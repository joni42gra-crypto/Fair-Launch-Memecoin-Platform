import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, Compass, Info, Search, ShieldCheck, Sparkles, Wallet } from 'lucide-react';

/** The approved Propose navigation, applied to the other existing routes. */
export function SiteChrome({ children, wallet, onConnect }: {
  children: ReactNode;
  wallet: string | null;
  onConnect: () => void;
}) {
  const [location] = useLocation();
  const detail = location.startsWith('/launch/');
  const activity = location === '/activity';
  const explore = location === '/' || detail;
  const section = activity ? 'Activity' : explore ? 'Explore' : 'Workspace';
  const page = activity ? 'Local records' : detail ? 'Launch details' : location === '/' ? 'Community launches' : 'Page not found';
  return <>
    <aside className="lp-sidebar">
      <Link href="/" className="lp-brand" data-testid="link-brand"><span>f</span>fairlaunch</Link>
      <nav aria-label="Main navigation">
        <small>WORKSPACE</small>
        <Link href="/"><Compass size={16} />Overview</Link>
        <Link href="/" className={explore ? 'active' : ''} aria-current={explore ? 'page' : undefined} data-testid="link-nav-explore"><Search size={16} />Explore</Link>
        <Link href="/propose" data-testid="link-nav-propose"><Sparkles size={16} />Propose</Link>
        <Link href="/activity" className={activity ? 'active' : ''} aria-current={activity ? 'page' : undefined} data-testid="link-nav-activity"><Activity size={16} />Activity</Link>
        <small>RESOURCES</small>
        <a href="https://pump.fun/docs/custom-pairs" target="_blank" rel="noreferrer"><Info size={16} />Documentation</a>
      </nav>
      <div className="lp-sidebar-note"><ShieldCheck size={17} /><span><strong>Browser-only proposal</strong><small>No blockchain transactions</small></span></div>
    </aside>
    <div className="lp-workspace">
      <header className="lp-topbar">
        <span>{section}<i>/</i><strong>{page}</strong></span>
        <div><small className="lp-mode">● DEMO MODE</small><button type="button" onClick={onConnect} aria-label={wallet ? 'Manage demo wallet' : 'Connect demo wallet'} data-testid="button-connect-wallet"><Wallet size={14} />{wallet ? 'Demo wallet' : 'Connect'}</button></div>
      </header>
      {children}
    </div>
  </>;
}
