"""Runtime configuration. All overridable via environment variables."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Filesystem layout
REGISTRY_DIR = Path(os.getenv("REGISTRY_DIR", ROOT / "data" / "registry"))
CHAINS_DIR = Path(os.getenv("CHAINS_DIR", ROOT / "data" / "chains"))
OVERLAYS_DIR = Path(os.getenv("OVERLAYS_DIR", ROOT / "data" / "overlays"))
ASSETS_DIR = Path(os.getenv("ASSETS_DIR", ROOT / "assets"))
METADATA_FILE = CHAINS_DIR / "metadata.json"

# Auto-refresh: background task pulls external token lists on this cadence.
# 0 disables the scheduler (refresh can still be triggered via POST /refresh).
REFRESH_INTERVAL_SECONDS = int(os.getenv("REFRESH_INTERVAL_SECONDS", str(6 * 60 * 60)))
REFRESH_ON_STARTUP = os.getenv("REFRESH_ON_STARTUP", "false").lower() == "true"
REFRESH_HTTP_TIMEOUT = float(os.getenv("REFRESH_HTTP_TIMEOUT", "20"))
REFRESH_CONCURRENCY = int(os.getenv("REFRESH_CONCURRENCY", "16"))

# Protect the manual refresh endpoint. Empty == open (dev).
REFRESH_TOKEN = os.getenv("REFRESH_TOKEN", "")

# RPC fallback for tokens not in the registry (slow path; network bound).
RPC_FALLBACK_ENABLED = os.getenv("RPC_FALLBACK_ENABLED", "true").lower() == "true"
RPC_HTTP_TIMEOUT = float(os.getenv("RPC_HTTP_TIMEOUT", "5"))

# Jupiter Tokens API — Solana source. Fetched during refresh only when a key is
# set. Provides verification status + organic score for the Solana registry.
JUP_API_KEY = os.getenv("JUP_API_KEY", "")
JUP_API_BASE = os.getenv("JUP_API_BASE", "https://api.jup.ag/tokens/v2")
SOLANA_CHAIN_ID = int(os.getenv("SOLANA_CHAIN_ID", "501000101"))

# Sentinel address used for native gas tokens across the ecosystem.
NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Tag ordering used when sorting a chain's token list (highest priority first).
TAG_PRIORITY = [
    "FEATURED",
    "NATIVE",
    "TRADE_VOLUME",
    "STABLE",
    "POPULAR",
    "GOVERNANCE",
    "WRAPPED",
    "MEME",
    "UTILITY",
    "VERIFIED",
]

# Only these tags survive a refresh; everything else is stripped.
WHITELISTED_TAGS = {
    "FEATURED",
    "POPULAR",
    "VERIFIED",
    "STABLE",
    "TRADE_VOLUME",
    "CEX",
    "GOVERNANCE",
    "NATIVE",
    "MEME",
    "UTILITY",
    "WRAPPED",
}
