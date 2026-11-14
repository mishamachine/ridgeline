import { memo } from 'react';
import { M_TO_FT } from '../lib/geo';
import { ft, km, metres10, mi } from '../lib/format';
import { METRIC_COPY } from '../lib/metricCopy';
import { useSettings, type Units } from '../lib/settings';
import { gainM, level, roundTripM } from '../lib/plan';
import { DOGS_UNKNOWN, DOGS_YES, dogsStatus } from '../lib/parks';
import type { Trail } from '../lib/trails';
import { DriveIcon, SavedIcon, CheckIcon } from './NavIcons';
import { DRIVE_TIME_ENABLED } from '../lib/flags';
import { RouteSketch } from './RouteSketch';

interface Props {
  trail: Trail;
  saved: boolean;
  offline?: boolean;
  /** Slot for drive time. Hidden until DRIVE_TIME_ENABLED is true. */
  driveLater?: boolean;
  onOpen: (t: Trail) => void;
  onToggleSave: (t: Trail) => void;
}

/** Distance is always the whole outing, so the label is always "round trip". */
export const distanceLabel = (t: Trail, u: Units = 'imperial') => (u === 'metric' ? METRIC_COPY.roundTrip(km(roundTripM(t))) : `${mi(roundTripM(t))} mi round trip`);
/** Gain is rounded to the nearest 50 ft: no false precision. */
export const gainLabel = (t: Trail, u: Units = 'imperial') => {
  const g = gainM(t);
  if (g == null) return null;
  return u === 'metric' ? METRIC_COPY.gainAbout(metres10(g)) : `About ${ft(Math.round(g * M_TO_FT / 50) * 50 / M_TO_FT)} ft gain`;
};

export const HomeCard = memo(function HomeCard({ trail, saved, offline, driveLater = DRIVE_TIME_ENABLED, onOpen, onToggleSave }: Props) {
  const [{ units }] = useSettings();
  const gain = gainLabel(trail, units);
  const lv = level(trail);
  const dogs = dogsStatus(trail);
  return (
    <article className="hm-card">
      <button className="hm-card-main" onClick={() => onOpen(trail)}>
        <span className="hm-thumb"><RouteSketch coords={trail.coords} /></span>
        <span className="hm-name">{trail.name}</span>
        <span className="hm-m1">{distanceLabel(trail, units)}</span>
        <span className="hm-m2">{gain}{gain && lv ? ' · ' : ''}{lv}</span>
        {dogs !== 'none' && <span className={`hm-tg${dogs === 'yes' ? '' : ' hm-dim'}`}>{dogs === 'yes' ? DOGS_YES : DOGS_UNKNOWN}</span>}
      </button>
      <div className="hm-ft">
        {offline
          ? <span className="hm-badge"><CheckIcon size={14} /> Offline</span>
          : driveLater ? <span className="hm-drive"><DriveIcon size={14} /> Drive time: later</span> : <span />}
        <button className="hm-save" aria-label={saved ? `Remove ${trail.name} from saved` : `Save ${trail.name}`} aria-pressed={saved} onClick={() => onToggleSave(trail)}>
          <SavedIcon filled={saved} />
        </button>
      </div>
    </article>
  );
});
