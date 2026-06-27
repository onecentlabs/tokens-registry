"""In-memory token store.

Everything is loaded once into an immutable ``Snapshot``. Reads grab the
current snapshot reference (a single attribute load, atomic in CPython) and
never touch the disk or a lock, so lookups are pure dict hits and list
responses are pre-serialized ``orjson`` bytes returned as-is.

A refresh builds a brand-new snapshot off to the side and swaps the reference
in one assignment, so readers never observe a half-built state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import orjson

from . import config

log = logging.getLogger("registry")

# chain name -> chain id (string). Mirrors the legacy TS registry aliases.
CHAIN_ALIASES: dict[str, str] = {
    "ETH": "1",
    "ETHEREUM": "1",
    "BNB": "56",
    "BSC": "56",
    "ARB": "42161",
    "ARBITRUM": "42161",
    "BASE": "8453",
    "GNOSIS": "100",
    "POL": "137",
    "POLYGON": "137",
    "OPTIMISM": "10",
    "OP": "10",
    "AVALANCHE": "43114",
    "AVAX": "43114",
    "LINEA": "59144",
    "BERACHAIN": "80094",
    "MANTLE": "5000",
    "SCROLL": "534352",
    "TAIKO": "167000",
    "SEI": "1329",
    "SONIC": "146",
    "BLAST": "81457",
    "UNICHAIN": "130",
    "HYPEREVM": "999",
    "PLASMA": "9745",
    "HEMI": "43111",
}

# Native gas-token placeholder rows that should not appear in token *lists*
# (symbol, chainId or None, frozenset of addresses considered placeholders).
_DEAD = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000"
_NATIVE_PLACEHOLDERS: list[tuple[str, int | None, frozenset[str]]] = [
    ("eth", None, frozenset({config.ZERO_ADDRESS})),
    ("eth", 10, frozenset({_DEAD})),
    ("avax", 43114, frozenset({config.ZERO_ADDRESS})),
    ("xdai", 100, frozenset({config.ZERO_ADDRESS})),
    ("pol", 137, frozenset({config.ZERO_ADDRESS, config.NATIVE_SENTINEL})),
    ("mnt", 5000, frozenset({config.ZERO_ADDRESS, _DEAD})),
    ("bnb", None, frozenset({config.ZERO_ADDRESS})),
]


def resolve_chain_id(chain: str) -> str:
    """Map a chain name/alias to its numeric id (as a string)."""
    if chain is None:
        return ""
    key = chain.strip()
    return CHAIN_ALIASES.get(key.upper(), key)


def _is_native_placeholder(token: dict) -> bool:
    symbol = token.get("symbol", "").lower()
    address = token.get("address", "").lower()
    chain_id = token.get("chainId")
    for sym, cid, addrs in _NATIVE_PLACEHOLDERS:
        if symbol == sym and (cid is None or cid == chain_id) and address in addrs:
            return True
    return False


def _looks_like_address(value: str) -> bool:
    if len(value) != 42 or not value.startswith("0x"):
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def _sort_chain_tokens(tokens: list[dict]) -> list[dict]:
    """Order a chain's tokens by tag priority, dropping native placeholders.

    A token is emitted at most once, under its highest-priority tag; untagged
    or lower-priority leftovers follow in their original order.
    """
    seen: set[str] = set()
    ordered: list[dict] = []
    for tag in config.TAG_PRIORITY:
        for token in tokens:
            if _is_native_placeholder(token):
                continue
            address = token.get("address", "")
            if address in seen:
                continue
            tags = token.get("tags")
            if tags and tag in tags:
                ordered.append(token)
                seen.add(address)
    for token in tokens:
        if _is_native_placeholder(token):
            continue
        address = token.get("address", "")
        if address in seen:
            continue
        ordered.append(token)
        seen.add(address)
    return ordered


@dataclass(frozen=True)
class Snapshot:
    """Immutable view of the whole registry. Swapped atomically on refresh."""

    # chain id -> sorted list of token dicts (native placeholders removed)
    sorted_by_chain: dict[str, list[dict]]
    # chain id -> address(lower) -> token  (raw, includes placeholders)
    by_address: dict[str, dict[str, dict]]
    # chain id -> symbol(lower) -> token
    by_symbol: dict[str, dict[str, dict]]
    # pre-serialized {"tokens": {chainId: [...]}} for the all-chains response
    serialized_all: bytes
    # pre-serialized per-chain {"tokens": {chainId: [...]}} responses
    serialized_chain: dict[str, bytes]
    chain_ids: list[str]
    token_count: int

    def get_token(self, token: str, chain: str) -> dict | None:
        chain_id = resolve_chain_id(chain)
        if _looks_like_address(token):
            return self.by_address.get(chain_id, {}).get(token.lower())
        return self.by_symbol.get(chain_id, {}).get(token.lower())

    def tokens_response(self, chains: list[str] | None) -> bytes:
        """Return pre-serialized JSON bytes for the /tokens endpoint."""
        if not chains:
            return self.serialized_all
        wanted = [resolve_chain_id(c) for c in chains]
        # Single-chain hits a precomputed cache entry directly.
        if len(wanted) == 1 and wanted[0] in self.serialized_chain:
            return self.serialized_chain[wanted[0]]
        payload = {
            cid: self.sorted_by_chain[cid]
            for cid in wanted
            if cid in self.sorted_by_chain
        }
        return orjson.dumps({"tokens": payload})


def build_snapshot() -> Snapshot:
    """Read every registry file from disk and build indexes + caches."""
    sorted_by_chain: dict[str, list[dict]] = {}
    by_address: dict[str, dict[str, dict]] = {}
    by_symbol: dict[str, dict[str, dict]] = {}
    serialized_chain: dict[str, bytes] = {}
    token_count = 0

    files = sorted(config.REGISTRY_DIR.glob("*.json"))
    for path in files:
        chain_id = path.stem
        try:
            tokens: list[dict] = orjson.loads(path.read_bytes())
        except Exception as exc:  # noqa: BLE001 - skip a corrupt file, keep serving
            log.error("failed to parse %s: %s", path.name, exc)
            continue
        if not isinstance(tokens, list):
            continue

        addr_index: dict[str, dict] = {}
        sym_index: dict[str, dict] = {}
        for token in tokens:
            addr = token.get("address")
            if not addr:
                continue
            addr_index.setdefault(addr.lower(), token)
            sym = token.get("symbol")
            if sym:
                sym_index.setdefault(sym.lower(), token)

        ordered = _sort_chain_tokens(tokens)
        sorted_by_chain[chain_id] = ordered
        by_address[chain_id] = addr_index
        by_symbol[chain_id] = sym_index
        serialized_chain[chain_id] = orjson.dumps({"tokens": {chain_id: ordered}})
        token_count += len(ordered)

    serialized_all = orjson.dumps({"tokens": sorted_by_chain})
    log.info("loaded %d tokens across %d chains", token_count, len(sorted_by_chain))
    return Snapshot(
        sorted_by_chain=sorted_by_chain,
        by_address=by_address,
        by_symbol=by_symbol,
        serialized_all=serialized_all,
        serialized_chain=serialized_chain,
        chain_ids=sorted(sorted_by_chain.keys(), key=lambda x: int(x) if x.isdigit() else 0),
        token_count=token_count,
    )


class Store:
    """Holds the current snapshot and swaps it atomically on reload."""

    def __init__(self) -> None:
        self._snapshot: Snapshot | None = None

    @property
    def snapshot(self) -> Snapshot:
        if self._snapshot is None:
            raise RuntimeError("registry not loaded")
        return self._snapshot

    def reload(self) -> Snapshot:
        snap = build_snapshot()
        self._snapshot = snap  # atomic reference swap
        return snap


store = Store()
