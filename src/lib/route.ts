// Real URLs without a router: /, /saved, /hike, /profile, /profile/badges, /trail/<id>, /s?ids=a,b,c, and (celebrate flag) /h/<id>?d=&c=&t=
import { features } from './features';
import { accountsLive } from './accounts/flags';
import { HikeStats, isTrailId, parseHikeParams } from './shareLinks';

export type Tab = 'find' | 'saved' | 'hike' | 'profile';
export type Route =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'trail'; id: string; ll?: [number, number] }
  | { kind: 'badges' }
  | { kind: 'account-delete' }
  | { kind: 'sign-in'; returnTo?: 'account-delete' }
  | { kind: 'hike'; id: string; stats: HikeStats }
  | { kind: 'shared'; ids: string[]; lls: ([number, number] | null)[] };

export const MAX_SHARED = 20;
const TABS: Tab[] = ['saved', 'hike', 'profile'];
const ID_OK = /^[A-Za-z0-9_.-]{1,64}$/;

export function parseLL(s: string | null | undefined, sep = ','): [number, number] | null {
  if (!s) return null;
  const [a, b] = s.split(sep).map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90 ? [a, b] : null;
}

/** base is the app's base path ("/" or "/ridgeline/"). */
export function parseRoute(pathname: string, search: string, base = '/', celebrate: boolean = features.celebrate, accounts: boolean = features.accounts, live: boolean = accountsLive()): Route {
  let p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  p = p.replace(/^\/+|\/+$/g, '');
  const q = new URLSearchParams(search);
  if (p === 'profile/badges' && features.badges) return { kind: 'badges' };
  if (accounts && p === 'account/delete') return { kind: 'account-delete' };
  // The one sign-in screen. While sign-in is paused it can only be reached from the delete flow (to confirm who is deleting).
  if (accounts && p === 'signin') {
    const forDelete = q.get('return') === 'delete';
    if (live || forDelete) return forDelete ? { kind: 'sign-in', returnTo: 'account-delete' } : { kind: 'sign-in' };
  }
  if (celebrate && p.startsWith('h/')) {
    let id = '';
    try { id = decodeURIComponent(p.slice(2)); } catch { /* bad escape: fall through */ }
    if (isTrailId(id)) return { kind: 'hike', id, stats: parseHikeParams(q) };
  }
  if (p.startsWith('trail/')) {
    let id = '';
    try { id = decodeURIComponent(p.slice(6)); } catch { /* bad escape: fall through */ }
    if (ID_OK.test(id)) return { kind: 'trail', id, ll: parseLL(q.get('ll')) ?? undefined };
  }
  if (p === 's') {
    const ids = (q.get('ids') ?? '').split(',').filter((i) => ID_OK.test(i)).slice(0, MAX_SHARED);
    const lls = (q.get('ll') ?? '').split('~').map((s) => parseLL(s, '_'));
    if (ids.length) return { kind: 'shared', ids, lls: ids.map((_, i) => lls[i] ?? null) };
  }
  return { kind: 'tab', tab: (TABS as string[]).includes(p) ? (p as Tab) : 'find' };
}

const r3 = (n: number) => String(Math.round(n * 1000) / 1000);

export function routePath(r: Route, base = '/'): string {
  if (r.kind === 'tab') return base + (r.tab === 'find' ? '' : r.tab);
  if (r.kind === 'badges') return `${base}profile/badges`;
  if (r.kind === 'account-delete') return `${base}account/delete/`;
  if (r.kind === 'sign-in') return `${base}signin${r.returnTo ? '?return=delete' : ''}`;
  if (r.kind === 'hike') return `${base}h/${encodeURIComponent(r.id)}`;
  if (r.kind === 'trail') return `${base}trail/${encodeURIComponent(r.id)}${r.ll ? `?ll=${r3(r.ll[0])},${r3(r.ll[1])}` : ''}`;
  const ll = r.lls.map((l) => (l ? `${r3(l[0])}_${r3(l[1])}` : '')).join('~');
  return `${base}s?ids=${r.ids.join(',')}${ll.replace(/~/g, '') ? `&ll=${ll}` : ''}`;
}
