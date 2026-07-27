"""FastAPI app. Hot paths return pre-serialized bytes for sub-millisecond latency."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

import orjson

from . import __version__, config
from .metadata import BASE_PLACEHOLDER, metadata
from .refresh import last_run, run_refresh
from .registry import store
from .rpc import fetch_token
from .scheduler import start as start_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("api")

JSON = "application/json"


def _public_base(request: Request) -> bytes:
    """Scheme+host the client reached us on, honoring proxy forwarding headers."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    return f"{proto}://{host}".encode()


def _with_base(body: bytes, request: Request) -> bytes:
    """Swap the {BASE} placeholder in serialized metadata for the live host."""
    if BASE_PLACEHOLDER not in body:
        return body
    return body.replace(BASE_PLACEHOLDER, _public_base(request))


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.reload()
    metadata.load()
    if config.REFRESH_ON_STARTUP:
        asyncio.create_task(run_refresh())
    task = start_scheduler()
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Token Registry API",
    version=__version__,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Raw logo/asset files: /assets/chains/<key>.svg, /assets/tokens/<chainId>/<sym>.svg
app.mount("/assets", StaticFiles(directory=str(config.ASSETS_DIR)), name="assets")


@app.get("/")
async def root():
    return {"service": "token-registry", "version": __version__, "status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok", "tokens": store.snapshot.token_count, "chains": len(store.snapshot.chain_ids)}


@app.get("/stats")
async def stats():
    snap = store.snapshot
    return {
        "tokens": snap.token_count,
        "chains": snap.chain_ids,
        "last_refresh": last_run(),
    }


@app.get("/tokens")
async def tokens(chains: str | None = Query(default=None, description="comma-separated chain ids or names")):
    chain_list = [c for c in chains.split(",") if c] if chains else None
    body = store.snapshot.tokens_response(chain_list)
    return Response(content=body, media_type=JSON)


@app.get("/token")
async def token(
    chain: str = Query(..., description="chain id or name"),
    token: str = Query(..., description="token symbol or address"),
):
    snap = store.snapshot
    found = snap.get_token(token, chain)
    if found is not None:
        return found

    # Not on the requested chain: scan the other chains by symbol/address.
    for chain_id in snap.chain_ids:
        alt = snap.get_token(token, chain_id)
        if alt is not None:
            return alt

    # Last resort: read it on-chain (slow path).
    fetched = await fetch_token(token, chain)
    if fetched is not None:
        return fetched
    raise HTTPException(status_code=404, detail="token not found")


@app.get("/chains")
async def chains(request: Request, full: bool = Query(default=False)):
    body = metadata.serialized if full else metadata.serialized_light
    return Response(content=_with_base(body, request), media_type=JSON)


@app.get("/chains/{key}")
async def chain(key: str, request: Request):
    found = metadata.resolve(key)
    if found is None:
        raise HTTPException(status_code=404, detail="chain not found")
    return Response(content=_with_base(orjson.dumps(found), request), media_type=JSON)


@app.get("/chains/{key}/logo")
async def chain_logo(key: str):
    local, remote = metadata.logo_path(key)
    if local is not None:
        return FileResponse(local, media_type="image/svg+xml", headers={"cache-control": "public, max-age=86400"})
    if remote:
        return RedirectResponse(remote)
    raise HTTPException(status_code=404, detail="logo not found")


@app.post("/refresh")
async def refresh(request: Request):
    if config.REFRESH_TOKEN:
        provided = request.headers.get("x-refresh-token", "")
        if provided != config.REFRESH_TOKEN:
            raise HTTPException(status_code=401, detail="invalid refresh token")
    result = await run_refresh()
    return {"status": "ok", "result": result}
