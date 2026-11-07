// A hike that was never finished (phone died, app closed): close it honestly, or offer to resume it.
import type { BadgeTrail } from './badges';
import { endActivity } from './finish';
import { Activity, getSaved, getShortlisted, listActivities, putActivity } from './store';

export const STALE_MS = 6 * 3600_000;

const lastT = (a: Activity) => a.points.at(-1)?.t ?? a.startedAt;

/** The hike as it should be stored when it has no end and nothing was recorded for 6 hours, else null. */
export function sealIfAbandoned(a: Activity, now: number): Activity | null {
  if (a.endedAt != null || a.points.length === 0 || now - lastT(a) <= STALE_MS) return null;
  return { ...a, endedAt: lastT(a), unfinished: true };
}

/** A trail hike still open and under 6 hours old: offer to resume the newest one. */
export function resumable(list: Activity[], now: number): Activity | null {
  const open = list.filter((a) => a.endedAt == null && !!a.trailId && a.points.length > 0 && now - lastT(a) <= STALE_MS);
  return open.sort((x, y) => lastT(y) - lastT(x))[0] ?? null;
}

/** The trail a hike was on, from what is saved on this phone (null when it was cleared). */
export async function savedTrailFor(id: string): Promise<BadgeTrail | null> {
  return (await getSaved(id))?.trail ?? (await getShortlisted(id))?.trail ?? null;
}

/**
 * Run at app start (and again before reading the list): writes the sealed hikes and returns the full list.
 * A sealed hike goes through endActivity like a finished one, so it keeps a trail snapshot while the trail is still saved.
 */
export async function closeAbandoned(now = Date.now(), trailFor: (id: string) => Promise<BadgeTrail | null> = savedTrailFor): Promise<Activity[]> {
  const list = await listActivities();
  const out: Activity[] = [];
  for (const a of list) {
    const sealed = sealIfAbandoned(a, now);
    if (sealed) {
      const trail = sealed.trailId ? await trailFor(sealed.trailId).catch(() => null) : null;
      if (trail) endActivity(sealed, trail, sealed.endedAt!);
      await putActivity(sealed);
    }
    out.push(sealed ?? a);
  }
  return out;
}
