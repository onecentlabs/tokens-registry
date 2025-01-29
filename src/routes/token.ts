import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {isAddress} from '../isAddress.js';

interface TokenData {
  // Add specific token properties here
  [key: string]: any;
}

export class TokenRegistry {
  private tokens: Map<string, TokenData>;
  private registryPath: string;
  private chainMap: Record<string, string>;

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

  public getToken(tokenName: string, chainName: string): TokenData | undefined {
    const chainId = this.chainMap[chainName] || chainName;
    const chainData = this.tokens.get(chainId);
    if (!chainData) {
        return undefined;
    }
    if (isAddress(tokenName)) {
        return chainData.find((token: TokenData) => token.address.toLowerCase() === tokenName.toLowerCase());
    }
    return chainData.find((token: TokenData) => token.symbol.toLowerCase() === tokenName.toLowerCase());
  }

  public getAllTokens(chains: string[]| null): Map<string, TokenData> {
    if (chains === null || chains.length === 0) {

        return this.tokens;
    }
    const tokens = new Map<string, TokenData>();
    chains.forEach(chain => {
        chain = this.chainMap[chain] || chain;
        const chainData = this.tokens.get(chain);
        if (chainData) {
            tokens.set(chain, chainData);
        }
    });
    return tokens;
  }

  // Optional: Method to reload tokens if needed
  public reloadTokens(): void {
    this.tokens.clear();
    this.loadTokens();
  }
}