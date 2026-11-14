import { M_TO_FT, M_TO_MI } from './geo';
import type { Units } from './settings';

export const mi = (m: number) => (m * M_TO_MI < 10 ? (m * M_TO_MI).toFixed(1) : Math.round(m * M_TO_MI).toString());
export const ft = (m: number) => Math.round(m * M_TO_FT).toLocaleString('en-US');

export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 60 ? `${h + 1}:00` : `${h}:${String(m).padStart(2, '0')}`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}

export const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`);

/** "2h 54" for planning cards; "45 min" under an hour. */
export function hrs(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${Math.max(1, total)} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}`;
}

/** Kilometres for a whole-outing distance: one decimal under 10 km, whole numbers above. */
export const km = (m: number) => (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000).toString());
/** Climb in metres, rounded to the nearest 10 m (the metric counterpart of the 50 ft rounding on Home cards). */
export const metres10 = (m: number) => (Math.round(m / 10) * 10).toLocaleString('en-US');
export const metres = (m: number) => Math.round(m).toLocaleString('en-US');
export type { Units };
