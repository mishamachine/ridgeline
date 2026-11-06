// Out-and-back handling. Nothing flips on a wobble: a switch needs the hiker to reach the end first and then really walk back,
// and a switch (automatic or tapped) is undone if the hiker keeps going the original way.
export const END_M = 30;       // within this of the end counts as there
export const BACK_M = 60;      // walked this far back after the end, or forward again after a switch
const SAMPLES = 3;             // consecutive on-trail updates, so one jittery fix never flips direction

/** After reaching the end of a non-loop trail and then walking back 60 m: time to call the forks on the way down. */
export class TurnBack {
  private max = 0;
  private seenMid = false;
  private atEnd = 0;
  private armed = false;
  private back = 0;
  private done = false;

  constructor(private total: number, private loop: boolean) {}

  /** True once. Loops never fire; neither does a point-to-point hiker who stops at the end. */
  update(along: number | null, offRoute: boolean): boolean {
    if (this.loop || this.done || this.total <= 0 || along == null || offRoute) return false;
    this.max = Math.max(this.max, along);
    // The end only counts after you were seen part-way along: a mis-snap at the start is not an arrival.
    if (along >= this.total * 0.25 && along <= this.total * 0.75) this.seenMid = true;
    if (!this.armed) {
      this.atEnd = this.seenMid && along >= this.total - END_M ? this.atEnd + 1 : 0;
      if (this.atEnd >= 2) this.armed = true;
      return false;
    }
    this.back = along <= this.max - BACK_M ? this.back + 1 : 0;
    if (this.back >= SAMPLES) { this.done = true; return true; }
    return false;
  }
}

/** After a switch: if the hiker keeps walking the ORIGINAL way (original-direction along grows 60 m from its low point), flip back. */
export class FlipBack {
  private min = Infinity;
  private fwd = 0;
  private done = false;

  /** `original` is the distance along the route in the direction used before the switch; null when not on the trail. */
  update(original: number | null, offRoute: boolean): boolean {
    if (this.done || original == null || offRoute) return false;
    this.min = Math.min(this.min, original);
    this.fwd = original >= this.min + BACK_M ? this.fwd + 1 : 0;
    if (this.fwd >= SAMPLES) { this.done = true; return true; }
    return false;
  }
}
