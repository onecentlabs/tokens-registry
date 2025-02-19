/**
 * @module utils/generic/construct-url
 * @description Converts a given URI with ipfs, ipns, http, or https protocol to an array of fetchable http(s) URLs
 * @param {string} uri - The URI to convert to fetchable http URLs
 * @returns {string[]} An array of fetchable http URLs corresponding to the given URI
 * @example
 * constructUrl("https://example.com"); // ["https://example.com"]
 * constructUrl("http://example.com"); // ["https://example.com", "http://example.com"]
 */
const constructUrl = (uri: string): string[] => {
  const protocol = uri.split(':')[0].toLowerCase()

  switch (protocol) {
    case 'https':
      return [uri]

    case 'http':
      return ['https' + uri.substr(4), uri]

    case 'ipfs':
      const hash = uri.match(/^ipfs:(\/\/)?(.*)$/i)?.[2]
      return [`https://cloudflare-ipfs.com/ipfs/${hash}/`, `https://ipfs.io/ipfs/${hash}/`]

    case 'ipns':
      const name = uri.match(/^ipns:(\/\/)?(.*)$/i)?.[2]
      return [`https://cloudflare-ipfs.com/ipns/${name}/`, `https://ipfs.io/ipns/${name}/`]

    default:
      return []
  }
}

export default constructUrl
