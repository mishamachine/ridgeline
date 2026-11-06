import { M_TO_FT, M_TO_MI } from '../geo';
import type { Units } from './prefs';

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Short form for screens: "500 ft", "1.2 mi", "150 m", "1.9 km". */
export function shortDistance(m: number, units: Units): string {
  if (units === 'metric') return m < 1000 ? `${Math.max(0, round(m, m < 100 ? 5 : 10))} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  const ft = m * M_TO_FT;
  if (ft < 1000) return `${Math.max(0, round(ft, ft < 100 ? 10 : 50))} ft`;
  const mi = m * M_TO_MI;
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

/** Spoken form for the off-route line: "120 feet", "40 metres". */
export function spokenDistance(m: number, units: Units): string {
  if (units === 'metric') { const v = Math.max(5, round(m, 5)); return `${v} ${v === 1 ? 'metre' : 'metres'}`; }
  const v = Math.max(10, round(m * M_TO_FT, 10));
  return `${v} feet`;
}

export const climbText = (m: number, units: Units) => (units === 'metric' ? `${Math.round(m)} m` : `${Math.round(m * M_TO_FT).toLocaleString('en-US')} ft`);
