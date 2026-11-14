import { memo } from 'react';
import { ft, mi } from '../lib/format';
import { gainM, level, roundTripM } from '../lib/plan';
import type { Trail } from '../lib/trails';
import { DriveIcon, SavedIcon, CheckIcon } from './NavIcons';
import { RouteSketch } from './RouteSketch';

interface Props {
  trail: Trail;
  saved: boolean;
  offline?: boolean;
  /** Slot for drive time: it is not built yet, so it says so. */
  driveLater?: boolean;
  onOpen: (t: Trail) => void;
  onToggleSave: (t: Trail) => void;
}

/** Distance is always the whole outing, so the label is always "round trip". */
export const distanceLabel = (t: Trail) => `${mi(roundTripM(t))} mi round trip`;
export const gainLabel = (t: Trail) => { const g = gainM(t); return g == null ? null : `About ${ft(g)} ft gain`; };

export const HomeCard = memo(function HomeCard({ trail, saved, offline, driveLater = true, onOpen, onToggleSave }: Props) {
  const gain = gainLabel(trail);
  const lv = level(trail);
  return (
    <article className="hm-card">
      <button className="hm-card-main" onClick={() => onOpen(trail)}>
        <span className="hm-thumb"><RouteSketch coords={trail.coords} /></span>
        <span className="hm-name">{trail.name}</span>
        <span className="hm-m1">{distanceLabel(trail)}</span>
        <span className="hm-m2">{gain}{gain && lv ? ' · ' : ''}{lv}</span>
      </button>
      <div className="hm-ft">
        {offline
          ? <span className="hm-badge"><CheckIcon size={14} /> Offline</span>
          : driveLater ? <span className="hm-drive" title="Drive time is not built yet"><DriveIcon size={14} /> Drive time: later</span> : <span />}
        <button className="hm-save" aria-label={saved ? `Remove ${trail.name} from saved` : `Save ${trail.name}`} aria-pressed={saved} onClick={() => onToggleSave(trail)}>
          <SavedIcon filled={saved} />
        </button>
      </div>
    </article>
  );
});
