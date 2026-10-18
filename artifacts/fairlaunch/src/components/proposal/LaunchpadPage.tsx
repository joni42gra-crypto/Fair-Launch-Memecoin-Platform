import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { getSearchSupportedPairAssetsQueryKey, useSearchSupportedPairAssets } from '@workspace/api-client-react';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Compass, FileImage, Info, Search, ShieldCheck, Sparkles, Upload, Users, Wallet, X } from 'lucide-react';
import {
  DEFAULT_HOLDER_REWARD_BPS, MAX_PROPOSAL_IMAGE_BYTES, PAIR_TYPE_LABELS, PAIR_TYPE_OPTIONS,
  isValidSolanaMintAddress, launchProposalSchema, proposalSocialUrl,
  type LaunchProposalFormInput, type LaunchProposalInput, type PairType,
} from '../../lib/launch-validation';
import type { SelectedPairToken, TokenCatalogEntry } from '../../lib/token-catalog';
import './launchpad.css';

type Group = 'all' | 'xstocks' | 'backpack' | 'crypto';
const groups: { id: Group; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'xstocks', label: 'xStocks' },
  { id: 'backpack', label: 'Backpack' }, { id: 'crypto', label: 'Crypto' },
];
const shortMint = (mint: string) => `${mint.slice(0, 5)}…${mint.slice(-5)}`;

function AssetIcon({ token }: { token: TokenCatalogEntry }) {
  const [failed, setFailed] = useState(false);
  return <span className="lp-asset-glyph">{token.iconUrl && !failed
    ? <img src={token.iconUrl} alt="" onError={() => setFailed(true)} />
    : <FileImage size={16} aria-label="No official icon available" />}</span>;
}

export function LaunchpadPage({ onAdd, wallet, onConnect }: {
  onAdd: (data: LaunchProposalInput) => boolean; wallet: string; onConnect: () => void;
}) {
  const form = useForm<LaunchProposalFormInput>({
    resolver: zodResolver(launchProposalSchema),
    defaultValues: { name: '', ticker: '', description: '', sourceUrl: '', websiteUrl: '', telegramUrl: '', xUrl: '', imageUrl: '', pairType: '', pairMintAddress: '', holderRewardBps: DEFAULT_HOLDER_REWARD_BPS },
  });
  const draft = form.watch();
  const errors = form.formState.errors;
  const [selected, setSelected] = useState<SelectedPairToken | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMint, setManualMint] = useState('');
  const [manualType, setManualType] = useState<PairType>('other-supported-token');
  const [imageError, setImageError] = useState('');
  const [imageReading, setImageReading] = useState(false);
  const [imageName, setImageName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<LaunchProposalInput | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageRequest = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    document.title = 'Launcher · Fairlaunch';
    return () => { imageRequest.current += 1; };
  }, []);
  const catalog = useSearchSupportedPairAssets({ query }, { query: {
    queryKey: getSearchSupportedPairAssetsQueryKey({ query }), staleTime: 30_000, retry: 1,
  } });
  const tokens = catalog.data?.results ?? [];
  const visible = tokens.filter(token => group === 'all' || token.assetGroup === group);
  const loading = search.trim() !== query || catalog.isFetching;
  const selectedName = selected?.source === 'catalog' ? selected.ticker : selected ? 'MANUAL' : 'Not selected';
  const choose = (token: SelectedPairToken, type: PairType) => {
    setSelected(token);
    form.setValue('pairMintAddress', token.mintAddress, { shouldDirty: true, shouldValidate: true });
    form.setValue('pairType', type, { shouldDirty: true, shouldValidate: true });
  };
  function chooseCatalog(token: TokenCatalogEntry) {
    choose({ ...token, source: 'catalog' }, token.category === 'tokenized-stock'
      ? 'tokenized-stock' : ['memecoin', 'pumpfun-coin'].includes(token.category ?? '')
        ? 'supported-memecoin' : 'other-supported-token');
  }
  function chooseImage(file?: File) {
    if (!file) return;
    const request = ++imageRequest.current;
    setImageReading(false);
    if (imageInput.current) imageInput.current.value = '';
    const extension = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension ? 'image/jpeg' : '';
    if (!mime || file.type !== mime) { setImageError('Choose a PNG, JPG or WebP image with a matching file type.'); return; }
    if (file.size > MAX_PROPOSAL_IMAGE_BYTES) { setImageError('Choose an image up to 2 MB for browser storage.'); return; }
    setImageReading(true);
    const reader = new FileReader();
    const fail = () => { if (request === imageRequest.current) { setImageReading(false); setImageError('This image could not be decoded. Try another file.'); } };
    reader.onerror = fail;
    reader.onload = () => {
      if (request !== imageRequest.current) return;
      const url = typeof reader.result === 'string' ? reader.result : '';
      const image = new Image();
      image.onerror = fail;
      image.onload = () => {
        if (request !== imageRequest.current) return;
        form.setValue('imageUrl', url, { shouldDirty: true, shouldValidate: true });
        setImageName(file.name); setImageError(''); setImageReading(false);
      };
      image.src = url;
    };
    reader.readAsDataURL(file);
  }
  function removeImage() {
    imageRequest.current += 1; setImageReading(false); setImageError(''); setImageName('');
    form.setValue('imageUrl', '', { shouldDirty: true, shouldValidate: true });
  }
  function submit(values: LaunchProposalFormInput) {
    setSaveError('');
    if (imageReading) return;
    if (!selected || selected.mintAddress !== values.pairMintAddress) {
      form.setError('pairMintAddress', { message: 'Select a pair token or enter a valid mint.' }); return;
    }
    const result = launchProposalSchema.parse(values);
    const proposal: LaunchProposalInput = { ...result, pairType: result.pairType as PairType, pairToken: selected };
    if (onAdd(proposal)) { setSaved(proposal); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else setSaveError('Browser storage is full or unavailable. Your form has not been cleared. Try a smaller image or free up storage.');
  }
  function reset() {
    imageRequest.current += 1; form.reset(); setSelected(null); setSaved(null); setImageName('');
    setImageError(''); setSaveError(''); setImageReading(false); setManualMint(''); setManualOpen(false);
  }
  const error = (key: keyof LaunchProposalFormInput) => errors[key] ? <small className="lp-error" role="alert">{errors[key]?.message}</small> : null;
  return <div className="lp-shell">
    <aside className="lp-sidebar">
      <Link href="/" className="lp-brand"><span>f</span>fairlaunch</Link>
      <nav aria-label="Main navigation"><small>WORKSPACE</small>
        <Link href="/"><Compass size={16} />Overview</Link><Link href="/"><Search size={16} />Explore</Link>
        <Link href="/propose" className="active" aria-current="page"><Sparkles size={16} />Launcher</Link>
        <Link href="/activity"><Activity size={16} />Activity</Link>
        <small>RESOURCES</small><a href="https://pump.fun/docs/custom-pairs" target="_blank" rel="noreferrer"><Info size={16} />Documentation</a>
      </nav>
      <div className="lp-sidebar-note"><ShieldCheck size={17} /><span><strong>Browser-only proposal</strong><small>No blockchain transactions</small></span></div>
    </aside>
    <div className="lp-workspace">
      <header className="lp-topbar"><span>Launcher <i>/</i> <strong>Trading pair</strong></span><div><small className="lp-mode">● DEMO MODE</small><button type="button" onClick={onConnect}><Wallet size={14} />{wallet ? 'Demo wallet' : 'Connect'}</button></div></header>
      <main className="lp-page">
        {saved ? <section className="lp-saved" data-testid="success-proposal"><CheckCircle2 size={32} /><small>PROPOSAL SAVED / DEMO</small><h1>Your idea has a demo page</h1><p>{saved.name} is saved in this browser only. No token was created, no funds were collected, and no transaction was sent.</p><p>Pair: {selectedName} · Holder rewards: {(saved.holderRewardBps / 100).toFixed(2)}% · Compatibility: Unverified</p><Link href="/" className="lp-primary">Explore launches</Link><button type="button" onClick={reset}>Back to Launcher</button></section> : <>
        <div className="lp-heading"><small>STEP 1 <i>/</i> 3</small><h1>Choose what it pairs with</h1><p>Your token trades against this asset, and rewards are distributed to eligible holders.</p><div className="lp-progress" aria-label="Proposal settings"><span /><span /><span /></div></div>
        <div className="lp-content">
          <form className="lp-config" noValidate onSubmit={form.handleSubmit(submit)} data-testid="form-propose">
            <div className="lp-config-header"><div><small>PROPOSAL SETTINGS</small><h2>Trading pair terms</h2></div><small>● Required settings</small></div>
            <section className="lp-section"><div className="lp-section-heading"><b>01</b><h3>Launch on</h3></div>
              <div className="lp-platform"><span className="lp-platform-mark"><Sparkles size={17} /></span><span><strong>Pump.fun</strong><small>The only launch platform</small></span><small><Check size={13} />Selected</small></div>
            </section>
            <section className="lp-section"><div className="lp-section-heading"><b>02</b><div><h3>Hooks</h3><p>One distribution mechanic for eligible holders.</p></div></div>
              <div className="lp-reward"><Users size={25} /><span><strong>Reward</strong><small>Trading fees are split among eligible token holders</small></span><small><Check size={13} />Selected</small></div>
              <div className="lp-rate-title"><h4>Holder commission</h4><small>RATE</small></div>
              <div className="lp-rate"><label htmlFor="holder-rate">Proposed rate</label><strong>{(draft.holderRewardBps / 100).toFixed(2)}<small>%</small></strong></div>
              <input id="holder-rate" className="lp-range" type="range" min={1} max={300} step={1} {...form.register('holderRewardBps', { valueAsNumber: true })} aria-valuetext={`${(draft.holderRewardBps / 100).toFixed(2)} percent`} data-testid="input-holder-reward" />
              <div className="lp-ticks"><span>0.01%</span><span>1.5%</span><span>3%</span></div>{error('holderRewardBps')}
              <div className="lp-note"><Info size={15} /><p>Rewards are distributed to eligible token holders under Pump.fun rules. The available rate depends on the pair. This is a distribution rate, not an extra fee on top of other charges; catalog listings do not confirm compatibility or rate availability.</p></div>
            </section>
            <section className="lp-section"><div className="lp-section-heading"><b>03</b><div><h3>Paired with</h3><p>Assets from Pump.fun’s published list. Individual mint compatibility has not been verified.</p></div></div>
              <div className="lp-tabs" role="group" aria-label="Catalog filter">{groups.map(tab => <button type="button" key={tab.id} className={group === tab.id ? 'active' : ''} aria-pressed={group === tab.id} onClick={() => setGroup(tab.id)}>{tab.label}{!query && catalog.data && <small>{tab.id === 'all' ? tokens.length : tokens.filter(t => t.assetGroup === tab.id).length}</small>}</button>)}</div>
              <label className="lp-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="Search by ticker, name or address" aria-label="Search catalog" data-testid="input-token-search" />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>
              <div className="lp-catalog-meta"><span>{loading ? 'Searching…' : `${visible.length} of ${catalog.data?.totalAssets ?? '—'} assets`}</span><span>{catalog.data ? `Snapshot: ${catalog.data.snapshotCapturedAt}` : ''}</span><a href={catalog.data?.sourceUrl ?? 'https://pump.fun/docs/custom-pairs'} target="_blank" rel="noreferrer">Official source ↗</a></div>
              {loading ? <div className="lp-empty" role="status">Loading supported assets…</div> : catalog.isError ? <div className="lp-empty lp-error" role="alert"><strong>Could not load the supported-pair catalog</strong><p>Check the server connection. No demonstration results are substituted.</p><button type="button" onClick={() => void catalog.refetch()}>Try again</button></div> : visible.length ? <div className="lp-assets" aria-label="Catalog results">{visible.map(token => <button type="button" key={token.mintAddress} title={`${token.name} · ${token.mintAddress}`} className={`lp-asset ${selected?.mintAddress === token.mintAddress ? 'selected' : ''}`} aria-pressed={selected?.mintAddress === token.mintAddress} onClick={() => chooseCatalog(token)} data-testid={`button-catalog-token-${token.mintAddress}`}><AssetIcon token={token} /><span><strong>{token.ticker}</strong><small>{token.name}</small><code>{shortMint(token.mintAddress)}</code></span>{selected?.mintAddress === token.mintAddress && <CheckCircle2 size={12} />}</button>)}</div> : <div className="lp-empty"><Search size={18} /><strong>No assets found</strong><span>Try another search or choose a different group.</span></div>}
              <div className="lp-note"><Info size={14} /><p>xStocks and Backpack groups follow issuer data; Crypto contains the remaining entries. A catalog match does not confirm Pump.fun compatibility.</p></div>
              <input type="hidden" {...form.register('pairMintAddress')} data-testid="input-pair-mint-address" /><input type="hidden" {...form.register('pairType')} />
              {error('pairMintAddress')}{error('pairType')}
              <div className="lp-manual"><button type="button" className="lp-manual-toggle" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}><span><strong>Enter a mint manually</strong><small>Candidate only; compatibility is unverified</small></span><ChevronDown size={16} /></button>
                {manualOpen && <div className="lp-manual-fields"><label>Solana mint address<input value={manualMint} onChange={event => setManualMint(event.target.value)} placeholder="Enter Base58 mint" spellCheck={false} /></label><label>Asset category<select value={manualType} onChange={event => setManualType(event.target.value as PairType)}>{PAIR_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" disabled={!isValidSolanaMintAddress(manualMint)} onClick={() => choose({ source: 'manual', mintAddress: manualMint.trim(), catalogStatus: 'not-listed', compatibilityStatus: 'not-checked' }, manualType)}>Select unverified mint</button>{manualMint && !isValidSolanaMintAddress(manualMint) && <small className="lp-error">Check the Base58 format and 32-byte length.</small>}<small>Some tokens launched on Pump.fun may qualify outside the main list. Manual entry alone does not establish eligibility.</small></div>}
              </div>
            </section>
            <section className="lp-section lp-identity"><div className="lp-section-heading"><b>04</b><div><h3>Name the coin</h3><p>A picture, a name and a ticker. This is what every card on the site will show.</p></div></div>
              <div className="lp-identity-grid"><div className="lp-image-field">
                <button type="button" className="lp-upload" aria-label="Upload token image" onClick={() => imageInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseImage(event.dataTransfer.files[0]); }}>{draft.imageUrl ? <img src={draft.imageUrl} alt="Token artwork preview" data-testid="img-proposal-preview" /> : <><Upload size={23} /><strong>Add image</strong><small>PNG, JPG, WebP</small></>}</button>
                <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => chooseImage(event.target.files?.[0])} data-testid="input-proposal-image" />
                {draft.imageUrl && <button type="button" onClick={removeImage} className="lp-remove-image">Remove image</button>}<small title={imageName}>2 MB max · Optional</small>
                {imageReading && <small role="status">Preparing preview…</small>}{imageError && <small className="lp-error" role="alert">{imageError}</small>}{error('imageUrl')}
              </div><div className="lp-name-fields"><div className="lp-name-row"><label><span>NAME <small>{draft.name.length}/48</small></span><input {...form.register('name')} placeholder="Token name" maxLength={48} aria-invalid={!!errors.name} data-testid="input-token-name" />{error('name')}</label><label><span>TICKER <small>{draft.ticker.length}/10</small></span><input {...form.register('ticker')} onChange={event => form.setValue('ticker', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} placeholder="TICKER" maxLength={10} aria-invalid={!!errors.ticker} data-testid="input-token-ticker" />{error('ticker')}</label></div>
                <label><span>DESCRIPTION <small>{draft.description.length}/380</small></span><textarea {...form.register('description')} maxLength={380} placeholder="Tell the story behind your coin (at least 12 characters)" aria-invalid={!!errors.description} data-testid="input-description" />{error('description')}</label></div></div>
              <div className="lp-socials">{([{ key: 'xUrl', label: 'X', placeholder: 'x.com/you, or a link to the tweet', max: 120 }, { key: 'websiteUrl', label: 'WEBSITE', placeholder: 'https://your-project.com', max: 200 }, { key: 'telegramUrl', label: 'TELEGRAM', placeholder: 't.me/yourcommunity', max: 120 }] as const).map(field => <label key={field.key}><span>{field.label}<small>{(draft[field.key] ?? '').length}/{field.max}</small></span><input {...form.register(field.key)} placeholder={field.placeholder} maxLength={field.max} aria-invalid={!!errors[field.key]} />{error(field.key)}</label>)}</div>
              <details className="lp-source"><summary>Original source link (optional)</summary><label><span>SOURCE</span><input {...form.register('sourceUrl')} type="url" placeholder="https://original-source.com/post" />{error('sourceUrl')}</label></details>
              <p className="lp-storage"><ShieldCheck size={13} />Proposal and image are stored in this browser only, not on a server.</p>
            </section>
            <div className="lp-actions"><Link href="/" className="lp-back"><ArrowLeft size={15} />Back</Link><button type="submit" className="lp-primary" disabled={imageReading || form.formState.isSubmitting} data-testid="button-submit-proposal">Save demo proposal <ArrowRight size={15} /></button></div>
            {saveError && <p className="lp-save-error" role="alert">{saveError}</p>}
          </form>
          <aside className="lp-summary"><section className="lp-summary-card"><div className="lp-summary-title"><h2>Token preview</h2><small>DEMO</small></div>
            <div className="lp-token">{draft.imageUrl ? <img src={draft.imageUrl} alt="Your token" /> : <span><FileImage size={19} /></span>}<div><strong>{draft.name.trim() || 'Token name'}</strong><small>{draft.ticker ? `$${draft.ticker}` : 'No ticker yet'}</small></div></div>
            {draft.description && <p className="lp-description">{draft.description}</p>}<div className="lp-links">{([{ key: 'xUrl', kind: 'x', label: 'X' }, { key: 'websiteUrl', kind: 'website', label: 'Website' }, { key: 'telegramUrl', kind: 'telegram', label: 'Telegram' }] as const).map(link => { const href = proposalSocialUrl(draft[link.key] ?? '', link.kind); return href ? <a key={link.key} href={href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a> : null; })}</div>
            <dl>{[['Platform', 'Pump.fun'], ['Asset type', PAIR_TYPE_LABELS[draft.pairType as PairType] ?? 'Not selected'], ['Pair', selectedName], ['Holder rewards', `${(draft.holderRewardBps / 100).toFixed(2)}%`], ['Catalog', selected?.catalogStatus === 'listed' ? 'Listed' : selected ? 'Not listed' : '—'], ['Compatibility', 'Unverified']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {selected && <code className="lp-summary-mint" title={selected.mintAddress}>{shortMint(selected.mintAddress)}</code>}<div className="lp-note"><ShieldCheck size={14} /><p>A catalog entry alone does not authorize a real launch.</p></div><button type="button" className="lp-launch" disabled>Launch unavailable in demo</button>
          </section><section className="lp-community"><small>COMMUNITY START</small><h2>Shared goal</h2><div className="lp-community-stats"><span><strong>$10</strong><small>per person</small></span><span><strong>100</strong><small>contributors</small></span><span><strong>$1,000</strong><small>goal</small></span></div><p>One-hour collection window. If the program is launched and the goal is not met, contributors may request a refund under its rules.</p><div className="lp-not-started">● Collection not started</div><small>Proposed terms only; no funds are collected.</small></section><p className="lp-storage"><ShieldCheck size={14} />No tokens, collections or transactions.</p></aside>
        </div></>}
      </main>
    </div>
  </div>;
}
