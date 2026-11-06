// Badges are computed on the phone from recorded hikes. Nothing is stored or sent: the same hikes always give the same badges.
import { LngLat, cumulative, lineLength, projectOnLine, resample, totalAscent } from './geo';
import { trackDistance } from './tracker';
import type { Activity, TrailSnapshot } from './store';

/** The part of a Trail that badges need. `highlights` arrives with the trail-highlights data; absent means "unknown". */
export interface BadgeTrail {
  id: string;
  name: string;
  coords: LngLat[];
  ascentM?: number;
  highlights?: string[];
}

export interface Badge {
  id: BadgeId;
  name: string;
  earned: boolean;
  earnedAt?: number;
  progress: { have: number; need: number };
  sub: string;
}

export type BadgeId = 'first-trail' | 'ledge-sitter' | 'trail-buddy' | 'early-bird' | 'lake-hopper' | 'falls-chaser' | '10k-club' | 'rain-or-shine' | 'i90-trio';

/** A hike counts as "finished" when the recorded track passes within TOLERANCE_M of at least this share of the trail. */
export const COMPLETE_SHARE = 0.8;
export const TOLERANCE_M = 40;
export const CLIMB_TARGET_FT = 10_000;
const FT_PER_M = 3.28084;
/** Phone altitude is noisy, so tiny wiggles are not counted as climbing. */
const GPS_ALT_NOISE_M = 10;

/** Well-known Washington hikes for the Ledge Sitter badge. Matched on the trail's name. */
export const WA_CLASSICS = ['Rattlesnake Ledge', 'Mount Si', 'Little Si', 'Poo Poo Point', 'Lake 22', 'Snow Lake', 'Wallace Falls'];
/** Hikes off the I-90 corridor east of Seattle, for the I-90 Trio badge. */
export const I90_CLASSICS = ['Rattlesnake Ledge', 'Mount Si', 'Little Si', 'Poo Poo Point', 'Snow Lake', 'Twin Falls', 'Granite Mountain', 'Mailbox Peak'];

const norm = (s: string) => ` ${s.toLowerCase().replace(/\bmt\.?\b/g, 'mount').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const findIn = (list: string[], name: string) => list.find((c) => norm(name).includes(norm(c)));

export const isRecorded = (a: Activity) => a.points.length >= 2;

/** Share of the trail (0..1) that the recorded track passes within TOLERANCE_M of. */
export function trailCoverage(a: Activity, trail: Pick<BadgeTrail, 'coords'>): number {
  if (a.points.length < 2 || trail.coords.length < 2) return 0;
  const track: LngLat[] = a.points.map((p) => [p.lon, p.lat]);
  const cum = cumulative(track);
  const n = Math.min(400, Math.max(20, Math.round(lineLength(trail.coords) / 50)));
  const samples = resample(trail.coords, n);
  let hit = 0;
  for (const s of samples) if (projectOnLine(track, cum, s).offset <= TOLERANCE_M) hit++;
  return hit / samples.length;
}

/** Call when a hike finishes and store the result on the Activity (`activity.snapshot`), so badges do not depend on the saved trail. */
export function snapshotForActivity(trail: BadgeTrail, activity: Activity): TrailSnapshot {
  const snap: TrailSnapshot = { name: trail.name, coverage: trailCoverage(activity, trail) };
  if (trail.ascentM != null) snap.ascentM = trail.ascentM;
  if (trail.highlights?.length) snap.highlights = [...trail.highlights];
  return snap;
}

/** The hike's own snapshot, else one made from the saved trail (older hikes), else none. */
export function snapshotOf(a: Activity, trails: BadgeTrail[]): TrailSnapshot | undefined {
  if (a.snapshot) return a.snapshot;
  const trail = a.trailId ? trails.find((t) => t.id === a.trailId) : undefined;
  return trail ? snapshotForActivity(trail, a) : undefined;
}

/**
 * Climb for one hike, in metres, and where the number came from:
 * the trail's elevation data when the hike covered a matched trail, otherwise the phone's GPS altitude, otherwise none.
 */
export function activityClimb(a: Activity, snap?: Pick<TrailSnapshot, 'ascentM' | 'coverage'>): { m: number; source: 'trail' | 'gps' | 'none' } {
  if (snap && snap.ascentM != null && snap.coverage >= COMPLETE_SHARE) return { m: snap.ascentM, source: 'trail' };
  const alts = a.points.filter((p) => p.alt != null).map((p) => p.alt as number);
  if (alts.length >= 2 && alts.length >= a.points.length * 0.8) return { m: totalAscent(alts, GPS_ALT_NOISE_M), source: 'gps' };
  return { m: 0, source: 'none' };
}

export interface HikeFacts {
  id: string;
  t: number;
  trailKey: string;
  completed: boolean;
  classic?: string;
  i90?: string;
  lake: boolean;
  falls: boolean;
  climbM: number;
  climbSource: 'trail' | 'gps' | 'none';
  early: boolean;
  dog: boolean;
  rain: boolean;
}

export function hikeFacts(a: Activity, trails: BadgeTrail[]): HikeFacts {
  const snap = snapshotOf(a, trails);
  const completed = !!snap && snap.coverage >= COMPLETE_SHARE;
  const hl = (snap?.highlights ?? []).map((h) => h.toLowerCase());
  const climb = activityClimb(a, snap);
  return {
    id: a.id,
    t: a.endedAt ?? a.startedAt,
    trailKey: a.trailId ?? snap?.name ?? norm(a.name),
    completed,
    classic: completed ? findIn(WA_CLASSICS, snap!.name) : undefined,
    i90: completed ? findIn(I90_CLASSICS, snap!.name) : undefined,
    lake: completed && hl.includes('lake'),
    falls: completed && hl.includes('falls'),
    climbM: climb.m,
    climbSource: climb.source,
    early: new Date(a.startedAt).getHours() >= 4 && new Date(a.startedAt).getHours() < 7,
    dog: !!a.withDog,
    rain: !!a.rain,
  };
}

const distinct = (f: HikeFacts[], pick: (h: HikeFacts) => string | boolean | undefined, key: (h: HikeFacts) => string = (h) => h.trailKey) =>
  new Set(f.filter((h) => pick(h)).map(key)).size;

const count = (have: number, need: number, unit: string, earnedSub: string) => ({
  progress: { have: Math.min(have, need), need },
  sub: have >= need ? earnedSub : `${have} of ${need} ${unit}`,
});

/** Pure: badges for a list of hikes' facts. `earnedAt` is added by computeBadges. */
export function evaluate(f: HikeFacts[]): Omit<Badge, 'earnedAt'>[] {
  const lakes = distinct(f, (h) => h.lake);
  const falls = distinct(f, (h) => h.falls);
  const i90 = distinct(f, (h) => h.i90, (h) => h.i90!);
  const classics = f.filter((h) => h.classic);
  const climbFt = Math.round(f.reduce((s, h) => s + h.climbM, 0) * FT_PER_M);
  const first = f.length > 0;
  const sources = [f.some((h) => h.climbSource === 'trail') && 'trail data', f.some((h) => h.climbSource === 'gps') && 'GPS altitude'].filter(Boolean).join(' and ');
  const climbSub = climbFt >= CLIMB_TARGET_FT ? '10,000 ft climbed' : `${climbFt.toLocaleString('en-US')} of 10,000 ft`;
  const rows: Omit<Badge, 'earnedAt'>[] = [
    { id: 'first-trail', name: 'First Trail', earned: first, progress: { have: Math.min(f.length, 1), need: 1 }, sub: first ? 'Recorded a hike' : 'Record your first hike' },
    { id: 'ledge-sitter', name: 'Ledge Sitter', earned: classics.length > 0, progress: { have: Math.min(classics.length, 1), need: 1 }, sub: classics.length ? classics[0].classic! : 'Finish a Washington classic' },
    { id: 'trail-buddy', name: 'Trail Buddy', earned: f.some((h) => h.dog), progress: { have: f.some((h) => h.dog) ? 1 : 0, need: 1 }, sub: f.some((h) => h.dog) ? 'Hiked with a dog' : 'Mark a hike with your dog' },
    { id: 'early-bird', name: 'Early Bird', earned: f.some((h) => h.early), progress: { have: f.some((h) => h.early) ? 1 : 0, need: 1 }, sub: 'Start between 4 and 7am' },
    { id: 'lake-hopper', name: 'Lake Hopper', earned: lakes >= 3, ...count(lakes, 3, 'lakes', '3 lakes') },
    { id: 'falls-chaser', name: 'Falls Chaser', earned: falls >= 3, ...count(falls, 3, 'waterfalls', '3 waterfalls') },
    { id: '10k-club', name: '10K Club', earned: climbFt >= CLIMB_TARGET_FT, progress: { have: Math.min(climbFt, CLIMB_TARGET_FT), need: CLIMB_TARGET_FT }, sub: sources ? `${climbSub} (${sources})` : climbSub },
    { id: 'rain-or-shine', name: 'Rain or Shine', earned: f.some((h) => h.rain), progress: { have: f.some((h) => h.rain) ? 1 : 0, need: 1 }, sub: 'Hike in the rain' },
    { id: 'i90-trio', name: 'I-90 Trio', earned: i90 >= 3, ...count(i90, 3, 'classics', '3 classics') },
  ];
  return rows;
}

export function computeBadges(activities: Activity[], trails: BadgeTrail[] = []): Badge[] {
  const facts = activities.filter(isRecorded).map((a) => hikeFacts(a, trails)).sort((a, b) => a.t - b.t);
  const full = evaluate(facts);
  // earnedAt = when the hike that tipped the badge finished
  const prefix = new Map<number, Set<string>>();
  const earnedAtFor = (id: string) => {
    for (let k = 1; k <= facts.length; k++) {
      let ids = prefix.get(k);
      if (!ids) { ids = new Set(evaluate(facts.slice(0, k)).filter((b) => b.earned).map((b) => b.id)); prefix.set(k, ids); }
      if (ids.has(id)) return facts[k - 1].t;
    }
    return undefined;
  };
  return full.map((b) => (b.earned ? { ...b, earnedAt: earnedAtFor(b.id) } : b));
}

/** Badges this hike earned that the hiker did not have before it. For the celebration screen. */
export function newBadgesFor(activity: Activity, others: Activity[], trails: BadgeTrail[] = []): Badge[] {
  const rest = others.filter((o) => o.id !== activity.id);
  const had = new Set(computeBadges(rest, trails).filter((b) => b.earned).map((b) => b.id));
  return computeBadges([...rest, activity], trails).filter((b) => b.earned && !had.has(b.id));
}

/** The unearned badge closest to done (ties keep list order). */
export function nextBadge(badges: Badge[]): Badge | undefined {
  let best: Badge | undefined;
  let bestShare = -1;
  for (const b of badges) {
    if (b.earned) continue;
    const share = b.progress.have / b.progress.need;
    if (share > bestShare) { best = b; bestShare = share; }
  }
  return best;
}

export function hikeTotals(activities: Activity[], trails: BadgeTrail[] = []) {
  const recorded = activities.filter(isRecorded);
  return {
    hikes: recorded.length,
    distanceM: recorded.reduce((s, a) => s + trackDistance(a.points), 0),
    climbM: recorded.reduce((s, a) => s + activityClimb(a, snapshotOf(a, trails)).m, 0),
  };
}
