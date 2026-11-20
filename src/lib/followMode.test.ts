import { describe, expect, it } from 'vitest';
import { angleDiff, followStep, FOLLOW_START, isRotated, NOTE_DENIED, NOTE_NO_SENSOR, smoothHeading, toBearing, type FollowEvent, type FollowState } from './followMode';

const run = (events: FollowEvent[], from: FollowState = FOLLOW_START) => events.reduce(followStep, from);

describe('follow mode', () => {
  it('goes centre, heading-up, off on three taps', () => {
    const one = run([{ type: 'tap' }]);
    expect(one).toMatchObject({ mode: 'centre', pending: false });
    const two = run([{ type: 'tap' }], one);
    expect(two).toMatchObject({ mode: 'centre', pending: true }); // asking the sensor
    const granted = run([{ type: 'headingResult', ok: true }], two);
    expect(granted).toMatchObject({ mode: 'heading', pending: false, note: null });
    expect(run([{ type: 'tap' }], granted)).toEqual(FOLLOW_START);
  });
  it('stays on centre-only with a note when the compass is denied', () => {
    const s = run([{ type: 'tap' }, { type: 'tap' }, { type: 'headingResult', ok: false }]);
    expect(s).toEqual({ mode: 'centre', pending: false, note: NOTE_DENIED });
    expect(run([{ type: 'tap' }], s)).toMatchObject({ mode: 'centre', pending: true, note: null }); // the next tap tries again
  });
  it('stays on centre-only with a note when there is no sensor', () => {
    const asking = run([{ type: 'tap' }, { type: 'tap' }]);
    expect(followStep(asking, { type: 'noSensor' })).toEqual({ mode: 'centre', pending: false, note: NOTE_NO_SENSOR });
    expect(followStep(FOLLOW_START, { type: 'noSensor' })).toBe(FOLLOW_START);
    expect(followStep(asking, { type: 'centre' })).toEqual({ mode: 'centre', pending: false, note: null });
  });
  it('ignores a late sensor answer when nothing was asked', () => {
    expect(run([{ type: 'headingResult', ok: true }])).toEqual(FOLLOW_START);
    const centre = run([{ type: 'tap' }]);
    expect(run([{ type: 'headingResult', ok: true }], centre)).toBe(centre);
  });
  it('a drag ends following; a hand rotation ends only heading-up', () => {
    const heading = run([{ type: 'tap' }, { type: 'tap' }, { type: 'headingResult', ok: true }]);
    expect(run([{ type: 'rotate' }], heading)).toMatchObject({ mode: 'centre' });
    expect(run([{ type: 'drag' }], heading)).toEqual(FOLLOW_START);
    const centre = run([{ type: 'tap' }]);
    expect(run([{ type: 'rotate' }], centre)).toBe(centre);
  });
});

describe('heading maths', () => {
  it('takes the short way round north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(smoothHeading(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(smoothHeading(null, -10)).toBe(350);
  });
  it('gives MapLibre bearings in -180..180', () => {
    expect(toBearing(270)).toBe(-90);
    expect(toBearing(90)).toBe(90);
    expect(toBearing(360)).toBe(0);
  });
  it('shows the north arrow only when turned or tilted', () => {
    expect(isRotated(0, 0)).toBe(false);
    expect(isRotated(0.2, 0)).toBe(false);
    expect(isRotated(-30, 0)).toBe(true);
    expect(isRotated(0, 20)).toBe(true);
  });
});
