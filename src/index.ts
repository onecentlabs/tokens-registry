import express, { Request, Response } from 'express'
import bodyParser from 'body-parser'

import { TokenRegistry } from './routes/index.js'
import { RPCFetch } from './routes/rpc.js'

const app = express()
const port = 3000

// Middleware
app.use(bodyParser.json())

const tokenRegisry = new TokenRegistry('./registry')
const rpcFetch = new RPCFetch("./chains/metadata.json")

// Routes
app.get('/', (req: Request, res: Response) => {
  res.send('Hello, world!')
})

app.get('/tokens', async (req: Request, res: Response) => {
  const chains: string[] | null = req.query.chains ? req.query.chains.toString().split(',') : null
  const tokens = tokenRegisry.getAllTokens(chains)

  const response: Record<string, any> = Object.fromEntries(tokens.entries())

  res.json({
    tokens: response,
  })
})

app.get('/token', async (req: Request, res: Response) => {
  const chain = req.query.chain as string
  const token = req.query.token as string
  if (!chain || !token) {
    res.status(400).send('Missing chain or token parameter')
    return
  }

  if(chain === "ETH"&& (token == "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb" || token == "0xca79db4b49f608ef54a5cb813fbed3a6387bc645")) {
    res.status(400).send('Token not found in registry')
    return
  }
  

  const tokenData = tokenRegisry.getToken(token, chain)

  if (tokenData === undefined) {
    console.log(`Token ${token} not found in registry, fetching from RPC`)
    const tokenFromRpc = await rpcFetch.getToken(token, chain)
    return res.json(tokenFromRpc)
  }

  return res.json(tokenData)
})

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})
