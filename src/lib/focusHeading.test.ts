import { describe, expect, it, vi } from 'vitest';
import { focusLandingHeading } from './focusHeading';

function el(opts: { tab?: number; hidden?: boolean } = {}) {
  const e = { tabIndex: opts.tab ?? -1, attrs: {} as Record<string, string>, focus: vi.fn(), setAttribute(k: string, v: string) { this.attrs[k] = v; }, closest: (s: string) => (s === '[hidden]' && opts.hidden ? {} : null) };
  return e;
}
/** A fake page: the schedule runs queued callbacks one frame at a time, so tests can change the page between frames. */
function page(state: { signIn: boolean; heads: ReturnType<typeof el>[] }) {
  const doc = { querySelector: (s: string) => (s === '[data-screen="sign-in"]' && state.signIn ? {} : null), querySelectorAll: () => state.heads };
  const q: (() => void)[] = [];
  return { doc, schedule: (cb: () => void) => { q.push(cb); }, step: () => q.shift()?.(), pending: () => q.length };
}

describe('focus after the guest note closes', () => {
  it('moves focus to the landing screen heading and makes it focusable (tabIndex -1)', () => {
    const h = el(); const p = page({ signIn: false, heads: [h] });
    focusLandingHeading(p.doc, p.schedule);
    p.step();
    expect(h.attrs.tabindex).toBe('-1');
    expect(h.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(p.pending()).toBe(0);
  });
  it('skips headings of hidden tab screens and takes the top-most visible one', () => {
    const hidden = el({ hidden: true }); const a = el(); const b = el(); const p = page({ signIn: false, heads: [hidden, a, b] });
    focusLandingHeading(p.doc, p.schedule); p.step();
    expect(hidden.focus).not.toHaveBeenCalled(); expect(a.focus).not.toHaveBeenCalled(); expect(b.focus).toHaveBeenCalledOnce();
  });
  it('waits while the sign-in screen is still on the page, then focuses once it has gone', () => {
    const h = el(); const state = { signIn: true, heads: [h] }; const p = page(state);
    focusLandingHeading(p.doc, p.schedule);
    p.step(); p.step();
    expect(h.focus).not.toHaveBeenCalled(); expect(p.pending()).toBe(1);
    state.signIn = false; p.step();
    expect(h.focus).toHaveBeenCalledOnce();
  });
  it('waits for a lazy-loaded screen, and gives up quietly after the allowed frames', () => {
    const state = { signIn: false, heads: [] as ReturnType<typeof el>[] }; const p = page(state);
    focusLandingHeading(p.doc, p.schedule, 3);
    for (let i = 0; i < 10; i++) p.step();
    expect(p.pending()).toBe(0);
    const h = el(); const s2 = { signIn: false, heads: [] as ReturnType<typeof el>[] }; const p2 = page(s2);
    focusLandingHeading(p2.doc, p2.schedule); p2.step(); s2.heads.push(h); p2.step();
    expect(h.focus).toHaveBeenCalledOnce();
  });
  it('does nothing without a document', () => { expect(() => focusLandingHeading(null)).not.toThrow(); });
  it('an existing tabindex is left alone', () => {
    const h = el({ tab: 0 }); const p = page({ signIn: false, heads: [h] }); focusLandingHeading(p.doc, p.schedule); p.step();
    expect(h.attrs.tabindex).toBeUndefined(); expect(h.focus).toHaveBeenCalled();
  });
});
