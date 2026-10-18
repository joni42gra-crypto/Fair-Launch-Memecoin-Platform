export type PairCompatibilityStatus = 'confirmed' | 'incompatible' | 'not-checked';

export type PairCompatibilityResult =
  | { status: 'not-checked'; reason: string }
  | { status: 'confirmed'; verifiedAt: string }
  | { status: 'incompatible'; verifiedAt: string; reason: string };

/**
 * A catalog hit proves only that an asset appeared in the published list
 * snapshot. There is no documented verifier for secondary-pair eligibility,
 * so all selections remain not checked until a reliable official check exists.
 */
