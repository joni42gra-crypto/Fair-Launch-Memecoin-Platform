export type TokenCatalogEntry = {
  mintAddress: string;
  name: string;
  ticker: string;
  iconUrl?: string;
};

export type SelectedPairToken =
  | (TokenCatalogEntry & { source: 'catalog' })
  | { mintAddress: string; source: 'manual' };

export type TokenCatalogSearchResult =
  | { status: 'connected'; tokens: TokenCatalogEntry[] }
  | { status: 'not-configured' };

/**
 * Catalog boundary for Solana token metadata.
 * Replace this provider with the chosen API adapter; never substitute demo rows.
 */
export interface TokenCatalogService {
  search(query: string): Promise<TokenCatalogSearchResult>;
}

export const unconfiguredTokenCatalog: TokenCatalogService = {
  async search() {
    return { status: 'not-configured' };
  },
};

export function filterTokenCatalog(
  tokens: TokenCatalogEntry[],
  query: string,
): TokenCatalogEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return tokens;
  return tokens.filter((token) =>
    [token.name, token.ticker, token.mintAddress].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}
