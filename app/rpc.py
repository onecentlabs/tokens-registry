"""Optional on-chain fallback for tokens missing from the registry.

Minimal ERC20 reader over raw JSON-RPC ``eth_call`` (no web3 dependency).
This is the *slow* path: it only runs on a registry miss and is network bound.
"""

from __future__ import annotations

import logging

import httpx

from . import config
from .metadata import metadata
from .registry import resolve_chain_id, _looks_like_address

log = logging.getLogger("rpc")

SEL_NAME = "0x06fdde03"
SEL_SYMBOL = "0x95d89b41"
SEL_DECIMALS = "0x313ce567"


def _decode_string(hex_result: str) -> str:
    """Decode an ABI-encoded string or bytes32 return value."""
    raw = bytes.fromhex(hex_result[2:]) if hex_result.startswith("0x") else bytes.fromhex(hex_result)
    if len(raw) == 32:
        # bytes32-style return (legacy tokens like MKR): trim null padding.
        return raw.rstrip(b"\x00").decode("utf-8", "ignore")
    if len(raw) >= 64:
        length = int.from_bytes(raw[32:64], "big")
        data = raw[64:64 + length]
        return data.decode("utf-8", "ignore")
    return raw.rstrip(b"\x00").decode("utf-8", "ignore")


def _rpc_urls(chain_id: str) -> list[str]:
    chain = metadata.by_id.get(chain_id)
    if chain and chain.get("metamask", {}).get("rpcUrls"):
        return chain["metamask"]["rpcUrls"]
    return []


async def _eth_call(client: httpx.AsyncClient, url: str, to: str, data: str) -> str:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
    }
    resp = await client.post(url, json=payload)
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(body["error"])
    return body["result"]


async def fetch_token(address: str, chain: str) -> dict | None:
    if not config.RPC_FALLBACK_ENABLED or not _looks_like_address(address):
        return None
    chain_id = resolve_chain_id(chain)
    urls = _rpc_urls(chain_id)
    if not urls:
        return None

    async with httpx.AsyncClient(timeout=config.RPC_HTTP_TIMEOUT) as client:
        for url in urls:
            try:
                name = _decode_string(await _eth_call(client, url, address, SEL_NAME))
                symbol = _decode_string(await _eth_call(client, url, address, SEL_SYMBOL))
                dec_hex = await _eth_call(client, url, address, SEL_DECIMALS)
                decimals = int(dec_hex, 16) if dec_hex and dec_hex != "0x" else 18
                return {
                    "chainId": int(chain_id) if chain_id.isdigit() else chain_id,
                    "address": address,
                    "symbol": symbol,
                    "name": name,
                    "decimals": decimals,
                    "logoURI": "",
                    "tags": ["NOT_VERIFIED"],
                }
            except Exception as exc:  # noqa: BLE001 - try the next RPC url
                log.warning("rpc fetch failed via %s: %s", url, exc)
                continue
    return None
