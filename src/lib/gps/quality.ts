import { M_TO_FT } from '../geo';
import { METRIC_COPY } from '../metricCopy';
import type { Units } from '../settings';

export type Quality = 'good' | 'fair' | 'weak';

export const GOOD_M = 10;
export const FAIR_M = 25;
export const STALE_MS = 10_000;
export const LOCK_M = 30;

/** Chip level from the latest fix accuracy and how long ago it arrived. */
export function qualityOf(accuracyM: number | null, ageMs: number): Quality | null {
  if (accuracyM == null) return null;
  if (ageMs > STALE_MS || accuracyM > FAIR_M) return 'weak';
  return accuracyM <= GOOD_M ? 'good' : 'fair';
}

/** "Warming up" until the first fix at or under 30 m. */
export const isLocked = (accuracyM: number) => accuracyM <= LOCK_M;

export const accuracyFt = (m: number) => Math.round(m * M_TO_FT);

/** Accuracy line on Navigate: feet for imperial, metres for metric. */
export function accuracyLine(a: { m: number; warming: boolean; quality: Quality | null }, units: Units = 'imperial'): string {
  const n = units === 'metric' ? Math.round(a.m) : accuracyFt(a.m);
  const label = a.quality ? QUALITY_LABEL[a.quality] : '';
  if (units === 'metric') return a.warming ? METRIC_COPY.gpsWarming(n) : METRIC_COPY.gps(label, n);
  return a.warming ? `GPS warming up ±${n} ft` : `GPS ${label} ±${n} ft`;
}

export const QUALITY_LABEL: Record<Quality, string> = { good: 'Good', fair: 'Fair', weak: 'Weak' };
