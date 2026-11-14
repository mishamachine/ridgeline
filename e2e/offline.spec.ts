import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The preview build serves no hosted trail data, so Home gets small fixtures: the index and the real Rattlesnake Ledge cell
// (same shapes build_trails.py writes), and an empty-but-valid name index.
const ledgeCell = JSON.parse(readFileSync(new URL('../src/lib/fixtures/wa-cells.json', import.meta.url), 'utf8')).ledge[0];
const INDEX = { v: 1, built: '2026-11-06T00:00:00Z', source: 'e2e fixture', elevation: 'Copernicus DEM GLO-90', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] };

// The promise of the app: save a trail with a signal, lose the signal, and the trail page and Navigate still open.
// Runs on the production build, so it also proves the code-split chunks are in the service worker's precache.
test('Home loads no map; "Explore the map" shows it after the lazy map chunk loads, with no page errors', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill(route.request().url().endsWith('/planet')
    ? { json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } }
    : { status: 200, contentType: 'application/x-protobuf', body: '' }));
  await page.addInitScript(() => { try { localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true })); } catch { /* ignore */ } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: INDEX }));
  await page.route('**/trails/232_549.json', (route) => route.fulfill({ json: ledgeCell }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [] } }));
  const mapRequests: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith('https://tiles.openfreemap.org/')) mapRequests.push(r.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  // These tests run with location already granted (playwright.config.ts), so Home shows "near you" rows.
  await expect(page.getByRole('heading', { name: 'Top picks near you' })).toBeVisible({ timeout: 20_000 });
  expect(mapRequests).toEqual([]); // no map tiles until someone asks for the map
  await page.getByRole('button', { name: /Explore the map/ }).click();
  await expect(page.locator('.map canvas').first()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

const TRAIL = '/trail/osm-r5588030?ll=-121.7717,47.4356';

test('a saved trail opens offline, and Navigate loads from the cache', async ({ page, context }) => {
  // Map servers are stubbed (no network needed): tile JSON, empty tiles and label fonts.
  await context.route('https://tiles.openfreemap.org/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/planet')) return route.fulfill({ json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } });
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' });
  });
  await page.addInitScript(() => {
    try { if (!localStorage.getItem('ridgeline:settings')) localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true, voice: false })); } catch { /* ignore */ }
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Online: the app installs its service worker, the trail page loads, and the trail is saved offline.
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.goto(TRAIL);
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'ft gain' }).locator('.tile-num')).toHaveText(/^1,1\d\d$/); // one-way gain, about 1,135 ft (B-1), not 2,329
  await page.getByRole('button', { name: /Save offline/ }).click();
  await expect(page.getByRole('button', { name: /Ready offline/ })).toBeVisible({ timeout: 60_000 });
  // Navigate's chunk is fetched by the service worker's precache, not just when it is first opened.
  expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('workbox-precache')))).toBe(true);

  // Offline: reload straight into the trail page, then Navigate.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await page.getByRole('button', { name: 'Start hike' }).click();
  await expect(page.getByText('climb left')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Directions are a guide/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
