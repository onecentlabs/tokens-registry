import express, { Request, Response } from 'express'
import bodyParser from 'body-parser'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

import { TokenRegistry } from './routes/index.js'
import { RPCFetch } from './routes/rpc.js'
import { __dirname } from './global.js'

const app = express()
const port = process.env.PORT || 3000

// Middleware
app.use(bodyParser.json())

// Serve static assets: /assets/chains/<key>.svg, /assets/tokens/<chainId>/<sym>.svg
const assetsDir = path.join(__dirname, '..', 'assets')
if (existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir))
}

const registryPath = existsSync(path.join(__dirname, '..', 'data', 'registry'))
  ? path.join(__dirname, '..', 'data', 'registry')
  : path.join(__dirname, '..', 'registry')

const metadataPath = existsSync(path.join(__dirname, '..', 'data', 'chains', 'metadata.json'))
  ? path.join(__dirname, '..', 'data', 'chains', 'metadata.json')
  : path.join(__dirname, '..', 'chains', 'metadata.json')

const metadataLightPath = existsSync(path.join(__dirname, '..', 'data', 'chains', 'metadata-light.json'))
  ? path.join(__dirname, '..', 'data', 'chains', 'metadata-light.json')
  : path.join(__dirname, '..', 'chains', 'metadata-light.json')

const tokenRegistry = new TokenRegistry(registryPath)
const rpcFetch = new RPCFetch(metadataPath)

// Helper: load chain metadata
function loadChainsMetadata(full: boolean = false) {
  const filePath = full ? metadataPath : metadataLightPath
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (e) {
      console.error(`Failed to parse ${filePath}:`, e)
    }
  }
  return []
}

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ service: 'token-registry', version: '0.0.1', status: 'ok' })
})

app.get('/health', (req: Request, res: Response) => {
  const tokens = tokenRegistry.getAllTokens(null)
  let totalTokens = 0
  for (const list of tokens.values()) {
    totalTokens += list.length
  }
  res.json({ status: 'ok', tokens: totalTokens, chains: tokens.size })
})

app.get('/tokens', async (req: Request, res: Response) => {
  const chains: string[] | null = req.query.chains ? req.query.chains.toString().split(',') : null
  const tokens = tokenRegistry.getAllTokens(chains)

  const response: Record<string, any> = Object.fromEntries(tokens.entries())
  res.json({ tokens: response })
})

app.get('/token', async (req: Request, res: Response) => {
  const chain = req.query.chain as string
  const token = req.query.token as string
  if (!chain || !token) {
    res.status(400).send('Missing chain or token parameter')
    return
  }

  const tokenData = tokenRegistry.getToken(token, chain)

  if (tokenData === undefined) {
    for (const [chainName, chainId] of Object.entries(tokenRegistry.chainMap)) {
      if (chainName.toLowerCase() !== chain.toLowerCase() || chainId !== chain) {
        const tokenFromRegistry = tokenRegistry.getToken(token, chainId)
        if (tokenFromRegistry) {
          return res.json(tokenFromRegistry)
        }
      }
    }
    console.log(`Token ${token} not found in registry, fetching from RPC`)
    const tokenFromRpc = await rpcFetch.getToken(token, chain)
    if (tokenFromRpc) {
      return res.json(tokenFromRpc)
    }
    res.status(404).json({ detail: 'Token not found' })
    return
  }

  return res.json(tokenData)
})

// Chain Metadata Endpoints
app.get('/chains', (req: Request, res: Response) => {
  const full = req.query.full === 'true'
  const data = loadChainsMetadata(full)
  res.json(data)
})

app.get('/chains/:key', (req: Request, res: Response) => {
  const key = req.params.key.toLowerCase()
  const chains = loadChainsMetadata(true) as any[]
  const found = chains.find((c) => (c.key && c.key.toLowerCase() === key) || String(c.id) === key)
  if (found) {
    return res.json(found)
  }
  res.status(404).json({ detail: 'Chain not found' })
})

app.get('/chains/:key/logo', (req: Request, res: Response) => {
  const key = req.params.key.toLowerCase()
  const svgPath = path.join(assetsDir, 'chains', `${key}.svg`)
  if (existsSync(svgPath)) {
    return res.sendFile(svgPath)
  }
  const chains = loadChainsMetadata(true) as any[]
  const found = chains.find((c) => (c.key && c.key.toLowerCase() === key) || String(c.id) === key)
  if (found && found.logoURI) {
    return res.redirect(found.logoURI)
  }
  res.status(404).json({ detail: 'Logo not found' })
})

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})
