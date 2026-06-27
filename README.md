# Token Registry API (FastAPI)

Fast, in-memory token registry across EVM chains. Tokens are loaded once into
an immutable snapshot and served as **pre-serialized `orjson` bytes**, so reads
are dict hits or a `memcpy` — sub-millisecond latency, no per-request encoding.
The registry auto-updates from external token lists in the background.

## Why it's fast

- **In-memory snapshot.** Every registry file is parsed at startup into indexes
  (`by_address`, `by_symbol`) plus a pre-sorted list per chain.
- **Pre-serialized responses.** `/tokens` payloads are `orjson`-encoded once at
  load time and returned as raw bytes — serving is just shipping cached bytes.
- **Lock-free reads.** A refresh builds a new snapshot off to the side and swaps
  one reference atomically; readers never block and never see a partial state.
- **No DB.** Files in, memory out.

Measured locally (incl. curl + loopback overhead, ~21k tokens / 53 chains):

| Endpoint | Latency |
|---|---|
| `/token?chain=ETH&token=USDC` | ~0.4 ms |
| `/tokens?chains=ETH` | ~1.3 ms |
| `/tokens` (full, ~5 MB) | ~2.5 ms (transfer-bound) |
| `get_token()` in-process | ~0.0002 ms |

## Run

```bash
./run.sh                      # http://localhost:8000
# or
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Production (multi-core):

```bash
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Each worker holds its own snapshot — put nginx/ALB in front for HTTP caching of
`/tokens` and `/chains/*/logo` (responses are deterministic between refreshes).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | service info |
| GET | `/health` | status + counts |
| GET | `/stats` | chains, token count, last refresh info |
| GET | `/tokens` | all tokens, grouped by chain id, tag-sorted |
| GET | `/tokens?chains=ETH,56` | filter by chain id or alias (comma-separated) |
| GET | `/token?chain=ETH&token=USDC` | lookup by symbol **or** address; falls back across chains then to on-chain RPC |
| GET | `/chains` | chain metadata (light); `?full=true` for everything |
| GET | `/chains/{key}` | one chain (key like `ethereum` or id like `1`) |
| GET | `/chains/{key}/logo` | chain logo SVG (local asset, else redirect to remote) |
| GET | `/assets/chains/{key}.svg` | raw logo files (also token logos under `/assets/tokens/...`) |
| POST | `/refresh` | trigger a refresh now (header `x-refresh-token` if `REFRESH_TOKEN` set) |

Chain aliases (`ETH`, `BNB`, `ARB`, `BASE`, `POL`, ...) and numeric ids both work.

## Auto-update

A background task pulls the source lists in `app/sources.py` every
`REFRESH_INTERVAL_SECONDS` (default 6h), merges them into `data/registry/*.json`
(dedup by address, first-wins), applies optional overlays, then hot-swaps the
in-memory snapshot. Sources are fetched concurrently; a failing source is
skipped, not fatal.

Overlays (optional, per chain id) under `data/overlays/`:

- `ban/<chainId>.json` — array of `{address}` to remove
- `custom/<chainId>.json` — array of full `Token`s to add/override
- `major/<chainId>.json` — array of `{address}` to flag with `"major": true`

## Logos

- **Chain logos** are bundled under `assets/chains/<key>.svg` and served at
  `GET /chains/{key}/logo` (falls back to the metadata `logoURI` if no local
  file). Raw files are also at `GET /assets/chains/<key>.svg`.
- **Token logos** ship per-token as `logoURI` in the registry, and bundled SVGs
  live under `assets/tokens/<chainId>/...` served at `/assets/tokens/...`.

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `REFRESH_INTERVAL_SECONDS` | `21600` | auto-refresh cadence; `0` disables |
| `REFRESH_ON_STARTUP` | `false` | run a refresh right after boot |
| `REFRESH_TOKEN` | _(empty)_ | require `x-refresh-token` header on `POST /refresh` |
| `REFRESH_CONCURRENCY` | `16` | parallel source fetches |
| `RPC_FALLBACK_ENABLED` | `true` | read unknown tokens on-chain via JSON-RPC |
| `REGISTRY_DIR` / `CHAINS_DIR` / `ASSETS_DIR` | `data/...`, `assets/` | data locations |

## Layout

```
app/
  main.py        FastAPI app + routes
  registry.py    in-memory store, indexes, snapshot, pre-serialization
  refresh.py     fetch external lists, merge, overlays, write + reload
  scheduler.py   background auto-refresh loop
  metadata.py    chain metadata + logo resolution
  rpc.py         optional on-chain ERC20 fallback (no web3 dep)
  sources.py     external token-list URLs
  config.py      env-driven settings
data/
  registry/<chainId>.json   per-chain token lists (auto-updated)
  chains/metadata.json      chain metadata
  overlays/{ban,custom,major}/<chainId>.json
assets/
  chains/<key>.svg          chain logos
  tokens/<chainId>/...       token logos
```
