import { describe, it, expect } from 'vitest';
import { buildView } from './view';
import type { GpsState } from '../../lib/gps/engine';

const g = (o: Partial<GpsState>) => ({ hasFix: true, offRoute: false, recalLastOffRoute: false, stalePosition: false, along: null, offsetM: null, trailBearing: null, warmingUp: false, ...o }) as GpsState;
const v = (s: GpsState) => buildView({ g: s, step: null, trailName: 'T', units: 'imperial', offSide: null, paused: false });

describe('banner while recalibrating', () => {
  it('keeps the red off-route banner, marked last known, until a fresh fix lands', () => {
    expect(v(g({ hasFix: false, recalLastOffRoute: true }))).toMatchObject({ off: true, line: 'Off route (last known)', sub: 'Waiting for GPS' });
  });
  it('shows the normal off-route banner once there is a fix', () => {
    expect(v(g({ offRoute: true, offsetM: 40 }))).toMatchObject({ off: true, line: "You're off the trail" });
  });
});
