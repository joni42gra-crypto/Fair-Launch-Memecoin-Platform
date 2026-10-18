import type { PairType } from './launch-validation';

export type PairCompatibilityRequest = {
  pairType: PairType;
  mintAddress: string;
  holderRewardBps: number;
};

export type PairCompatibilityResult =
  | { status: 'not-checked'; message: string }
  | { status: 'compatible'; checkedAt: string }
  | { status: 'incompatible'; checkedAt: string; message: string };

/**
 * Contract for a future server-side Pump.fun compatibility endpoint.
 * It is deliberately unconfigured until an official server check is available.
 */
export interface PairCompatibilityServer {
  check(request: PairCompatibilityRequest): Promise<PairCompatibilityResult>;
}

export const unconfiguredPairCompatibilityServer: PairCompatibilityServer = {
  async check() {
    return {
      status: 'not-checked',
      message: 'Server-side Pump.fun compatibility checks are not configured.',
    };
  },
};
