import { ft, mi } from '../lib/format';

interface Props { elevation: number[]; lengthM: number; progress?: number }

/** Line profile in the Swiss style: one black line, red dot at the high point. */
export function ElevationChart({ elevation, lengthM, progress }: Props) {
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
        aria-label={`Elevation from ${ft(elevation[0])} to ${ft(elevation.at(-1)!)} feet, peaking at ${ft(max)} feet`}>
        <path d={`M0 ${H - 1} L${W} ${H - 1}`} stroke="#D9D9D4" strokeWidth="1" />
        {progress != null && <rect x="0" y="0" width={progress * W} height={H} fill="#111111" opacity="0.06" />}
        <path d={d} fill="none" stroke="#111111" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={x(peak)} cy={y(max)} r="4" fill="#D52B26" />
      </svg>
      <figcaption className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>0 mi</span><span>High point {ft(max)} ft</span><span>{mi(lengthM)} mi</span>
      </figcaption>
    </figure>
  );
}
