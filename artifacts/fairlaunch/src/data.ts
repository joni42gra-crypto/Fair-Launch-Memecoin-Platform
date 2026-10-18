import type { PairType } from './lib/launch-validation';
import type { SelectedPairToken } from './lib/token-catalog';

export type Participant = {
  walletAddress: string;
  amountUsd: number;
  committedAt: string;
};

export type Launch = {
  id: string;
  name: string;
  ticker: string;
  creatorWallet: string;
  imageUrl: string;
  sourceUrl: string;
  websiteUrl?: string;
  telegramUrl?: string;
  xUrl?: string;
  description: string;
  pairType: PairType;
  pairMintAddress: string;
  pairToken?: SelectedPairToken;
  holderRewardBps: number;
  committedAmountUsd: number;
  participantCount: number;
  targetParticipantCount: number;
  deadline: string;
  status: 'active' | 'completed' | 'failed';
  participants: Participant[];
};

export type Activity = {
  id: string;
  launchId: string;
  launchName: string;
  ticker: string;
  amountUsd: number;
  status: 'confirmed' | 'pending' | 'refundable';
  createdAt: string;
  demo: boolean;
  walletAddress: string;
};

const dateFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

export const SEED_LAUNCHES: Launch[] = [
  {
    id: 'slow-burn', name: 'Slow Burn', ticker: 'SLOW', creatorWallet: '7xKp...mQ4z',
    imageUrl: '/launch-art/slow-burn.svg', sourceUrl: 'https://example.com/slow-burn-thread',
    description: 'A tiny tribute to the reply guy who took three years to land the perfect comeback. No rush. We are all still reading.',
    pairType: 'supported-memecoin', pairMintAddress: 'So11111111111111111111111111111111111111112', holderRewardBps: 50,
    committedAmountUsd: 620, participantCount: 62, targetParticipantCount: 100,
    deadline: dateFromNow(3), status: 'active',
    participants: Array.from({ length: 8 }, (_, i) => ({ walletAddress: `8${i}Qm...${['v3Ks', 'k9Pq', 'X1nB', '2tLm', 'r7Wa', 'h5Jd', 'p4Fc', 'm8Zx'][i]}`, amountUsd: 10, committedAt: ago(i * 3 + 1) })),
  },
  {
    id: 'little-ladle', name: 'Little Ladle', ticker: 'LADLE', creatorWallet: '4vBn...p2Xc',
    imageUrl: '/launch-art/little-ladle.svg', sourceUrl: 'https://example.com/little-ladle',
    description: 'For the spoon that somehow made it into every group chat. A community-sized soup of extremely online energy.',
    pairType: 'other-supported-token', pairMintAddress: 'So11111111111111111111111111111111111111112', holderRewardBps: 75,
    committedAmountUsd: 410, participantCount: 41, targetParticipantCount: 80,
    deadline: dateFromNow(5), status: 'active',
    participants: Array.from({ length: 6 }, (_, i) => ({ walletAddress: `5${i}Rs...${['w2Mn', 'a6Yt', 'C4qL', 'z8Fb', 'n3Jv', 'Q1pD'][i]}`, amountUsd: 10, committedAt: ago(i * 5 + 2) })),
  },
  {
    id: 'orbiting-cat', name: 'Orbiting Cat', ticker: 'ORBIT', creatorWallet: '9cLr...D8wN',
    imageUrl: '/launch-art/orbiting-cat.svg', sourceUrl: 'https://example.com/orbiting-cat-post',
    description: 'A cat looking at the ceiling fan like it has just discovered the nature of time. For the curious and the slightly dizzy.',
    pairType: 'supported-memecoin', pairMintAddress: 'So11111111111111111111111111111111111111112', holderRewardBps: 100,
    committedAmountUsd: 280, participantCount: 28, targetParticipantCount: 75,
    deadline: dateFromNow(2), status: 'active',
    participants: Array.from({ length: 5 }, (_, i) => ({ walletAddress: `2${i}Jx...${['L7qA', 'd5Wh', 't9Bk', 'M3cP', 'f6Vu'][i]}`, amountUsd: 10, committedAt: ago(i * 6 + 4) })),
  },
  {
    id: 'many-tabs', name: 'Many Tabs Open', ticker: 'TABS', creatorWallet: '2kYv...n5Rp',
    imageUrl: '/launch-art/many-tabs.svg', sourceUrl: 'https://example.com/many-tabs',
    description: 'The browser has 47 tabs open and every single one is important. A goal reached by equal-sized commitments.',
    pairType: 'tokenized-stock', pairMintAddress: 'So11111111111111111111111111111111111111112', holderRewardBps: 25,
    committedAmountUsd: 900, participantCount: 90, targetParticipantCount: 90,
    deadline: ago(12), status: 'completed',
    participants: Array.from({ length: 7 }, (_, i) => ({ walletAddress: `3${i}Bt...${['c4Ne', 'u8Ka', 'R2mV', 'q6Ls', 'X9dF', 'p1Wj', 'a5Zt'][i]}`, amountUsd: 10, committedAt: ago(i * 4 + 15) })),
  },
];

export const SEED_ACTIVITIES: Activity[] = [
  { id: 'seed-act-1', launchId: 'slow-burn', launchName: 'Slow Burn', ticker: 'SLOW', amountUsd: 10, status: 'confirmed', createdAt: ago(1), demo: true, walletAddress: '8Qm...v3Ks' },
  { id: 'seed-act-2', launchId: 'little-ladle', launchName: 'Little Ladle', ticker: 'LADLE', amountUsd: 10, status: 'confirmed', createdAt: ago(4), demo: true, walletAddress: '51Rs...w2Mn' },
  { id: 'seed-act-3', launchId: 'many-tabs', launchName: 'Many Tabs Open', ticker: 'TABS', amountUsd: 10, status: 'confirmed', createdAt: ago(14), demo: true, walletAddress: '37Bt...c4Ne' },
];

export const shortAddress = (address: string) => address.length > 13 ? `${address.slice(0, 5)}...${address.slice(-4)}` : address;
