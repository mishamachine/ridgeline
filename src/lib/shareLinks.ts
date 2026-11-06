import { SITE_URL } from './site';

/** Trail ids look like "osm-r123" or "osm-w456-0". Anything else is refused. */
const TRAIL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_MILES = 200;
const MAX_CLIMB_FT = 30000;
const MAX_MINUTES = 48 * 60;

export interface HikeStats {
  miles?: number;
  climbFt?: number;
  /** "h:mm" */
  time?: string;
}

export const isTrailId = (id: unknown): id is string => typeof id === 'string' && TRAIL_ID.test(id);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function formatTime(minutes: number): string {
  const total = Math.round(clamp(minutes, 0, MAX_MINUTES));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Link for one finished hike: trail id and three numbers. No name, no place, nothing about the person.
 * Returns the plain site address when the trail id is not usable.
 */
export function hikeShareUrl(h: { trailId: string; distanceM: number; climbFt: number; movingMs: number }): string {
  if (!isTrailId(h.trailId)) return SITE_URL;
  const miles = clamp(Number.isFinite(h.distanceM) ? h.distanceM * 0.000621371 : 0, 0, MAX_MILES).toFixed(1);
  const climb = Math.round(clamp(Number.isFinite(h.climbFt) ? h.climbFt : 0, 0, MAX_CLIMB_FT));
  const time = formatTime(Number.isFinite(h.movingMs) ? h.movingMs / 60000 : 0);
  return `${SITE_URL}/h/${encodeURIComponent(h.trailId)}?d=${miles}&c=${climb}&t=${time}`;
}

/** Plain marker so a counter could count shares. It carries no id and stores nothing. */
export const appShareUrl = () => `${SITE_URL}/?ref=share`;

/** Short address printed on the card, and the trail-only link its QR code opens. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');
export const trailUrl = (trailId: string) => (isTrailId(trailId) ? `${SITE_URL}/h/${encodeURIComponent(trailId)}` : SITE_URL);

/** Reads the trail id from a path like "/h/osm-r123" (a trailing slash is fine). */
export function parseHikePath(pathname: string): string | null {
  const m = /^\/h\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let id: string;
  try { id = decodeURIComponent(m[1]); } catch { return null; }
  return isTrailId(id) ? id : null;
}

/** Reads d, c and t from a query string. Junk is dropped, out-of-range numbers are clamped. */
export function parseHikeParams(search: string | URLSearchParams): HikeStats {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: HikeStats = {};
  const d = q.get('d');
  if (d && /^\d{1,4}(\.\d{1,3})?$/.test(d)) out.miles = Math.round(clamp(parseFloat(d), 0, MAX_MILES) * 10) / 10;
  const c = q.get('c');
  if (c && /^\d{1,6}$/.test(c)) out.climbFt = clamp(parseInt(c, 10), 0, MAX_CLIMB_FT);
  const t = q.get('t');
  const tm = t ? /^(\d{1,3}):([0-5]\d)$/.exec(t) : null;
  if (tm) out.time = formatTime(parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10));
  return out;
}

/** One line for the landing page, e.g. "3.8 mi · 1,540 ft climbed · 2:41". Empty when nothing usable. */
export function statsLine(s: HikeStats): string {
  const parts: string[] = [];
  if (s.miles != null) parts.push(`${s.miles.toFixed(1)} mi`);
  if (s.climbFt != null) parts.push(`${s.climbFt.toLocaleString('en-US')} ft climbed`);
  if (s.time) parts.push(s.time);
  return parts.join(' · ');
}
