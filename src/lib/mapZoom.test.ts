import { describe, expect, it, vi } from 'vitest';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, SAVED_ZOOMS, SOURCE_MAX_ZOOM, atZoomLimit, breaksFollow, zoomLimits, zoomStep, type Zoomable } from './mapZoom';
import { swissStyle } from './mapStyle';

const fake = (z: number, min = 9, max = 17) => ({ getZoom: () => z, getMinZoom: () => min, getMaxZoom: () => max, zoomTo: vi.fn() }) satisfies Zoomable;

describe('zoomLimits', () => {
  it('is z9 to z17 with a signal', () => {
    expect(zoomLimits()).toEqual({ minZoom: 9, maxZoom: 17 });
    expect([MAP_MIN_ZOOM, MAP_MAX_ZOOM]).toEqual([9, 17]);
  });
  it('stops zooming out at the lowest saved zoom (z10) with no signal', () => {
    expect(zoomLimits({ online: false })).toEqual({ minZoom: SAVED_ZOOMS[0], maxZoom: 17 });
    expect(SAVED_ZOOMS[0]).toBe(10);
  });
  it('lets the map zoom in past the z14 vector tiles (overzoom) and stays in line with the style', () => {
    expect(MAP_MAX_ZOOM).toBeGreaterThan(SOURCE_MAX_ZOOM);
    const src = swissStyle('https://example.test/{z}/{x}/{y}.pbf').sources.omt as { maxzoom: number };
    expect(src.maxzoom).toBe(SOURCE_MAX_ZOOM);
    expect(SAVED_ZOOMS[1]).toBe(SOURCE_MAX_ZOOM);
  });
});

describe('zoom buttons', () => {
  it('step in and out', () => {
    const m = fake(12);
    zoomStep(m, 1, 0); expect(m.zoomTo).toHaveBeenLastCalledWith(13, { duration: 200 });
    zoomStep(m, -1, 1000); expect(m.zoomTo).toHaveBeenLastCalledWith(11, { duration: 200 });
  });
  it('adds up quick taps and stops at the limits', () => {
    const m = fake(12);
    zoomStep(m, -1, 0); zoomStep(m, -1, 100); zoomStep(m, -1, 200); zoomStep(m, -1, 300);
    expect(m.zoomTo).toHaveBeenLastCalledWith(9, { duration: 200 });
    const hi = fake(16.5);
    zoomStep(hi, 1, 0); expect(hi.zoomTo).toHaveBeenLastCalledWith(17, { duration: 200 });
  });
  it('report the limits so a button can be greyed', () => {
    expect(atZoomLimit(fake(9))).toEqual({ min: true, max: false });
    expect(atZoomLimit(fake(17))).toEqual({ min: false, max: true });
    expect(atZoomLimit(fake(13))).toEqual({ min: false, max: false });
    expect(atZoomLimit(fake(10, 10, 17)).min).toBe(true);
  });
});

describe('follow mode', () => {
  it('breaks on a drag only, never on zoom', () => {
    expect(breaksFollow('dragstart')).toBe(true);
    for (const e of ['zoomstart', 'zoom', 'zoomend', 'moveend', 'rotate', 'pitch'] as const) expect(breaksFollow(e)).toBe(false);
  });
});
