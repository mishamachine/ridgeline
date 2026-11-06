import { describe, expect, it } from 'vitest';
import { haversine } from './geo';
import { HikeSummary } from './hype';
import { CARD_SIZES, CardOptions, DEM_CREDIT, Measure, Op, OSM_CREDIT, STORY_SAFE, TRIM_M, cardDate, layoutCard, projectRoute, qrModules, routeForCard, trimTrack } from './shareCard';
import { SITE_HOST } from './shareLinks';

const measure: Measure = (t, size) => t.length * size * 0.55;

// A walk north from a made-up point, one vertex every ~100 m.
const walk = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 47.5 + i * 0.0009, lon: -121.8 + Math.sin(i / 3) * 0.0004 }));
const summary = (over: Partial<HikeSummary> = {}): HikeSummary => ({
  trail: { id: 'osm-r123', name: 'Rattlesnake Ledge', highlights: ['Views'] },
  distanceM: 6115, climbFt: 1540, movingMs: 161 * 60000,
  startedAt: new Date(2026, 10, 7, 9, 0).getTime(), endedAt: new Date(2026, 10, 7, 12, 0).getTime(),
  highlightsHit: ['Views'], completedFraction: 1, track: walk(25), ...over,
});
const opts = (o: Partial<CardOptions> = {}): CardOptions => ({ format: 'story', showRoute: false, hideStart: true, ...o });
const texts = (ops: Op[]) => ops.flatMap((o) => (o.kind === 'text' ? [o] : []));
const has = (ops: Op[], kind: Op['kind']) => ops.some((o) => o.kind === kind);

describe('trimTrack', () => {
  const track = walk(25); // ~2.4 km
  const total = track.slice(1).reduce((a, p, i) => a + haversine([track[i].lon, track[i].lat], [p.lon, p.lat]), 0);
  it('drops the first and last 200 m', () => {
    const out = trimTrack(track);
    const d0 = haversine([track[0].lon, track[0].lat], out[0]);
    const dEnd = haversine([track.at(-1)!.lon, track.at(-1)!.lat], out.at(-1)!);
    expect(d0).toBeGreaterThan(TRIM_M - 2);
    expect(d0).toBeLessThan(TRIM_M + 2);
    expect(dEnd).toBeGreaterThan(TRIM_M - 2);
    expect(dEnd).toBeLessThan(TRIM_M + 2);
    // none of the first or last 200 m survives
    for (const p of out) {
      expect(haversine([track[0].lon, track[0].lat], p)).toBeGreaterThan(TRIM_M - 5);
      expect(haversine([track.at(-1)!.lon, track.at(-1)!.lat], p)).toBeGreaterThan(TRIM_M - 5);
    }
    expect(total).toBeGreaterThan(2000);
  });
  it('shows nothing when a hike is too short to hide the ends', () => {
    expect(trimTrack(walk(4))).toEqual([]); // ~300 m
    expect(trimTrack(walk(5))).toEqual([]); // ~400 m, nothing left
    expect(trimTrack(walk(1))).toEqual([]);
    expect(trimTrack([])).toEqual([]);
  });
  it('keeps the whole track when hide-start is off', () => {
    expect(routeForCard(track, false)).toHaveLength(track.length);
    expect(routeForCard(track, true).length).toBeLessThan(track.length);
  });
});

describe('projectRoute', () => {
  it('stays inside the rect and keeps the shape', () => {
    const rect = { x: 100, y: 200, w: 800, h: 500 };
    const pts = projectRoute(trimTrack(walk(25)), rect, 50);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(rect.x + 50 - 0.2);
      expect(x).toBeLessThanOrEqual(rect.x + rect.w - 50 + 0.2);
      expect(y).toBeGreaterThanOrEqual(rect.y + 50 - 0.2);
      expect(y).toBeLessThanOrEqual(rect.y + rect.h - 50 + 0.2);
    }
    expect(pts.length).toBeGreaterThan(5);
  });
  it('thins very long tracks', () => {
    const long = Array.from({ length: 5000 }, (_, i): [number, number] => [-121 + i * 1e-5, 47 + Math.sin(i / 50) * 1e-3]);
    expect(projectRoute(long, { x: 0, y: 0, w: 900, h: 500 }, 40).length).toBeLessThanOrEqual(241);
  });
});

describe('layoutCard: privacy', () => {
  it('draws no route by default, and no map credit', () => {
    const l = layoutCard({ summary: summary(), options: opts() }, measure);
    expect(l.routeShown).toBe(false);
    expect(has(l.ops, 'route')).toBe(false);
    expect(l.credits).toBe('');
  });
  it('draws the route only when asked, and credits OpenStreetMap', () => {
    const l = layoutCard({ summary: summary(), options: opts({ showRoute: true }) }, measure);
    expect(l.routeShown).toBe(true);
    expect(has(l.ops, 'route')).toBe(true);
    expect(l.credits).toContain(OSM_CREDIT);
    expect(texts(l.ops).some((t) => t.text.includes(OSM_CREDIT))).toBe(true);
  });
  it('falls back to no route when the hike is too short to hide the start', () => {
    const l = layoutCard({ summary: summary({ track: walk(5) }), options: opts({ showRoute: true }) }, measure);
    expect(l.routeShown).toBe(false);
    expect(has(l.ops, 'route')).toBe(false);
  });
  it('puts no coordinates or location text on the card', () => {
    const l = layoutCard({ summary: summary({ trail: { id: 'osm-r123', name: 'Rattlesnake Ledge', elevation: [300, 400, 500] } }), newBadge: { name: 'Ledge Sitter' }, badgeCount: 4, options: opts({ showRoute: true }) }, measure);
    const all = texts(l.ops).map((t) => t.text).join(' | ');
    expect(all).not.toMatch(/\d{2,3}\.\d{3,}/);
    expect(all).not.toMatch(/47\.5|121\.8/);
    for (const op of l.ops) if (op.kind === 'route') for (const [x, y] of op.points) { expect(x).toBeLessThan(2000); expect(y).toBeLessThan(2000); }
  });
  it('credits Copernicus DEM when an elevation profile is drawn', () => {
    const l = layoutCard({ summary: summary({ trail: { id: 'osm-r123', name: 'X', elevation: [300, 420, 560, 480] } }), options: opts() }, measure);
    expect(l.elevationShown).toBe(true);
    expect(l.credits).toContain(DEM_CREDIT);
    expect(l.credits).toContain(OSM_CREDIT);
  });
});

describe('layoutCard: content and layout', () => {
  for (const format of ['story', 'square'] as const) {
    const { w, h } = CARD_SIZES[format];
    const long = 'Mount Pilchuck Lookout via the Old Mountain Road and Back';
    for (const [label, s] of [['normal', summary()], ['long title', summary({ trail: { id: 'osm-w123456789-12', name: long } })]] as const) {
      it(`${format}, ${label}: fits, stays in bounds, has the footer`, () => {
        const l = layoutCard({ summary: s, newBadge: { name: 'Ledge Sitter' }, badgeCount: 4, options: opts({ format, showRoute: true }) }, measure);
        expect([l.w, l.h]).toEqual([w, h]);
        expect(l.hero.h).toBeGreaterThanOrEqual(format === 'story' ? 380 : 200);
        const t = texts(l.ops);
        for (const x of t) {
          expect(x.y).toBeLessThanOrEqual(h);
          expect(x.y - x.size).toBeGreaterThanOrEqual(0);
          if (format === 'story') {
            expect(x.y - x.size * 0.75).toBeGreaterThanOrEqual(h * STORY_SAFE - 4);
            expect(x.y).toBeLessThanOrEqual(h * (1 - STORY_SAFE) + 4);
          }
        }
        expect(t.some((x) => x.text === 'Hike it yourself, free and offline')).toBe(true);
        expect(t.some((x) => x.text === SITE_HOST)).toBe(true);
        expect(t.some((x) => x.text === 'RIDGELINE')).toBe(true);
        expect(t.some((x) => x.text === 'New badge: Ledge Sitter')).toBe(true);
        expect(t.some((x) => x.text === '4 badges so far')).toBe(true);
        for (const x of t.filter((y) => y.align === 'left')) expect(x.x + measure(x.text, x.size, x.weight, x.family)).toBeLessThanOrEqual(w - 40);
        expect(has(l.ops, 'qr')).toBe(true);
      });
    }
  }
  it('real stats are on the card', () => {
    const l = layoutCard({ summary: summary(), options: opts() }, measure);
    const all = texts(l.ops).map((t) => t.text);
    expect(all).toContain('3.8');
    expect(all).toContain('1,540');
    expect(all).toContain('2:41');
    expect(all).toContain('Rattlesnake Ledge');
  });
  it('formats the date', () => {
    expect(cardDate(new Date(2026, 10, 7, 9).getTime())).toBe('Sat 7 Nov 2026');
  });
  it('omits the badge pill when there is no new badge', () => {
    const l = layoutCard({ summary: summary(), options: opts() }, measure);
    expect(texts(l.ops).some((t) => t.text.startsWith('New badge'))).toBe(false);
  });
});

describe('qrModules', () => {
  it('makes a real QR code with finder patterns', () => {
    const m = qrModules('https://hike.bobolearns.com/h/osm-r123');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    for (const [r, c] of [[0, 0], [0, 6], [6, 0], [6, 6], [2, 2], [3, 3]]) expect(m[r][c]).toBe(true);
    expect(m[1][1]).toBe(false);
    const n = m.length;
    expect(m[0][n - 1]).toBe(true);
    expect(m[n - 1][0]).toBe(true);
  });
});
