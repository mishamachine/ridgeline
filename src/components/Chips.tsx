import { isBigClimb, isLong } from '../lib/plan';
import type { Trail } from '../lib/trails';

const LABEL: Record<string, string> = {
  view: 'Views', lake: 'Lake', falls: 'Waterfall', beach: 'Beach', bikes: 'Bikes share', horses: 'Horses share',
  dogs: 'Dogs OK', nodogs: 'No dogs', climb: 'Big climb', long: 'Long',
};

export interface Hl { kind: string; maybe: boolean }

/** Highlights from the data (a trailing "?" = maybe), plus Big climb and Long computed from the route. */
export function highlightsOf(t: Pick<Trail, 'highlights' | 'lengthM' | 'ascentM'>): Hl[] {
  const out: Hl[] = [];
  for (const h of t.highlights ?? []) {
    const kind = h.replace(/\?$/, '');
    if (LABEL[kind] && !out.some((o) => o.kind === kind)) out.push({ kind, maybe: h.endsWith('?') });
  }
  if (isBigClimb(t)) out.push({ kind: 'climb', maybe: false });
  if (isLong(t)) out.push({ kind: 'long', maybe: false });
  return out.sort((a, b) => Number(a.maybe) - Number(b.maybe));
}

/** Filters match only firm highlights, never "maybe". */
export const hasHighlight = (t: Pick<Trail, 'highlights'>, kind: string) => !!t.highlights?.includes(kind);

export function HighlightChips({ trail, max = 3 }: { trail: Trail; max?: number }) {
  const hs = highlightsOf(trail).slice(0, max);
  if (!hs.length) return null;
  return <div className="hl-row">{hs.map((h) => <span className={`hl${h.maybe ? ' hl-maybe' : ''}`} key={h.kind}>{h.maybe ? 'Maybe ' : ''}{LABEL[h.kind]}</span>)}</div>;
}
