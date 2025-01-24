export interface Token {
  chainId: number;
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
  logoURI?: string;
  tags?: string[];
}

export interface TokenList {
  name: string;
  logoURI: string;
  keywords: string[];
  timestamp: string;
  tokens: Token[];
  version: {
    major: number;
    minor: number;
    patch: number;
  };
}
