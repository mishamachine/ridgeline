import { ft, km, metres, mi } from '../lib/format';
import { METRIC_COPY } from '../lib/metricCopy';
import { useSettings, type Units } from '../lib/settings';

interface Props { elevation: number[]; lengthM: number; progress?: number }

/** Text around the chart (elevations are metres in the data). */
export function elevationText(elevation: number[], lengthM: number, units: Units = 'imperial') {
  const max = Math.max(...elevation), a = elevation[0], b = elevation.at(-1)!;
  return units === 'metric'
    ? { aria: METRIC_COPY.elevAria(metres(a), metres(b), metres(max)), start: METRIC_COPY.elevStart, high: METRIC_COPY.elevHigh(metres(max)), end: METRIC_COPY.elevEnd(km(lengthM)) }
    : { aria: `Elevation from ${ft(a)} to ${ft(b)} feet, peaking at ${ft(max)} feet`, start: '0 mi', high: `High point ${ft(max)} ft`, end: `${mi(lengthM)} mi` };
}

/** Line profile in the Swiss style: one black line, red dot at the high point. */
export function ElevationChart({ elevation, lengthM, progress }: Props) {
  const [{ units }] = useSettings();
  const txt = elevationText(elevation, lengthM, units);
  const min = Math.min(...elevation), max = Math.max(...elevation);
  const span = Math.max(max - min, 20);
  const W = 340, H = 100;
  const x = (i: number) => (i / (elevation.length - 1)) * W;
  const y = (e: number) => H - 8 - ((e - min) / span) * (H - 16);
  const d = elevation.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(e).toFixed(1)}`).join(' ');
  const peak = elevation.indexOf(max);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="96" preserveAspectRatio="none" role="img"
        aria-label={txt.aria}>
        <path d={`M0 ${H - 1} L${W} ${H - 1}`} stroke="#D9D9D4" strokeWidth="1" />
        {progress != null && <rect x="0" y="0" width={progress * W} height={H} fill="#111111" opacity="0.06" />}
        <path d={d} fill="none" stroke="#111111" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={x(peak)} cy={y(max)} r="4" fill="#D52B26" />
      </svg>
      <figcaption className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{txt.start}</span><span>{txt.high}</span><span>{txt.end}</span>
      </figcaption>
    </figure>
  );
}
