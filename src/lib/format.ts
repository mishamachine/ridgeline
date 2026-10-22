import { M_TO_FT, M_TO_MI } from './geo';

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
