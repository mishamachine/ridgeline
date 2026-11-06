import { describe, it, expect } from 'vitest';
import { cumulative, LngLat } from '../geo';
import { Frame } from '../gps/frame';
import type { Junction } from '../trails';
import { Announcer, type Utterance } from './announcer';
import { forksFor } from './forkpoints';
import { TurnBack } from './turnback';

const fr = new Frame([-121.7, 47.5]);
const P = (x: number, y: number) => fr.toLngLat(x, y);
const COORDS: LngLat[] = [P(0, 0), P(500, 0), P(1000, 0)];
const TOTAL = cumulative(COORDS).at(-1)!;
// A Y-junction at 400 m, as in the voice tests.
const J: Junction[] = [{ along: 400, branches: [{ name: 'Side Path', point: P(417, 10) }, { point: P(383, 10) }] }];
const T0 = 1_700_000_000_000;

describe('turn back', () => {
  it('fires once when the end is reached, after two samples', () => {
    const t = new TurnBack(TOTAL, false);
    const hits: number[] = [];
    for (let d = 0; d <= TOTAL; d += 5) if (t.update(d, false)) hits.push(d);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(TOTAL - 30);
    expect(t.update(TOTAL, false)).toBe(false);
  });
  it('fires when the hiker turns round near the end and walks back 60 m', () => {
    const t = new TurnBack(TOTAL, false);
    for (let d = 0; d <= TOTAL * 0.85; d += 5) expect(t.update(d, false)).toBe(false);
    let fired = -1;
    for (let d = TOTAL * 0.85; d >= TOTAL * 0.85 - 90 && fired < 0; d -= 5) if (t.update(d, false)) fired = d;
    expect(fired).toBeGreaterThan(0);
    expect(TOTAL * 0.85 - fired).toBeGreaterThanOrEqual(60);
  });
  it('never fires on a loop', () => {
    const t = new TurnBack(TOTAL, true);
    for (let d = 0; d <= TOTAL; d += 5) expect(t.update(d, false)).toBe(false);
    for (let d = TOTAL; d >= 0; d -= 5) expect(t.update(d, false)).toBe(false);
  });
  it('is not fooled by GPS jitter near the end, or by one stray sample', () => {
    const t = new TurnBack(TOTAL, false);
    for (let d = 0; d <= TOTAL - 70; d += 5) t.update(d, false);
    for (let k = 0; k < 60; k++) expect(t.update(TOTAL - 70 + Math.sin(k) * 15, false)).toBe(false); // wobbling 55-85 m from the end
    expect(t.update(TOTAL - 5, false)).toBe(false);  // one jumpy fix at the end
    expect(t.update(TOTAL - 60, false)).toBe(false);
  });
  it('ignores samples while off the trail and a start-of-trail jump to the end', () => {
    const t = new TurnBack(TOTAL, false);
    expect(t.update(TOTAL - 2, false)).toBe(false);
    expect(t.update(TOTAL - 2, false)).toBe(false); // never seen half way: not the end of a hike
    const u = new TurnBack(TOTAL, false);
    for (let d = 0; d <= TOTAL - 10; d += 5) u.update(d, false);
    expect(u.update(TOTAL, true)).toBe(false);
  });
});

describe('out-and-back relation trail: the way back', () => {
  it('prompts at the same fork on the way back with the opposite side', () => {
    const texts = (u: Utterance[]) => u.map((x) => x.text);
    const walk = (a: Announcer) => { const out: Utterance[] = []; for (let d = 0, k = 0; d <= TOTAL; d += 1.2, k++) out.push(...a.update({ t: T0 + k * 1000, along: d, offRoute: false })); return out; };
    const outbound = walk(new Announcer({ forks: forksFor(COORDS, J, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL }));
    // Navigate switches to the reversed route (same as Reverse) when TurnBack fires, with a fresh announcer.
    const back = walk(new Announcer({ forks: forksFor(COORDS, J, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL }));
    expect(texts(outbound)).toContain('Stay right.');
    expect(texts(back)).toEqual(['In 500 feet, stay left for Mount Test Trail.', 'Stay left.', 'You made it.']);
  });
});
