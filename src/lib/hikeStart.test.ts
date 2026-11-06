import { describe, it, expect } from 'vitest';
import { startAction } from './hikeStart';

describe('start hike while a hike runs', () => {
  it('starts when nothing is running', () => expect(startAction(null, { id: 'a' })).toBe('start'));
  it('just goes back to the hike when it is the same trail', () => expect(startAction({ id: 'a' }, { id: 'a' })).toBe('resume'));
  it('asks first for a different trail', () => expect(startAction({ id: 'a' }, { id: 'b' })).toBe('confirm'));
});
