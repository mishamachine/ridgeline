// "Delete my Ridgeline data" locks many rows; if it meets another transaction head on the database picks one as the loser (40P01, deadlock detected).
// Nothing was deleted by the loser, so trying again is safe and the person never sees the failure.
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== '40P01' || i >= attempts) throw e;
      await wait(50 * 2 ** i);
    }
  }
}
