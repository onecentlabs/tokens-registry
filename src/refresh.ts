import path from "path";
import fs from "fs";

import type { Token, TokenList } from "./types";
import fetch from "./fetch";
import { __dirname } from "./global";
import urls from "./urls";

const main = async () => {
  const tokensByChain: Record<number, Token[]> = {};

  for (const url of urls) {
    console.log(`Fetching from: ${url}`);

    try {
      const data: Partial<TokenList> = await fetch(url);

      // If there's a `tokens` array, we'll parse it:
      if (!Array.isArray(data.tokens)) {
        console.warn(`No tokens array found at: ${url}`);
        continue;
      }

      for (const token of data.tokens) {
        // skip if missing chainId/address
        if (!token.chainId || !token.address) {
          continue;
        }

        const chainId = token.chainId;

        // Initialize array if needed
        if (!tokensByChain[chainId]) {
          tokensByChain[chainId] = [];
        }

        tokensByChain[chainId].push(token);
      }
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
    }
  }

  for (const chainIdStr of Object.keys(tokensByChain)) {
    const chainId = parseInt(chainIdStr, 10);
    const newTokens = tokensByChain[chainId];

    const registryPath = path.join(
      __dirname,
      "..",
      "registry",
      `${chainId}.json`
    );

    // Create registry directory (if needed)
    if (!fs.existsSync(path.dirname(registryPath))) {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    }

    let existingTokens: Token[] = [];
    if (fs.existsSync(registryPath)) {
      try {
        const fileData = fs.readFileSync(registryPath, "utf8");
        existingTokens = JSON.parse(fileData);
      } catch (error) {
        console.warn(
          `Failed to parse existing tokens for chainId=${chainId}`,
          error
        );
      }
    }

    // Combine existing + new
    const combinedTokens = [...existingTokens, ...newTokens];

    // Deduplicate by address (case-insensitive)
    const deduped: Record<string, Token> = {};
    for (const t of combinedTokens) {
      const addressKey = t.address.toLowerCase();
      if (!deduped[addressKey]) {
        deduped[addressKey] = t;
      }
    }

    const finalTokens = Object.values(deduped);

    fs.writeFileSync(
      registryPath,
      JSON.stringify(finalTokens, null, 2),
      "utf8"
    );

    console.log(`✅ Wrote ${finalTokens.length} tokens to ${registryPath}`);
  }
};

main();
