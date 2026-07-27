"""Refresh job: pull external token lists, merge into the registry, reload.

Fetches every source concurrently, groups tokens by chain, merges with the
existing on-disk registry (dedup by address, first-wins), applies optional
ban/custom/major overlays, strips non-whitelisted tags, writes the per-chain
files, then triggers an in-memory snapshot reload.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time

import httpx
import orjson

from . import config
from .registry import store
from .sources import SOURCES

log = logging.getLogger("refresh")

# CoinGecko serves logos at thumb (25px), small (50px), large (250px). Normalise
# to the 50px variant so UI logos stay crisp when downscaled and payloads stay
# light. Only rewrites CoinGecko image paths; other hosts are single-size.
_CG_SIZE_RE = re.compile(
    r"(https?://(?:assets|coin-images)\.coingecko\.com/coins/images/\d+/)"
    r"(?:thumb|large|standard)(/)"
)


def _normalize_logo(url: str | None) -> str | None:
    if not url:
        return url
    return _CG_SIZE_RE.sub(r"\1small\2", url)

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


# Jupiter Solana lists to pull each refresh: the verified tag (authoritative
# curated set) plus a few hot categories to catch trending tokens early.
_JUP_TAGS = ["verified"]
_JUP_CATEGORIES = [("toporganicscore", "24h"), ("toptrending", "24h"), ("toptraded", "24h")]
_JUP_CATEGORY_LIMIT = 100


def _jup_to_token(j: dict) -> dict | None:
    """Map a Jupiter token object to the registry (Uniswap-style) schema."""
    mint = j.get("id")
    decimals = j.get("decimals")
    if not mint or decimals is None:
        return None
    token: dict = {
        "chainId": config.SOLANA_CHAIN_ID,
        "address": mint,
        "name": j.get("name"),
        "symbol": j.get("symbol"),
        "decimals": decimals,
    }
    if j.get("icon"):
        token["logoURI"] = j["icon"]
    if j.get("isVerified"):
        token["tags"] = ["VERIFIED"]
    if "major" in (j.get("tags") or []):
        token["major"] = True
    ext: dict = {}
    score = j.get("organicScore")
    if score is not None:
        ext["organicScore"] = round(score, 2)
    if j.get("isVerified") is not None:
        ext["isVerified"] = bool(j["isVerified"])
    if ext:
        token["extensions"] = ext
    return token


async def _fetch_jupiter(client: httpx.AsyncClient, sem: asyncio.Semaphore) -> list[dict]:
    """Pull Solana tokens from Jupiter (verified tag + hot categories).

    Returns an empty list when no API key is configured. Deduped by mint,
    first-wins, so the verified list takes precedence over category overlaps.
    """
    if not config.JUP_API_KEY:
        return []
    headers = {"x-api-key": config.JUP_API_KEY}
    urls = [f"{config.JUP_API_BASE}/tag?query={t}" for t in _JUP_TAGS]
    urls += [
        f"{config.JUP_API_BASE}/{cat}/{iv}?limit={_JUP_CATEGORY_LIMIT}"
        for cat, iv in _JUP_CATEGORIES
    ]

    async def one(url: str) -> list[dict]:
        async with sem:
            try:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                data = orjson.loads(resp.content)
            except Exception as exc:  # noqa: BLE001 - a bad Jupiter call must not fail the run
                log.warning("jupiter source failed %s: %s", url, exc)
                return []
            return data if isinstance(data, list) else []

    results = await asyncio.gather(*(one(u) for u in urls))
    seen: set[str] = set()
    tokens: list[dict] = []
    for arr in results:
        for j in arr:
            tok = _jup_to_token(j)
            if not tok:
                continue
            key = tok["address"].lower()
            if key in seen:
                continue
            seen.add(key)
            tokens.append(tok)
    if tokens:
        log.info("jupiter: %d solana tokens", len(tokens))
    return tokens


def _read_json(path) -> list[dict]:
    if not path.is_file():
        return []
    try:
        return orjson.loads(path.read_bytes())
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to read %s: %s", path, exc)
        return []


def _merge_chain(chain_id: int, new_tokens: list[dict], source_wins: bool = False) -> list[dict]:
    registry_path = config.REGISTRY_DIR / f"{chain_id}.json"
    existing = _read_json(registry_path)

    # Dedup by address, first-wins. Existing entries take precedence by default;
    # with source_wins the fetched tokens win (used for Solana/Jupiter so
    # verification + organic score refresh every cycle).
    ordered = [*new_tokens, *existing] if source_wins else [*existing, *new_tokens]
    deduped: dict[str, dict] = {}
    for token in ordered:
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

    # Strip non-whitelisted tags; normalise CoinGecko logos to 50px.
    for t in tokens:
        tags = t.get("tags")
        if isinstance(tags, list) and not all(tag in config.WHITELISTED_TAGS for tag in tags):
            t.pop("tags", None)
        logo = t.get("logoURI")
        if logo:
            t["logoURI"] = _normalize_logo(logo)

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
            jup_tokens = await _fetch_jupiter(client, sem)

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

        # Jupiter Solana tokens go to the front so they win the source_wins merge.
        if jup_tokens:
            prev = tokens_by_chain.get(config.SOLANA_CHAIN_ID, [])
            tokens_by_chain[config.SOLANA_CHAIN_ID] = jup_tokens + prev

        written = 0
        config.REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
        for chain_id, new_tokens in tokens_by_chain.items():
            merged = _merge_chain(
                chain_id, new_tokens, source_wins=(chain_id == config.SOLANA_CHAIN_ID)
            )
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
