// Share links and the share sheet. Links point at the public site, not at wherever the app is running.
import { linkBase, linkOrigin } from './origin';
import { routePath, type Route } from './route';
import type { Trail } from './trails';
import { count } from './counter';
import { toast } from './toast';

const startOf = (t: Pick<Trail, 'coords'>): [number, number] => [t.coords[0][0], t.coords[0][1]];

export const trailUrl = (t: Pick<Trail, 'id' | 'coords'>) => linkOrigin() + routePath({ kind: 'trail', id: t.id, ll: startOf(t) }, linkBase());

export const shortlistUrl = (ts: Pick<Trail, 'id' | 'coords'>[]) =>
  linkOrigin() + routePath({ kind: 'shared', ids: ts.map((t) => t.id), lls: ts.map(startOf) }, linkBase());

export const appUrl = () => linkOrigin() + linkBase();

export interface SharePayload { title: string; text: string; url: string }

/** Native share sheet when there is one, else copy the link. Returns what happened. */
export async function shareOrCopy(p: SharePayload): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share(p); count('share'); return 'shared'; } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(p.url);
    count('share');
    toast('Link copied');
    return 'copied';
  } catch {
    toast('Couldn’t copy. Long-press the address bar to share.');
    return 'failed';
  }
}

export const shareTrail = (t: Trail) =>
  shareOrCopy({ title: t.name, text: `${t.name} on Ridgeline`, url: trailUrl(t) });

export const shareApp = () =>
  shareOrCopy({ title: 'Ridgeline', text: 'Ridgeline: simple trail maps that work offline.', url: appUrl() });

export const shareShortlist = (ts: Trail[]) =>
  shareOrCopy({ title: 'My Ridgeline shortlist', text: `${ts.length} trail${ts.length === 1 ? '' : 's'} on my Ridgeline shortlist: ${ts.map((t) => t.name).join(', ')}`, url: shortlistUrl(ts) });

export type { Route };
