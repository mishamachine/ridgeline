import { describe, it, expect, vi } from 'vitest';
import { decideUpdate, mayReload, RELOAD_GUARD_MS } from './swUpdate';

describe('update decision', () => {
  it('applies at once when no hike is running', () => expect(decideUpdate(false)).toBe('apply'));
  it('shows the toast, never reloads, during a hike', () => expect(decideUpdate(true)).toBe('toast'));
});

describe('reload loop guard', () => {
  it('allows the first reload', () => expect(mayReload(null, 1000)).toBe(true));
  it('blocks a second reload within a minute', () => expect(mayReload(1000, 1000 + RELOAD_GUARD_MS - 1)).toBe(false));
  it('allows it again after a minute', () => expect(mayReload(1000, 1000 + RELOAD_GUARD_MS)).toBe(true));
  it('allows it if the clock went backwards', () => expect(mayReload(5000, 1000)).toBe(true));
});

describe('hike ends with an update waiting', () => {
  it('shows the toast during the hike, then applies when the hike ends', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const { setHikeActive, handleWaiting, onUpdateReady } = await import('./swUpdate');
    const posted: string[] = [];
    const ready: boolean[] = [];
    onUpdateReady((r) => ready.push(r));
    setHikeActive(true);
    handleWaiting({ postMessage: (m: string) => posted.push(m) } as unknown as ServiceWorker);
    expect(ready).toEqual([true]);
    expect(posted).toEqual([]);
    setHikeActive(false);
    expect(posted).toEqual(['SKIP_WAITING']);
  });
});
