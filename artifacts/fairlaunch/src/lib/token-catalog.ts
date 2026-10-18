export type TokenCatalogEntry = {
  mintAddress: string;
  name: string;
  ticker: string;
  iconUrl?: string;
};

export type SelectedPairToken =
  | (TokenCatalogEntry & { source: 'catalog' })
  | { mintAddress: string; source: 'manual' };
