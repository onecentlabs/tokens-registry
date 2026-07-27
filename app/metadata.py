"""Chain metadata + logo resolution.

Loaded once at startup into pre-serialized bytes. Chain logos are served from
local SVG assets when present, otherwise the remote ``logoURI`` from metadata.
"""

from __future__ import annotations

import logging

import orjson

from . import config

log = logging.getLogger("metadata")

# Placeholder in stored logo URLs, swapped for the live request host at serve
# time so logos resolve against whatever base URL the API is reached on.
BASE_PLACEHOLDER = b"{BASE}"


class ChainMetadata:
    def __init__(self) -> None:
        self.chains: list[dict] = []
        self.by_key: dict[str, dict] = {}
        self.by_id: dict[str, dict] = {}
        self.serialized: bytes = b"[]"
        self.serialized_light: bytes = b"[]"

    def load(self) -> None:
        try:
            self.chains = orjson.loads(config.METADATA_FILE.read_bytes())
        except Exception as exc:  # noqa: BLE001
            log.error("failed to load chain metadata: %s", exc)
            self.chains = []

        self.by_key = {}
        self.by_id = {}
        for chain in self.chains:
            key = str(chain.get("key", "")).lower()
            if key:
                self.by_key[key] = chain
            cid = chain.get("id")
            if cid is not None:
                self.by_id[str(cid)] = chain

        self.serialized = orjson.dumps(self.chains)
        light = [
            {
                "key": c.get("key"),
                "name": c.get("name"),
                "id": c.get("id"),
                "coin": c.get("coin"),
                "logoURI": c.get("logoURI"),
                "mainnet": c.get("mainnet"),
            }
            for c in self.chains
        ]
        self.serialized_light = orjson.dumps(light)
        log.info("loaded metadata for %d chains", len(self.chains))

    def resolve(self, key_or_id: str) -> dict | None:
        k = key_or_id.strip().lower()
        return self.by_key.get(k) or self.by_id.get(key_or_id.strip())

    def logo_path(self, key_or_id: str):
        """Return (local_svg_path | None, remote_url | None) for a chain logo."""
        chain = self.resolve(key_or_id)
        key = (chain.get("key") if chain else key_or_id).lower()
        local = config.ASSETS_DIR / "chains" / f"{key}.svg"
        if local.is_file():
            return local, None
        remote = chain.get("logoURI") if chain else None
        return None, remote


metadata = ChainMetadata()
