import { useMemo } from 'react';
import type { LngLat } from '../lib/geo';
import { SKETCH_SIZE, fitRoute } from '../lib/sketch';

const S = SKETCH_SIZE;

/** The route's shape on map-ground grey: a card thumbnail with no tiles to load. */
export function RouteSketch({ coords }: { coords: LngLat[] }) {
  const { d, start } = useMemo(() => {
    const pts = fitRoute(coords);
    return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), start: pts[0] ?? [S / 2, S / 2] };
  }, [coords]);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="sketch" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <rect x="-2000" y="-2000" width="4000" height="4000" fill="#E9ECE4" />
      <path d={d} fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#D52B26" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={start[0]} cy={start[1]} r="4" fill="#111111" stroke="#FFFFFF" strokeWidth="2" />
    </svg>
  );
}
