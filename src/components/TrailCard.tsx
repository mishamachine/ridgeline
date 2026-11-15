import { memo } from 'react';
import { ft, hrs, km, metres, mi } from '../lib/format';
import { METRIC_COPY } from '../lib/metricCopy';
import { useSettings, type Units } from '../lib/settings';
import { gainM, level, roundTripM, tripMinutes } from '../lib/plan';
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

/** m: miles away (the caller's unit); for metric it is converted here. */
export const awayLabel = (m: number, u: Units = 'imperial') => {
  if (u === 'metric') { const k = Math.round(m * 1.609344); return k < 1 ? METRIC_COPY.awayUnder : METRIC_COPY.away(k); }
  return m < 1 ? 'Under 1 mi away' : `${Math.round(m)} mi away`;
};

export function statsLine(t: Trail, u: Units = 'imperial'): string {
  const gain = gainM(t);
  const parts = [u === 'metric' ? METRIC_COPY.roundTrip(km(roundTripM(t))) : `${mi(roundTripM(t))} mi round trip`]; // a loop is a round trip too
  if (gain != null) parts.push(u === 'metric' ? METRIC_COPY.gain(metres(gain)) : `${ft(gain)} ft gain`, `~${hrs(tripMinutes(t))}`);
  return parts.join(' · ');
}

export const TrailCard = memo(function TrailCard({ trail, saved, offline, awayMi, onOpen, onToggleSave, extra }: Props) {
  const lv = level(trail);
  const [{ units }] = useSettings();
  return (
    <div className="card">
      <button className="card-main" onClick={() => onOpen(trail)}>
        <span className="card-sketch"><RouteSketch coords={trail.coords} /></span>
        <span className="card-body">
          <span className="card-name">{trail.name}</span>
          <span className="card-stats">{statsLine(trail, units)}</span>
          <HighlightChips trail={trail} />
          <span className="card-foot">
            {lv && <span className={`level level-${lv.toLowerCase()}`}>{lv}</span>}
            {offline && <span className="pill">Ready offline</span>}
            {awayMi != null && <span className="away">{awayLabel(awayMi, units)}</span>}
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
