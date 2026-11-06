import { describe, it, expect } from 'vitest';
import { cumulative, LngLat } from '../geo';
import { Frame } from '../gps/frame';
import { findReversals } from '../gps/reversals';
import { GpsEngine } from '../gps/engine';
import type { Junction } from '../trails';
import { Announcer, type Utterance } from './announcer';
import { forksFor, nextStep } from './forkpoints';
import { offRouteSide } from './offroute';
import { shortDistance, spokenDistance } from './units';

const fr = new Frame([-121.7, 47.5]);
const P = (x: number, y: number) => fr.toLngLat(x, y);
// A trail running east for 1,000 m. A Y-junction at 400 m: one path leaves to the north-east, one to the north-west.
const COORDS: LngLat[] = [P(0, 0), P(500, 0), P(1000, 0)];
const TOTAL = cumulative(COORDS).at(-1)!;
const JUNCTIONS: Junction[] = [{ along: 400, branches: [{ name: 'Side Path', point: P(417, 10) }, { point: P(383, 10) }] }];
const T0 = 1_700_000_000_000;

const texts = (u: Utterance[]) => u.map((x) => x.text);

function walk(a: Announcer, from: number, to: number, jitter = 0): Utterance[] {
  const out: Utterance[] = [];
  const step = to >= from ? 1.2 : -1.2;
  for (let k = 0, d = from; step > 0 ? d <= to : d >= to; k++, d += step) {
    const wobble = jitter ? Math.sin(k * 1.7) * jitter : 0;
    out.push(...a.update({ t: T0 + k * 1000, along: Math.max(0, d + wobble), offRoute: false }));
  }
  return out;
}

describe('forks from junctions', () => {
  it('stays right when the other path leaves to the left, and flips on a reversed route', () => {
    const fwd = forksFor(COORDS, JUNCTIONS, false, 'Mount Test Trail');
    expect(fwd).toEqual([expect.objectContaining({ along: 400, side: 'right', kind: 'fork', otherName: 'Side Path' })]);
    const rev = forksFor(COORDS, JUNCTIONS, true, 'Mount Test Trail');
    expect(rev).toEqual([expect.objectContaining({ along: TOTAL - 400, side: 'left', kind: 'fork' })]);
  });
  it('ignores side paths that carry the trail\'s own name', () => {
    const same: Junction[] = [{ along: 400, branches: [{ name: 'mount test trail', point: P(417, 10) }] }];
    expect(forksFor(COORDS, same, false, 'Mount Test Trail')).toEqual([]);
    const mixed: Junction[] = [{ along: 400, branches: [{ name: 'Mount Test Trail', point: P(383, 10) }, { name: 'Side Path', point: P(417, 10) }] }];
    expect(forksFor(COORDS, mixed, false, 'Mount Test Trail')).toEqual([expect.objectContaining({ side: 'right', otherName: 'Side Path' })]);
  });
  it('has nothing to say when the trail has no junctions or they sit at the ends', () => {
    expect(forksFor(COORDS, undefined, false, 'T')).toEqual([]);
    expect(forksFor(COORDS, [{ along: 10, branches: [{ point: P(10, 20) }] }], false, 'T')).toEqual([]);
  });
  it('picks the next step from where you are', () => {
    const forks = forksFor(COORDS, JUNCTIONS, false, 'T');
    expect(nextStep(forks, [], TOTAL, 100)).toMatchObject({ kind: 'fork', toM: expect.closeTo(300, 0) });
    expect(nextStep(forks, [], TOTAL, 600)).toMatchObject({ kind: 'follow', target: 'end' });
    expect(nextStep(forks, [800], TOTAL, 600)).toMatchObject({ kind: 'follow', target: 'turnaround' });
    expect(nextStep(forks, [800], TOTAL, 795)).toMatchObject({ kind: 'turnaround' });
  });
});

describe('announcer on a simulated walk', () => {
  it('says the fork twice, the finish once, and nothing else', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    expect(texts(walk(a, 0, TOTAL))).toEqual(['In 500 feet, stay right for Mount Test Trail.', 'Stay right.', 'You made it.']);
  });
  it('never repeats when the position wobbles back and forth across the trigger points', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    const said = texts(walk(a, 200, TOTAL, 12));
    expect(said.filter((t) => t === 'Stay right.')).toHaveLength(1);
    expect(said.filter((t) => t.startsWith('In 500'))).toHaveLength(1);
    expect(said.filter((t) => t === 'You made it.')).toHaveLength(1);
  });
  it('interrupts the earlier line at the fork, not when it first speaks', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, false, 'T'), turnarounds: [], total: TOTAL });
    const u = walk(a, 0, 420);
    expect(u.map((x) => x.interrupt)).toEqual([false, true]);
  });
  it('reversed route: the walk the other way says stay left', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    expect(texts(walk(a, 0, TOTAL))).toEqual(['In 500 feet, stay left for Mount Test Trail.', 'Stay left.', 'You made it.']);
  });
  it('metric', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, false, 'Mount Test Trail'), turnarounds: [], total: TOTAL }, 'metric');
    expect(texts(walk(a, 0, 420))[0]).toBe('In 150 metres, stay right for Mount Test Trail.');
  });
  it('a turn in the trail says turn, not stay', () => {
    const bend: LngLat[] = [P(0, 0), P(300, 0), P(300, 300)];
    const j: Junction[] = [{ along: 300, branches: [{ point: P(320, 0) }] }];
    const f = forksFor(bend, j, false, 'Bend Trail');
    expect(f[0]).toMatchObject({ kind: 'turn', side: 'left' });
    const a = new Announcer({ forks: f, turnarounds: [], total: 600 });
    expect(texts(walk(a, 0, 300))).toEqual(['In 500 feet, turn left onto Bend Trail.', 'Turn left.']);
  });
  it('off the trail: once, again only after 60 s, then back on', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    const off = (s: number, side: 'left' | 'behind' = 'left') => a.update({ t: T0 + s * 1000, along: 300, offRoute: true, off: { distM: 36.6, side } });
    expect(texts(off(0))).toEqual(["You're off the trail. The trail is 120 feet to your left."]);
    expect(off(20)).toEqual([]);
    expect(off(59)).toEqual([]);
    expect(texts(off(61, 'behind'))).toEqual(["You're off the trail. The trail is 120 feet behind you."]);
    expect(texts(a.update({ t: T0 + 80_000, along: 300, offRoute: false }))).toEqual(['Back on the trail.']);
    expect(a.update({ t: T0 + 81_000, along: 301, offRoute: false })).toEqual([]);
  });
  it('off the trail in metric', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL }, 'metric');
    expect(a.update({ t: T0, along: 300, offRoute: true, off: { distM: 36.6, side: 'right' } })[0].text).toBe("You're off the trail. The trail is 35 metres to your right.");
  });
  it('says nothing about forks while off the trail', () => {
    const a = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, false, 'T'), turnarounds: [], total: TOTAL });
    expect(a.update({ t: T0, along: 380, offRoute: true, off: { distM: 50, side: 'left' } }).map((u) => u.kind)).toEqual(['off-route']);
  });
  it('turnaround point, once', () => {
    const spur: LngLat[] = [P(0, 0), P(300, 0), P(300, 1), P(0, 1)];
    const tips = findReversals([P(0, 0), P(300, 0), P(0, 2)]);
    expect(tips).toHaveLength(1);
    const a = new Announcer({ forks: [], turnarounds: tips, total: 600 });
    void spur;
    expect(texts(walk(a, 0, 330))).toEqual(['Turnaround point. Head back the way you came.']);
  });
  it('two samples at total minus 5 on a loop, never seen mid-route: no finish', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    expect(a.update({ t: T0, along: TOTAL - 5, offRoute: false })).toEqual([]);
    expect(a.update({ t: T0 + 1000, along: TOTAL - 5, offRoute: false })).toEqual([]);
  });
  it('a finish counts when you have walked half the route even if it was never seen mid-way', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    expect(texts(a.update({ t: T0, along: TOTAL - 5, offRoute: false, walkedM: TOTAL * 0.6 }))).toEqual(['You made it.']);
  });
  it('recalibrating while off the trail: no new line, no "back on", and the 60 s clock keeps running', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    const off = { distM: 36.6, side: 'left' as const };
    expect(a.update({ t: T0, along: 300, offRoute: true, off })).toHaveLength(1);
    expect(a.update({ t: T0 + 10_000, along: null, offRoute: false, holdOff: true })).toEqual([]);
    expect(a.update({ t: T0 + 40_000, along: null, offRoute: false, holdOff: true })).toEqual([]);
    expect(texts(a.update({ t: T0 + 61_000, along: 300, offRoute: true, off }))).toEqual(["You're off the trail. The trail is 120 feet to your left."]);
  });
  it('a loop does not "finish" at the trailhead before you have walked it', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    expect(a.update({ t: T0, along: TOTAL - 5, offRoute: false })).toEqual([]);
    a.update({ t: T0 + 1000, along: TOTAL / 2, offRoute: false });
    expect(texts(a.update({ t: T0 + 2000, along: TOTAL - 5, offRoute: false }))).toEqual(['You made it.']);
  });
});

describe('reversing the route', () => {
  it('the engine drops the old along at once, so a stale screen state is told apart from the new one', () => {
    const eng = new GpsEngine({ start() {}, stop() {}, restart() {} }, { route: { coords: COORDS } });
    for (let d = 0; d <= 800; d += 4) { const p = P(d, 0); eng.ingest({ lon: p[0], lat: p[1], accuracy: 5, t: T0 + d * 250 }); }
    const shown = eng.state;
    expect(shown.along).toBeGreaterThan(700);
    eng.setRoute({ coords: [...COORDS].reverse() });
    expect(eng.state).not.toBe(shown); // Navigate skips announcements while the screen still holds `shown`
    expect(eng.state.along).toBeNull();
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    expect(a.update({ t: T0, along: eng.state.along, offRoute: eng.state.offRoute })).toEqual([]);
  });
});

describe('after a hand-tapped switch', () => {
  it('a mistaken tap 10 m before a fork, walking on forward, never speaks a reversed side', () => {
    // Forward the fork at 400 m is "stay right". The tap puts the hiker on the reversed route, whose fork (at 600 m) says "stay left".
    const rev = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    rev.hushForks();
    const said: Utterance[] = [];
    // Still walking forward: reversed along goes 610, 609, ... down to 560 over 40 s, passing the reversed fork.
    for (let k = 0; k <= 40; k++) said.push(...rev.update({ t: T0 + k * 1000, along: 610 - 1.25 * k, offRoute: false }));
    expect(said).toEqual([]);
  });
  it('speaks forks again once 20 s and 20 m the new way have passed', () => {
    const rev = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    rev.hushForks();
    const said: Utterance[] = [];
    for (let k = 0; k <= 30; k++) said.push(...rev.update({ t: T0 + k * 1000, along: 100 + k * 1.2, offRoute: false })); // 36 m in 30 s: hush over
    for (let k = 31; k < 500; k++) said.push(...rev.update({ t: T0 + k * 1000, along: 100 + k * 1.2, offRoute: false }));
    expect(said.map((x) => x.text)).toContain('Stay left.');
  });
  it('the hush needs both: 20 m of growth in 5 s is still quiet', () => {
    const rev = new Announcer({ forks: forksFor(COORDS, JUNCTIONS, true, 'Mount Test Trail'), turnarounds: [], total: TOTAL });
    rev.hushForks();
    expect(rev.update({ t: T0, along: 590, offRoute: false })).toEqual([]);
    expect(rev.update({ t: T0 + 5000, along: 612, offRoute: false })).toEqual([]);
  });
  it('"You made it." is not said again when the finished flag is carried into the next announcer', () => {
    const a = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    expect(texts(walk(a, 0, TOTAL))).toEqual(['You made it.']);
    expect(a.finishedSaid).toBe(true);
    const next = new Announcer({ forks: [], turnarounds: [], total: TOTAL });
    next.markFinished();
    expect(texts(walk(next, 0, TOTAL))).toEqual([]);
  });
});

describe('return leg of an out-and-back', () => {
  it('a junction visited on the way out and on the way back is announced on both passes, with opposite sides', () => {
    const out: LngLat[] = [P(0, 0), P(500, 0), P(1000, 0)];
    const back: LngLat[] = [...out, P(500, 2), P(0, 2)];
    // The side path leaves to the north at 500 m: on the way out that is the left, on the way back the right.
    const j: Junction[] = [
      { along: 500, branches: [{ name: 'Side Path', point: P(517, 10) }] },
      { along: cumulative(back)[3], branches: [{ name: 'Side Path', point: P(483, 12) }] },
    ];
    const f = forksFor(back, j, false, 'Out And Back');
    expect(f.map((x) => x.side)).toEqual(['right', 'left']);
  });
});

describe('off-route side', () => {
  it('left, right, behind and ahead, relative to the way you face', () => {
    // Standing 40 m north of an eastbound trail.
    const north = P(500, 40);
    expect(offRouteSide(COORDS, north, 90)).toMatchObject({ side: 'right' });  // facing east, trail is south = right
    expect(offRouteSide(COORDS, north, 270)).toMatchObject({ side: 'left' });  // facing west, trail is south = left
    expect(offRouteSide(COORDS, north, 0)).toMatchObject({ side: 'behind' });  // facing north, trail is behind
    expect(offRouteSide(COORDS, north, 180)).toMatchObject({ side: 'ahead' });
    expect(offRouteSide(COORDS, north, null)).toMatchObject({ side: 'right' }); // no heading: facing along the route
    expect(offRouteSide(COORDS, north, 90).distM).toBeCloseTo(40, 0);
    expect(offRouteSide(COORDS, north, 90).target[1]).toBeCloseTo(P(500, 0)[1], 5); // the nearest trail point, for the way-back line
  });
});

describe('units', () => {
  it('short and spoken forms', () => {
    expect(shortDistance(152, 'imperial')).toBe('500 ft');
    expect(shortDistance(1930, 'imperial')).toBe('1.2 mi');
    expect(shortDistance(150, 'metric')).toBe('150 m');
    expect(shortDistance(1900, 'metric')).toBe('1.9 km');
    expect(spokenDistance(36.6, 'imperial')).toBe('120 feet');
    expect(spokenDistance(36.6, 'metric')).toBe('35 metres');
  });
});
