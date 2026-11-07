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
  /** Recalibrating after being off the trail: still off, say nothing new. */
  holdOff?: boolean;
  /** How far the hiker has actually walked (m). Lets a finish count when the route was never seen mid-way. */
  walkedM?: number;
  /** Distance to the trail and which way it lies, when off route. */
  off?: { distM: number; side: OffSide };
  /** The hiker is walking back toward the trail: no repeat reminder. */
  closing?: boolean;
}

export const NEAR_M = 150;        // "In 500 feet" (about 150 m)
export const AT_M = 15;
export const FINISH_M = 50;
export const OFF_REPEAT_MS = 60_000;
export const HUSH_MS = 20_000;   // after a hand-tapped switch, fork lines stay quiet this long...
export const HUSH_GROW_M = 20;    // ...and until the hiker has moved this far the new way, whichever is later

const verb = (f: ForkPoint) => (f.kind === 'turn' ? `turn ${f.side}` : `stay ${f.side}`);
const near = (f: ForkPoint, lead: string) => `${lead}${verb(f)} ${f.kind === 'turn' ? 'onto' : 'for'} ${f.name}.`;
const atFork = (f: ForkPoint) => `${verb(f).replace(/^./, (c) => c.toUpperCase())}.`;

export class Announcer {
  private nearSaid = new Set<number>();
  private atSaid = new Set<number>();
  private turnSaid = new Set<number>();
  private offAt: number | null = null;
  private finished = false;
  private seenMid = false;
  private hush: { t0?: number; a0?: number; minM?: number } | null = null;

  constructor(private route: AnnouncerRoute, private units: Units = 'imperial') {}

  /** True once "You made it." has been said on this route direction. */
  get finishedSaid() { return this.finished; }
  markFinished() { this.finished = true; }

  /**
   * After a hand-tapped switch (or its undo) the fork sides may not match where the hiker is really heading.
   * Fork and turnaround lines are marked as said but not spoken until HUSH_MS have passed and the hiker has moved HUSH_GROW_M.
   */
  hushForks() { this.hush = {}; }
  /** For an automatic switch (it may be a mis-snap): quiet until the hiker has really walked `minM` the new way, with no time release. */
  hushForksUntilWalked(minM: number) { this.hush = { minM }; }

  update(i: AnnouncerInput): Utterance[] {
    const out: Utterance[] = [];
    const say = (kind: UtteranceKind, text: string, interrupt: boolean, vibrate: number[]) => out.push({ kind, text, interrupt, vibrate });
    if (this.hush && i.along != null && !i.offRoute) {
      this.hush.t0 ??= i.t;
      this.hush.a0 ??= i.along;
      const h = this.hush;
      if (h.minM != null ? i.along - h.a0! >= h.minM : i.t - h.t0! >= HUSH_MS && i.along - h.a0! >= HUSH_GROW_M) this.hush = null;
    }
    const sayRoute = this.hush ? () => 0 : say;

    // Recalibrating while off the trail: still off. Keep the clock, add nothing, never "back on".
    if (i.holdOff && this.offAt != null) return out;

    // Off the trail: say it once, then at most once a minute.
    if (i.offRoute) {
      if (this.offAt == null || (i.t - this.offAt >= OFF_REPEAT_MS && !i.closing)) {
        this.offAt = i.t;
        say('off-route', i.off ? offRouteText(i.off.distM, i.off.side, this.units) : "You're off the trail.", true, [300, 100, 300]);
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
          sayRoute('fork', atFork(f), true, [200, 100, 200]);
        }
      } else if (d <= NEAR_M && !this.nearSaid.has(k)) {
        this.nearSaid.add(k);
        const lead = this.units === 'metric' ? 'In 150 metres, ' : 'In 500 feet, ';
        sayRoute('fork-near', near(f, lead), false, [120]);
      }
    });

    this.route.turnarounds.forEach((r, k) => {
      const d = r - along;
      if (!this.turnSaid.has(k) && d <= AT_M && d >= -AT_M) {
        this.turnSaid.add(k);
        sayRoute('turnaround', 'Turnaround point. Head back the way you came.', true, [200, 100, 200]);
      }
    });

    // On a loop the start is also the end: only count a finish once the hiker was seen mid-route or has walked half of it.
    const seenMid = this.seenMid;
    if (along >= this.route.total * 0.25 && along <= this.route.total * 0.75) this.seenMid = true;
    if (!this.finished && (seenMid || (i.walkedM ?? 0) >= this.route.total * 0.5) && this.route.total - along <= FINISH_M) {
      this.finished = true;
      say('finish', 'You made it.', true, [100, 60, 100, 60, 300]);
    }
    return out;
  }
}

export function offRouteText(distM: number, side: OffSide, units: Units): string {
  return `You're off the trail.${where(distM, side, units)}`;
}

function where(distM: number, side: OffSide, units: Units): string {
  const d = spokenDistance(distM, units);
  if (side === 'behind') return ` The trail is ${d} behind you.`;
  if (side === 'ahead') return ` The trail is ${d} ahead.`;
  return ` The trail is ${d} to your ${side}.`;
}
