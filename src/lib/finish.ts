// Start and end of a hike: what gets written on the Activity.
import { snapshotForActivity, type BadgeTrail } from './badges';
import { getSettings } from './settings';
import { newActivity } from './tracker';
import type { Activity } from './store';

/** A new hike starts marked "with a dog" when that setting is on. */
export function startActivity(trail: Pick<BadgeTrail, 'id' | 'name'>, withDogDefault = getSettings().withDogDefault): Activity {
  const a = newActivity(trail.name, trail.id);
  if (withDogDefault) a.withDog = true;
  return a;
}

/** Closes the hike. A recorded hike (2+ points) also keeps a snapshot of the trail, so badges survive "Clear offline maps". Returns true when it should be saved. */
export function endActivity(a: Activity, trail: BadgeTrail, endedAt: number): boolean {
  a.endedAt = endedAt;
  if (a.points.length < 2) return false;
  a.snapshot = snapshotForActivity(trail, a);
  return true;
}
