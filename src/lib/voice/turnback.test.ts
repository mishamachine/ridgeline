import { describe, it, expect } from 'vitest';
import { cumulative, LngLat } from '../geo';
import { Frame } from '../gps/frame';
import type { Junction } from '../trails';
import { Announcer, type Utterance } from './announcer';
import { forksFor } from './forkpoints';
import { FlipBack, TurnBack } from './turnback';

const fr = new Frame([-121.7, 47.5]);
const P = (x: number, y: number) => fr.toLngLat(x, y);
const COORDS: LngLat[] = [P(0, 0), P(500, 0), P(1000, 0)];
const TOTAL = cumulative(COORDS).at(-1)!;
// A Y-junction at 400 m, as in the voice tests.
const J: Junction[] = [{ along: 400, branches: [{ name: 'Side Path', point: P(417, 10) }, { point: P(383, 10) }] }];
const T0 = 1_700_000_000_000;

const texts = (u: Utterance[]) => u.map((x) => x.text);
// Feed alongs to an announcer (and the detector) one second apart; returns what was said and whether the detector fired.
function run(alongs: number[], a: Announcer, tb?: TurnBack) {
  const said: Utterance[] = [];
  let fired = -1;
  alongs.forEach((d, k) => {
    said.push(...a.update({ t: T0 + k * 1000, along: d, offRoute: false }));
    if (tb && fired < 0 && tb.update(d, false)) fired = k;
  });
  return { said, fired };
}
const range = (from: number, to: number, step = 1.2) => { const out: number[] = []; for (let d = from; step > 0 ? d <= to : d >= to; d += step) out.push(d); return out; };

describe('turn back after the end', () => {
  it('a point-to-point hiker who reaches the end and stops hears "You made it." and nothing else', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    const tb = new TurnBack(TOTAL, false);
    const { said, fired } = run([...range(0, TOTAL), ...Array(120).fill(TOTAL - 3)], a, tb);
    expect(texts(said)).toEqual(['You made it.']);
    expect(fired).toBe(-1);
  });
  it('an out-and-back hiker who reaches the end and walks 60 m back switches once, and the way down has the opposite sides', () => {
    const fwd = new Announcer({ forks: forksFor(COORDS, J, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    const tb = new TurnBack(TOTAL, false);
    const { said, fired } = run([...range(0, TOTAL), ...range(TOTAL, TOTAL - 100, -1.2)], fwd, tb);
    expect(fired).toBeGreaterThan(0);
    expect(texts(said)).toEqual(['In 500 feet, stay right for Mount Test Trail.', 'Stay right.', 'You made it.']);
    // Navigate now switches to the reversed route with a fresh announcer: the hiker is at its start.
    const back = new Announcer({ forks: forksFor(COORDS, J, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    expect(texts(run(range(0, TOTAL), back).said)).toEqual(['In 500 feet, stay left for Mount Test Trail.', 'Stay left.', 'You made it.']);
  });
  it('wobbling back 70 m after 80% and then carrying on forward never switches, and the forks keep their sides', () => {
    const far: Junction[] = [{ along: 900, branches: [{ name: 'Side Path', point: P(917, 10) }, { point: P(883, 10) }] }];
    const a = new Announcer({ forks: forksFor(COORDS, far, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    const tb = new TurnBack(TOTAL, false);
    const walk = [...range(0, 850), ...range(850, 770, -1.2), ...range(770, TOTAL)];
    const { said, fired } = run(walk, a, tb);
    expect(fired).toBe(-1);
    expect(texts(said)).toEqual(['In 500 feet, stay right for Mount Test Trail.', 'Stay right.', 'You made it.']);
  });
  it('never on a loop', () => {
    const tb = new TurnBack(TOTAL, true);
    for (const d of [...range(0, TOTAL), ...range(TOTAL, 0, -1.2)]) expect(tb.update(d, false)).toBe(false);
  });
  it('not on jitter or one stray fix at the end, and not while off the trail', () => {
    const tb = new TurnBack(TOTAL, false);
    for (const d of range(0, TOTAL - 70)) tb.update(d, false);
    for (let k = 0; k < 60; k++) expect(tb.update(TOTAL - 70 + Math.sin(k) * 15, false)).toBe(false);
    expect(tb.update(TOTAL - 5, false)).toBe(false);   // one jumpy fix at the end is not an arrival
    for (let k = 0; k < 6; k++) expect(tb.update(TOTAL - 70, false)).toBe(false);
    const u = new TurnBack(TOTAL, false);
    for (const d of range(0, TOTAL)) u.update(d, true); // off the trail the whole time
    for (const d of range(TOTAL, TOTAL - 100, -1.2)) expect(u.update(d, true)).toBe(false);
  });
  it('a jump to the end at the start of the trail (never seen part-way) is not an arrival', () => {
    const tb = new TurnBack(TOTAL, false);
    for (let k = 0; k < 4; k++) tb.update(TOTAL - 2, false);
    for (let k = 0; k < 6; k++) expect(tb.update(TOTAL - 100, false)).toBe(false);
  });
});

describe('flip back safety net', () => {
  it('flips back when the hiker keeps going the original way for 60 m, not before', () => {
    const f = new FlipBack();
    for (const o of [500, 490, 480, 470]) expect(f.update(o, false)).toBe(false); // walking back the new way
    for (const o of [480, 500, 520]) expect(f.update(o, false)).toBe(false);       // 50 m forward again: not yet
    let fired = false;
    for (const o of [532, 540, 548]) fired = f.update(o, false) || fired;
    expect(fired).toBe(true);
  });
  it('does not flip on jitter or a single stray sample', () => {
    const f = new FlipBack();
    for (let k = 0; k < 50; k++) expect(f.update(500 + Math.sin(k) * 15, false)).toBe(false);
    expect(f.update(580, false)).toBe(false);
    expect(f.update(500, false)).toBe(false);
  });
});
