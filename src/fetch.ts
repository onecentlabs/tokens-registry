import type { TokenList } from './types'
import { constructUrl } from './utils'

const getTokenList = async (listUrl: string): Promise<TokenList> => {
  const urls = constructUrl(listUrl)

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const isLast = i === urls.length - 1

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const json = (await response.json()) as TokenList
      return json
    } catch (error) {
      console.debug('Failed to fetch list', listUrl, error)
      if (isLast) {
        throw new Error(`Failed to download list ${listUrl}`)
      }
    }
  }

  throw new Error('Unrecognized list URL protocol')
}

export default getTokenList
