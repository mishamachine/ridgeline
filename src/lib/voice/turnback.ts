// Out-and-back: notice that the hiker has reached the end, or has turned round near it, so Navigate can switch to the way back.
export const END_M = 30;       // within this of the end counts as there
export const NEAR_END = 0.8;   // turned round after this much of the trail
export const BACK_M = 60;      // ...and has come back this far
const SAMPLES = 3;             // consecutive updates, so one jittery fix never flips direction

export class TurnBack {
  private max = 0;
  private atEnd = 0;
  private back = 0;
  private seenMid = false;
  private done = false;

  constructor(private total: number, private loop: boolean) {}

  /** True once, when it is time to head back. Loops and trails with no length never fire. */
  update(along: number | null, offRoute: boolean): boolean {
    if (this.loop || this.done || this.total <= 0 || along == null || offRoute) return false;
    this.max = Math.max(this.max, along);
    // The end only counts after you were seen part-way along: a mis-snap at the start of a loop-like trail is not an arrival.
    if (along >= this.total * 0.25 && along <= this.total * 0.75) this.seenMid = true;
    this.atEnd = this.seenMid && along >= this.total - END_M ? this.atEnd + 1 : 0;
    this.back = this.max >= this.total * NEAR_END && along <= this.max - BACK_M ? this.back + 1 : 0;
    if (this.atEnd >= 2 || this.back >= SAMPLES) { this.done = true; return true; }
    return false;
  }
}
