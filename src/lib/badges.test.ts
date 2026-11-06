import { describe, it, expect } from 'vitest';
import { computeBadges, newBadgesFor, nextBadge, hikeTotals, trailCoverage, activityClimb, BadgeTrail, WA_CLASSICS } from './badges';
import type { Activity } from './store';
import type { LngLat } from './geo';

// A straight 3 km trail north from a point near Rattlesnake Ledge. 1 deg lat = 111.19 km.
const line = (lon: number, lat0: number, km = 3, n = 31): LngLat[] => Array.from({ length: n }, (_, k) => [lon, lat0 + (km / 111.19) * (k / (n - 1))]);

const trail = (id: string, name: string, extra: Partial<BadgeTrail> = {}, lon = -121.77): BadgeTrail => ({ id, name, coords: line(lon, 47.43), ascentM: 300, ...extra });

let seq = 0;
function hike(t: BadgeTrail | null, opts: { start?: Date; share?: number; alt?: (k: number) => number | null; withDog?: boolean; rain?: boolean; name?: string } = {}): Activity {
  const start = (opts.start ?? new Date(2026, 9, 10, 9, 0)).getTime() + seq++ * 86_400_000;
  const coords = t ? t.coords : line(-122.1, 47.6);
  const n = Math.round(coords.length * (opts.share ?? 1));
  return {
    id: `a${seq}`,
    name: opts.name ?? t?.name ?? 'Hike',
    trailId: t?.id,
    startedAt: start,
    endedAt: start + 3_600_000,
    withDog: opts.withDog,
    rain: opts.rain,
    points: coords.slice(0, Math.max(2, n)).map(([lon, lat], k) => ({ lon, lat, alt: opts.alt ? opts.alt(k) : null, acc: 8, t: start + k * 60_000 })),
  };
}

const get = (acts: Activity[], trails: BadgeTrail[], id: string) => computeBadges(acts, trails).find((b) => b.id === id)!;

describe('badges: shape and empty state', () => {
  it('returns the first nine, none earned, with progress and a sub line', () => {
    const b = computeBadges([], []);
    expect(b.map((x) => x.id)).toEqual(['first-trail', 'ledge-sitter', 'trail-buddy', 'early-bird', 'lake-hopper', 'falls-chaser', '10k-club', 'rain-or-shine', 'i90-trio']);
    expect(b.every((x) => !x.earned && x.earnedAt === undefined && x.sub.length > 0 && x.progress.need > 0 && x.progress.have === 0)).toBe(true);
  });
  it('ignores recordings with fewer than 2 points', () => {
    const a = hike(null);
    a.points = a.points.slice(0, 1);
    expect(get([a], [], 'first-trail').earned).toBe(false);
  });
});

describe('First Trail and totals', () => {
  it('is earned by one recorded hike, dated by when it ended', () => {
    const a = hike(null);
    const b = get([a], [], 'first-trail');
    expect(b.earned).toBe(true);
    expect(b.earnedAt).toBe(a.endedAt);
  });
  it('totals count hikes, distance and climb', () => {
    const a = hike(null, { alt: (k) => 100 + k * 10 });
    const t = hikeTotals([a, hike(null)], []);
    expect(t.hikes).toBe(2);
    expect(t.distanceM).toBeGreaterThan(5000);
    expect(t.climbM).toBeCloseTo(300, -1);
  });
});

describe('trail completion', () => {
  const t = trail('r1', 'Rattlesnake Ledge');
  it('full track covers the trail', () => expect(trailCoverage(hike(t), t)).toBe(1));
  it('half a track does not', () => expect(trailCoverage(hike(t, { share: 0.5 }), t)).toBeLessThan(0.6));
  it('a track 500 m away covers nothing', () => expect(trailCoverage(hike(trail('x', 'Elsewhere', {}, -121.76), { name: 'x' }), t)).toBe(0));
  it('79% does not count, 85% does', () => {
    expect(get([hike(t, { share: 0.7 })], [t], 'ledge-sitter').earned).toBe(false);
    expect(get([hike(t, { share: 0.9 })], [t], 'ledge-sitter').earned).toBe(true);
  });
});

describe('Ledge Sitter', () => {
  it('earned by finishing a listed classic, named in the sub line', () => {
    const t = trail('r1', 'Rattlesnake Ledge');
    const b = get([hike(t)], [t], 'ledge-sitter');
    expect(b.earned).toBe(true);
    expect(b.sub).toBe('Rattlesnake Ledge');
  });
  it('matches "Mt. Si" style names', () => {
    const t = trail('s1', 'Mt. Si Trail');
    expect(get([hike(t)], [t], 'ledge-sitter').earned).toBe(true);
  });
  it('does not match Mount Siegel for Mount Si', () => {
    const t = trail('s2', 'Mount Siegel');
    expect(get([hike(t)], [t], 'ledge-sitter').earned).toBe(false);
  });
  it('is not earned when the trail is unknown (not saved), because completion cannot be checked', () => {
    expect(get([hike(trail('r1', 'Rattlesnake Ledge'))], [], 'ledge-sitter').earned).toBe(false);
  });
  it('is not earned for an unlisted trail or a partial hike', () => {
    const t = trail('u', 'Some Local Loop');
    expect(get([hike(t)], [t], 'ledge-sitter').earned).toBe(false);
    const l = trail('r1', 'Rattlesnake Ledge');
    expect(get([hike(l, { share: 0.5 })], [l], 'ledge-sitter').earned).toBe(false);
  });
  it('lists the seven starting classics', () => expect(WA_CLASSICS).toHaveLength(7));
});

describe('Trail Buddy, Early Bird, Rain or Shine', () => {
  it('Trail Buddy needs the dog toggle', () => {
    expect(get([hike(null)], [], 'trail-buddy').earned).toBe(false);
    expect(get([hike(null, { withDog: true })], [], 'trail-buddy').earned).toBe(true);
  });
  it('Rain or Shine needs the rain toggle', () => {
    expect(get([hike(null)], [], 'rain-or-shine').earned).toBe(false);
    expect(get([hike(null, { rain: true })], [], 'rain-or-shine').earned).toBe(true);
  });
  it('Early Bird: 6:59 local counts, 7:00 does not', () => {
    expect(get([hike(null, { start: new Date(2026, 9, 10, 6, 59) })], [], 'early-bird').earned).toBe(true);
    expect(get([hike(null, { start: new Date(2026, 9, 10, 7, 0) })], [], 'early-bird').earned).toBe(false);
  });
});

describe('Lake Hopper and Falls Chaser', () => {
  const lakes = [trail('l1', 'Lake A', { highlights: ['Lake'] }), trail('l2', 'Lake B', { highlights: ['lake', 'views'] }), trail('l3', 'Lake C', { highlights: ['lake'] })];
  it('counts distinct completed trails with the highlight (case-insensitive)', () => {
    const acts = [hike(lakes[0]), hike(lakes[0]), hike(lakes[1])];
    const b = get(acts, lakes, 'lake-hopper');
    expect(b.progress).toEqual({ have: 2, need: 3 });
    expect(b.earned).toBe(false);
    expect(b.sub).toBe('2 of 3 lakes');
  });
  it('is earned at 3 and dated by the third distinct trail', () => {
    const acts = lakes.map((t) => hike(t));
    const b = get(acts, lakes, 'lake-hopper');
    expect(b.earned).toBe(true);
    expect(b.earnedAt).toBe(acts[2].endedAt);
  });
  it('does not count a trail without highlights data, or a partial hike', () => {
    const bare = [trail('p1', 'Plain 1'), trail('p2', 'Plain 2'), trail('p3', 'Plain 3')];
    expect(get(bare.map((t) => hike(t)), bare, 'lake-hopper').progress.have).toBe(0);
    expect(get([hike(lakes[0], { share: 0.4 })], lakes, 'lake-hopper').progress.have).toBe(0);
  });
  it('Falls Chaser uses the falls highlight', () => {
    const f = ['a', 'b', 'c'].map((s) => trail('f' + s, 'Falls ' + s, { highlights: ['falls'] }));
    expect(get(f.map((t) => hike(t)), f, 'falls-chaser').earned).toBe(true);
    expect(get(f.slice(0, 2).map((t) => hike(t)), f, 'falls-chaser').progress).toEqual({ have: 2, need: 3 });
  });
});

describe('I-90 Trio', () => {
  const names = ['Rattlesnake Ledge', 'Mount Si', 'Twin Falls'];
  const ts = names.map((n, i) => trail('i' + i, n));
  it('needs 3 distinct I-90 classics', () => {
    expect(get(ts.slice(0, 2).map((t) => hike(t)), ts, 'i90-trio').progress).toEqual({ have: 2, need: 3 });
    expect(get(ts.map((t) => hike(t)), ts, 'i90-trio').earned).toBe(true);
  });
  it('the same classic twice counts once; Lake 22 is not on I-90', () => {
    const l22 = trail('l22', 'Lake 22');
    expect(get([hike(ts[0]), hike(ts[0]), hike(l22)], [...ts, l22], 'i90-trio').progress.have).toBe(1);
  });
});

describe('10K Club and climb source', () => {
  it('uses the trail elevation data when the hike covered a matched trail', () => {
    const t = trail('t1', 'Big Climb', { ascentM: 1000 });
    expect(activityClimb(hike(t), t)).toEqual({ m: 1000, source: 'trail' });
  });
  it('uses GPS altitude otherwise, ignoring small wiggles', () => {
    const noisy = hike(null, { alt: (k) => 500 + (k % 2) * 3 });
    expect(activityClimb(noisy).m).toBe(0);
    const climb = hike(null, { alt: (k) => 500 + k * 20 });
    const c = activityClimb(climb);
    expect(c.source).toBe('gps');
    expect(c.m).toBeCloseTo(600, -1);
  });
  it('reports none without altitude', () => expect(activityClimb(hike(null))).toEqual({ m: 0, source: 'none' }));
  it('earns at 10,000 ft total across hikes', () => {
    const t = trail('t1', 'Big Climb', { ascentM: 1000 }); // 3,281 ft each
    expect(get([hike(t), hike(t), hike(t)], [t], '10k-club').earned).toBe(false);
    const b = get([hike(t), hike(t), hike(t), hike(t)], [t], '10k-club');
    expect(b.earned).toBe(true);
    expect(b.progress).toEqual({ have: 10000, need: 10000 });
  });
  it('shows progress in feet', () => {
    const t = trail('t1', 'Big Climb', { ascentM: 1000 });
    expect(get([hike(t)], [t], '10k-club').sub).toBe('3,281 of 10,000 ft');
  });
});

describe('newBadgesFor and nextBadge', () => {
  it('lists only badges this hike unlocked', () => {
    const l = trail('r1', 'Rattlesnake Ledge');
    const first = hike(null);
    const second = hike(l, { withDog: true });
    expect(newBadgesFor(first, [], [l]).map((b) => b.id)).toEqual(['first-trail']);
    expect(newBadgesFor(second, [first], [l]).map((b) => b.id).sort()).toEqual(['ledge-sitter', 'trail-buddy']);
    expect(newBadgesFor(hike(null), [first, second], [l])).toEqual([]);
  });
  it('does not double count when the hike is already in the list', () => {
    const a = hike(null);
    expect(newBadgesFor(a, [a], []).map((b) => b.id)).toEqual(['first-trail']);
  });
  it('picks the unearned badge closest to done', () => {
    const lakes = [trail('l1', 'A', { highlights: ['lake'] }), trail('l2', 'B', { highlights: ['lake'] })];
    const next = nextBadge(computeBadges(lakes.map((t) => hike(t)), lakes));
    expect(next?.id).toBe('lake-hopper');
  });
  it('returns undefined when everything is earned', () => expect(nextBadge(computeBadges([], []).map((b) => ({ ...b, earned: true })))).toBeUndefined());
});
