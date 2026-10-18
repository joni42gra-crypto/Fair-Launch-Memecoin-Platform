import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ArrowUpRight, Check, Clock3, ExternalLink, Plus, ShieldCheck, Users, Wallet, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Form, FormField } from '@/components/ui/form';
import { Activity, Launch, SEED_ACTIVITIES, SEED_LAUNCHES, shortAddress } from './data';
import {
  DEFAULT_HOLDER_REWARD_BPS,
  DEFAULT_PAIR_MINT_ADDRESS,
  DEFAULT_PAIR_TYPE,
  MAX_HOLDER_REWARD_BPS,
  MIN_HOLDER_REWARD_BPS,
  PAIR_TYPE_LABELS,
  PAIR_TYPE_OPTIONS,
  isPairType,
  isValidSolanaMintAddress,
  launchProposalSchema,
  type LaunchProposalFormInput,
  type LaunchProposalInput,
} from './lib/launch-validation';

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

function Nav({ wallet, onConnect }: { wallet: string | null; onConnect: () => void }) {
  const [location] = useLocation();
  const navItems = [
    { href: '/', label: 'Explore' },
    { href: '/propose', label: 'Propose' },
    { href: '/activity', label: 'Activity' },
  ];
  return <header className="topbar">
    <div className="topbar-inner">
      <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark">f</span><span>fairlaunch</span></Link>
      <nav className="nav-links" aria-label="Main navigation">
        {navItems.map(item => <Link key={item.href} href={item.href} className={`nav-link ${location === item.href || (item.href === '/' && location.startsWith('/launch/')) ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase()}`}>{item.label}</Link>)}
      </nav>
      <div className="nav-right">
        <span className="demo-pill"><i className="demo-dot" />Demo mode</span>
        <button className={wallet ? 'button button-quiet' : 'button button-outline'} onClick={onConnect} aria-label={wallet ? 'Manage demo wallet' : 'Connect demo wallet'} data-testid="button-connect-wallet">
          <Wallet size={14} />{wallet ? shortAddress(wallet) : 'Connect'}
        </button>
      </div>
    </div>
  </header>;
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
          <Link href="/propose" className="button button-quiet" data-testid="button-propose-hero"><Plus size={15} /> Propose a meme</Link>
        </div>
        <div className="hero-note"><span className="live-led">● ALL ACTIVITY IS SIMULATED</span><span>Not connected to a blockchain</span></div>
      </div>
    </section>

    <section className="section" id="active-launches">
      <div className="section-head"><div><span className="section-kicker">Open calls / 01</span><h2>Find your people</h2><p className="section-sub">Every participant contributes the same fixed $10 in this demo.</p></div><Link href="/activity" className="text-link" data-testid="link-view-activity">View demo activity <ArrowUpRight size={13} /></Link></div>
      {loading ? <div className="loading-lines" aria-label="Loading launches" data-testid="loading-launches"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        : active.length ? <div className="launch-grid" data-testid="list-active-launches">{active.map(launch => <LaunchCard key={launch.id} launch={launch} />)}</div>
        : <div className="empty-state" data-testid="empty-active-launches"><div className="empty-mark"><Plus size={19} /></div><h3>No open launches yet</h3><p>The next community idea could start here. Propose a meme for everyone to rally around.</p><Link href="/propose" className="button button-primary" data-testid="button-empty-propose">Propose a meme</Link></div>}
    </section>

    <section className="section">
      <div className="section-head"><div><span className="section-kicker">Made it together / 02</span><h2>Goal reached</h2><p className="section-sub">A target hit by the community. No token has been created.</p></div></div>
      {completed.length ? <div className="launch-grid">{completed.map(launch => <LaunchCard key={launch.id} launch={launch} />)}</div>
        : <div className="empty-state"><div className="empty-mark"><Check size={18} /></div><h3>First one is still on its way</h3><p>When a community reaches its participant target, it will appear here as goal reached.</p></div>}
    </section>

    <section className="section mechanics">
      <div className="mechanics-intro"><span className="section-kicker">The rules are the product</span><h2>Same amount.<br />Same starting line.</h2><p>Fair means the mechanics do not quietly change when a bigger wallet walks in. Every community member gets one equal-sized demo commitment.</p></div>
      <div className="steps">
        <div className="step"><span className="step-no">01</span><div><h3>Bring a meme with a pulse</h3><p>Anyone can propose an idea and link its source. Proposing creates a launch page, never a token.</p></div></div>
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
  return <main className="main">
    <div className="page-top"><Link href="/" className="text-link" data-testid="link-back-launches">← All launches</Link></div>
    <div className="detail-layout">
      <section className="panel">
        <div className="detail-heading"><Artwork launch={launch} /><div><span className={`status ${launch.status === 'completed' ? 'complete' : ''}`}>{launch.status === 'completed' ? 'Goal reached' : 'Active demo'}</span><h1>{launch.name}</h1><span className="ticker">${launch.ticker} · by {launch.creatorWallet}</span></div></div>
        <p className="detail-content">{launch.description}</p>
        <div className="pair-summary" data-testid="launch-pair-settings">
          <div className="pair-summary-item"><span className="stat-label">Trading pair type</span><span className="stat-value">{PAIR_TYPE_LABELS[launch.pairType]}</span></div>
          <div className="pair-summary-item"><span className="stat-label">Pair mint address</span><span className="stat-value mono" title={launch.pairMintAddress}>{shortAddress(launch.pairMintAddress)}</span></div>
          <div className="pair-summary-item"><span className="stat-label">Holder Rewards · demo setting</span><span className="stat-value">{(launch.holderRewardBps / 100).toFixed(2)}%</span></div>
        </div>
        <div className="pair-validation-note">Pair support and reward-rate eligibility have not been checked with Pump.fun.</div>
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

function ProposePage({ onAdd }: { onAdd: (data: LaunchProposalInput) => void }) {
  const [submittedProposal, setSubmittedProposal] = useState<LaunchProposalInput | null>(null);
  const form = useForm<LaunchProposalFormInput>({
    resolver: zodResolver(launchProposalSchema),
    defaultValues: {
      name: '',
      ticker: '',
      pairType: '',
      pairMintAddress: '',
      holderRewardBps: DEFAULT_HOLDER_REWARD_BPS,
      imageUrl: '',
      sourceUrl: '',
      description: '',
    },
  });
  const holderRewardBps = form.watch('holderRewardBps') ?? DEFAULT_HOLDER_REWARD_BPS;
  const descriptionLength = form.watch('description')?.length ?? 0;

  function submit(values: LaunchProposalFormInput) {
    if (!isPairType(values.pairType)) return;
    const proposal: LaunchProposalInput = { ...values, pairType: values.pairType };
    onAdd(proposal);
    setSubmittedProposal(proposal);
  }

  if (submittedProposal) return <main className="main"><div className="page-top"><span className="section-kicker">Proposal saved / demo</span></div><div className="empty-state" data-testid="success-proposal"><div className="empty-mark"><Check size={19} /></div><h3>Your idea has a demo page</h3><p>{submittedProposal.name} is saved as a local proposal. This does not create or launch a token, check pair eligibility, calculate rewards, or send a transaction.</p><div className="proposal-result-meta"><span>{PAIR_TYPE_LABELS[submittedProposal.pairType]}</span><span>Holder Rewards {(submittedProposal.holderRewardBps / 100).toFixed(2)}%</span></div><div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}><Link href="/" className="button button-primary" data-testid="button-proposal-home">Explore launches</Link><button className="button button-quiet" onClick={() => { setSubmittedProposal(null); form.reset(); }} data-testid="button-propose-another">Propose another</button></div></div><Footer /></main>;
  return <main className="main">
    <div className="page-top"><span className="section-kicker">Start with the story / 03</span><h1 className="page-title">Propose a meme.</h1><p className="page-intro">Give the community something worth showing up for. Your proposal becomes a demo launch page only — no token is created and no funds are collected.</p></div>
    <div className="form-layout">
      <Form {...form}>
      <form className="panel" onSubmit={form.handleSubmit(submit)} data-testid="form-propose">
        <h2>Tell us what the internet made</h2>
        <FormField control={form.control} name="name" render={({ field, fieldState }) => <div className="field"><label htmlFor="token-name">Token name</label><input {...field} id="token-name" placeholder="e.g. The Last Braincell" maxLength={48} data-testid="input-token-name" required aria-invalid={fieldState.invalid} />{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="ticker" render={({ field, fieldState }) => <div className="field"><label htmlFor="token-ticker">Ticker</label><input {...field} id="token-ticker" onChange={event => field.onChange(event.target.value.toUpperCase())} placeholder="e.g. BRAIN" maxLength={10} data-testid="input-token-ticker" required aria-invalid={fieldState.invalid} /><div className="field-hint">2–10 letters or numbers. It will display as a ticker only.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="pairType" render={({ field, fieldState }) => <div className="field"><label htmlFor="pair-type">Trading pair type</label><select {...field} id="pair-type" value={field.value ?? ''} data-testid="select-pair-type" required aria-invalid={fieldState.invalid}><option value="" disabled>Choose a pair category</option>{PAIR_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="pairMintAddress" render={({ field, fieldState }) => <div className="field"><label htmlFor="pair-mint-address">Pair token mint address</label><input {...field} id="pair-mint-address" type="text" inputMode="text" autoComplete="off" spellCheck={false} minLength={32} maxLength={44} placeholder="Solana Base58 mint address" data-testid="input-pair-mint-address" required aria-invalid={fieldState.invalid} /><div className="field-hint">Enter the token mint address for the selected pair. This checks Base58 format and 32-byte length only.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="holderRewardBps" render={({ field, fieldState }) => <div className="field reward-field"><div className="reward-slider-header"><label htmlFor="holder-reward-rate">Holder Rewards</label><strong data-testid="text-holder-reward-rate">{(holderRewardBps / 100).toFixed(2)}%</strong></div><input {...field} id="holder-reward-rate" type="range" min={MIN_HOLDER_REWARD_BPS} max={MAX_HOLDER_REWARD_BPS} step={1} value={holderRewardBps} onChange={event => field.onChange(Number(event.target.value))} data-testid="slider-holder-rewards" aria-label="Holder Rewards rate" aria-valuetext={`${(holderRewardBps / 100).toFixed(2)} percent`} aria-invalid={fieldState.invalid} /><div className="range-limits"><span>0.01%</span><span>3.00%</span></div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}<p className="rewards-explanation">Rewards are intended for eligible holders of the selected pair token, distributed under Pump.fun rules. This prototype does not calculate or distribute rewards.</p></div>} />
        <FormField control={form.control} name="imageUrl" render={({ field, fieldState }) => <div className="field"><label htmlFor="image-url">Image URL <span className="field-hint">(optional)</span></label><input {...field} id="image-url" type="url" placeholder="https://..." data-testid="input-image-url" aria-invalid={fieldState.invalid} /><div className="field-hint">Display-only prototype value; not uploaded or verified.</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="sourceUrl" render={({ field, fieldState }) => <div className="field"><label htmlFor="source-url">Source URL <span className="field-hint">(optional)</span></label><input {...field} id="source-url" type="url" placeholder="Link to the original post or meme" data-testid="input-source-url" aria-invalid={fieldState.invalid} />{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <FormField control={form.control} name="description" render={({ field, fieldState }) => <div className="field"><label htmlFor="description">The story</label><textarea {...field} id="description" placeholder="What happened, and why is this one worth a shared shot?" maxLength={380} data-testid="input-description" required aria-invalid={fieldState.invalid} /><div className="field-hint">{descriptionLength}/380 characters</div>{fieldState.error && <p className="error-line" role="alert">{fieldState.error.message}</p>}</div>} />
        <div className="pair-validation-note" data-testid="notice-pair-validation">Pair availability and reward-rate eligibility are not verified in this frontend prototype. A future server check must validate them with the official Pump.fun SDK before any real launch.</div>
        <button type="submit" className="button button-primary button-wide" style={{ marginTop: 5 }} data-testid="button-submit-proposal">Save demo proposal <ArrowUpRight size={15} /></button>
      </form>
      </Form>
      <aside>
        <div className="side-note"><h3>A launch page, not a launch</h3><p>This prototype stores a proposal in your browser and displays it as an open community idea. No token, pool, or on-chain asset will be created.</p></div>
        <div className="side-note"><h3>One size for everyone</h3><p>Demo participation is fixed at $10, once per wallet per launch. There are no privileged creator shares or whale tiers.</p></div>
        <div className="side-note"><h3>Server-side checks come later</h3><p>This form validates the mint address format and required fields only. It does not confirm token support or Pump.fun reward eligibility.</p></div>
      </aside>
    </div>
    <Footer />
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
  const addLaunch = (proposal: LaunchProposalInput) => {
    const id = `${proposal.ticker.toLowerCase()}-${Date.now().toString(36)}`;
    const launch: Launch = {
      ...proposal, id, creatorWallet: wallet ? shortAddress(wallet) : 'Demo proposer',
      committedAmountUsd: 0, participantCount: 0, targetParticipantCount: 100,
      deadline: new Date(Date.now() + 7 * 86400000).toISOString(), status: 'active', participants: [],
    };
    setLaunches(current => [launch, ...current]);
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

  return <div className="app-shell">
    <Nav wallet={wallet} onConnect={() => setModal('connect')} />
    <Switch>
      <Route path="/"><HomePage launches={launches} /></Route>
      <Route path="/propose"><ProposePage onAdd={addLaunch} /></Route>
      <Route path="/activity"><ActivityPage activities={activities} launches={launches} wallet={wallet} /></Route>
      <Route path="/launch/:id">{params => <LaunchPage id={params.id} launches={launches} activities={activities} wallet={wallet} onConnect={() => setModal('connect')} onCommit={startCommit} />}</Route>
      <Route><NotFound /></Route>
    </Switch>
    <Dialog kind={modal} launch={selectedLaunch} wallet={wallet} busy={busy} onClose={() => { if (!busy) setModal(null); }} onConnect={connect} onConfirm={confirmCommit} />
    {toast && <div role="status" className="toast" data-testid="status-toast">{toast}</div>}
  </div>;
}

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppContent /></WouterRouter>;
}

export default App;
