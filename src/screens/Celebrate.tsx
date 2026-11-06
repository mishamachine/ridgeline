import { useEffect, useRef, useState, type RefObject } from 'react';
import { BOBO_MARK_URL } from '../lib/boboMark';
import { BackIcon } from '../components/Icons';
import { HikeSummary, highlightChips, hype, isFinished, shareText } from '../lib/hype';
import { CardFormat, CardOptions, CardTheme, DEFAULT_CARD_OPTIONS, renderCard } from '../lib/shareCard';
import { ShareFiles, shareFiles } from '../lib/shareFiles';
import { formatClimb, formatHoursMinutes, formatMiles } from '../lib/shareText';
import { SITE_HOST, hikeShareUrl } from '../lib/shareLinks';
import './celebrate.css';

export interface Badge { name: string; sub: string }
export interface CelebrateProps {
  summary: HikeSummary;
  newBadges?: Badge[];
  badgeCount?: number;
  onDone: () => void;
  onShareApp: () => void;
  /** Replaced by the native share wrapper later. */
  share?: ShareFiles;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v13" /><path d="M7 8l5-5 5 5" /><path d="M5 14v6h14v-6" /></svg>
);

function Confetti() {
  // Static, tiny shapes in the brand colours. No motion.
  return (
    <svg className="cel-confetti" viewBox="0 0 390 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <rect x="40" y="40" width="10" height="22" rx="3" fill="#D52B26" transform="rotate(-20 45 51)" />
      <rect x="320" y="56" width="10" height="22" rx="3" fill="#FFF0D6" transform="rotate(25 325 67)" />
      <circle cx="96" cy="120" r="6" fill="#E2A15A" />
      <circle cx="300" cy="140" r="5" fill="#D52B26" />
      <rect x="250" y="24" width="8" height="18" rx="3" fill="#E2A15A" transform="rotate(40 254 33)" />
      <rect x="140" y="30" width="8" height="18" rx="3" fill="#FFF0D6" transform="rotate(-35 144 39)" />
      <circle cx="352" cy="210" r="4" fill="#FFF0D6" />
      <circle cx="30" cy="200" r="5" fill="#D52B26" />
    </svg>
  );
}

export function Celebrate({ summary, newBadges, badgeCount, onDone, onShareApp, share = shareFiles }: CelebrateProps) {
  const [step, setStep] = useState<'hype' | 'share'>('hype');
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
  }, [step]);
  const h = hype(summary);
  const chips = highlightChips(summary.trail, summary.highlightsHit);
  const badge = newBadges?.[0];
  const extraBadges = (newBadges?.length ?? 0) - 1;

  if (step === 'share') {
    return <ShareStep summary={summary} badge={badge} badgeCount={badgeCount} share={share} heading={heading} onBack={() => setStep('hype')} />;
  }
  return (
    <main className="cel" aria-labelledby="cel-h">
      <Confetti />
      <div className="cel-top">
        <img className="cel-bobo" src={BOBO_MARK_URL} alt="" width="110" height="110" />
        <div className="cel-eyebrow">{h.eyebrow}</div>
        <h1 id="cel-h" ref={heading} tabIndex={-1}>{h.headline}</h1>
        <p className="cel-sub">{h.sub}</p>
      </div>
      <div className="cel-stats">
        <div className="cel-stat"><b>{formatMiles(summary.distanceM)}</b><span>miles</span></div>
        <div className="cel-stat"><b>{formatClimb(summary.climbFt)}</b><span>ft climbed</span></div>
        <div className="cel-stat"><b>{formatHoursMinutes(summary.movingMs)}</b><span>hours</span></div>
      </div>
      {(badge || chips.length > 0) && (
        <div className="cel-extra">
          {badge && (
            <div className="cel-badge">
              <i><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 20l8-8 3 3 7-9" /></svg></i>
              <div>
                <b>New badge: {badge.name}</b>
                <span>{(badge.sub || (badgeCount ? `Your ${ordinal(badgeCount)} badge.` : '')) + (extraBadges > 0 ? ` (+${extraBadges} more)` : '')}</span>
              </div>
            </div>
          )}
          {chips.length > 0 && <ul className="cel-chips" aria-label="Highlights you hit">{chips.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
      )}
      <div className="cel-actions">
        <button className="cel-btn" onClick={() => setStep('share')}><ShareIcon />Share my hike</button>
        <button className="cel-ghost" onClick={onDone}>Done</button>
        <button className="cel-link" onClick={onShareApp}>Know someone who'd love this? Share Ridgeline</button>
      </div>
    </main>
  );
}

function ShareStep({ summary, badge, badgeCount, share, heading, onBack }: { summary: HikeSummary; badge?: Badge; badgeCount?: number; share: ShareFiles; heading: RefObject<HTMLHeadingElement | null>; onBack: () => void }) {
  const [options, setOptions] = useState<CardOptions>(DEFAULT_CARD_OPTIONS);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; routeShown: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(false);
    renderCard({ summary, newBadge: badge ?? null, badgeCount, options })
      .then(({ blob, layout }) => {
        if (!live) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setPreview({ blob, url: urlRef.current, routeShown: layout.routeShown });
      })
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [summary, badge, badgeCount, options, attempt]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const set = (patch: Partial<CardOptions>) => { setMessage(''); setOptions((o) => ({ ...o, ...patch })); };
  const link = hikeShareUrl({ trailId: summary.trail.id, distanceM: summary.distanceM, climbFt: summary.climbFt, movingMs: summary.movingMs, finished: isFinished(summary.completedFraction) });
  const slug = summary.trail.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hike';

  async function onShare() {
    if (!preview || busy) return;
    setBusy(true);
    const file = new File([preview.blob], `ridgeline-${slug}-${options.format}.png`, { type: 'image/png' });
    const text = `${shareText(summary)} ${link}`;
    const res = await share({ files: [file], title: 'My Ridgeline hike', text, url: link });
    setBusy(false);
    if (res.status === 'fallback') setMessage(res.copied ? 'Image saved and link copied.' : `Image saved. Link: ${SITE_HOST}`);
    else if (res.status === 'shared') setMessage('Shared.');
  }

  const formats: [CardFormat, string][] = [['story', 'Story'], ['square', 'Square']];
  const themes: [CardTheme, string][] = [['dark', 'Dark'], ['light', 'Light']];
  return (
    <main className="cel" aria-labelledby="cel-s">
      <div className="cel-head">
        <button className="cel-back" onClick={onBack} aria-label="Back"><BackIcon />Back</button>
        <h2 id="cel-s" ref={heading} tabIndex={-1}>Share your hike</h2>
      </div>
      <div className="cel-preview">
        {preview ? <img src={preview.url} alt={`Your Ridgeline card for ${summary.trail.name}: ${formatMiles(summary.distanceM)} miles, ${formatClimb(summary.climbFt)} feet climbed`} />
          : <div className="cel-wait">{error ? <>Could not make the card.<button className="cel-retry" onClick={() => setAttempt((n) => n + 1)}>Retry</button></> : 'Making your card…'}</div>}
      </div>
      <div className="cel-seg" role="group" aria-label="Card shape">
        {formats.map(([f, label]) => <button key={f} aria-pressed={options.format === f} onClick={() => set({ format: f })}>{label}</button>)}
      </div>
      <div className="cel-seg" role="group" aria-label="Card style">
        {themes.map(([t, label]) => <button key={t} aria-pressed={options.theme === t} onClick={() => set({ theme: t })}>{label}</button>)}
      </div>
      <div className="cel-opts">
        <label className="cel-opt">
          <span><b>Show my route</b><small>{options.showRoute ? 'Your route is drawn as a line, with no map details.' : 'Off: the card has no map.'}</small></span>
          <input type="checkbox" role="switch" checked={options.showRoute} onChange={(e) => set({ showRoute: e.target.checked })} />
        </label>
        {options.showRoute && (
          <label className="cel-opt">
            <span><b>Hide start point</b><small>Trims the first and last 200 m of your route.</small></span>
            <input type="checkbox" role="switch" checked={options.hideStart} onChange={(e) => set({ hideStart: e.target.checked })} />
          </label>
        )}
      </div>
      <p className="cel-note" role="status" aria-live="polite">
        {message || (options.showRoute && preview && !preview.routeShown ? 'Too short to show your route without giving away the start, so the card has no map.' : '')}
      </p>
      <div className="cel-actions">
        <button className="cel-btn" onClick={onShare} disabled={!preview || busy}><ShareIcon />Share</button>
      </div>
    </main>
  );
}

