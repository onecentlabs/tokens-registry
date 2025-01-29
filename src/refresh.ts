import path from 'path'
import fs from 'fs'

import type { Token, TokenList } from './types'
import fetch from './fetch'
import { __dirname } from './global'
import urls from './urls'

const main = async () => {
  const tokensByChain: Record<number, Token[]> = {}

  for (const url of urls) {
    console.log(`Fetching from: ${url}`)

    try {
      const data: Partial<TokenList> = await fetch(url)

      // If there's a `tokens` array, we'll parse it:
      if (!Array.isArray(data.tokens)) {
        console.warn(`No tokens array found at: ${url}`)
        continue
      }

      for (const token of data.tokens) {
        // skip if missing chainId/address
        if (!token.chainId || !token.address) {
          continue
        }

        const chainId = token.chainId

        // Initialize array if needed
        if (!tokensByChain[chainId]) {
          tokensByChain[chainId] = []
        }

        tokensByChain[chainId].push(token)
      }
    } catch (error) {
      console.error(`Error fetching ${url}:`, error)
    }
  }

  for (const chainIdStr of Object.keys(tokensByChain)) {
    const chainId = parseInt(chainIdStr, 10)
    const newTokens = tokensByChain[chainId]

    const registryPath = path.join(__dirname, '..', 'registry', `${chainId}.json`)

    // Create registry directory (if needed)
    if (!fs.existsSync(path.dirname(registryPath))) {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    }

    let existingTokens: Token[] = []
    if (fs.existsSync(registryPath)) {
      try {
        const fileData = fs.readFileSync(registryPath, 'utf8')
        existingTokens = JSON.parse(fileData)
      } catch (error) {
        console.warn(`Failed to parse existing tokens for chainId=${chainId}`, error)
      }
    }

    // Combine existing + new
    const combinedTokens = [...existingTokens, ...newTokens]

    // Deduplicate by address (case-insensitive)
    const deduped: Record<string, Token> = {}
    for (const t of combinedTokens) {
      const addressKey = t.address.toLowerCase()
      if (!deduped[addressKey]) {
        deduped[addressKey] = t
      }
    }

    let finalTokens = Object.values(deduped)

    // Process Ban List
    const banPath = path.join(__dirname, '..', 'ban', `${chainId}.json`)
    if (fs.existsSync(banPath)) {
      try {
        const banData: Array<Partial<Token>> = JSON.parse(fs.readFileSync(banPath, 'utf8'))

        const bannedAddresses = new Set(banData.map((token) => token?.address?.toLowerCase()))

        finalTokens = finalTokens.filter(
          (token) => !bannedAddresses.has(token.address.toLowerCase())
        )

        console.log(
          `🔨 Applied ban list: Removed ${bannedAddresses.size} tokens from chainId=${chainId}`
        )
      } catch (error) {
        console.warn(`Failed to process ban list for chainId=${chainId}`, error)
      }
    }

    // Custom Tokens
    const customPath = path.join(__dirname, '..', 'custom', `${chainId}.json`)
    if (fs.existsSync(customPath)) {
      try {
        const customData: Token[] = JSON.parse(fs.readFileSync(customPath, 'utf8'))

        const customMap: Record<string, Token> = {}
        for (const token of customData) {
          if (!token.address) continue
          customMap[token.address.toLowerCase()] = token
        }

        // Override existing tokens with custom tokens or add new ones
        const tokenMap: Record<string, Token> = {}
        for (const token of finalTokens) {
          tokenMap[token.address.toLowerCase()] = token
        }

        for (const [address, customToken] of Object.entries(customMap)) {
          tokenMap[address] = customToken
        }

        finalTokens = Object.values(tokenMap)

        console.log(
          `✨ Applied custom list: Added/Overridden ${customData.length} tokens to chainId=${chainId}`
        )
      } catch (error) {
        console.warn(`Failed to process custom list for chainId=${chainId}`, error)
      }
    }

    // Add major flag to tokens
    const majorPath = path.join(__dirname, '..', 'major', `${chainId}.json`)
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

        console.log(
          `⭐ Applied major list: Marked ${majorAddresses.size} tokens as major for chainId=${chainId}`
        )
      } catch (error) {
        console.warn(`Failed to process major list for chainId=${chainId}`, error)
      }
    }

    fs.writeFileSync(registryPath, JSON.stringify(finalTokens, null, 2), 'utf8')

    console.log(`✅ Wrote ${finalTokens.length} tokens to ${registryPath}`)
  }
}

main()
