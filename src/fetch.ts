import { TokenList } from "@uniswap/token-lists";

import { constructUrl } from "./utils";

/**
 * Contains the logic for resolving a list URL to a validated token list
 *
 * @param listUrl - The URL or ENS name of the token list to fetch
 * @param resolveENSContentHash - A function that resolves an ENS name to a content hash URI.
 *
 * @returns A promise that resolves to a valid TokenList object
 * @throws Will throw an error if the ENS name cannot be resolved, the content hash cannot be translated to a URI,
 *         the list cannot be fetched, or the fetched list fails validation
 */
const getTokenList = async (
  listUrl: string
  // resolveENSContentHash: (ensName: string) => Promise<string>
): Promise<TokenList> => {
  let urls: string[];

  urls = constructUrl(listUrl);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLast = i === urls.length - 1;
    let response: Response;

    try {
      response = await fetch(url);
    } catch (error) {
      console.debug("Failed to fetch list", listUrl, error);
      if (isLast) {
        throw new Error(`Failed to download list ${listUrl}`);
      }
      continue;
    }

    const json: TokenList = await response.json() as TokenList;

    return json;
  }

  throw new Error("Unrecognized list URL protocol");
};

export default getTokenList;
