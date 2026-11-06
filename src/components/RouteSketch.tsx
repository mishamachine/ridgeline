import { useMemo } from 'react';
import type { LngLat } from '../lib/geo';

const W = 96, H = 120, PAD = 14;

/** The route's shape on map-ground grey: a card thumbnail with no tiles to load. */
export function RouteSketch({ coords }: { coords: LngLat[] }) {
  const { d, start } = useMemo(() => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    const k = Math.cos(((s + n) / 2) * Math.PI / 180);
    const sx = Math.max((e - w) * k, 1e-6), sy = Math.max(n - s, 1e-6);
    const scale = Math.min((W - 2 * PAD) / sx, (H - 2 * PAD) / sy);
    const ox = (W - sx * scale) / 2, oy = (H - sy * scale) / 2;
    const step = Math.max(1, Math.floor(coords.length / 60));
    const pts = coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
      .map(([x, y]) => [ox + (x - w) * k * scale, H - oy - (y - s) * scale]);
    return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), start: pts[0] };
  }, [coords]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sketch" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width={W} height={H} fill="#E9ECE4" />
      <path d={d} fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#D52B26" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={start[0]} cy={start[1]} r="4" fill="#111111" stroke="#FFFFFF" strokeWidth="2" />
    </svg>
  );
}
