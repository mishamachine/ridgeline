import { useMemo } from 'react';
import type { Activity } from '../lib/store';
import { Badge, BadgeId, BadgeTrail, computeBadges, nextBadge } from '../lib/badges';
import { useHikes } from '../lib/useHikes';
import { BackIcon } from '../components/Icons';
import { Placeholder } from '../components/Bobo';
import boboUrl from '../assets/trail-bobo.svg';
import './profile.css';

const PATHS: Record<BadgeId, string> = {
  'first-trail': 'M3 19l6-9 4 6 3-4 5 7z',
  'ledge-sitter': 'M3 20l8-8 3 3 7-9',
  'trail-buddy': 'M8 17c0-3 2-5 4-5s4 2 4 5c0 2-8 2-8 0zM7 9h.01M12 6.5h.01M17 9h.01',
  'early-bird': 'M12 4v3M4 12h3M17 12h3M6 6l2 2M18 6l-2 2M7 18h10',
  'lake-hopper': 'M3 10c3-2 6 2 9 0s6 2 9 0M3 15c3-2 6 2 9 0s6 2 9 0',
  'falls-chaser': 'M4 4h16M8 4v10M12 4v13M16 4v10',
  '10k-club': 'M3 20l8-8 3 3 7-9M15 6h6v6',
  'rain-or-shine': 'M6 14a4 4 0 110-8 6 6 0 0111 1 3.5 3.5 0 010 7zM8 18v2M12 18v2M16 18v2',
  'i90-trio': 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
};

const HOW: Record<BadgeId, string> = {
  'first-trail': 'Record one hike.',
  'ledge-sitter': 'Finish a classic hike, like Rattlesnake Ledge or Mount Si.',
  'trail-buddy': 'Mark a hike as done with your dog.',
  'early-bird': 'Start a hike before 7am.',
  'lake-hopper': 'Hike to 3 lakes.',
  'falls-chaser': 'Hike to 3 waterfalls.',
  '10k-club': 'Climb 10,000 ft in total across your hikes.',
  'rain-or-shine': 'Mark a hike as done in the rain.',
  'i90-trio': 'Finish 3 hikes off the I-90 corridor.',
};

const when = (t?: number) => (t ? `Earned ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '');

export function BadgeMedal({ id, size = 36 }: { id: BadgeId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[id]} />
    </svg>
  );
}

export function Badges({ onBack, preset }: { onBack?: () => void; preset?: { activities: Activity[]; trails: BadgeTrail[] } }) {
  const { activities, trails, loaded } = useHikes(preset);
  const badges = useMemo(() => computeBadges(activities, trails), [activities, trails]);
  const next = nextBadge(badges);
  const done = badges.filter((b) => b.earned).length;
  const pct = next ? Math.round((next.progress.have / next.progress.need) * 100) : 100;

  if (!loaded) {
    return (
      <div className="screen pf">
        <div className="bd-top">{onBack && <button className="round" onClick={onBack} aria-label="Back to Profile"><BackIcon /></button>}<h1>Badges</h1></div>
        <Placeholder title="Loading your badges…" />
      </div>
    );
  }

  return (
    <div className="screen pf">
      <div className="bd-top">
        {onBack && <button className="round" onClick={onBack} aria-label="Back to Profile"><BackIcon /></button>}
        <h1>Badges · {done} of {badges.length}</h1>
      </div>

      {next ? (
        <section className="bd-next" aria-label="Next badge">
          <img src={boboUrl} alt="" />
          <div style={{ flexGrow: 1 }}>
            <h2>Next: {next.name}</h2>
            <p>{HOW[next.id]} {next.sub !== HOW[next.id] ? next.sub + '.' : ''}</p>
            <div className="bd-bar" role="progressbar" aria-label={`${next.name} progress`} aria-valuemin={0} aria-valuemax={next.progress.need} aria-valuenow={next.progress.have}><i style={{ width: `${pct}%` }} /></div>
          </div>
        </section>
      ) : (
        <section className="bd-next" aria-label="All badges earned">
          <img src={boboUrl} alt="" />
          <div><h2>All {badges.length} earned</h2><p>Nice. More badges are coming.</p></div>
        </section>
      )}

      <ul className="bd-grid">
        {badges.map((b: Badge) => (
          <li key={b.id} className={`bd-item ${b.earned ? 'on' : ''}`}>
            <div className="bd-medal"><BadgeMedal id={b.id} /></div>
            <b>{b.name}</b>
            <span className="sr">{b.earned ? 'Earned.' : `Not earned yet. ${HOW[b.id]}`}</span>
            <small>{b.earned ? when(b.earnedAt) || b.sub : b.sub}</small>
          </li>
        ))}
      </ul>
      <p className="bd-foot">Badges are earned from hikes you record. Kept on your phone; no account.</p>
    </div>
  );
}
