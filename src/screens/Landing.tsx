import { BOBO_MARK_URL } from '../lib/boboMark';
import { HikeStats, statsLine } from '../lib/shareLinks';
import './landing.css';

// TODO: fill these in once the store listings exist. While empty, the store buttons stay hidden.
export const APP_STORE_URL = '';
export const PLAY_URL = '';

export interface LandingProps {
  /** From the trail data. Falls back to a generic line when the trail is not known. */
  trail?: { name: string } | null;
  stats: HikeStats;
  features?: { voice?: boolean };
  platform?: 'ios' | 'android' | 'other';
  /** Opens the web app and starts onboarding. */
  onGetApp: () => void;
  /** Opens the trail page in the app. Hidden when absent or when the trail is not known. */
  onSeeTrail?: () => void;
  storeUrls?: { ios?: string; android?: string };
}

export function Landing({ trail, stats, features, platform = 'other', onGetApp, onSeeTrail, storeUrls = { ios: APP_STORE_URL, android: PLAY_URL } }: LandingProps) {
  const name = trail?.name?.trim() || 'a Ridgeline trail';
  const line = statsLine(stats);
  const store = platform === 'ios' ? { href: storeUrls.ios, label: 'Get it on the App Store' } : platform === 'android' ? { href: storeUrls.android, label: 'Get it on Google Play' } : null;
  return (
    <main className="land" aria-labelledby="land-h">
      <div className="land-body">
        <div className="land-brand"><img src={BOBO_MARK_URL} alt="" width="40" height="40" />Ridgeline</div>
        <h1 id="land-h">Your friend just hiked {name}.</h1>
        {line && <p className="land-stats">{line}. Your turn?</p>}
      </div>
      <div className="land-hero"><img src={BOBO_MARK_URL} alt="Bobo the dog, Ridgeline's mascot, in a red bandana" /></div>
      <ul className="land-list">
        <li><b aria-hidden="true">✓</b><span>Free. Maps work with no signal.</span></li>
        <li><b aria-hidden="true">✓</b><span>{features?.voice ? 'Turn-by-turn at trail forks' : 'Clear trail maps and your progress'}</span></li>
        <li><b aria-hidden="true">✓</b><span>Earn badges for the hikes you finish.</span></li>
      </ul>
      <div className="land-actions">
        <button className="land-cta" onClick={onGetApp}>Get Ridgeline, free</button>
        {store?.href && <a className="land-store" href={store.href}>{store.label}</a>}
        {onSeeTrail && trail && <button className="land-sec" onClick={onSeeTrail}>See this trail first</button>}
        <p className="land-fine">Directions are a guide; check conditions; not for emergency use.</p>
        <p className="land-fine">A B&amp;B Project Factory app</p>
      </div>
    </main>
  );
}
