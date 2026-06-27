"""Refresh job: pull external token lists, merge into the registry, reload.

Fetches every source concurrently, groups tokens by chain, merges with the
existing on-disk registry (dedup by address, first-wins), applies optional
ban/custom/major overlays, strips non-whitelisted tags, writes the per-chain
files, then triggers an in-memory snapshot reload.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import orjson

from . import config
from .registry import store
from .sources import SOURCES

log = logging.getLogger("refresh")

_lock = asyncio.Lock()
_last_run: dict = {"at": None, "duration": None, "sources_ok": 0, "sources_failed": 0}


def last_run() -> dict:
    return dict(_last_run)


async def _fetch(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> list[dict]:
    async with sem:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = orjson.loads(resp.content)
        except Exception as exc:  # noqa: BLE001 - one bad source must not fail the run
            log.warning("source failed %s: %s", url, exc)
            raise
        tokens = data.get("tokens") if isinstance(data, dict) else None
        if not isinstance(tokens, list):
            log.warning("no tokens array at %s", url)
            return []
        return tokens


def _read_json(path) -> list[dict]:
    if not path.is_file():
        return []
    try:
        return orjson.loads(path.read_bytes())
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to read %s: %s", path, exc)
        return []


def _merge_chain(chain_id: int, new_tokens: list[dict]) -> list[dict]:
    registry_path = config.REGISTRY_DIR / f"{chain_id}.json"
    existing = _read_json(registry_path)

    # Dedup by address, first-wins (existing entries take precedence).
    deduped: dict[str, dict] = {}
    for token in [*existing, *new_tokens]:
        addr = token.get("address")
        if not addr:
            continue
        deduped.setdefault(addr.lower(), token)
    tokens = list(deduped.values())

    # Ban list: drop addresses.
    ban = _read_json(config.OVERLAYS_DIR / "ban" / f"{chain_id}.json")
    if ban:
        banned = {t.get("address", "").lower() for t in ban}
        tokens = [t for t in tokens if t.get("address", "").lower() not in banned]

    # Custom list: override or add.
    custom = _read_json(config.OVERLAYS_DIR / "custom" / f"{chain_id}.json")
    if custom:
        index = {t.get("address", "").lower(): t for t in tokens}
        for t in custom:
            addr = t.get("address")
            if addr:
                index[addr.lower()] = t
        tokens = list(index.values())

    # Major list: flag tokens.
    major = _read_json(config.OVERLAYS_DIR / "major" / f"{chain_id}.json")
    if major:
        flagged = {t.get("address", "").lower() for t in major}
        for t in tokens:
            if t.get("address", "").lower() in flagged:
                t["major"] = True

    # Strip non-whitelisted tags.
    for t in tokens:
        tags = t.get("tags")
        if isinstance(tags, list) and not all(tag in config.WHITELISTED_TAGS for tag in tags):
            t.pop("tags", None)

    return tokens


async def run_refresh() -> dict:
    """Execute one refresh cycle. Serialized via a lock; concurrent callers wait."""
    async with _lock:
        start = time.monotonic()
        sem = asyncio.Semaphore(config.REFRESH_CONCURRENCY)
        ok = 0
        failed = 0
        tokens_by_chain: dict[int, list[dict]] = {}

        async with httpx.AsyncClient(
            timeout=config.REFRESH_HTTP_TIMEOUT,
            follow_redirects=True,
            headers={"user-agent": "tokens-registry/1.0"},
        ) as client:
            results = await asyncio.gather(
                *(_fetch(client, url, sem) for url in SOURCES),
                return_exceptions=True,
            )

        for result in results:
            if isinstance(result, Exception):
                failed += 1
                continue
            ok += 1
            for token in result:
                cid = token.get("chainId")
                addr = token.get("address")
                if cid is None or not addr:
                    continue
                tokens_by_chain.setdefault(int(cid), []).append(token)

        written = 0
        config.REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
        for chain_id, new_tokens in tokens_by_chain.items():
            merged = _merge_chain(chain_id, new_tokens)
            path = config.REGISTRY_DIR / f"{chain_id}.json"
            path.write_bytes(orjson.dumps(merged, option=orjson.OPT_INDENT_2))
            written += len(merged)

        # Swap in the freshly written data.
        snap = store.reload()

        duration = round(time.monotonic() - start, 2)
        _last_run.update(
            at=time.time(),
            duration=duration,
            sources_ok=ok,
            sources_failed=failed,
            chains=len(tokens_by_chain),
            tokens=snap.token_count,
        )
        log.info(
            "refresh done in %ss: %d ok / %d failed, %d chains, %d tokens",
            duration, ok, failed, len(tokens_by_chain), snap.token_count,
        )
        return last_run()
