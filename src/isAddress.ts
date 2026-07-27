export function isAddress(value: string): boolean {
  if (!value) return false
  // Check Ethereum 0x address
  if (/^0x[0-9A-Fa-f]{40}$/.test(value)) {
    return true
  }
  // Check Solana base58 address
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    return true
  }
  return false
}
