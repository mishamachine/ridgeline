import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });

import { parseRoute, routePath } from './route';
import { features } from './features';
import { endActivity, startActivity } from './finish';
import { computeBadges, newBadgesFor } from './badges';
import { toCelebrateSummary, buildSummary } from '../components/nav/summary';
import { onboardingCards } from '../screens/Onboarding';
import type { Activity } from './store';
import type { LngLat } from './geo';
import type { Trail } from './trails';

const coords: LngLat[] = Array.from({ length: 21 }, (_, k) => [-121.77, 47.43 + k * 0.0015]);
const trail: Trail = { id: 'osm-w1', name: 'Rattlesnake Ledge', coords, lengthM: 3300, loop: false, partial: false, osmUrl: 'https://www.openstreetmap.org/way/1', tags: {}, ascentM: 370, highlights: ['view', 'lake'] };
const walk = (): Activity => {
  const a = startActivity(trail, false);
  a.startedAt = new Date(2026, 10, 6, 9, 0).getTime();
  a.points = coords.map(([lon, lat], k) => ({ lon, lat, alt: 200 + k * 8, acc: 6, t: a.startedAt + k * 90_000 }));
  return a;
};

describe('routes', () => {
  it('Badges lives at /profile/badges, with and without a base path', () => {
    expect(parseRoute('/profile/badges', '')).toEqual({ kind: 'badges' });
    expect(parseRoute('/ridgeline/profile/badges/', '', '/ridgeline/')).toEqual({ kind: 'badges' });
    expect(routePath({ kind: 'badges' }, '/ridgeline/')).toBe('/ridgeline/profile/badges');
    expect(parseRoute('/profile', '')).toEqual({ kind: 'tab', tab: 'profile' });
  });
  it('/h/<id> is a landing page only when the celebrate flag is on', () => {
    const url = ['/h/osm-r123', '?d=3.8&c=1540&t=2:41'] as const;
    expect(parseRoute(url[0], url[1], '/', true)).toEqual({ kind: 'hike', id: 'osm-r123', stats: { miles: 3.8, climbFt: 1540, time: '2:41' } });
    expect(parseRoute(url[0], url[1], '/', false)).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/ridgeline/h/osm-r123', '', '/ridgeline/', true)).toMatchObject({ kind: 'hike', id: 'osm-r123' });
  });
  it('the flag is ON now the domain is live, and the default route follows it', () => {
    expect(features.celebrate).toBe(true);
    expect(parseRoute('/h/osm-r123', '?d=1')).toEqual({ kind: 'hike', id: 'osm-r123', stats: { miles: 1 } });
  });
  it('the privacy page describes sharing a hike and carries today\'s date', () => {
    const html = readFileSync('public/privacy/index.html', 'utf8');
    expect(html).toContain('<h2>Sharing a hike</h2>');
    expect(html).toContain('Last updated 14 November 2026');
    expect(html).toContain('first and last 200 m');
    expect(html).toContain('whether you finished');
  });
  it('the location wording says exact location, and what our host can tell', () => {
    const html = readFileSync('public/privacy/index.html', 'utf8');
    expect(html.match(/Your exact location, recorded hikes and saved trails stay on your device\./g)).toHaveLength(2);
    expect(html).toContain("Your exact location is never sent to our servers. To show trails near you, Ridgeline downloads trail data for the area around you, so our host can tell roughly which area (about 25 km across) you're in.");
    expect(html).toContain("browser type and pages loaded, and, from the trail files your device downloads, roughly which area (about 25 km across) you're looking at.");
    expect(html).not.toContain('Your location is never sent to our servers');
    const profile = readFileSync('src/screens/Profile.tsx', 'utf8');
    expect(profile).toContain("Your exact location is never sent to our servers. To show trails near you, Ridgeline downloads trail data for the area around you, so our host can tell roughly which area (about 25 km across) you're in.");
    expect(profile).toContain('Stays on your phone');
    expect(readFileSync('src/screens/Onboarding.tsx', 'utf8')).toContain("Your exact location stays on your phone. It\\'s never sent to our servers.");
  });
  it('refuses a bad hike id', () => {
    expect(parseRoute('/h/%E0%A4%A', '', '/', true)).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/h/a b', '', '/', true)).toEqual({ kind: 'tab', tab: 'find' });
    expect(parseRoute('/h/', '', '/', true)).toEqual({ kind: 'tab', tab: 'find' });
  });
  it('the host rewrite sends /h/<id> to the app (nothing excludes it)', () => {
    const ht = readFileSync('deploy/htaccess', 'utf8');
    const excl = /RewriteCond %\{REQUEST_URI\} !\^\/\(([^)]*)\)\//.exec(ht)![1].split('|');
    expect(excl).not.toContain('h');
    expect(ht).toContain('RewriteRule ^ /index.html [L]');
  });
});

describe('finishing a hike', () => {
  it('stores a trail snapshot on the activity, so badges do not need the saved trail', () => {
    const a = walk();
    expect(endActivity(a, trail, a.startedAt + 3_600_000)).toBe(true);
    expect(a.endedAt).toBe(a.startedAt + 3_600_000);
    expect(a.snapshot).toMatchObject({ name: 'Rattlesnake Ledge', ascentM: 370, highlights: ['view', 'lake'] });
    expect(a.snapshot!.coverage).toBeGreaterThan(0.9);
    // badges computed with NO trails still see the completed Washington classic
    const ids = computeBadges([a], []).filter((b) => b.earned).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['first-trail', 'ledge-sitter']));
  });
  it('a track with under two points is not saved and has no snapshot', () => {
    const a = startActivity(trail, false);
    a.points = [{ lon: 0, lat: 0, alt: null, acc: 5, t: 1 }];
    expect(endActivity(a, trail, 2)).toBe(false);
    expect(a.snapshot).toBeUndefined();
  });
  it('newBadgesFor lists only badges this hike earned', () => {
    const a = walk();
    endActivity(a, trail, a.startedAt + 3_600_000);
    expect(newBadgesFor(a, []).map((b) => b.id)).toEqual(expect.arrayContaining(['first-trail', 'ledge-sitter']));
    const b = { ...walk(), id: 'second', startedAt: a.startedAt + 86_400_000 };
    endActivity(b, trail, b.startedAt + 3_600_000);
    expect(newBadgesFor(b, [a]).map((x) => x.id)).not.toContain('first-trail');
  });
  it('new hikes start with a dog only when the setting is on', () => {
    expect(startActivity(trail, true).withDog).toBe(true);
    expect(startActivity(trail, false).withDog).toBeUndefined();
  });
  it('the celebration gets the hike in its own shape, with the track', () => {
    const a = walk();
    endActivity(a, trail, a.startedAt + 3_600_000);
    const sm = buildSummary({ trail, activity: a, endedAt: a.endedAt!, pausedMs: 0, elevation: undefined, total: 3000, startAlong: 0, maxAlong: 3000 });
    const c = toCelebrateSummary(sm);
    expect(c.trail).toMatchObject({ id: 'osm-w1', name: 'Rattlesnake Ledge' });
    expect(c.track).toHaveLength(a.points.length);
    expect(c.completedFraction).toBeGreaterThan(0.9);
    expect(Object.keys(c)).not.toContain('activity');
  });
});

describe('copy that follows the flags', () => {
  it('voice on, screen-off off: pocket wording is web-honest', () => {
    const forks = onboardingCards(features, true).find((c) => c.id === 'forks')!;
    expect(forks.body).toContain('Keep your phone in your pocket; Ridgeline keeps the screen on while you hike.');
    expect(forks.body).not.toMatch(/screen off/i);
  });
});
