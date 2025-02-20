import { readFileSync } from 'fs'
import { ethers } from 'ethers'

import { Token } from '../types.js'

export class RPCFetch {
  private chainMap: Record<string, string>
  private rpcMap: Record<string, string[]>

  constructor(metadataPath: string) {
    this.chainMap = {
      ETH: '1',
      BNB: '56',
      ARB: '42161',
      BASE: '8453',
      GNOSIS: '100',
    }

    this.rpcMap = {}
    this.loadRPCs(metadataPath)
  }

  private ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
  ]

  private loadRPCs(metadataPath: string) {
    try {
      const data = readFileSync(metadataPath, 'utf-8')
      const chains = JSON.parse(data)

      chains.forEach((chain: any) => {
        if (chain.metamask && chain.metamask.rpcUrls) {
          this.rpcMap[chain.id] = chain.metamask.rpcUrls
        }
      })

      console.log('RPCs loaded')
    } catch (error) {
      console.error('Error loading metadata:', error)
      this.rpcMap = {
        '1': ['https://ethereum-rpc.publicnode.com'],
        '42161': ['https://arb1.arbitrum.io/rpc'],
        '8453': ['https://mainnet.base.org'],
        '100': ['https://rpc.gnosischain.com'],
      }
    }
  }

  // TODO: Current support limited to EVM chains and ERC20 tokens
  public async getToken(tokenAddress: string, chainName: string): Promise<Token | undefined> {
    const chainId = isNaN(Number(chainName)) ? this.chainMap[chainName] : chainName

    const rpc = this.rpcMap[chainId]
    if (!rpc || rpc.length === 0) {
      return undefined
    }
    if (ethers.isAddress(tokenAddress)) {
      for (const rpcUrl of rpc) {
        console.log(
          `Fetching token details for ${tokenAddress} on chain ${chainName} (${chainId}) using ${rpcUrl}`
        )

        try {
          const provider = new ethers.JsonRpcProvider(rpcUrl)
          const contract = new ethers.Contract(tokenAddress, this.ERC20_ABI, provider)

          const [name, symbol, decimals] = await Promise.all([
            contract.name(),
            contract.symbol(),
            contract.decimals(),
          ])
          console.log(`Token details: ${name} (${symbol}) with ${decimals} decimals`)

          return {
            chainId: Number.parseInt(chainId),
            address: tokenAddress,
            symbol,
            name,
            decimals: Number(decimals),
            logoURI: '',
            tags: ['NOT_VERIFIED'],
          }
        } catch (error) {
          console.error(`Error fetching token details from ${rpcUrl}: ${error}`)
        }
      }

      return undefined
    }
  }
}
