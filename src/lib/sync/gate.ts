// A gate around sync passes. Deleting data (or an account) must not race a sync: pause() stops new passes and waits for any pass
// already running, so nothing is uploaded between the delete and the wipe of this phone's copies / the sign-out.
let holds = 0;
let running: Promise<unknown> | null = null;

export const syncGate = {
  /** True while a delete is in progress. A paused gate lets no pass start and tells a running one to stop pushing. */
  get paused() { return holds > 0; },
  /** Stop new passes and wait until the one in flight (if any) has finished. */
  async pause(): Promise<void> {
    holds++;
    try { await running; } catch { /* a failed pass is still finished */ }
  },
  /** Call once for every pause(), after the wipe and sign-out are done (or the delete failed). */
  resume(): void { holds = Math.max(0, holds - 1); },
  /** Run one pass under the gate. Returns undefined when paused. */
  async run<T>(pass: () => Promise<T>): Promise<T | undefined> {
    if (holds > 0 || running) return undefined;
    const p = pass();
    running = p;
    try { return await p; } finally { if (running === p) running = null; }
  },
};
