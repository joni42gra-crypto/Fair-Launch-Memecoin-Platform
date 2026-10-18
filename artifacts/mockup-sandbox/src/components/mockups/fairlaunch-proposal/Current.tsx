import { ArrowUpRight, Wallet } from 'lucide-react';
import { useState } from 'react';
import './_group.css';

export function Current() {
  const [rewardBps, setRewardBps] = useState(50);
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#" className="brand"><span className="brand-mark">f</span><span>fairlaunch</span></a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#" className="nav-link">Explore</a>
          <a href="#" className="nav-link active">Propose</a>
          <a href="#" className="nav-link">Activity</a>
        </nav>
        <div className="nav-right">
          <span className="demo-pill"><i className="demo-dot" />Demo mode</span>
          <button className="button button-outline"><Wallet size={14} />Connect</button>
        </div>
      </div>
    </header>
    <main className="main">
      <div className="page-top">
        <span className="section-kicker">Start with the story / 03</span>
        <h1 className="page-title">Propose a meme.</h1>
        <p className="page-intro">Give the community something worth showing up for. Your proposal becomes a demo launch page only — no token is created and no funds are collected.</p>
      </div>
      <div className="form-layout">
        <form className="panel">
          <h2>Tell us what the internet made</h2>
          <div className="field"><label htmlFor="current-name">Token name</label><input id="current-name" placeholder="e.g. The Last Braincell" /></div>
          <div className="field"><label htmlFor="current-ticker">Ticker</label><input id="current-ticker" placeholder="e.g. BRAIN" /><div className="field-hint">2–10 letters or numbers. It will display as a ticker only.</div></div>
          <div className="field"><label htmlFor="current-type">Trading pair type</label><select id="current-type" defaultValue=""><option value="" disabled>Choose a pair category</option><option>Supported meme coin</option><option>Tokenized stock</option><option>Other supported token</option></select></div>
          <div className="field"><label htmlFor="current-mint">Pair token mint address</label><input id="current-mint" placeholder="Solana Base58 mint address" /><div className="field-hint">Enter the token mint address for the selected pair. This checks Base58 format and 32-byte length only.</div></div>
          <div className="field">
            <div className="reward-slider-header"><label htmlFor="current-reward">Holder Rewards</label><strong>{(rewardBps / 100).toFixed(2)}%</strong></div>
            <input id="current-reward" type="range" min="1" max="300" step="1" value={rewardBps} onChange={event => setRewardBps(Number(event.target.value))} />
            <div className="range-limits"><span>0.01%</span><span>3.00%</span></div>
            <p className="rewards-explanation">Rewards are intended for eligible holders of the selected pair token, distributed under Pump.fun rules. This prototype does not calculate or distribute rewards.</p>
          </div>
          <div className="field"><label htmlFor="current-image">Image URL <span className="field-hint">(optional)</span></label><input id="current-image" type="url" placeholder="https://..." /><div className="field-hint">Display-only prototype value; not uploaded or verified.</div></div>
          <div className="field"><label htmlFor="current-source">Source URL <span className="field-hint">(optional)</span></label><input id="current-source" type="url" placeholder="Link to the original post or meme" /></div>
          <div className="field"><label htmlFor="current-story">The story</label><textarea id="current-story" placeholder="What happened, and why is this one worth a shared shot?" /><div className="field-hint">0/380 characters</div></div>
          <div className="pair-validation-note">Pair availability and reward-rate eligibility are not verified in this frontend prototype. A future server check must validate them with the official Pump.fun SDK before any real launch.</div>
          <button type="button" className="button button-primary button-wide" style={{ marginTop: 5 }}>Save demo proposal <ArrowUpRight size={15} /></button>
        </form>
        <aside>
          <div className="side-note"><h3>A launch page, not a launch</h3><p>This prototype stores a proposal in your browser and displays it as an open community idea. No token, pool, or on-chain asset will be created.</p></div>
          <div className="side-note"><h3>One size for everyone</h3><p>Demo participation is fixed at $10, once per wallet per launch. There are no privileged creator shares or whale tiers.</p></div>
          <div className="side-note"><h3>Server-side checks come later</h3><p>This form validates the mint address format and required fields only. It does not confirm token support or Pump.fun reward eligibility.</p></div>
        </aside>
      </div>
      <footer className="footer"><span><strong>fairlaunch</strong> / community first, always</span><span>PROTOTYPE ONLY · NO FUNDS · NO TOKEN DEPLOYMENT</span></footer>
    </main>
  </div>;
}
