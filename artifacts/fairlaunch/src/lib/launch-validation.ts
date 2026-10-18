import { z } from 'zod';
import type { SelectedPairToken } from './token-catalog';

export const PAIR_TYPE_VALUES = [
  'supported-memecoin',
  'tokenized-stock',
  'other-supported-token',
] as const;

export type PairType = (typeof PAIR_TYPE_VALUES)[number];

export const PAIR_TYPE_OPTIONS: ReadonlyArray<{ value: PairType; label: string }> = [
  { value: 'supported-memecoin', label: 'Supported meme coin' },
  { value: 'tokenized-stock', label: 'Tokenized stock' },
  { value: 'other-supported-token', label: 'Other supported token' },
];

export const PAIR_TYPE_LABELS: Record<PairType, string> = {
  'supported-memecoin': 'Supported meme coin',
  'tokenized-stock': 'Tokenized stock',
  'other-supported-token': 'Other supported token',
};

export const DEFAULT_PAIR_TYPE: PairType = 'other-supported-token';
export const DEFAULT_PAIR_MINT_ADDRESS =
  'So11111111111111111111111111111111111111112';
export const DEFAULT_HOLDER_REWARD_BPS = 50;
export const MIN_HOLDER_REWARD_BPS = 1;
export const MAX_HOLDER_REWARD_BPS = 300;
export const MAX_PROPOSAL_IMAGE_BYTES = 2 * 1024 * 1024;

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Checks the address encoding and 32-byte public-key length only.
 * It does not check token existence, pair support, or Pump.fun eligibility.
 */
export function isValidSolanaMintAddress(value: string): boolean {
  const address = value.trim();
  if (
    address.length < 32 ||
    address.length > 44 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)
  ) {
    return false;
  }

  let decoded = 0n;
  for (const character of address) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }

  let decodedBytes = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    decodedBytes += 1;
  }

  const leadingZeroBytes = address.match(/^1*/)?.[0].length ?? 0;
  return decodedBytes + leadingZeroBytes === 32;
}

export function isPairType(value: unknown): value is PairType {
  return (
    typeof value === 'string' &&
    (PAIR_TYPE_VALUES as readonly string[]).includes(value)
  );
}

function isOptionalHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function proposalSocialUrl(value: string, kind: 'website' | 'telegram' | 'x'): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.')) return null;
    if (kind === 'telegram' && (!['t.me', 'telegram.me'].includes(host) || url.pathname === '/')) return null;
    if (kind === 'x' && (!['x.com', 'twitter.com'].includes(host) || url.pathname === '/')) return null;
    return url.href;
  } catch { return null; }
}

export function isValidProposalImageDataUrl(value: string): boolean {
  if (!value) return true;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return false;

  const base64 = match[2];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((base64.length * 3) / 4) - padding;
  return byteLength <= MAX_PROPOSAL_IMAGE_BYTES;
}

export const launchProposalSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(48),
  ticker: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]{2,10}$/, 'Use 2–10 letters or numbers.'),
  pairType: z
    .string()
    .refine(isPairType, 'Select a trading pair type.'),
  pairMintAddress: z
    .string()
    .trim()
    .refine(
      isValidSolanaMintAddress,
      'Enter a valid Solana mint address (32-byte Base58 public key).',
    ),
  holderRewardBps: z
    .number()
    .int('Choose a rate in 0.01% increments.')
    .min(MIN_HOLDER_REWARD_BPS, 'The minimum rate is 0.01%.')
    .max(MAX_HOLDER_REWARD_BPS, 'The maximum rate is 3.00%.'),
  imageUrl: z
    .string()
    .trim()
    .refine(
      isValidProposalImageDataUrl,
      'Upload a PNG, JPG, JPEG, or WebP image up to 2 MB.',
    ),
  sourceUrl: z
    .string()
    .trim()
    .refine(isOptionalHttpUrl, 'Use a valid http:// or https:// source URL.'),
  websiteUrl: z.string().trim().max(200).refine(value => !value || !!proposalSocialUrl(value, 'website'), 'Enter a valid website URL.').optional(),
  telegramUrl: z.string().trim().max(120).refine(value => !value || !!proposalSocialUrl(value, 'telegram'), 'Enter a valid t.me or telegram.me link.').optional(),
  xUrl: z.string().trim().max(120).refine(value => !value || !!proposalSocialUrl(value, 'x'), 'Enter an x.com or twitter.com profile or post link.').optional(),
  description: z
    .string()
    .trim()
    .min(12, 'Add at least 12 characters of context.')
    .max(380),
});

export type LaunchProposalFormInput = z.input<typeof launchProposalSchema>;
export type LaunchProposalInput = Omit<
  z.output<typeof launchProposalSchema>,
  'pairType'
> & { pairType: PairType; pairToken: SelectedPairToken };
