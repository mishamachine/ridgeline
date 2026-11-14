import { isBigClimb, isLong } from '../lib/plan';
import { DOGS_UNKNOWN, DOGS_YES, dogsStatus } from '../lib/parks';
import type { Trail } from '../lib/trails';

const LABEL: Record<string, string> = {
  view: 'Views', lake: 'Lake', falls: 'Waterfall', beach: 'Beach', bikes: 'Bikes share', horses: 'Horses share',
  dogs: DOGS_YES, dogsunknown: DOGS_UNKNOWN, nodogs: 'No dogs', climb: 'Big climb', long: 'Long',
};

export interface Hl { kind: string; maybe: boolean }

/** Highlights from the data (a trailing "?" = maybe), plus Big climb and Long computed from the route. */
export function highlightsOf(t: Pick<Trail, 'highlights' | 'lengthM' | 'loop' | 'ascentM'> & Partial<Pick<Trail, 'coords' | 'trailhead'>>): Hl[] {
  const out: Hl[] = [];
  for (const h of t.highlights ?? []) {
    let kind = h.replace(/\?$/, '');
    let maybe = h.endsWith('?');
    if (kind === 'dogs') { // never a firm "Yes" inside a national park or on a maybe tag
      kind = t.coords && dogsStatus({ highlights: t.highlights, coords: t.coords, trailhead: t.trailhead }) === 'yes' ? 'dogs' : 'dogsunknown';
      maybe = false;
    }
    if (LABEL[kind] && !out.some((o) => o.kind === kind)) out.push({ kind, maybe });
  }
  if (isBigClimb(t) && !out.some((o) => o.kind === 'climb')) out.push({ kind: 'climb', maybe: false });
  if (isLong(t) && !out.some((o) => o.kind === 'long')) out.push({ kind: 'long', maybe: false });
  return out.sort((a, b) => Number(a.maybe) - Number(b.maybe));
}

/** Filters match only firm highlights, never "maybe". */
export const hasHighlight = (t: Pick<Trail, 'highlights'> & Partial<Pick<Trail, 'coords' | 'trailhead'>>, kind: string) =>
  kind === 'dogs' ? !!t.coords && dogsStatus({ highlights: t.highlights, coords: t.coords, trailhead: t.trailhead }) === 'yes' : !!t.highlights?.includes(kind);

export function HighlightChips({ trail, max = 3 }: { trail: Trail; max?: number }) {
  const hs = highlightsOf(trail).slice(0, max);
  if (!hs.length) return null;
  return <div className="hl-row">{hs.map((h) => <span className={`hl${h.maybe ? ' hl-maybe' : ''}`} key={h.kind}>{h.maybe ? 'Maybe ' : ''}{LABEL[h.kind]}</span>)}</div>;
}
