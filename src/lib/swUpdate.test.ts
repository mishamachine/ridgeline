import { describe, it, expect } from 'vitest';
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
