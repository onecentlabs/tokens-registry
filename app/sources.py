"""External token-list sources pulled by the refresh job.

All sources follow the Uniswap token-list schema: a JSON object with a
top-level ``tokens`` array of ``{chainId, address, symbol, name, decimals,
logoURI, tags}`` entries.
"""

SOURCES: list[str] = [
    # Uniswap-style aggregated lists
    "https://ipfs.io/ipns/tokens.uniswap.org",
    "https://tokens.1inch.eth.link",
    "https://tokenlist.aave.eth.link",
    "https://synths.snx.eth.link",
    "https://defi.cmc.eth.link",
    "https://erc20.cmc.eth.link",
    "https://stablecoin.cmc.eth.link",
    # Exchanges / protocols
    "https://files.cow.fi/tokens/CoinGecko.json",
    "https://files.cow.fi/tokens/CowSwap.json",
    "https://www.gemini.com/uniswap/manifest.json",
    "https://tokens.pancakeswap.finance/pancakeswap-extended.json",
    "https://tokens.honeyswap.org/",
    "https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json",
    # Ecosystem specific
    "https://static.optimism.io/optimism.tokenlist.json",
    # CoinGecko per-chain
    "https://tokens.coingecko.com/ethereum/all.json",
    "https://tokens.coingecko.com/arbitrum-one/all.json",
    "https://tokens.coingecko.com/avalanche/all.json",
    "https://tokens.coingecko.com/base/all.json",
    "https://tokens.coingecko.com/blast/all.json",
    "https://tokens.coingecko.com/linea/all.json",
    "https://tokens.coingecko.com/mantle/all.json",
    "https://tokens.coingecko.com/optimistic-ethereum/all.json",
    "https://tokens.coingecko.com/polygon-pos/all.json",
    "https://tokens.coingecko.com/scroll/all.json",
    "https://tokens.coingecko.com/sonic/all.json",
    "https://tokens.coingecko.com/berachain/all.json",
    "https://tokens.coingecko.com/hyperevm/all.json",
    "https://tokens.coingecko.com/robinhood/all.json",
]
