import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AlertCircle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileImage, Image as ImageIcon, Info, Plus, Search, ShieldCheck, Upload, Users, Wallet, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Form, FormField } from '@/components/ui/form';
import { getSearchSupportedPairAssetsQueryKey, useSearchSupportedPairAssets } from '@workspace/api-client-react';
import { Activity, Launch, SEED_ACTIVITIES, SEED_LAUNCHES, shortAddress } from './data';
import {
  DEFAULT_HOLDER_REWARD_BPS,
  DEFAULT_PAIR_MINT_ADDRESS,
  DEFAULT_PAIR_TYPE,
  MAX_PROPOSAL_IMAGE_BYTES,
  MAX_HOLDER_REWARD_BPS,
  MIN_HOLDER_REWARD_BPS,
  PAIR_TYPE_LABELS,
  PAIR_TYPE_OPTIONS,
  isPairType,
  isValidSolanaMintAddress,
  proposalSocialUrl,
  launchProposalSchema,
  type LaunchProposalFormInput,
  type LaunchProposalInput,
} from './lib/launch-validation';
import { type CatalogMembershipStatus, type PairAssetCategory, type SelectedPairToken, type TokenCatalogEntry } from './lib/token-catalog';
import { type PairCompatibilityStatus } from './lib/pair-compatibility';
import './proposal.css';
import './light-routes.css';
import { LaunchpadPage } from './components/proposal/LaunchpadPage';
import { SiteChrome } from './components/SiteChrome';

const LAUNCH_KEY = 'fairlaunch.demo.launches.v2';
const ACTIVITY_KEY = 'fairlaunch.demo.activity.v1';
const WALLET_KEY = 'fairlaunch.demo.wallet.v1';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function CatalogTokenIcon({ token }: { token: TokenCatalogEntry }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!token.iconUrl || imageFailed) {
    return <span className="catalog-token-icon catalog-icon-placeholder" aria-hidden="true"><ImageIcon size={15} /></span>;
  }
  return <span className="catalog-token-icon"><img src={token.iconUrl} alt="" onError={() => setImageFailed(true)} /></span>;
}

const PAIR_ASSET_CATEGORY_LABELS: Record<PairAssetCategory, string> = {
  native: 'Native asset',
  stablecoin: 'Stablecoin',
  'tokenized-stock': 'Tokenized stock / ETF',
  'tokenized-asset': 'Tokenized asset',
  wrapped: 'Wrapped / bridged',
  protocol: 'Protocol token',
  platform: 'Platform token',
  community: 'Community token',
  memecoin: 'Memecoin',
  'pumpfun-coin': 'Pump.fun coin',
  other: 'Other',
};

function catalogMembershipLabel(status?: CatalogMembershipStatus) {
  if (status === 'listed') return 'Found in official list';
  if (status === 'not-listed') return 'Not in main list';
  return 'Catalog status unknown';
}

function compatibilityLabel(status?: PairCompatibilityStatus) {
  if (status === 'confirmed') return 'Compatibility confirmed';
  if (status === 'incompatible') return 'Not compatible';
  return 'Not checked';
}

function usePersistedState<T>(key: string, initial: T, normalize?: (value: T) => T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readStorage(key, initial);
    return normalize ? normalize(stored) : stored;
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* local demo storage can be unavailable */ } }, [key, value]);
  return [value, setValue] as const;
}

function normalizeLaunches(launches: Launch[]): Launch[] {
  return launches.map((launch) => ({
    ...launch,
    pairType: isPairType(launch.pairType) ? launch.pairType : DEFAULT_PAIR_TYPE,
    pairMintAddress: isValidSolanaMintAddress(launch.pairMintAddress ?? '')
      ? launch.pairMintAddress
      : DEFAULT_PAIR_MINT_ADDRESS,
    holderRewardBps:
      Number.isInteger(launch.holderRewardBps) &&
      launch.holderRewardBps >= MIN_HOLDER_REWARD_BPS &&
      launch.holderRewardBps <= MAX_HOLDER_REWARD_BPS
        ? launch.holderRewardBps
        : DEFAULT_HOLDER_REWARD_BPS,
  }));
}

function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Footer() {
  return <footer className="footer"><span><strong>fairlaunch</strong> / community first, always</span><span>PROTOTYPE ONLY · NO FUNDS · NO TOKEN DEPLOYMENT</span></footer>;
}

function DemoBanner() {
  return <div className="eyebrow"><i className="demo-dot" /> An experiment in equal-sized conviction</div>;
}

function RefundNotice() {
  return <div className="refund-banner" data-testid="notice-refund-policy">
    <div className="refund-icon"><ShieldCheck size={16} /></div>
    <div><h3>What about refunds?</h3><p>In a future on-chain version, if a launch misses its participant target before the deadline, each valid $10 commitment would be refundable. This prototype does not hold, transfer, or return funds. Everything shown here is simulated demo data.</p></div>
  </div>;
}

function Artwork({ launch, compact = false }: { launch: Launch; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return launch.imageUrl && !failed
    ? <img className="coin-art" src={launch.imageUrl} alt={`${launch.name} community artwork`} data-testid={`img-launch-${launch.id}`} onError={() => setFailed(true)} />
    : <div className={`coin-art art-fallback ${compact ? 'compact' : ''}`} aria-label={`${launch.name} artwork placeholder`} data-testid={`img-launch-${launch.id}`}>{launch.ticker.slice(0, 2)}</div>;
}

function LaunchCard({ launch }: { launch: Launch }) {
  const progress = Math.min(100, Math.round(launch.participantCount / launch.targetParticipantCount * 100));
  return <article className="launch-card" data-testid={`card-launch-${launch.id}`}>
    <div className="card-top">
      <Artwork launch={launch} />
      <div className="card-title"><h3>{launch.name}</h3><span className="ticker">${launch.ticker}</span></div>
      <span className={`status ${launch.status === 'completed' ? 'complete' : ''}`} data-testid={`status-launch-${launch.id}`}>{launch.status === 'completed' ? 'Goal reached' : 'Gathering'}</span>
    </div>
    <p className="card-desc">{launch.description}</p>
    <div className="progress-meta"><span>UNIQUE PARTICIPANTS</span><strong>{launch.participantCount} / {launch.targetParticipantCount}</strong></div>
    <div className="progress-track" aria-label={`${progress}% participant progress`}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
    <div className="card-stats">
      <div><span className="stat-label">Demo commitments</span><span className="stat-value">${launch.committedAmountUsd.toLocaleString()}</span></div>
      <div><span className="stat-label">Deadline</span><span className="stat-value">{launch.status === 'completed' ? 'Reached' : formatDate(launch.deadline)}</span></div>
      <div><span className="stat-label">Equal shares</span><span className="stat-value">$10 each</span></div>
    </div>
    <div className="card-footer"><span className="creator">by {launch.creatorWallet}</span><Link href={`/launch/${launch.id}`} className="text-link" data-testid={`link-launch-${launch.id}`}>{launch.status === 'completed' ? 'View launch' : 'Join launch'} <ArrowUpRight size={13} /></Link></div>
  </article>;
}

function HomePage({ launches }: { launches: Launch[] }) {
  const active = launches.filter(launch => launch.status === 'active');
  const completed = launches.filter(launch => launch.status === 'completed');
  const [loading, setLoading] = useState(true);
  useEffect(() => { const timer = window.setTimeout(() => setLoading(false), 240); return () => window.clearTimeout(timer); }, []);
  return <main className="main">
    <section className="hero">
      <div className="hero-grid" />
      <div className="hero-content">
        <DemoBanner />
        <h1>Small bets.<br /><span>One fair shot.</span></h1>
        <p>A launch space where meme communities show up together. Same $10 demo commitment. Same starting line. No whale tier, no creator allocation.</p>
        <div className="hero-actions">
          <a href="#active-launches" className="button button-primary" data-testid="button-explore-launches">Explore launches <ArrowUpRight size={15} /></a>
          <Link href="/propose" className="button button-quiet" data-testid="button-propose-hero"><Plus size={15} /> Open Launcher</Link>
        </div>
        <div className="hero-note"><span className="live-led">● ALL ACTIVITY IS SIMULATED</span><span>Not connected to a blockchain</span></div>
      </div>
    </section>

    <section className="section" id="active-launches">
      <div className="section-head"><div><span className="section-kicker">Open calls / 01</span><h2>Find your people</h2><p className="section-sub">Every participant contributes the same fixed $10 in this demo.</p></div><Link href="/activity" className="text-link" data-testid="link-view-activity">View demo activity <ArrowUpRight size={13} /></Link></div>
      {loading ? <div className="loading-lines" aria-label="Loading launches" data-testid="loading-launches"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        : active.length ? <div className="launch-grid" data-testid="list-active-launches">{active.map(launch => <LaunchCard key={launch.id} launch={launch} />)}</div>
        : <div className="empty-state" data-testid="empty-active-launches"><div className="empty-mark"><Plus size={19} /></div><h3>No open launches yet</h3><p>The next community idea could start here. Use the Launcher to share a meme for everyone to rally around.</p><Link href="/propose" className="button button-primary" data-testid="button-empty-propose">Open Launcher</Link></div>}
    </section>

    <section className="section">
      <div className="section-head"><div><span className="section-kicker">Made it together / 02</span><h2>Goal reached</h2><p className="section-sub">A target hit by the community. No token has been created.</p></div></div>
      {completed.length ? <div className="launch-grid">{completed.map(launch => <LaunchCard key={launch.id} launch={launch} />)}</div>
        : <div className="empty-state"><div className="empty-mark"><Check size={18} /></div><h3>First one is still on its way</h3><p>When a community reaches its participant target, it will appear here as goal reached.</p></div>}
    </section>

    <section className="section mechanics">
      <div className="mechanics-intro"><span className="section-kicker">The rules are the product</span><h2>Same amount.<br />Same starting line.</h2><p>Fair means the mechanics do not quietly change when a bigger wallet walks in. Every community member gets one equal-sized demo commitment.</p></div>
      <div className="steps">
        <div className="step"><span className="step-no">01</span><div><h3>Bring a meme with a pulse</h3><p>Anyone can share an idea and link its source using the Launcher. This creates a demo launch page, never a token.</p></div></div>
        <div className="step"><span className="step-no">02</span><div><h3>Show up for exactly $10</h3><p>One commitment per demo wallet per launch. No larger contribution, no private creator allocation.</p></div></div>
        <div className="step"><span className="step-no">03</span><div><h3>Reach the people target</h3><p>The goal is a number of unique participants, not a race to collect a bigger pile of money.</p></div></div>
      </div>
    </section>
    <RefundNotice />
    <Footer />
  </main>;
}

function LaunchPage({ id, launches, activities, wallet, onConnect, onCommit }: {
  id: string; launches: Launch[]; activities: Activity[]; wallet: string | null; onConnect: () => void; onCommit: (launch: Launch) => void;
}) {
  const launch = launches.find(item => item.id === id);
  if (!launch) return <main className="main"><div className="empty-state" data-testid="error-launch-not-found"><div className="empty-mark">?</div><h3>Launch not found</h3><p>This page may belong to an older demo session, or the launch link may be incorrect.</p><Link className="button button-primary" href="/">Back to launches</Link></div></main>;
  const alreadyCommitted = !!wallet && activities.some(item => item.launchId === launch.id && item.walletAddress === wallet);
  const progress = Math.min(100, Math.round(launch.participantCount / launch.targetParticipantCount * 100));
  const remaining = Math.max(0, launch.targetParticipantCount - launch.participantCount);
  const pairCatalogStatus = launch.pairToken?.catalogStatus ?? 'unknown';
  const pairCompatibilityStatus = launch.pairToken?.compatibilityStatus ?? 'not-checked';
  return <main className="main">
    <div className="page-top"><Link href="/" className="text-link" data-testid="link-back-launches">← All launches</Link></div>
    <div className="detail-layout">
      <section className="panel">
        <div className="detail-heading"><Artwork launch={launch} /><div><span className={`status ${launch.status === 'completed' ? 'complete' : ''}`}>{launch.status === 'completed' ? 'Goal reached' : 'Active demo'}</span><h1>{launch.name}</h1><span className="ticker">${launch.ticker} · by {launch.creatorWallet}</span></div></div>
        <p className="detail-content">{launch.description}</p>
        <div className="proposal-result-actions">
          {([{ key: 'xUrl', kind: 'x', label: 'X' }, { key: 'websiteUrl', kind: 'website', label: 'Website' }, { key: 'telegramUrl', kind: 'telegram', label: 'Telegram' }] as const).map(link => {
            const href = proposalSocialUrl(launch[link.key] ?? '', link.kind);
            return href ? <a key={link.key} className="text-link" href={href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a> : null;
          })}
        </div>
        <div className="pair-summary" data-testid="launch-pair-settings">
          <div className="pair-summary-item"><span className="stat-label">Trading pair type</span><span className="stat-value">{PAIR_TYPE_LABELS[launch.pairType]}</span></div>
          <div className="pair-summary-item"><span className="stat-label">Pair token</span><span className="stat-value">{launch.pairToken?.source === 'catalog' ? `${launch.pairToken.name} ($${launch.pairToken.ticker})` : launch.pairToken?.source === 'manual' ? 'Manual mint' : 'Mint address'}</span><span className="field-hint mono" title={launch.pairMintAddress}>{shortAddress(launch.pairMintAddress)}</span></div>
          <div className="pair-summary-item"><span className="stat-label">Holder Rewards · demo setting</span><span className="stat-value">{(launch.holderRewardBps / 100).toFixed(2)}%</span></div>
        </div>
        <div className="pair-validation-note" data-testid="status-launch-pair-check"><strong>Catalog: {catalogMembershipLabel(pairCatalogStatus)}.</strong> Compatibility: {compatibilityLabel(pairCompatibilityStatus)}. Pair and reward-rate eligibility have not been verified by Pump.fun.</div>
        <div className="detail-stats">
          <div className="detail-stat"><span className="stat-label">Participants</span><span className="stat-value">{launch.participantCount} / {launch.targetParticipantCount}</span></div>
          <div className="detail-stat"><span className="stat-label">Demo amount shown</span><span className="stat-value">${launch.committedAmountUsd.toLocaleString()}</span></div>
          <div className="detail-stat"><span className="stat-label">Deadline</span><span className="stat-value">{formatDate(launch.deadline)}</span></div>
        </div>
        <div className="progress-meta"><span>UNIQUE COMMUNITY MEMBERS</span><strong>{progress}%</strong></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="participants"><h3>Recent demo participants <span className="ticker">({launch.participantCount} total)</span></h3>
          {launch.participants.length ? launch.participants.slice(0, 8).map((participant, index) => <div className="participant-row" key={`${participant.walletAddress}-${index}`} data-testid={`participant-row-${launch.id}-${index}`}><span className="participant-wallet">{participant.walletAddress}</span><span className="participant-amount">$10.00 <span style={{ color: '#6d7783' }}>· {formatDate(participant.committedAt)}</span></span></div>)
            : <p className="detail-content">Be the first demo participant in this community.</p>}
        </div>
        {launch.sourceUrl && <div style={{ marginTop: 19 }}><a href={launch.sourceUrl} target="_blank" rel="noreferrer" className="text-link" data-testid="link-launch-source">View original source <ExternalLink size={12} /></a><span className="field-hint">Source URL is display-only prototype data.</span></div>}
      </section>
      <aside className="panel commit-panel">
        <span className="section-kicker">Equal by design</span><h2 style={{ marginTop: 8 }}>One spot. One amount.</h2>
        <div className="amount-box"><span className="amount-caption">Fixed demo commitment</span><div className="amount-number">$10<span style={{ color: '#828b96', fontSize: 15 }}>.00</span></div></div>
        <p>Exactly $10. No slider, no higher tier. This click simulates a commitment in your browser only; no funds are collected.</p>
        {launch.status === 'completed'
          ? <button className="button button-quiet button-wide" disabled data-testid="button-launch-reached">Participant target reached</button>
          : alreadyCommitted
            ? <button className="button button-quiet button-wide" disabled data-testid="button-already-committed"><Check size={15} /> Demo commitment recorded</button>
            : <button className="button button-primary button-wide" onClick={() => wallet ? onCommit(launch) : onConnect()} data-testid="button-commit-ten"><Plus size={15} /> Commit $10 (demo)</button>}
        {!wallet && <button className="button button-outline button-wide" style={{ marginTop: 9 }} onClick={onConnect} data-testid="button-detail-connect"><Wallet size={14} /> Connect demo wallet</button>}
        <div className="modal-notice" style={{ marginTop: 18 }}>DEMO ONLY — no blockchain transaction or transfer takes place.</div>
        <div className="stat-label"><Users size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />{remaining === 0 ? 'Participant target met' : `${remaining} more ${remaining === 1 ? 'person' : 'people'} to reach target`}</div>
        <div className="stat-label" style={{ marginTop: 10 }}><Clock3 size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />Deadline {formatDate(launch.deadline)}</div>
      </aside>
    </div>
    <RefundNotice /><Footer />
  </main>;
}

// Retained during graduation so existing validation, upload and picker behavior
// remain available for parity checks. The /propose route uses LaunchpadPage.
export function PreviousProposePage({ onAdd }: { onAdd: (data: LaunchProposalInput) => boolean }) {
  const [submittedProposal, setSubmittedProposal] = useState<LaunchProposalInput | null>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [assetGroupFilter, setAssetGroupFilter] = useState<'all' | 'xstocks' | 'backpack' | 'crypto'>('all');
  const [debouncedTokenSearch, setDebouncedTokenSearch] = useState('');
  const [selectedToken, setSelectedToken] = useState<SelectedPairToken | null>(null);
  const [manualMint, setManualMint] = useState('');
  const [manualMintTouched, setManualMintTouched] = useState(false);
  const [showAdvancedMint, setShowAdvancedMint] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageSize, setImageSize] = useState(0);
  const [imageReading, setImageReading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const catalogSearchInput = useRef<HTMLInputElement>(null);
  const tokenTrigger = useRef<HTMLButtonElement>(null);
  const tokenModal = useRef<HTMLElement>(null);
  const imageRequest = useRef(0);
  const form = useForm<LaunchProposalFormInput>({
    resolver: zodResolver(launchProposalSchema),
    defaultValues: { name: '', ticker: '', pairType: '', pairMintAddress: '', holderRewardBps: DEFAULT_HOLDER_REWARD_BPS, imageUrl: '', sourceUrl: '', description: '' },
  });
  const holderRewardBps = form.watch('holderRewardBps') ?? DEFAULT_HOLDER_REWARD_BPS;
  const descriptionLength = form.watch('description')?.length ?? 0;
  const mintValue = form.watch('pairMintAddress') ?? '';
  const imageData = form.watch('imageUrl') ?? '';
  const validManualMint = isValidSolanaMintAddress(manualMint);
  const searchText = tokenSearch.trim();
  const searchReady = tokenDialogOpen && debouncedTokenSearch === searchText;
  const catalogQuery = useSearchSupportedPairAssets(
    { query: debouncedTokenSearch },
    {
      query: {
        enabled: searchReady,
        queryKey: getSearchSupportedPairAssetsQueryKey({ query: debouncedTokenSearch }),
        staleTime: 30_000,
        retry: 1,
      },
    },
  );
  const catalogTokens = catalogQuery.data?.results ?? [];
  const visibleCatalogTokens = assetGroupFilter === 'all'
    ? catalogTokens
    : catalogTokens.filter(token => token.assetGroup === assetGroupFilter);
  const catalogLoading = tokenDialogOpen && (searchText ? (!searchReady || catalogQuery.isFetching) : (!catalogQuery.data && catalogQuery.isFetching));
  const catalogError = catalogQuery.error?.data?.error
    ?? (catalogQuery.isError ? 'Could not load the official supported-pair catalog. Check the server connection and try again.' : '');
  const selectedCatalogStatus = selectedToken?.catalogStatus ?? 'unknown';
  const selectedCompatibilityStatus = selectedToken?.compatibilityStatus ?? 'not-checked';

  useEffect(() => {
    if (!tokenDialogOpen || !searchText) {
      setDebouncedTokenSearch('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedTokenSearch(searchText), 300);
    return () => window.clearTimeout(timer);
  }, [searchText, tokenDialogOpen]);

  useEffect(() => {
    if (!tokenDialogOpen) return;
    catalogSearchInput.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTokenDialogOpen(false);
        tokenTrigger.current?.focus();
      }
      if (event.key === 'Tab') {
        const controls = tokenModal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (first && last && event.shiftKey && (document.activeElement === first || !tokenModal.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && (document.activeElement === last || !tokenModal.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [tokenDialogOpen]);

  function chooseToken(token: SelectedPairToken) {
    setSelectedToken(token);
    form.setValue('pairMintAddress', token.mintAddress, { shouldDirty: true, shouldValidate: true });
    setManualMint(token.source === 'manual' ? token.mintAddress : '');
    setManualMintTouched(false);
    setTokenDialogOpen(false);
    tokenTrigger.current?.focus();
  }

  function chooseImage(file?: File) {
    if (!file) return;
    const request = ++imageRequest.current;
    setImageReading(false);
    if (imageInput.current) imageInput.current.value = '';
    const ext = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
    const expectedMime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext ? 'image/jpeg' : '';
    if (!ext || !expectedMime || file.type !== expectedMime) {
      setImageError('Choose a PNG, JPG, JPEG, or WebP image with a matching file type.');
      return;
    }
    if (file.size > MAX_PROPOSAL_IMAGE_BYTES) {
      setImageError('This image is over 2 MB. Choose a smaller file.');
      return;
    }
    setImageReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (request !== imageRequest.current) return;
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        setImageReading(false);
        setImageError('This image could not be read. Try another file.');
        return;
      }
      const decodedImage = new Image();
      decodedImage.onload = () => {
        if (request !== imageRequest.current) return;
        form.setValue('imageUrl', dataUrl, { shouldDirty: true, shouldValidate: true });
        setImageName(file.name);
        setImageSize(file.size);
        setImageError('');
        setImageReading(false);
      };
      decodedImage.onerror = () => {
        if (request !== imageRequest.current) return;
        setImageReading(false);
        setImageError('This file could not be decoded as an image. Choose another PNG, JPG, or WebP.');
      };
      decodedImage.src = dataUrl;
    };
    reader.onerror = () => {
      if (request !== imageRequest.current) return;
      setImageReading(false);
      setImageError('This image could not be read. Try another file.');
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    imageRequest.current += 1;
    setImageReading(false);
    form.setValue('imageUrl', '', { shouldDirty: true, shouldValidate: true });
    setImageName('');
    setImageSize(0);
    setImageError('');
    if (imageInput.current) imageInput.current.value = '';
  }

  function resetProposal() {
    imageRequest.current += 1;
    setImageReading(false);
    setSubmittedProposal(null);
    setSelectedToken(null);
    setManualMint('');
    setManualMintTouched(false);
    setShowAdvancedMint(false);
    setImageName('');
    setImageSize(0);
    setImageError('');
    setSaveError('');
    form.reset();
    if (imageInput.current) imageInput.current.value = '';
  }

  function submit(values: LaunchProposalFormInput) {
    setSaveError('');
    if (imageReading) return;
    if (!isPairType(values.pairType) || !selectedToken || selectedToken.mintAddress !== values.pairMintAddress) {
      form.setError('pairMintAddress', { message: 'Select a pair token or enter a valid mint in the token dialog.' });
      return;
    }
    const proposal: LaunchProposalInput = { ...values, pairType: values.pairType, pairToken: selectedToken };
    if (onAdd(proposal)) setSubmittedProposal(proposal);
    else setSaveError('Your proposal could not be saved because browser storage is full or unavailable. Try a smaller image or free up storage, then save again. Your form has not been cleared.');
  }

  if (submittedProposal) return <main className="main proposal-update proposal-main">
    <div className="page-top"><span className="section-kicker">Proposal saved / demo</span></div>
    <div className="empty-state" data-testid="success-proposal"><div className="empty-mark"><Check size={19} /></div><h3>Your idea has a demo page</h3><p>{submittedProposal.name} is saved in this browser only. This does not create or launch a token, check pair eligibility, calculate rewards, or send a transaction.</p><div className="proposal-result-meta"><span>{PAIR_TYPE_LABELS[submittedProposal.pairType]}</span><span>Holder Rewards {(submittedProposal.holderRewardBps / 100).toFixed(2)}%</span></div><div className="proposal-result-actions"><Link href="/" className="button button-primary" data-testid="button-proposal-home">Explore launches</Link><button className="button button-quiet" onClick={resetProposal} data-testid="button-propose-another">Back to Launcher</button></div></div><Footer />
  </main>;

  return <main className="main proposal-update proposal-main">
    <div className="proposal-hero">
      <div className="page-top"><span className="section-kicker">Start with the story <span className="step-divider">/</span> 03</span><h1 className="page-title"><em>Launcher.</em></h1><p className="page-intro">Give the community something worth showing up for. Your proposal becomes a demo launch page only — no token is created and no funds are collected.</p></div>
      <div className="hero-stamp"><span className="stamp-orbit"><ShieldCheck size={15} /></span><span>Community<br />idea board</span></div>
    </div>
    <div className="form-layout proposal-layout">
      <Form {...form}>
      <form className="panel proposal-panel" onSubmit={form.handleSubmit(submit)} noValidate data-testid="form-propose">
        <div className="form-heading"><div><span className="form-overline">Proposal details</span><h2>Tell us what the internet made</h2></div><span className="required-key"><i /> Required</span></div>
        <section className="form-section" aria-labelledby="idea-section-title">
          <div className="section-label"><span className="section-index">01</span><h3 id="idea-section-title">The idea</h3></div>
          <div className="field-grid">
            <FormField control={form.control} name="name" render={({ field, fieldState }) => <div className="field"><label htmlFor="proposal-name">Token name <span className="required-mark">*</span></label><input {...field} id="proposal-name" placeholder="e.g. The Last Braincell" maxLength={48} required data-testid="input-token-name" aria-invalid={fieldState.invalid} />{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
            <FormField control={form.control} name="ticker" render={({ field, fieldState }) => <div className="field"><label htmlFor="proposal-ticker">Ticker <span className="required-mark">*</span></label><div className="ticker-input"><span>$</span><input {...field} id="proposal-ticker" onChange={event => field.onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="BRAIN" maxLength={10} required data-testid="input-token-ticker" aria-invalid={fieldState.invalid} /></div><div className="field-hint">2–10 letters or numbers. Display only.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
          </div>
          <div className="field">
            <div className="field-label-row"><label htmlFor="proposal-image">Idea image <span className="field-hint inline-hint">Optional</span></label><span className="file-spec">PNG · JPG · WEBP / 2 MB MAX</span></div>
            {imageData ? <div className="image-preview-card"><img src={imageData} alt="Selected proposal artwork preview" data-testid="img-proposal-preview" /><div className="image-file-details"><strong>{imageName || 'Proposal image'}</strong><span>{(imageSize / 1024).toFixed(0)} KB · Stored in this browser</span></div><div className="image-actions"><button type="button" className="mini-action" onClick={() => imageInput.current?.click()} data-testid="button-replace-image"><Upload size={13} />Replace</button><button type="button" className="mini-action remove-action" onClick={removeImage} data-testid="button-remove-image"><X size={13} />Remove</button></div></div> :
              <button type="button" className="upload-zone" onClick={() => imageInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseImage(event.dataTransfer.files[0]); }} data-testid="button-upload-image"><span className="upload-icon"><FileImage size={19} /></span><span className="upload-copy"><strong>Choose an image</strong><span>or drop it here · PNG, JPG, WebP</span></span><span className="upload-cta"><Upload size={14} />Browse files</span></button>}
            <input ref={imageInput} id="proposal-image" className="file-input-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={event => chooseImage(event.target.files?.[0])} aria-label="Upload proposal image" data-testid="input-proposal-image" />
            {imageReading && <p className="field-hint" role="status" data-testid="status-image-reading">Preparing image preview…</p>}
            {imageError && <p className="error-line" role="alert" data-testid="error-proposal-image"><AlertCircle size={13} />{imageError}</p>}
            {form.formState.errors.imageUrl && <p className="error-line" role="alert">{form.formState.errors.imageUrl.message}</p>}
            <p className="storage-notice"><Info size={13} />Image and proposal data are temporarily stored in this browser only, not in remote storage.</p>
          </div>
          <FormField control={form.control} name="description" render={({ field, fieldState }) => <div className="field"><label htmlFor="proposal-story">The story <span className="required-mark">*</span></label><textarea {...field} id="proposal-story" placeholder="What happened, and why is this one worth a shared shot?" maxLength={380} required data-testid="input-description" aria-invalid={fieldState.invalid} /><div className="story-meta"><span>Give people the context behind the meme.</span><span className={descriptionLength > 350 ? 'count-close' : ''}>{descriptionLength}<i>/</i>380</span></div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
          <FormField control={form.control} name="sourceUrl" render={({ field, fieldState }) => <div className="field"><label htmlFor="proposal-source">Source link <span className="field-hint inline-hint">Optional</span></label><input {...field} id="proposal-source" type="url" placeholder="Link to the original post or meme" data-testid="input-source-url" aria-invalid={fieldState.invalid} /><div className="field-hint">Credit the original spark, if there is one.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        </section>
        <section className="form-section pair-section" aria-labelledby="pair-section-title">
           <div className="section-label"><span className="section-index">02</span><div><h3 id="pair-section-title">Выбери торговую пару</h3><p className="section-description">Твой токен будет торговаться против выбранного актива, а награды будут распределяться между подходящими держателями</p></div><span className="pumpfun-platform-badge" data-testid="status-pair-platform">Pump.fun</span></div>
           <FormField control={form.control} name="pairType" render={({ field, fieldState }) => <div className="field"><label>Категория актива <span className="required-mark">*</span></label><div className="pair-options" role="radiogroup" aria-label="Trading pair type">{PAIR_TYPE_OPTIONS.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={field.value === option.value} className={`pair-option ${field.value === option.value ? 'selected' : ''}`} onClick={() => field.onChange(option.value)} data-testid={`button-pair-${option.value}`}><span className="pair-option-mark">{field.value === option.value ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{option.label}</strong><small>{option.value === 'supported-memecoin' ? 'A community meme token' : option.value === 'tokenized-stock' ? 'A tokenized equity asset' : 'Another supported pair asset'}</small></span></button>)}</div><div className="field-hint">Choose the asset category; Pump.fun is the only launch platform shown here.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
          <div className="token-picker-block">
            <div className="field-label-row"><label>Pair token <span className="required-mark">*</span></label><span className="field-hint inline-hint">Catalog lookup</span></div>
            <button ref={tokenTrigger} type="button" className={`token-picker-button ${selectedToken ? 'has-token' : ''}`} onClick={() => { setTokenSearch(''); setManualMint(selectedToken?.source === 'manual' ? selectedToken.mintAddress : ''); setTokenDialogOpen(true); }} aria-haspopup="dialog" data-testid="button-select-pair-token"><span className="token-picker-icon"><Search size={16} /></span><span className="token-picker-text"><strong>{selectedToken?.source === 'catalog' ? `${selectedToken.name} ($${selectedToken.ticker})` : selectedToken ? 'Manual mint selected' : 'Select a token'}</strong><small>{selectedToken ? selectedToken.mintAddress : 'Search by name, ticker, or mint address'}</small></span><span className="picker-arrow"><ArrowUpRight size={15} /></span></button>
            <FormField control={form.control} name="pairMintAddress" render={({ field, fieldState }) => <><input type="hidden" {...field} data-testid="input-pair-mint-address" />{selectedToken && <div className="selected-token-status"><span className="mono">{selectedToken.mintAddress}</span><span className="pair-status-pills"><span className="pair-status-pill">{catalogMembershipLabel(selectedCatalogStatus)}</span><span className="pair-status-pill">{compatibilityLabel(selectedCompatibilityStatus)}</span></span></div>}{fieldState.error && <p className="error-line" role="alert" data-testid="error-pair-mint">{fieldState.error.message}</p>}</>} />
          </div>
          <div className="pair-validation-note compact-validation" data-testid="notice-pair-validation">Catalog membership and compatibility are separate. A listing is not live eligibility confirmation; secondary pair eligibility is not checked.</div>
        </section>
         <section className="form-section rewards-section">
           <div className="section-label"><span className="section-index">03</span><div><h3>Механика наград</h3><p className="section-description">Один прозрачный механизм для идеи сообщества.</p></div></div>
           <div className="reward-mechanic-card" aria-label="Selected reward mechanic"><span className="reward-mechanic-icon"><Users size={17} /></span><span><strong>Reward</strong><small>Торговые комиссии распределяются между подходящими держателями токена</small></span><span className="reward-selected"><Check size={13} /> Выбрано</span></div>
           <div className="reward-rate-title"><h4>Комиссия для держателей</h4><span>Текущая ставка</span></div>
           <FormField control={form.control} name="holderRewardBps" render={({ field, fieldState }) => <><div className="reward-slider-header"><label htmlFor="holder-reward-rate">Предлагаемая ставка</label><strong data-testid="text-holder-reward-rate">{(holderRewardBps / 100).toFixed(2)}<span>%</span></strong></div><input {...field} id="holder-reward-rate" type="range" min={MIN_HOLDER_REWARD_BPS} max={MAX_HOLDER_REWARD_BPS} step={1} value={holderRewardBps} onChange={event => field.onChange(Number(event.target.value))} data-testid="slider-holder-rewards" aria-label="Комиссия для держателей" aria-valuetext={`${(holderRewardBps / 100).toFixed(2)} percent`} aria-invalid={fieldState.invalid} /><div className="range-limits range-ticks"><span>0.01%</span><span>1.5%</span><span>3%</span></div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</>} />
           <div className="rewards-explanation"><Info size={15} /><p>Ставка зависит от выбранной пары и правил Pump.fun. Это ставка распределения, а не отдельный сбор поверх других комиссий. Наличие актива в каталоге не подтверждает совместимость пары или доступность этой ставки.</p></div>
        </section>
        <div className="pair-validation-note"><ShieldCheck size={16} /><span><strong>Demo proposal only</strong><small>Catalog status: {catalogMembershipLabel(selectedCatalogStatus)}. Compatibility: {compatibilityLabel(selectedCompatibilityStatus)}. No token, pool, or on-chain asset will be created.</small></span></div>
        {saveError && <p className="form-error" role="alert" data-testid="error-proposal-save"><AlertCircle size={15} />{saveError}</p>}
        <button type="submit" className="button button-primary button-wide save-button" disabled={imageReading || form.formState.isSubmitting} data-testid="button-submit-proposal">Save demo proposal <ArrowUpRight size={15} /></button>
        <p className="submit-caption">Proposal data is stored in this browser only. No wallet, transaction, or remote storage.</p>
      </form>
      </Form>
      <aside className="proposal-aside">
        <div className="side-note side-note-featured"><span className="aside-number">01 / THE POINT</span><span className="aside-mark"><CheckCircle2 size={16} /></span><h3>A launch page,<br />not a launch.</h3><p>Your proposal is an open community idea. This prototype does not create a token, pool, or on-chain asset.</p><div className="aside-rule"><span /></div><div className="aside-tag">COMMUNITY FIRST, ALWAYS</div></div>
         <div className="side-note community-start-card"><span className="aside-number">02 / СТАРТ СООБЩЕСТВА</span><h3>Старт сообщества</h3><div className="community-targets"><span><strong>$10</strong><small>за участника</small></span><span><strong>100</strong><small>участников</small></span><span><strong>$1,000</strong><small>цель</small></span></div><p>Окно сбора — 1 час. Если программа будет запущена и цель не достигнута, участники смогут запросить возврат по правилам программы.</p><div className="collection-not-started"><i /> Сбор не начался</div><small className="demo-disclaimer">Демо-параметры; средства здесь не собираются.</small></div>
        <div className="side-note"><span className="aside-number">03 / WHAT'S NOT HERE</span><h3>Checks come later</h3><p>Mint format and required fields are checked in your browser. Token support and Pump.fun eligibility are not.</p></div>
        <div className="privacy-card"><span className="privacy-icon"><ShieldCheck size={16} /></span><span><strong>Browser-only storage</strong><small>Your proposal and image are temporarily stored in this browser, not remote storage.</small></span></div>
      </aside>
    </div>
    <Footer />
    {tokenDialogOpen && <div className="fu-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setTokenDialogOpen(false); tokenTrigger.current?.focus(); } }}>
      <section ref={tokenModal} className="fu-modal token-modal" role="dialog" aria-modal="true" aria-labelledby="token-dialog-title" data-testid="dialog-token-selector">
        <div className="fu-modal-top"><div><span className="modal-kicker">PAIR TOKEN / CATALOG</span><h2 id="token-dialog-title">Select a token</h2></div><button type="button" className="modal-close" onClick={() => { setTokenDialogOpen(false); tokenTrigger.current?.focus(); }} aria-label="Close token selector" data-testid="button-close-token-dialog"><X size={18} /></button></div>
        <p className="modal-copy">Find a pair token by its name, ticker, or Solana mint address.</p>
        <label className="token-search"><Search size={16} /><input ref={catalogSearchInput} value={tokenSearch} onChange={event => setTokenSearch(event.target.value)} placeholder="Search name, ticker, or mint" aria-label="Search token catalog" data-testid="input-token-search" /></label>
         <div className="catalog-filters" role="group" aria-label="Filter assets by catalog group">{([{ key: 'all', label: 'All' }, { key: 'xstocks', label: 'xStocks' }, { key: 'backpack', label: 'Backpack' }, { key: 'crypto', label: 'Crypto' }] as const).map(filter => <button type="button" key={filter.key} className={assetGroupFilter === filter.key ? 'active' : ''} aria-pressed={assetGroupFilter === filter.key} onClick={() => setAssetGroupFilter(filter.key)} data-testid={`button-filter-${filter.key}`}>{filter.label}</button>)}</div>
         <p className="catalog-warning" data-testid="notice-pump-supported-list"><Info size={13} />Search uses the official list snapshot. xStocks and Backpack filters come from issuer data; Crypto groups the remaining listed assets. A catalog match does not confirm current Pump.fun eligibility.</p>
        {catalogLoading ? <div className="catalog-empty" role="status" data-testid="status-catalog-loading"><span className="catalog-spinner" aria-hidden="true" /><strong>Searching supported assets…</strong></div> :
          searchReady && catalogQuery.isError ? <div className="catalog-empty catalog-error" role="alert" data-testid="error-token-catalog"><span className="catalog-empty-icon"><AlertCircle size={18} /></span><strong>Couldn’t load the supported-pair list</strong><p>{catalogError}</p><button type="button" className="button button-quiet" onClick={() => void catalogQuery.refetch()} data-testid="button-retry-token-search">Try again</button></div> :
           catalogQuery.isSuccess && visibleCatalogTokens.length > 0 ? <div className="catalog-results" aria-label="Token catalog results">{visibleCatalogTokens.map(token => {
             const tokenEntry: TokenCatalogEntry = { mintAddress: token.mintAddress, name: token.name, ticker: token.ticker, category: token.category, assetGroup: token.assetGroup, iconUrl: token.iconUrl, catalogStatus: token.catalogStatus, compatibilityStatus: token.compatibilityStatus };
             return <button type="button" className={`catalog-result ${selectedToken?.mintAddress === token.mintAddress ? 'selected' : ''}`} key={token.mintAddress} onClick={() => chooseToken({ ...tokenEntry, source: 'catalog' })} data-testid={`button-catalog-token-${token.mintAddress}`} aria-pressed={selectedToken?.mintAddress === token.mintAddress}><CatalogTokenIcon token={tokenEntry} /><span className="catalog-result-copy"><strong><small className="catalog-ticker">{token.ticker}</small>{token.name}</strong><span className="mono" title={token.mintAddress}>{shortAddress(token.mintAddress)}</span><span className="catalog-result-details"><small>{PAIR_ASSET_CATEGORY_LABELS[token.category]}</small><small>{catalogMembershipLabel(token.catalogStatus)}</small><small>Compatibility: {compatibilityLabel(token.compatibilityStatus)}</small></span></span>{selectedToken?.mintAddress === token.mintAddress && <Check size={15} className="catalog-selected-check" />}</button>;
          })}</div> :
           catalogQuery.isSuccess ? <div className="catalog-empty" role="status" data-testid="status-catalog-empty"><span className="catalog-empty-icon"><Search size={20} /></span><strong>{catalogTokens.length ? 'No assets in this group' : 'Nothing found'}</strong><p>{catalogTokens.length ? 'Choose another filter to view the matching published assets.' : 'No asset in the official list matches this name, ticker, or mint address.'}</p></div> :
          <div className="catalog-empty" role="status" data-testid="status-catalog-prompt"><span className="catalog-empty-icon"><Search size={20} /></span><strong>Search supported pair assets</strong><p>Enter a name, ticker, or Solana mint to search the Pump.fun list.</p>{catalogQuery.data && <small className="catalog-source-date">Snapshot of {catalogQuery.data.totalAssets} assets · page updated {catalogQuery.data.sourceLastUpdated}</small>}</div>}
        <div className="secondary-pair-note"><strong>Secondary Pump.fun coins</strong><p>A Pump.fun coin may qualify as a pair only when its own launch was against a listed asset (one hop). This app cannot verify that launch basis, so such mints remain “Not checked.”</p></div>
        <div className="advanced-mint dialog-advanced">
          <button className="advanced-toggle" type="button" aria-expanded={showAdvancedMint} onClick={() => setShowAdvancedMint(value => !value)} data-testid="button-toggle-manual-mint"><span><span className="advanced-bracket">+</span><span><strong>Advanced</strong><small>Enter a mint address manually</small></span></span><ChevronDown size={16} className={showAdvancedMint ? 'chevron-open' : ''} /></button>
          {showAdvancedMint && <div className="advanced-content"><div className="field"><div className="field-label-row"><label htmlFor="manual-pair-mint">Pair token mint address</label>{manualMintTouched && manualMint && <span className={`mint-status ${validManualMint ? 'valid' : 'invalid'}`}>{validManualMint ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{validManualMint ? 'Format valid · unverified' : 'Invalid format'}</span>}</div><input id="manual-pair-mint" value={manualMint} onChange={event => { setManualMint(event.target.value); setManualMintTouched(true); }} onBlur={() => setManualMintTouched(true)} inputMode="text" autoComplete="off" spellCheck={false} minLength={32} maxLength={44} placeholder="Solana Base58 mint address" aria-invalid={manualMintTouched && !!manualMint && !validManualMint} data-testid="input-manual-mint" /><div className="field-hint">Checks Base58 encoding and 32-byte length only. No network lookup is performed.</div>{manualMintTouched && manualMint && !validManualMint && <p className="error-line" role="alert">Enter a valid 32-byte Solana Base58 mint address.</p>}</div><div className="unverified-note"><ShieldCheck size={15} /><span><strong>Not in the main list · not checked</strong><small>Manual entry is an unverified demo candidate. A pump.fun coin could qualify as a one-hop secondary pair, but this app has no official way to confirm its original pair.</small></span></div><button type="button" className="button button-primary manual-select-button" disabled={!validManualMint} onClick={() => chooseToken({ source: 'manual', mintAddress: manualMint.trim(), catalogStatus: 'not-listed', compatibilityStatus: 'not-checked' })} data-testid="button-use-manual-mint">Use as unverified candidate</button></div>}
        </div>
        <div className="fu-modal-footer"><span><Info size={13} />No catalog entry confirms live compatibility.</span><a className="button button-quiet source-link" href="https://pump.fun/docs/custom-pairs" target="_blank" rel="noreferrer" data-testid="link-supported-pair-source">Official source <ExternalLink size={13} /></a></div>
      </section>
    </div>}
  </main>;
}

function ActivityPage({ activities, launches, wallet }: { activities: Activity[]; launches: Launch[]; wallet: string | null }) {
  const sorted = useMemo(() => [...activities].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [activities]);
  const own = wallet ? sorted.filter(activity => activity.walletAddress === wallet) : [];
  return <main className="main">
    <div className="page-top"><span className="section-kicker">Local browser record / 04</span><h1 className="page-title">Demo activity.</h1><p className="page-intro">A transparent record of simulated $10 commitments. These are not transfers, receipts, or on-chain transactions.</p></div>
    <div className="refund-banner" style={{ margin: '0 0 24px' }} data-testid="notice-activity-demo"><div className="refund-icon"><ShieldCheck size={16} /></div><div><h3>All rows are demo data</h3><p>Activity is stored locally in this browser. No funds have been collected. A “confirmed” label means only that the prototype recorded a click.</p></div></div>
    {sorted.length ? <div className="activity-table" data-testid="table-activity">
      <div className="activity-head"><span>Community idea</span><span>Demo wallet</span><span>Amount</span><span>Status · date</span></div>
      {sorted.map(activity => {
        const live = launches.find(launch => launch.id === activity.launchId);
        return <div className="activity-row" key={activity.id} data-testid={`row-activity-${activity.id}`}>
          <div className="activity-project">{live?.name ?? activity.launchName}<small>${activity.ticker}</small></div>
          <div className="mono" style={{ color: '#aeb5bf' }}>{shortAddress(activity.walletAddress)}</div>
          <div className="mono">$ {activity.amountUsd.toFixed(2)}</div>
          <div><span className={`activity-status ${activity.status === 'pending' ? 'pending' : ''}`}>{activity.status.toUpperCase()}</span><span className="activity-demo">DEMO</span><small style={{ display: 'block', color: '#78818e', marginTop: 5 }}>{formatDate(activity.createdAt)}</small></div>
        </div>;
      })}
    </div> : <div className="empty-state" data-testid="empty-activity"><div className="empty-mark"><Wallet size={17} /></div><h3>No demo activity yet</h3><p>Connect a demo wallet and record a fixed $10 commitment to see it here.</p><Link href="/" className="button button-primary" data-testid="button-activity-explore">Explore launches</Link></div>}
    {wallet && <p className="field-hint" style={{ marginTop: 13 }}>Connected demo wallet: <span className="mono">{shortAddress(wallet)}</span> · {own.length} local record{own.length === 1 ? '' : 's'} linked to this wallet.</p>}
    <Footer />
  </main>;
}

type ModalKind = 'connect' | 'commit' | null;
function Dialog({ kind, launch, wallet, onClose, onConnect, onConfirm, busy }: {
  kind: ModalKind; launch: Launch | null; wallet: string | null; onClose: () => void; onConnect: () => void; onConfirm: () => void; busy: boolean;
}) {
  if (!kind) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" data-testid={`modal-${kind}`}>
      <div className="modal-top"><div><span className="section-kicker">{kind === 'connect' ? 'Local-only identity' : 'Review before recording'}</span><h2 id="dialog-title">{kind === 'connect' ? (wallet ? 'Demo wallet connected' : 'Connect demo wallet') : 'Commit exactly $10?'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Close dialog" data-testid="button-close-modal"><X size={18} /></button></div>
      {kind === 'connect' ? <>
        <p className="modal-copy">This is a local prototype identity used only to enforce one demo commitment per launch. No wallet provider is contacted, and no private keys are requested or accepted.</p>
        {wallet ? <div className="connected-box"><div className="connected-symbol"><Check size={14} /></div><div><span className="stat-label">DEMO ADDRESS</span><span className="mono">{shortAddress(wallet)}</span></div></div> : <div className="modal-notice">Demo mode creates a non-custodial-looking placeholder address in this browser. It is not a real wallet and cannot sign or send anything.</div>}
        <div className="modal-actions"><button className="button button-quiet" onClick={onClose} data-testid="button-cancel-connect">Close</button>{!wallet && <button className="button button-primary" onClick={onConnect} data-testid="button-enable-demo-wallet"><Wallet size={14} /> Use demo wallet</button>}</div>
      </> : <>
        <p className="modal-copy">You are about to add one simulated <strong>$10.00</strong> commitment to <strong>{launch?.name}</strong>. This is a local demo record only.</p>
        <div className="amount-box"><span className="amount-caption">Fixed contribution · one per wallet</span><div className="amount-number">$10.00</div></div>
        <div className="modal-notice">No funds will be transferred or held. No token or liquidity pool is created. “Confirm” only updates this prototype’s local display.</div>
        <div className="modal-actions"><button className="button button-quiet" onClick={onClose} disabled={busy} data-testid="button-cancel-commit">Cancel</button><button className="button button-primary" onClick={onConfirm} disabled={busy} data-testid="button-confirm-commit">{busy ? 'Recording demo…' : 'Confirm demo $10'}</button></div>
      </>}
    </section>
  </div>;
}

function NotFound() {
  return <main className="main"><div className="empty-state"><div className="empty-mark">404</div><h3>That page wandered off</h3><p>This route is not part of the fairlaunch demo.</p><Link href="/" className="button button-primary">Return to explore</Link></div></main>;
}

function AppContent() {
  const [location] = useLocation();
  const [launches, setLaunches] = usePersistedState<Launch[]>(LAUNCH_KEY, SEED_LAUNCHES, normalizeLaunches);
  const [activities, setActivities] = usePersistedState<Activity[]>(ACTIVITY_KEY, SEED_ACTIVITIES);
  const [wallet, setWallet] = usePersistedState<string | null>(WALLET_KEY, null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const connect = () => {
    if (!wallet) {
      const candidate = `Demo-${Math.random().toString(36).slice(2, 7)}-${Math.random().toString(36).slice(2, 6)}`;
      setWallet(candidate);
      setToast('Demo wallet connected locally. No wallet service was contacted.');
    }
    setModal(null);
  };
  const addLaunch = (proposal: LaunchProposalInput): boolean => {
    const id = `${proposal.ticker.toLowerCase()}-${Date.now().toString(36)}`;
    const launch: Launch = {
      ...proposal, id, creatorWallet: wallet ? shortAddress(wallet) : 'Demo proposer',
      committedAmountUsd: 0, participantCount: 0, targetParticipantCount: 100,
      deadline: new Date(Date.now() + 3600000).toISOString(), status: 'active', participants: [],
    };
    const nextLaunches = [launch, ...launches];
    try {
      localStorage.setItem(LAUNCH_KEY, JSON.stringify(nextLaunches));
    } catch {
      return false;
    }
    setLaunches(nextLaunches);
    return true;
  };
  const startCommit = (launch: Launch) => { setSelectedLaunch(launch); setModal('commit'); };
  const confirmCommit = () => {
    if (!wallet || !selectedLaunch || busy) return;
    if (activities.some(activity => activity.launchId === selectedLaunch.id && activity.walletAddress === wallet)) {
      setModal(null); setToast('This demo wallet already has a commitment on this launch.'); return;
    }
    setBusy(true);
    window.setTimeout(() => {
      const timestamp = new Date().toISOString();
      const activity: Activity = {
        id: `demo-${Date.now().toString(36)}`, launchId: selectedLaunch.id, launchName: selectedLaunch.name,
        ticker: selectedLaunch.ticker, amountUsd: 10, status: 'confirmed', createdAt: timestamp, demo: true, walletAddress: wallet,
      };
      setActivities(current => [activity, ...current]);
      setLaunches(current => current.map(item => item.id !== selectedLaunch.id ? item : {
        ...item,
        committedAmountUsd: item.committedAmountUsd + 10,
        participantCount: item.participantCount + 1,
        participants: [{ walletAddress: shortAddress(wallet), amountUsd: 10, committedAt: timestamp }, ...item.participants],
        status: item.participantCount + 1 >= item.targetParticipantCount ? 'completed' : item.status,
      }));
      setBusy(false); setModal(null); setSelectedLaunch(null);
      setToast('Demo commitment recorded. No funds were transferred.');
    }, 650);
  };

  const pages = <Switch>
      <Route path="/"><HomePage launches={launches} /></Route>
      <Route path="/propose"><LaunchpadPage onAdd={addLaunch} wallet={wallet ?? ''} onConnect={() => setModal('connect')} /></Route>
      <Route path="/activity"><ActivityPage activities={activities} launches={launches} wallet={wallet} /></Route>
      <Route path="/launch/:id">{params => <LaunchPage id={params.id} launches={launches} activities={activities} wallet={wallet} onConnect={() => setModal('connect')} onCommit={startCommit} />}</Route>
      <Route><NotFound /></Route>
    </Switch>;
  return <div className={`app-shell ${location !== '/propose' ? 'light-migration site-with-sidebar' : ''}`}>
    {location === '/propose' ? pages : <SiteChrome wallet={wallet} onConnect={() => setModal('connect')}>{pages}</SiteChrome>}
    <Dialog kind={modal} launch={selectedLaunch} wallet={wallet} busy={busy} onClose={() => { if (!busy) setModal(null); }} onConnect={connect} onConfirm={confirmCommit} />
    {toast && <div role="status" className="toast" data-testid="status-toast">{toast}</div>}
  </div>;
}

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppContent /></WouterRouter>;
}

export default App;
