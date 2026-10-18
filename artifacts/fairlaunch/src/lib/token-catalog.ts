import type { PairCompatibilityStatus } from './pair-compatibility';

export type PairAssetCategory =
  | 'native'
  | 'stablecoin'
  | 'tokenized-stock'
  | 'tokenized-asset'
  | 'wrapped'
  | 'protocol'
  | 'platform'
  | 'community'
  | 'memecoin'
  | 'pumpfun-coin'
  | 'other';

export type CatalogMembershipStatus = 'listed' | 'not-listed' | 'unknown';
export type PairAssetGroup = 'xstocks' | 'backpack' | 'crypto';

export type TokenCatalogEntry = {
  mintAddress: string;
  name: string;
  ticker: string;
  category?: PairAssetCategory;
  assetGroup?: PairAssetGroup;
  iconUrl?: string | null;
  catalogStatus?: CatalogMembershipStatus;
  compatibilityStatus?: PairCompatibilityStatus;
};

export type SelectedPairToken =
  | (TokenCatalogEntry & { source: 'catalog' })
  | {
      mintAddress: string;
      source: 'manual';
      catalogStatus?: CatalogMembershipStatus;
      compatibilityStatus?: PairCompatibilityStatus;
    };
