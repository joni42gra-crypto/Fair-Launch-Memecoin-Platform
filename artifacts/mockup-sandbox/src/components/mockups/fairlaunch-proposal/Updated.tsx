import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Compass,
  FileImage,
  Info,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import {
  supportedPairCatalog,
  type PairAssetCategory,
  type PairAssetGroup,
} from '../../../../../api-server/src/data/supported-pair-assets';
import './_group.css';
import './Updated.css';
import { emptyTokenDraft, TokenIdentitySection, tokenDraftErrors, tokenLink, type TokenDraft } from './_TokenIdentity';

type PairType = 'supported-memecoin' | 'tokenized-stock' | 'other-supported-token';
type CatalogAsset = {
  source: 'catalog';
  name: string;
  ticker: string;
  mintAddress: string;
  category: PairAssetCategory;
  assetGroup: PairAssetGroup;
  pairType: PairType;
  catalogStatus: 'listed';
  compatibilityStatus: 'not-checked';
};
type ManualAsset = {
  source: 'manual';
  name: string;
  ticker: string;
  mintAddress: string;
  category: PairAssetCategory;
  pairType: PairType;
  catalogStatus: 'not-listed';
  compatibilityStatus: 'not-checked';
};
type SelectedAsset = CatalogAsset | ManualAsset;
type GroupFilter = 'all' | PairAssetGroup;

const xstocksMints = new Set(supportedPairCatalog.assetGroups.xstocks);
const backpackMints = new Set(supportedPairCatalog.assetGroups.backpack);
const catalogAssets: CatalogAsset[] = supportedPairCatalog.assets.map(
  ([ticker, name, mintAddress, category]) => ({
    source: 'catalog',
    ticker,
    name,
    mintAddress,
    category,
    assetGroup: xstocksMints.has(mintAddress)
      ? 'xstocks'
      : backpackMints.has(mintAddress)
        ? 'backpack'
        : 'crypto',
    pairType: pairTypeForCategory(category),
    catalogStatus: 'listed',
    compatibilityStatus: 'not-checked',
  }),
);

function pairTypeForCategory(category: PairAssetCategory): PairType {
  if (category === 'tokenized-stock') return 'tokenized-stock';
  if (category === 'memecoin' || category === 'pumpfun-coin') {
    return 'supported-memecoin';
  }
  return 'other-supported-token';
}

function pairTypeLabel(pairType: PairType | undefined) {
  if (pairType === 'tokenized-stock') return 'Tokenized stock';
  if (pairType === 'supported-memecoin') return 'Supported memecoin';
  if (pairType === 'other-supported-token') return 'Other supported token';
  return 'Not selected';
}

function shortMint(mint: string) {
  return `${mint.slice(0, 5)}…${mint.slice(-5)}`;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function validMint(value: string) {
  const address = value.trim();
  if (address.length < 32 || address.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return false;
  let decoded = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let byteCount = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    byteCount += 1;
  }
  return byteCount + (address.match(/^1*/)?.[0].length ?? 0) === 32;
}

function CatalogGlyph({ ticker }: { ticker: string }) {
  return (
    <span className="pr-asset-glyph" aria-label="No official icon provided">
      {ticker.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Updated() {
  const initialSol = catalogAssets.find((asset) => asset.ticker === 'SOL') ?? null;
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(initialSol);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [search, setSearch] = useState('');
  const [rewardBps, setRewardBps] = useState(50);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMint, setManualMint] = useState('');
  const [manualPairType, setManualPairType] = useState<PairType>('other-supported-token');
  const [showDemoNotice, setShowDemoNotice] = useState(false);
  const [tokenDraft, setTokenDraft] = useState<TokenDraft>(emptyTokenDraft);
  const [showIdentityErrors, setShowIdentityErrors] = useState(false);

  function previewProposal() {
    setShowIdentityErrors(true);
    if (Object.keys(tokenDraftErrors(tokenDraft)).length > 0) {
      document.querySelector('.pr-identity-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setShowDemoNotice(true);
  }

  const groupCounts = {
    all: catalogAssets.length,
    xstocks: catalogAssets.filter((asset) => asset.assetGroup === 'xstocks').length,
    backpack: catalogAssets.filter((asset) => asset.assetGroup === 'backpack').length,
    crypto: catalogAssets.filter((asset) => asset.assetGroup === 'crypto').length,
  };

  const visibleAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalogAssets.filter((asset) => {
      const groupMatches = groupFilter === 'all' || asset.assetGroup === groupFilter;
      const queryMatches =
        !query ||
        asset.name.toLocaleLowerCase().includes(query) ||
        asset.ticker.toLocaleLowerCase().includes(query) ||
        asset.mintAddress.toLocaleLowerCase().includes(query);
      return groupMatches && queryMatches;
    });
  }, [groupFilter, search]);

  function chooseManualMint() {
    if (!validMint(manualMint)) return;
    setSelectedAsset({
      source: 'manual',
      name: 'Custom mint',
      ticker: 'MANUAL',
      mintAddress: manualMint.trim(),
      category: 'other',
      pairType: manualPairType,
      catalogStatus: 'not-listed',
      compatibilityStatus: 'not-checked',
    });
  }

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setSearch(event.target.value);
  }

  const tabs: { id: GroupFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'xstocks', label: 'xStocks' },
    { id: 'backpack', label: 'Backpack' },
    { id: 'crypto', label: 'Crypto' },
  ];

  return (
    <div className="app-shell fairlaunch-concept">
      <aside className="pr-sidebar">
        <a href="#" className="pr-brand" aria-label="Fairlaunch home">
          <span className="pr-brand-mark">f</span>
          <span>fairlaunch</span>
        </a>
        <nav className="pr-nav" aria-label="Main navigation">
          <span className="pr-nav-label">Workspace</span>
          <a className="pr-nav-item" href="#"><Compass size={16} />Overview</a>
          <a className="pr-nav-item" href="#"><Search size={16} />Explore</a>
          <a className="pr-nav-item active" href="#" aria-current="page"><Sparkles size={16} />Propose</a>
          <a className="pr-nav-item" href="#"><Activity size={16} />Activity</a>
          <span className="pr-nav-label pr-nav-label-lower">Resources</span>
          <a className="pr-nav-item" href="#"><CircleHelp size={16} />Documentation</a>
        </nav>
        <div className="pr-sidebar-note">
          <span className="pr-sidebar-note-icon"><ShieldCheck size={15} /></span>
          <span><strong>Preview prototype</strong><small>No wallet or transactions</small></span>
        </div>
      </aside>

      <div className="pr-workspace">
        <header className="pr-topbar">
          <div className="pr-breadcrumb"><span>Proposal</span><span>/</span><strong>Trading pair</strong></div>
          <div className="pr-topbar-actions">
            <span className="pr-demo-status"><i /> DEMO MODE</span>
            <button type="button" className="pr-wallet-button" disabled title="Wallet connection is not part of this prototype">
              <Wallet size={14} />Connect
            </button>
          </div>
        </header>

        <main className="pr-page">
          <div className="pr-step-heading">
            <div className="pr-step-eyebrow">STEP 1 <span>/</span> 3</div>
            <h1>Choose what it pairs with</h1>
            <p>Your token trades against this asset, and rewards are distributed to eligible holders.</p>
            <div className="pr-progress" aria-label="Step 1 of 3">
              <span className="current" /><span /><span />
            </div>
          </div>

          <div className="pr-content-grid">
              <section className="pr-config-card" aria-label="Trading pair settings">
              <div className="pr-config-header">
                  <div><span className="pr-kicker">PROPOSAL SETTINGS</span><h2>Trading pair terms</h2></div>
                  <span className="pr-required"><i />Required settings</span>
              </div>

              <div className="pr-config-section pr-launch-section">
                <div className="pr-section-heading"><span className="pr-section-number">01</span><h3>Launch on</h3></div>
                <div className="pr-platform-card" aria-label="Only platform: Pump.fun">
                  <span className="pr-platform-mark"><Sparkles size={16} /></span>
                  <span><strong>Pump.fun</strong><small>The only platform in this concept</small></span>
                  <span className="pr-selected-label"><Check size={13} />Selected</span>
                </div>
              </div>

              <div className="pr-config-section pr-reward-section">
                <div className="pr-section-heading"><span className="pr-section-number">02</span><div><h3>Hooks</h3><p>One distribution mechanic for eligible holders.</p></div></div>
                <div className="pr-reward-card" role="group" aria-label="Reward hook selected">
                  <span className="pr-reward-icon"><UsersIcon /></span>
                  <span className="pr-reward-copy"><strong>Reward</strong><small>Trading fees are split among eligible token holders</small></span>
                  <span className="pr-reward-check"><Check size={14} />Selected</span>
                </div>
                <div className="pr-rate-heading"><h4>Holder commission</h4><span>RATE</span></div>
                <div className="pr-rate-readout"><label htmlFor="pr-reward-rate">Proposed rate</label><strong>{(rewardBps / 100).toFixed(2)}<small>%</small></strong></div>
                <input
                  id="pr-reward-rate"
                  className="pr-range"
                  type="range"
                  min={1}
                  max={300}
                  step={1}
                  value={rewardBps}
                  onChange={(event) => setRewardBps(Number(event.target.value))}
                  aria-label="Holder commission"
                  aria-valuetext={`${(rewardBps / 100).toFixed(2)} percent`}
                />
                <div className="pr-rate-ticks"><span>0.01%</span><span>1.5%</span><span>3%</span></div>
                <div className="pr-rate-note"><Info size={15} /><p>The available rate depends on the trading pair and Pump.fun rules. This is a distribution rate, not an extra fee on top of other charges; catalog listings do not confirm pair compatibility or rate availability.</p></div>
              </div>

              <div className="pr-config-section pr-pairs-section">
                <div className="pr-section-heading"><span className="pr-section-number">03</span><div><h3>Paired with</h3><p>Assets from Pump.fun’s published list. Individual mint compatibility has not been verified.</p></div></div>
                <div className="pr-pair-toolbar">
                  <div className="pr-pair-tabs" role="group" aria-label="Catalog filter">
                    {tabs.map((tab) => (
                      <button
                        type="button"
                        key={tab.id}
                        className={groupFilter === tab.id ? 'active' : ''}
                        aria-pressed={groupFilter === tab.id}
                        onClick={() => setGroupFilter(tab.id)}
                      >
                        {tab.label}<span>{groupCounts[tab.id]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="pr-search-box">
                    <Search size={15} />
                    <input value={search} onChange={onSearchChange} placeholder="Search by ticker, name or address" aria-label="Search catalog" />
                    {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
                  </label>
                </div>
                <div className="pr-catalog-meta">
                  <span>{visibleAssets.length} of {groupCounts[groupFilter]} assets</span>
                  <span>Snapshot: {supportedPairCatalog.snapshotCapturedAt}</span>
                </div>
                {visibleAssets.length > 0 ? (
                  <div className="pr-asset-grid" aria-label="Catalog results">
                    {visibleAssets.map((asset) => (
                      <button
                        type="button"
                        key={asset.mintAddress}
                        className={`pr-asset-card ${selectedAsset?.mintAddress === asset.mintAddress ? 'selected' : ''}`}
                        aria-pressed={selectedAsset?.mintAddress === asset.mintAddress}
                        title={`${asset.name} · ${asset.mintAddress}`}
                        onClick={() => setSelectedAsset(asset)}
                      >
                        <CatalogGlyph ticker={asset.ticker} />
                        <span className="pr-asset-copy">
                          <strong>{asset.ticker}</strong>
                          <small>{asset.name}</small>
                          <code>{shortMint(asset.mintAddress)}</code>
                        </span>
                        {selectedAsset?.mintAddress === asset.mintAddress && <CheckCircle2 size={14} className="pr-asset-check" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pr-no-results"><Search size={18} /><strong>No assets found</strong><span>Try another search or choose a different group.</span></div>
                )}
                <div className="pr-source-note">
                  <Info size={14} />
                  <span>xStocks and Backpack groups follow issuer data; Crypto contains the remaining entries. <a href={supportedPairCatalog.sourceUrl} target="_blank" rel="noreferrer">Official source</a></span>
                </div>

                <div className="pr-manual-entry">
                  <button type="button" className="pr-manual-toggle" aria-expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}>
                    <span><strong>Enter a mint manually</strong><small>Candidate only; compatibility is unverified</small></span>
                    <ChevronDown size={16} className={manualOpen ? 'open' : ''} />
                  </button>
                  {manualOpen && (
                    <div className="pr-manual-fields">
                      <label>
                        Solana mint address
                        <input value={manualMint} onChange={(event) => setManualMint(event.target.value)} placeholder="Enter Base58 mint" spellCheck={false} />
                      </label>
                      <label>
                        Asset category
                        <select value={manualPairType} onChange={(event) => setManualPairType(event.target.value as PairType)}>
                          <option value="supported-memecoin">Supported memecoin</option>
                          <option value="tokenized-stock">Tokenized stock</option>
                          <option value="other-supported-token">Other supported token</option>
                        </select>
                      </label>
                      <button type="button" className="pr-manual-select" disabled={!validMint(manualMint)} onClick={chooseManualMint}>Select unverified mint</button>
                      {manualMint && !validMint(manualMint) && <small className="pr-manual-error">Check the Base58 format and 32-byte length.</small>}
                    </div>
                  )}
                </div>
              </div>

              <TokenIdentitySection draft={tokenDraft} onChange={setTokenDraft} showErrors={showIdentityErrors} />

              <div className="pr-step-actions">
                <button type="button" className="pr-back-button" disabled><ArrowLeft size={15} />Back</button>
                <button type="button" className="pr-continue-button" onClick={previewProposal}>Continue <ArrowRight size={15} /></button>
              </div>
            </section>

            <aside className="pr-summary">
              <section className="pr-summary-card">
                <div className="pr-summary-title"><h2>Token preview</h2><span>DEMO</span></div>
                <div className="pr-token-summary">
                  {tokenDraft.imageUrl ? <img className="pr-summary-token-image" src={tokenDraft.imageUrl} alt="Your token image" /> : <span className="pr-empty-glyph"><FileImage size={17} /></span>}
                  <span><strong>{tokenDraft.name.trim() || 'Token name'}</strong><small>{tokenDraft.ticker.trim() ? `$${tokenDraft.ticker.trim()}` : 'No ticker yet'}</small></span>
                </div>
                {tokenDraft.description.trim() && <p className="pr-summary-description">{tokenDraft.description}</p>}
                <div className="pr-summary-socials">
                  {(['x', 'website', 'telegram'] as const).map((kind) => {
                    const href = tokenLink(tokenDraft[kind], kind);
                    return href ? <a key={kind} href={href} target="_blank" rel="noopener noreferrer">{kind === 'website' ? 'Website' : kind === 'telegram' ? 'Telegram' : 'X'} ↗</a> : null;
                  })}
                </div>
                <div className="pr-summary-lines">
                  <div><span>Platform</span><strong>Pump.fun</strong></div>
                  <div><span>Asset type</span><strong>{pairTypeLabel(selectedAsset?.pairType)}</strong></div>
                  <div><span>Pair</span><strong>{selectedAsset?.ticker ?? '—'}</strong></div>
                  <div><span>Holder rewards</span><strong>{(rewardBps / 100).toFixed(2)}%</strong></div>
                  <div><span>Catalog</span><strong>{selectedAsset?.catalogStatus === 'listed' ? 'Listed' : selectedAsset ? 'Not listed' : '—'}</strong></div>
                  <div><span>Compatibility</span><strong className="pr-unverified">Unverified</strong></div>
                </div>
                {selectedAsset && <code className="pr-summary-mint">{shortMint(selectedAsset.mintAddress)}</code>}
                <div className="pr-summary-caution"><ShieldCheck size={14} /><span>A catalog entry alone does not authorize a real launch.</span></div>
                <button type="button" className="pr-summary-disabled" disabled title="Token launches are not part of this prototype">Launch unavailable in demo</button>
              </section>

              <section className="pr-community-card">
                <span className="pr-kicker">COMMUNITY START</span>
                <h2>Shared goal</h2>
                <div className="pr-community-stats">
                  <span><strong>$10</strong><small>per person</small></span>
                  <span><strong>100</strong><small>contributors</small></span>
                  <span><strong>$1,000</strong><small>goal</small></span>
                </div>
                <p>One-hour collection window. If the program is launched and the goal is not met, contributors may request a refund under its rules.</p>
                <div className="pr-not-started"><i />Collection not started</div>
                <small className="pr-demo-only">Concept terms only; no funds are collected.</small>
              </section>

              <p className="pr-privacy"><ShieldCheck size={14} />Prototype only: no tokens, collections or transactions.</p>
            </aside>
          </div>
        </main>
      </div>

      {showDemoNotice && (
        <div className="pr-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDemoNotice(false); }}>
          <section className="pr-demo-modal" role="dialog" aria-modal="true" aria-labelledby="pr-demo-title">
            <button type="button" className="pr-modal-close" aria-label="Close" onClick={() => setShowDemoNotice(false)}><X size={17} /></button>
            <span className="pr-modal-icon"><ShieldCheck size={21} /></span>
            <span className="pr-kicker">PREVIEW</span>
            <h2 id="pr-demo-title">Concept only</h2>
            <p>This mockup previews a token proposal. It does not create a token, collect funds or send transactions. Pair compatibility has not been verified.</p>
            <button type="button" className="pr-continue-button" onClick={() => setShowDemoNotice(false)}>Got it <Check size={15} /></button>
          </section>
        </div>
      )}
    </div>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 20v-1.6c0-1.3-1.2-2.4-2.7-2.4H6.7C5.2 16 4 17.1 4 18.4V20M10 12a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 12ZM17 7.2a2.5 2.5 0 0 1 0 4.8M20 19v-.7c0-1.1-.8-2-2-2.3" />
    </svg>
  );
}
