import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileImage,
  Info,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import './_group.css';
import './Updated.css';

const PAIR_OPTIONS = [
  { value: 'supported-memecoin', label: 'Supported meme coin', detail: 'A community meme token' },
  { value: 'tokenized-stock', label: 'Tokenized stock', detail: 'A tokenized equity asset' },
  { value: 'other-supported-token', label: 'Other supported token', detail: 'Another eligible pair asset' },
] as const;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function validMint(value: string) {
  const address = value.trim();
  if (address.length < 32 || address.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return false;
  let decoded = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let decodedBytes = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    decodedBytes += 1;
  }
  return decodedBytes + (address.match(/^1*/)?.[0].length ?? 0) === 32;
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function Updated() {
  const [rewardBps, setRewardBps] = useState(50);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [pairType, setPairType] = useState('');
  const [mint, setMint] = useState('');
  const [story, setStory] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [mintTouched, setMintTouched] = useState(false);
  const [showMintEntry, setShowMintEntry] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [imageInputKey, setImageInputKey] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const validMintValue = mint.length > 0 && validMint(mint);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (!tokenDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTokenDialogOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tokenDialogOpen]);

  function chooseImage(file?: File) {
    if (!file) return;
    setImageError('');
    const extensionAllowed = /\.(png|jpe?g|webp)$/i.test(file.name);
    const mimeAllowed = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
    if (!extensionAllowed || (file.type && !mimeAllowed)) {
      setImageFile(null);
      setImageError('Choose a PNG, JPG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageFile(null);
      setImageError('This image is over 2 MB. Choose a smaller file.');
      return;
    }
    setImageFile(file);
  }

  function removeImage() {
    setImageFile(null);
    setImageError('');
    setImageInputKey(value => value + 1);
  }

  function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!name.trim() || !/^[a-zA-Z0-9]{2,10}$/.test(ticker.trim()) || !pairType || !mint.trim() || !story.trim()) {
      setFormError('Complete each required field before saving your demo proposal.');
      if (!mint.trim() || !validMintValue) {
        setShowMintEntry(true);
        if (mint.trim()) setMintTouched(true);
      }
      return;
    }
    if (name.trim().length < 2 || story.trim().length < 12) {
      setFormError('Use at least 2 characters for the name and 12 characters for the story.');
      return;
    }
    if (!validMintValue) {
      setShowMintEntry(true);
      setMintTouched(true);
      setFormError('Enter a valid 32-byte Solana Base58 mint address.');
      return;
    }
    if (sourceUrl.trim()) {
      try {
        const source = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(source.protocol)) throw new Error('invalid');
      } catch {
        setFormError('Use a valid http:// or https:// source link.');
        return;
      }
    }
    setConfirmationOpen(true);
  }

  function startAnother() {
    setConfirmationOpen(false);
    setName('');
    setTicker('');
    setPairType('');
    setMint('');
    setStory('');
    setSourceUrl('');
    setRewardBps(50);
    setMintTouched(false);
    setShowMintEntry(false);
    removeImage();
  }

  return (
    <div className="app-shell proposal-update">
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#" className="brand" aria-label="fairlaunch home">
            <span className="brand-mark">f</span><span>fairlaunch</span>
          </a>
          <nav className="nav-links" aria-label="Main navigation">
            <a href="#" className="nav-link">Explore</a>
            <a href="#" className="nav-link active" aria-current="page">Propose</a>
            <a href="#" className="nav-link">Activity</a>
          </nav>
          <div className="nav-right">
            <span className="demo-pill"><i className="demo-dot" />Demo mode</span>
            <button className="button button-outline" type="button" disabled title="Wallet connection is not part of this prototype">
              <Wallet size={14} />Connect
            </button>
          </div>
        </div>
      </header>

      <main className="main proposal-main">
        <div className="proposal-hero">
          <div className="page-top">
            <span className="section-kicker">Start with the story <span className="step-divider">/</span> 03</span>
            <h1 className="page-title">Propose a <em>meme.</em></h1>
            <p className="page-intro">Give the community something worth showing up for. Your proposal becomes a demo launch page only — no token is created and no funds are collected.</p>
          </div>
          <div className="hero-stamp" aria-label="A community idea, not a token launch">
            <span className="stamp-orbit"><Sparkles size={15} /></span>
            <span>Community<br />idea board</span>
          </div>
        </div>

        <div className="form-layout proposal-layout">
          <form className="panel proposal-panel" onSubmit={submitProposal} noValidate>
            <div className="form-heading">
              <div>
                <span className="form-overline">Proposal details</span>
                <h2>Tell us what the internet made</h2>
              </div>
              <span className="required-key"><i /> Required</span>
            </div>

            <section className="form-section" aria-labelledby="idea-section-title">
              <div className="section-label"><span className="section-index">01</span><h3 id="idea-section-title">The idea</h3></div>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="proposal-name">Token name <span className="required-mark">*</span></label>
                  <input id="proposal-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. The Last Braincell" maxLength={48} required />
                  <div className="field-hint">A name the community can rally around.</div>
                </div>
                <div className="field">
                  <label htmlFor="proposal-ticker">Ticker <span className="required-mark">*</span></label>
                  <div className="ticker-input"><span>$</span><input id="proposal-ticker" value={ticker} onChange={event => setTicker(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="BRAIN" maxLength={10} required /></div>
                  <div className="field-hint">2–10 letters or numbers. Display only.</div>
                </div>
              </div>
              <div className="field">
                <div className="field-label-row"><label>Idea image <span className="field-hint inline-hint">Optional</span></label><span className="file-spec">PNG · JPG · WEBP / 2 MB MAX</span></div>
                {imageFile && imagePreview ? (
                  <div className="image-preview-card">
                    <img src={imagePreview} alt="Selected proposal artwork preview" />
                    <div className="image-file-details"><strong>{imageFile.name}</strong><span>{formatBytes(imageFile.size)} · Temporary preview</span></div>
                    <div className="image-actions">
                      <button type="button" className="mini-action" onClick={() => imageInput.current?.click()}><Upload size={13} />Replace</button>
                      <button type="button" className="mini-action remove-action" onClick={removeImage}><X size={13} />Remove</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="upload-zone" onClick={() => imageInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseImage(event.dataTransfer.files[0]); }}>
                    <span className="upload-icon"><FileImage size={19} /></span>
                    <span className="upload-copy"><strong>Choose an image</strong><span>or drop it here · PNG, JPG, WebP</span></span>
                    <span className="upload-cta"><Upload size={14} />Browse files</span>
                  </button>
                )}
                <input key={imageInputKey} ref={imageInput} className="file-input-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={event => chooseImage(event.target.files?.[0])} aria-label="Upload proposal image" />
                {imageError && <p className="error-line" role="alert"><AlertCircle size={13} />{imageError}</p>}
                <p className="storage-notice"><Info size={13} />Image preview stays in this browser tab only. It is not uploaded or saved remotely.</p>
              </div>
              <div className="field">
                <label htmlFor="proposal-story">The story <span className="required-mark">*</span></label>
                <textarea id="proposal-story" value={story} onChange={event => setStory(event.target.value.slice(0, 380))} placeholder="What happened, and why is this one worth a shared shot?" maxLength={380} required />
                <div className="story-meta"><span>Give people the context behind the meme.</span><span className={story.length > 350 ? 'count-close' : ''}>{story.length}<i>/</i>380</span></div>
              </div>
              <div className="field">
                <label htmlFor="proposal-source">Source link <span className="field-hint inline-hint">Optional</span></label>
                <input id="proposal-source" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="Link to the original post or meme" />
                <div className="field-hint">Credit the original spark, if there is one.</div>
              </div>
            </section>

            <section className="form-section pair-section" aria-labelledby="pair-section-title">
              <div className="section-label"><span className="section-index">02</span><h3 id="pair-section-title">Pair category</h3></div>
              <div className="field">
                <label>Trading pair type <span className="required-mark">*</span></label>
                <div className="pair-options" role="radiogroup" aria-label="Trading pair type">
                  {PAIR_OPTIONS.map((option, index) => (
                    <button key={option.value} type="button" role="radio" aria-checked={pairType === option.value} className={`pair-option ${pairType === option.value ? 'selected' : ''}`} onClick={() => setPairType(option.value)}>
                      <span className="pair-option-mark">{pairType === option.value ? <Check size={13} /> : <span>{String(index + 1).padStart(2, '0')}</span>}</span>
                      <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                    </button>
                  ))}
                </div>
                <div className="field-hint">Choose the category that best describes the pair asset.</div>
              </div>

              <div className="token-picker-block">
                <div className="field-label-row"><label>Pair token <span className="required-mark">*</span></label><span className="field-hint inline-hint">Catalog lookup</span></div>
                <button type="button" className="token-picker-button" onClick={() => { setTokenSearch(''); setTokenDialogOpen(true); }}>
                  <span className="token-picker-icon"><Search size={16} /></span>
                  <span className="token-picker-text"><strong>Select a token</strong><small>Search by name, ticker, or mint address</small></span>
                  <span className="picker-arrow"><ArrowUpRight size={15} /></span>
                </button>
                <p className="field-hint">Catalog connection is not available in this prototype. Add a mint manually below.</p>
              </div>

              <div className="advanced-mint">
                <button className="advanced-toggle" type="button" aria-expanded={showMintEntry} onClick={() => setShowMintEntry(value => !value)}>
                  <span><span className="advanced-bracket">+</span><span><strong>Advanced</strong><small>Enter a mint address manually</small></span></span>
                  <ChevronDown size={16} className={showMintEntry ? 'chevron-open' : ''} />
                </button>
                {showMintEntry && (
                  <div className="advanced-content">
                    <div className="field">
                      <div className="field-label-row"><label htmlFor="proposal-mint">Pair token mint address <span className="required-mark">*</span></label>
                        {mintTouched && mint.length > 0 && (validMintValue ? <span className="mint-status valid"><CheckCircle2 size={12} />Format valid · unverified</span> : <span className="mint-status invalid"><AlertCircle size={12} />Invalid format</span>)}
                      </div>
                      <input id="proposal-mint" value={mint} onChange={event => { setMint(event.target.value); setMintTouched(true); }} onBlur={() => setMintTouched(true)} inputMode="text" autoComplete="off" spellCheck={false} minLength={32} maxLength={44} placeholder="Solana Base58 mint address" required />
                      <div className="field-hint">Checks Base58 encoding and 32-byte length only. No network lookup is performed.</div>
                    </div>
                    <div className="unverified-note"><ShieldCheck size={15} /><span><strong>Format check only</strong><small>This address is not checked for existence, pair support, or reward eligibility.</small></span></div>
                  </div>
                )}
              </div>
            </section>

            <section className="form-section rewards-section" aria-labelledby="rewards-title">
              <div className="section-label"><span className="section-index">03</span><h3 id="rewards-title">Holder Rewards</h3></div>
              <div className="reward-slider-header"><label htmlFor="proposal-rewards">Proposed reward rate</label><strong>{(rewardBps / 100).toFixed(2)}<span>%</span></strong></div>
              <input id="proposal-rewards" type="range" min="1" max="300" step="1" value={rewardBps} onChange={event => setRewardBps(Number(event.target.value))} aria-label="Holder Rewards rate" aria-valuetext={`${(rewardBps / 100).toFixed(2)} percent`} />
              <div className="range-limits"><span>0.01%</span><span>3.00%</span></div>
              <div className="rewards-explanation"><Info size={15} /><p>Rewards are intended for eligible holders of the selected pair token, distributed under Pump.fun holder rules. Eligibility and distribution are not calculated or verified here.</p></div>
            </section>

            <div className="pair-validation-note"><ShieldCheck size={16} /><span><strong>Demo proposal only</strong><small>Pair availability and reward-rate eligibility are not verified. No token, pool, or on-chain asset will be created.</small></span></div>
            {formError && <p className="form-error" role="alert"><AlertCircle size={15} />{formError}</p>}
            <button type="submit" className="button button-primary button-wide save-button">Save demo proposal <ArrowUpRight size={15} /></button>
            <p className="submit-caption">No wallet connection. No transaction. Just an idea for the community.</p>
          </form>

          <aside className="proposal-aside">
            <div className="side-note side-note-featured">
              <span className="aside-number">01 / THE POINT</span>
              <span className="aside-mark"><Sparkles size={16} /></span>
              <h3>A launch page,<br />not a launch.</h3>
              <p>Your proposal is an open community idea. This prototype does not create a token, pool, or on-chain asset.</p>
              <div className="aside-rule"><span /></div>
              <div className="aside-tag">COMMUNITY FIRST, ALWAYS</div>
            </div>
            <div className="side-note">
              <span className="aside-number">02 / SAME RULES</span>
              <h3>One size for everyone</h3>
              <p>Demo participation is fixed at $10, once per wallet per launch. No privileged creator shares or whale tiers.</p>
            </div>
            <div className="side-note">
              <span className="aside-number">03 / WHAT'S NOT HERE</span>
              <h3>Checks come later</h3>
              <p>Mint format and required fields are checked in your browser. Token support and Pump.fun eligibility are not.</p>
            </div>
            <div className="privacy-card"><span className="privacy-icon"><ShieldCheck size={16} /></span><span><strong>Prototype boundaries</strong><small>Your entry stays in this page state. Nothing is sent to a server.</small></span></div>
          </aside>
        </div>
        <footer className="footer"><span><strong>fairlaunch</strong> / community first, always</span><span>PROTOTYPE ONLY · NO FUNDS · NO TOKEN DEPLOYMENT</span></footer>
      </main>

      {tokenDialogOpen && (
        <div className="fu-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setTokenDialogOpen(false); }}>
          <section className="fu-modal token-modal" role="dialog" aria-modal="true" aria-labelledby="token-dialog-title">
            <div className="fu-modal-top">
              <div><span className="modal-kicker">PAIR TOKEN / CATALOG</span><h2 id="token-dialog-title">Select a token</h2></div>
              <button type="button" className="modal-close" onClick={() => setTokenDialogOpen(false)} aria-label="Close token selector"><X size={18} /></button>
            </div>
            <p className="modal-copy">Find a pair token by its name, ticker, or Solana mint address.</p>
            <label className="token-search"><Search size={16} /><input autoFocus value={tokenSearch} onChange={event => setTokenSearch(event.target.value)} placeholder="Search name, ticker, or mint" aria-label="Search token catalog" /><kbd>/</kbd></label>
            <div className="catalog-empty">
              <span className="catalog-empty-icon"><Search size={20} /></span>
              <strong>Token catalog isn't connected</strong>
              <p>No token results are available in this prototype. Nothing has been searched on-chain.</p>
            </div>
            <div className="fu-modal-footer"><span><Info size={13} />Search is a visual prototype only.</span><button type="button" className="button button-quiet" onClick={() => { setTokenDialogOpen(false); setShowMintEntry(true); }}>Enter mint manually</button></div>
          </section>
        </div>
      )}

      {confirmationOpen && (
        <div className="fu-modal-backdrop">
          <section className="fu-modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <button type="button" className="modal-close confirm-close" onClick={() => setConfirmationOpen(false)} aria-label="Close confirmation"><X size={18} /></button>
            <div className="confirm-symbol"><Check size={22} /></div>
            <span className="modal-kicker">PROPOSAL / DEMO STATE</span>
            <h2 id="confirmation-title">Your idea is ready.</h2>
            <p className="modal-copy"><strong>{name.trim()}</strong> is prepared as a local demo proposal. This confirmation does not save to a server, create a token, validate pair eligibility, or send a transaction.</p>
            <div className="confirm-summary"><span>{ticker ? `$${ticker}` : 'Ticker'}</span><span>{PAIR_OPTIONS.find(item => item.value === pairType)?.label}</span><span>Holder Rewards {(rewardBps / 100).toFixed(2)}%</span></div>
            <div className="confirm-actions"><button type="button" className="button button-primary" onClick={() => setConfirmationOpen(false)}>Back to proposal</button><button type="button" className="button button-quiet" onClick={startAnother}>Start another</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
