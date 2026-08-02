import path from 'node:path'
import fs from 'node:fs'

import type { Token, TokenList } from './types'
import fetchList from './fetch'
import { __dirname } from './global'
import urls from './urls'

// Whitelisted token tags
const WHITELISTED_TAGS = new Set([
  'FEATURED',
  'POPULAR',
  'VERIFIED',
  'STABLE',
  'TRADE_VOLUME',
  'CEX',
  'GOVERNANCE',
  'NATIVE',
  'MEME',
  'UTILITY',
  'WRAPPED',
])

// Normalise CoinGecko logos to 50px (small)
function normalizeLogoURI(logoURI?: string): string | undefined {
  if (!logoURI) return logoURI
  return logoURI.replace(
    /(https?:\/\/(?:assets|coin-images)\.coingecko\.com\/coins\/images\/\d+\/)(?:thumb|large|standard)(\/)/,
    '$1small$2'
  )
}

// Jupiter Solana Token Fetcher
async function fetchJupiterSolanaTokens(): Promise<Token[]> {
  const SOLANA_CHAIN_ID = 501000101
  const jupUrl = 'https://tokens.jup.ag/tokens?tags=verified'
  try {
    console.log(`Fetching Solana tokens from Jupiter: ${jupUrl}`)
    const res = await fetch(jupUrl)
    if (!res.ok) return []
    const data = (await res.json()) as any[]
    if (!Array.isArray(data)) return []

    const tokens: Token[] = []
    for (const item of data) {
      if (!item.id || item.decimals === undefined) continue
      tokens.push({
        chainId: SOLANA_CHAIN_ID,
        address: item.id,
        name: item.name,
        symbol: item.symbol,
        decimals: item.decimals,
        logoURI: normalizeLogoURI(item.icon),
        tags: item.isVerified ? ['VERIFIED'] : undefined,
        extensions: item.organicScore ? { organicScore: Math.round(item.organicScore * 100) / 100 } : undefined,
      })
    }
    console.log(`Fetched ${tokens.length} Solana tokens from Jupiter`)
    return tokens
  } catch (err) {
    console.warn('Failed to fetch Jupiter Solana tokens:', err)
    return []
  }
}

const main = async () => {
  const tokensByChain: Record<number, Token[]> = {}

  // Fetch standard token lists
  for (const url of urls) {
    console.log(`Fetching from: ${url}`)
    try {
      const data: Partial<TokenList> = await fetchList(url)

      if (!Array.isArray(data.tokens)) {
        console.warn(`No tokens array found at: ${url}`)
        continue
      }

      for (const token of data.tokens) {
        if (!token.chainId || !token.address) {
          continue
        }

        const chainId = token.chainId
        if (!tokensByChain[chainId]) {
          tokensByChain[chainId] = []
        }
        tokensByChain[chainId].push(token)
      }
    } catch (error) {
      console.error(`Error fetching ${url}:`, error)
    }
  }

  // Fetch Jupiter Solana tokens
  const solanaTokens = await fetchJupiterSolanaTokens()
  if (solanaTokens.length > 0) {
    const SOLANA_CHAIN_ID = 501000101
    if (!tokensByChain[SOLANA_CHAIN_ID]) {
      tokensByChain[SOLANA_CHAIN_ID] = []
    }
    tokensByChain[SOLANA_CHAIN_ID].unshift(...solanaTokens)
  }

  // Process and merge each chain
  for (const chainIdStr of Object.keys(tokensByChain)) {
    const chainId = parseInt(chainIdStr, 10)
    const newTokens = tokensByChain[chainId]

    const dataRegistryPath = path.join(__dirname, '..', 'data', 'registry', `${chainId}.json`)
    const rootRegistryPath = path.join(__dirname, '..', 'registry', `${chainId}.json`)

    if (!fs.existsSync(path.dirname(dataRegistryPath))) {
      fs.mkdirSync(path.dirname(dataRegistryPath), { recursive: true })
    }
    if (!fs.existsSync(path.dirname(rootRegistryPath))) {
      fs.mkdirSync(path.dirname(rootRegistryPath), { recursive: true })
    }

    let existingTokens: Token[] = []
    const readPath = fs.existsSync(dataRegistryPath) ? dataRegistryPath : (fs.existsSync(rootRegistryPath) ? rootRegistryPath : null)
    if (readPath) {
      try {
        const fileData = fs.readFileSync(readPath, 'utf8')
        existingTokens = JSON.parse(fileData)
      } catch (error) {
        console.warn(`Failed to parse existing tokens for chainId=${chainId}`, error)
      }
    }

    // Combine existing + new (for Solana, new/Jupiter tokens take precedence)
    const combinedTokens = chainId === 501000101 ? [...newTokens, ...existingTokens] : [...existingTokens, ...newTokens]

    // Deduplicate by address (case-insensitive)
    const deduped: Record<string, Token> = {}
    for (const t of combinedTokens) {
      if (!t.address) continue
      const addressKey = t.address.toLowerCase()
      if (!deduped[addressKey]) {
        deduped[addressKey] = t
      }
    }

    let finalTokens = Object.values(deduped)

    // Process Ban List
    const banPath = fs.existsSync(path.join(__dirname, '..', 'data', 'ban', `${chainId}.json`))
      ? path.join(__dirname, '..', 'data', 'ban', `${chainId}.json`)
      : path.join(__dirname, '..', 'ban', `${chainId}.json`)

    if (fs.existsSync(banPath)) {
      try {
        const banData: Array<Partial<Token>> = JSON.parse(fs.readFileSync(banPath, 'utf8'))
        const bannedAddresses = new Set(banData.map((token) => token?.address?.toLowerCase()))
        finalTokens = finalTokens.filter(
          (token) => !bannedAddresses.has(token.address.toLowerCase())
        )
        console.log(`🔨 Applied ban list: Removed ${bannedAddresses.size} tokens from chainId=${chainId}`)
      } catch (error) {
        console.warn(`Failed to process ban list for chainId=${chainId}`, error)
      }
    }

    // Custom Tokens
    const customPath = fs.existsSync(path.join(__dirname, '..', 'data', 'custom', `${chainId}.json`))
      ? path.join(__dirname, '..', 'data', 'custom', `${chainId}.json`)
      : path.join(__dirname, '..', 'custom', `${chainId}.json`)

    if (fs.existsSync(customPath)) {
      try {
        const customData: Token[] = JSON.parse(fs.readFileSync(customPath, 'utf8'))
        const customMap: Record<string, Token> = {}
        for (const token of customData) {
          if (!token.address) continue
          customMap[token.address.toLowerCase()] = token
        }

        const tokenMap: Record<string, Token> = {}
        for (const token of finalTokens) {
          tokenMap[token.address.toLowerCase()] = token
        }

        for (const [address, customToken] of Object.entries(customMap)) {
          tokenMap[address] = customToken
        }

        finalTokens = Object.values(tokenMap)
        console.log(`✨ Applied custom list: Added/Overridden ${customData.length} tokens to chainId=${chainId}`)
      } catch (error) {
        console.warn(`Failed to process custom list for chainId=${chainId}`, error)
      }
    }

    // Major Tokens
    const majorPath = fs.existsSync(path.join(__dirname, '..', 'data', 'major', `${chainId}.json`))
      ? path.join(__dirname, '..', 'data', 'major', `${chainId}.json`)
      : path.join(__dirname, '..', 'major', `${chainId}.json`)

    if (fs.existsSync(majorPath)) {
      try {
        const majorData: Array<Partial<Token>> = JSON.parse(fs.readFileSync(majorPath, 'utf8'))
        const majorAddresses = new Set(majorData.map((token) => token?.address?.toLowerCase()))

        finalTokens = finalTokens.map((token) => {
          if (majorAddresses.has(token.address.toLowerCase())) {
            return { ...token, major: true }
          }
          return token
        })
        console.log(`⭐ Applied major list: Marked ${majorAddresses.size} tokens as major for chainId=${chainId}`)
      } catch (error) {
        console.warn(`Failed to process major list for chainId=${chainId}`, error)
      }
    }

    // Filter tags & normalize logoURIs
    finalTokens = finalTokens.map((token) => {
      if (Array.isArray(token.tags)) {
        if (!token.tags.every((tag) => WHITELISTED_TAGS.has(tag))) {
          delete token.tags
        }
      }
      if (token.logoURI) {
        token.logoURI = normalizeLogoURI(token.logoURI)
      }
      return token
    })

    const formattedJson = JSON.stringify(finalTokens, null, 2)
    fs.writeFileSync(dataRegistryPath, formattedJson, 'utf8')
    fs.writeFileSync(rootRegistryPath, formattedJson, 'utf8')
    console.log(`✅ Wrote ${finalTokens.length} tokens to ${dataRegistryPath} and ${rootRegistryPath}`)
  }

  // Sync chain metadata files if data/chains exists
  const dataChainsDir = path.join(__dirname, '..', 'data', 'chains')
  const rootChainsDir = path.join(__dirname, '..', 'chains')
  if (fs.existsSync(dataChainsDir) && fs.existsSync(rootChainsDir)) {
    const chainFiles = fs.readdirSync(dataChainsDir).filter(f => f.endsWith('.json'))
    for (const f of chainFiles) {
      fs.copyFileSync(path.join(dataChainsDir, f), path.join(rootChainsDir, f))
    }
  }
}

main()
