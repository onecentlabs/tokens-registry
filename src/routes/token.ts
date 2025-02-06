import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {isAddress} from '../isAddress.js';
import { Token } from '../types.js';

interface TokenData {
  // Add specific token properties here
  [key: string]: any;
}

export class TokenRegistry {
  private tokens: Map<string, Token[]>;
  private registryPath: string;
  private chainMap: Record<string, string>;
  private tags: string[];

  constructor(registryPath: string) {
    this.tokens = new Map();
    this.registryPath = registryPath;
    this.chainMap = {
        "ETH": "1",
        "BNB": "56",
        "ARB": "42161",
        "BASE": "8453",
        "GNOSIS": "100",
    }
    this.tags = [ 'FEATURED',
    'NATIVE',
    'TRADE_VOLUME',
    'STABLE',
    'POPULAR',
    'GOVERNANCE',
    'WRAPPED',
    'MEME',
    'UTILITY',
    'VERIFIED']
    this.loadTokens();
  }

  private loadTokens(): void {
    try {
      const files = readdirSync(this.registryPath);
      
      const chainNames: string[] = Object.values(this.chainMap);
      files.filter(file => file.endsWith('.json')).forEach(file => {
        const filePath = join(this.registryPath, file);
        const fileContent = readFileSync(filePath, 'utf-8');
        const chainname = file.replace('.json', '');
        if (!chainNames.includes(chainname)) {
            return;
        }
        try {
          const chainData = JSON.parse(fileContent);
          this.tokens.set(chainname, chainData);
        } catch (parseError) {
          console.error(`Error parsing JSON file ${file}:`, parseError);
        }
      });

      console.log(`Loaded ${this.tokens.size} tokens from registry`);
    } catch (error) {
      console.error('Error loading token registry:', error);
    }
  }

  private sortTokens(tokens: Map<string, Token[]>): Map<string, Token[]> {
    const returntokens: Map<string, Token[]> = new Map()
    for (const [chainKey, chainData] of tokens.entries()) {
        const collected_addresses: string[] = []
        const updatedTokenData: Map<string, Token[]> = new Map()
        for (const i in this.tags) {
            const tag = this.tags[i]
            const chainTagData: Token[] = chainData.filter((token: Token) => {
                if (token.tags?.includes(tag) && collected_addresses.includes(token.address)) {
                    return true
                }
                return false
            })
            updatedTokenData.set(tag, chainTagData)
            collected_addresses.push(...chainTagData.map((token: Token) => token.address))
        }
        const remainingTokens: Token[] = chainData.filter((token: Token) => {
            if (collected_addresses.includes(token.address)) {
                return false
            }
            return true
        })
        
        const newTokenData: Token[] = []
        for (const i in this.tags) {
            const tag = this.tags[i]
            const tokenList : Token[]| undefined = updatedTokenData.get(tag)
            if (tokenList) {
                newTokenData.push(...tokenList)
            }
        }
        newTokenData.push(...remainingTokens)
        returntokens.set(chainKey, newTokenData)
    }
    return returntokens;

  }

  public getToken(tokenName: string, chainName: string): Token | undefined {
    const chainId = this.chainMap[chainName] || chainName;
    const chainData = this.tokens.get(chainId);
    if (!chainData) {
        return undefined;
    }
    if (isAddress(tokenName)) {
        return chainData.find((token: Token) => token.address.toLowerCase() === tokenName.toLowerCase());
    }
    return chainData.find((token: Token) =>{
        if (tokenName.toLowerCase() === 'eth' && chainId === '1') {
            return token.symbol.toLowerCase() === 'eth' && token.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        }
        return token.symbol.toLowerCase() === tokenName.toLowerCase()
    }) ;
  }

  public getAllTokens(chains: string[]| null): Map<string, Token[]> {
    if (chains === null || chains.length === 0) {

        return this.sortTokens(this.tokens);
    }
    const tokens = new Map<string, Token[]>();
    chains.forEach(chain => {
        chain = this.chainMap[chain] || chain;
        const chainData = this.tokens.get(chain);
        if (chainData) {
            tokens.set(chain, chainData);
        }
    });
    return this.sortTokens(tokens);
  }

  // Optional: Method to reload tokens if needed
  public reloadTokens(): void {
    this.tokens.clear();
    this.loadTokens();
  }
}