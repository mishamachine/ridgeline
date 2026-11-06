// When to speak. Pure: feed it the engine's position once a second, get back what to say (if anything).
import type { ForkPoint } from './forkpoints';
import type { OffSide } from './offroute';
import type { Units } from './prefs';
import { spokenDistance } from './units';

export type UtteranceKind = 'fork-near' | 'fork' | 'off-route' | 'back-on' | 'turnaround' | 'finish';

export interface Utterance {
  kind: UtteranceKind;
  text: string;
  /** Drop whatever is queued first (the hiker is at the fork now; the "in 500 feet" line is stale). */
  interrupt: boolean;
  /** Vibration pattern (ms) to play with it on devices that support it. */
  vibrate: number[];
}

export interface AnnouncerRoute {
  forks: ForkPoint[];
  /** Where the route doubles back (m along). */
  turnarounds: number[];
  total: number;
}

export interface AnnouncerInput {
  /** ms clock. */
  t: number;
  /** Distance along the route (m); null when the trail is not near. */
  along: number | null;
  offRoute: boolean;
  /** Distance to the trail and which way it lies, when off route. */
  off?: { distM: number; side: OffSide };
}

export const NEAR_M = 150;        // "In 500 feet" (about 150 m)
export const AT_M = 15;
export const FINISH_M = 50;
export const OFF_REPEAT_MS = 60_000;

const verb = (f: ForkPoint) => (f.kind === 'turn' ? `turn ${f.side}` : `stay ${f.side}`);
const near = (f: ForkPoint, lead: string) => `${lead}${verb(f)} ${f.kind === 'turn' ? 'onto' : 'for'} ${f.name}.`;
const atFork = (f: ForkPoint) => `${verb(f).replace(/^./, (c) => c.toUpperCase())}.`;

export class Announcer {
  private nearSaid = new Set<number>();
  private atSaid = new Set<number>();
  private turnSaid = new Set<number>();
  private offAt: number | null = null;
  private finished = false;
  private furthest = 0;

  constructor(private route: AnnouncerRoute, private units: Units = 'imperial') {}

  update(i: AnnouncerInput): Utterance[] {
    const out: Utterance[] = [];
    const say = (kind: UtteranceKind, text: string, interrupt: boolean, vibrate: number[]) => out.push({ kind, text, interrupt, vibrate });

    // Off the trail: say it once, then at most once a minute.
    if (i.offRoute) {
      if (this.offAt == null || i.t - this.offAt >= OFF_REPEAT_MS) {
        this.offAt = i.t;
        const w = i.off ? where(i.off.distM, i.off.side, this.units) : '';
        say('off-route', `You're off the trail.${w}`, true, [300, 100, 300]);
      }
      return out;
    }
    if (this.offAt != null) {
      this.offAt = null;
      say('back-on', 'Back on the trail.', true, [100]);
    }
    if (i.along == null) return out;
    const along = i.along;

    this.route.forks.forEach((f, k) => {
      const d = f.along - along;
      if (d < -AT_M) { this.nearSaid.add(k); this.atSaid.add(k); return; }
      if (d <= AT_M) {
        if (!this.atSaid.has(k)) {
          this.atSaid.add(k); this.nearSaid.add(k);
          say('fork', atFork(f), true, [200, 100, 200]);
        }
      } else if (d <= NEAR_M && !this.nearSaid.has(k)) {
        this.nearSaid.add(k);
        const lead = this.units === 'metric' ? 'In 150 metres, ' : 'In 500 feet, ';
        say('fork-near', near(f, lead), false, [120]);
      }
    });

    this.route.turnarounds.forEach((r, k) => {
      const d = r - along;
      if (!this.turnSaid.has(k) && d <= AT_M && d >= -AT_M) {
        this.turnSaid.add(k);
        say('turnaround', 'Turnaround point. Head back the way you came.', true, [200, 100, 200]);
      }
    });

    // On a loop the start is also the end, so only count the finish after most of the route is done.
    const furthest = this.furthest;
    this.furthest = Math.max(furthest, along);
    if (!this.finished && furthest >= this.route.total * 0.5 && this.route.total - along <= FINISH_M) {
      this.finished = true;
      say('finish', 'You made it.', true, [100, 60, 100, 60, 300]);
    }
    return out;
  }
}

function where(distM: number, side: OffSide, units: Units): string {
  const d = spokenDistance(distM, units);
  if (side === 'behind') return ` The trail is ${d} behind you.`;
  if (side === 'ahead') return ` The trail is ${d} ahead.`;
  return ` The trail is ${d} to your ${side}.`;
}
