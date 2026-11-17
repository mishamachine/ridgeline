import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { RICH_INDEX, richCell } from './fixtures';

// Zoom buttons on every map (Find, Detail, Navigate), the draggable Detail map, and the zoom limits offline.
// Map servers are stubbed with empty tiles; trail data is the real Rattlesnake Ledge cell (e2e/fixtures.ts).
// Screenshots at phone width go to test-results/map-zoom/ for a person to look at (CI uploads them).
const OUT = 'test-results/map-zoom';
const TRAIL = '/trail/osm-r5588030?ll=-121.7717,47.4356';
test.use({ viewport: { width: 375, height: 740 } });

type Win = { __ridgelineMap?: { getZoom(): number; getCenter(): { lng: number; lat: number }; setZoom(z: number): void; getMinZoom(): number; getMaxZoom(): number } };
const zoom = (page: Page) => page.evaluate(() => (window as unknown as Win).__ridgelineMap!.getZoom());
const centre = (page: Page) => page.evaluate(() => { const c = (window as unknown as Win).__ridgelineMap!.getCenter(); return [c.lng, c.lat]; });

/**
 * The OSM / OpenMapTiles credit: starts expanded (full text on load), and no control on the map (zoom buttons, Fit trail,
 * Locate, Center, More ...) overlaps it. `scope` is the map's wrapper element.
 */
async function checkAttribution(page: Page, scope: string, expanded: boolean) {
  const attr = page.locator(`${scope} .maplibregl-ctrl-attrib`).first();
  await expect(attr).toBeVisible({ timeout: 20_000 });
  if (expanded) {
    await expect(attr).toHaveClass(/maplibregl-compact-show/);
    for (const t of ['OpenFreeMap', '© OpenMapTiles', 'OpenStreetMap']) await expect(attr.getByText(t)).toBeVisible();
  }
  const a = (await attr.boundingBox())!;
  const hits = await page.locator(`${scope} button:visible`).evaluateAll((els, ar) => els
    .filter((el) => !el.closest('.maplibregl-ctrl-attrib'))
    .map((el) => { const r = el.getBoundingClientRect(); return { el: (el.getAttribute('aria-label') || el.textContent || '').trim(), hit: r.left < ar.x + ar.w && r.right > ar.x && r.top < ar.y + ar.h && r.bottom > ar.y }; })
    .filter((x) => x.hit).map((x) => x.el), { x: a.x, y: a.y, w: a.width, h: a.height });
  expect(hits, `controls covering the map credit in ${scope}`).toEqual([]);
}
const settle = (page: Page) => page.waitForTimeout(500);

async function setup(page: Page, context: import('@playwright/test').BrowserContext) {
  await context.route('https://tiles.openfreemap.org/**', (route) => route.fulfill(route.request().url().endsWith('/planet')
    ? { json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } }
    : { status: 200, contentType: 'application/x-protobuf', body: '' }));
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: RICH_INDEX }));
  await page.route(/\/trails\/\d+_\d+\.json$/, (route) => route.fulfill({ json: richCell() }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [] } }));
  await page.addInitScript(() => { try { localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true, voice: false })); } catch { /* ignore */ } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Both buttons are there, labelled, at least 44 px, and a click changes the zoom. */
async function checkButtons(page: Page) {
  const zin = page.getByRole('button', { name: 'Zoom in' });
  const zout = page.getByRole('button', { name: 'Zoom out' });
  await expect(zin).toBeVisible({ timeout: 20_000 });
  await expect(zout).toBeVisible();
  for (const b of [zin, zout]) { const r = (await b.boundingBox())!; expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44); }
  await expect.poll(() => zoom(page)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as Win).__ridgelineMap!.setZoom(13));
  await settle(page);
  await zin.click(); await settle(page);
  expect(await zoom(page)).toBeCloseTo(14, 0);
  await zout.click(); await zout.click(); await settle(page);
  expect(await zoom(page)).toBeCloseTo(12, 0);
}

test('Find: zoom buttons sit above Locate, change the zoom and grey out at the limits', async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors = await setup(page, context);
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the map/ }).click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 20_000 });
  await checkAttribution(page, '.find-body', true);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/find-375.png` });
  await checkButtons(page);
  await checkAttribution(page, '.find-body', false);
  const zin = (await page.getByRole('button', { name: 'Zoom in' }).boundingBox())!;
  const zout = (await page.getByRole('button', { name: 'Zoom out' }).boundingBox())!;
  const loc = (await page.getByRole('button', { name: 'Go to my location' }).boundingBox())!;
  expect(zin.y + zin.height).toBeLessThanOrEqual(zout.y);
  expect(zout.y + zout.height).toBeLessThanOrEqual(loc.y);
  await page.evaluate(() => (window as unknown as Win).__ridgelineMap!.setZoom(17)); await settle(page);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await page.evaluate(() => (window as unknown as Win).__ridgelineMap!.setZoom(2)); await settle(page);
  expect(await zoom(page)).toBe(9);
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  await checkAttribution(page, '.find-body', false);
  // A selected trail opens a card over the bottom of the map: the credit must sit above it, not under it.
  type M = { jumpTo(o: unknown): void; querySourceFeatures(s: string): { geometry: { coordinates: number[][] } }[]; project(c: number[]): { x: number; y: number }; getContainer(): HTMLElement };
  await page.evaluate(() => (window as unknown as { __ridgelineMap: M }).__ridgelineMap.jumpTo({ center: [-121.7717, 47.4356], zoom: 13 }));
  await page.getByRole('button', { name: 'Zoom in' }).click(); // counts as moving, so "Search this area" shows
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ridgelineMap: M }).__ridgelineMap.querySourceFeatures('trails').length), { timeout: 20_000 }).toBeGreaterThan(0);
  await settle(page);
  const at = await page.evaluate(() => { const m = (window as unknown as { __ridgelineMap: M }).__ridgelineMap; const c = m.querySourceFeatures('trails')[0].geometry.coordinates; const p = m.project(c[Math.floor(c.length / 2)]); const r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.map-pick')).toBeVisible();
  await checkAttribution(page, '.find-body', false);
  const credit = (await page.locator('.find-body .maplibregl-ctrl-attrib').boundingBox())!;
  const cardBox = (await page.locator('.map-pick').boundingBox())!;
  expect(credit.y + credit.height, 'credit sits above the card').toBeLessThanOrEqual(cardBox.y);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/find-card-375.png` });
  expect(errors).toEqual([]);
});

test('Detail: zoom buttons, a draggable map, "Fit trail" only after moving, and the page still scrolls', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto(TRAIL);
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit trail' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 20_000 });
  await checkAttribution(page, '.trail-map', true);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/detail-375.png` });
  await checkButtons(page);
  await checkAttribution(page, '.trail-map', false);
  await page.getByRole('button', { name: 'Fit trail' }).click(); // zooming counts as moving
  await expect(page.getByRole('button', { name: 'Fit trail' })).toHaveCount(0);
  await settle(page);
  const z0 = await zoom(page), c0 = await centre(page);
  const box = (await page.locator('.trail-map .map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 30, { steps: 8 }); await page.mouse.up();
  await settle(page);
  const c1 = await centre(page);
  expect(Math.abs(c1[0] - c0[0]) + Math.abs(c1[1] - c0[1])).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Fit trail' })).toBeVisible();
  await checkAttribution(page, '.trail-map', false); // with Fit trail showing, after the map was dragged
  const attr = page.locator('.trail-map .maplibregl-ctrl-attrib');
  if (!(await attr.evaluate((el) => el.classList.contains('maplibregl-compact-show')))) await attr.locator('.maplibregl-ctrl-attrib-button').click(); // collapsed: the credit is still behind the (i)
  await expect(page.locator('.trail-map .maplibregl-ctrl-attrib').getByText('OpenStreetMap')).toBeVisible();
  await page.screenshot({ path: `${OUT}/detail-moved-375.png` });
  await page.getByRole('button', { name: 'Fit trail' }).click(); await settle(page);
  await expect(page.getByRole('button', { name: 'Fit trail' })).toHaveCount(0);
  expect(await zoom(page)).toBeCloseTo(z0, -1);
  // The wheel over the map scrolls the page (zooming needs Ctrl/Cmd), so the map is not a scroll trap.
  const z1 = await zoom(page);
  await page.mouse.move(x, y); await page.mouse.wheel(0, 300); await settle(page);
  expect(await zoom(page)).toBeCloseTo(z1, 1);
  expect(await page.locator('.trail-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Navigate: zoom buttons keep follow mode; a drag ends it; the sheet hides them', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto(TRAIL);
  await page.getByRole('button', { name: 'Start hike' }).click();
  await expect(page.getByText(/Directions are a guide/).first()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 40_000 });
  await checkAttribution(page, '.nv-map', true);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/navigate-375.png` });
  await checkButtons(page);
  await checkAttribution(page, '.nv-map', false);
  await expect(page.getByRole('button', { name: 'Center on me' })).toHaveCount(0); // still following after zooming
  const box = (await page.locator('.nv-map .map').boundingBox())!;
  const x = box.x + box.width / 3, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 40, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Center on me' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('offline: a saved trail map zooms in past the saved tiles and stops zooming out at z10, with no errors', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.goto(TRAIL);
  await page.getByRole('button', { name: /Save offline/ }).click();
  await expect(page.getByRole('button', { name: /Ready offline/ })).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => (window as unknown as Win).__ridgelineMap!.setZoom(17)); await settle(page);
  await page.evaluate(() => (window as unknown as Win).__ridgelineMap!.setZoom(2)); await settle(page);
  expect(await zoom(page)).toBe(10);
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  expect(errors).toEqual([]);
});
