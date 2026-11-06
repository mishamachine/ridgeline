import { memo } from 'react';
import { ft, hrs, mi } from '../lib/format';
import { level, roundTripClimbM, roundTripM, tripMinutes } from '../lib/plan';
import type { Trail } from '../lib/trails';
import { HighlightChips } from './Chips';
import { SavedIcon } from './NavIcons';
import { RouteSketch } from './RouteSketch';

interface Props {
  trail: Trail;
  saved: boolean;
  offline?: boolean;
  awayMi?: number | null;
  onOpen: (t: Trail) => void;
  onToggleSave?: (t: Trail) => void;
  /** Extra row inside the card, e.g. download status on Saved. */
  extra?: React.ReactNode;
}

export const awayLabel = (m: number) => (m < 1 ? 'Under 1 mi away' : `${Math.round(m)} mi away`);

export function statsLine(t: Trail): string {
  const climb = roundTripClimbM(t);
  const parts = [`${mi(roundTripM(t))} mi${t.loop ? ' loop' : ''}`];
  if (climb != null) parts.push(`${ft(climb)} ft climb`, `~${hrs(tripMinutes(t))}`);
  return parts.join(' · ');
}

export const TrailCard = memo(function TrailCard({ trail, saved, offline, awayMi, onOpen, onToggleSave, extra }: Props) {
  const lv = level(trail);
  return (
    <div className="card">
      <button className="card-main" onClick={() => onOpen(trail)}>
        <span className="card-sketch"><RouteSketch coords={trail.coords} /></span>
        <span className="card-body">
          <span className="card-name">{trail.name}</span>
          <span className="card-stats">{statsLine(trail)}</span>
          <HighlightChips trail={trail} />
          <span className="card-foot">
            {lv && <span className={`level level-${lv.toLowerCase()}`}>{lv}</span>}
            {offline && <span className="pill">Ready offline</span>}
            {awayMi != null && <span className="away">{awayLabel(awayMi)}</span>}
          </span>
        </span>
      </button>
      {extra && <div className="card-extra">{extra}</div>}
      {onToggleSave && (
        <button className="card-save" aria-label={saved ? `Remove ${trail.name} from Saved` : `Save ${trail.name}`} aria-pressed={saved} onClick={() => onToggleSave(trail)}>
          <SavedIcon filled={saved} />
        </button>
      )}
    </div>
  );
});
