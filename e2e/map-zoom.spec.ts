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

// Layout matrix: small and tall phones, with and without a notch. On every map, in its most crowded state (Find with a
// trail card open, the trail page after a drag so Fit trail shows, Navigate after a drag so Center shows), every control is
// inside the map, none overlaps another, none covers the credit, and none covers Navigate's turn banner.
const SIZES = [{ w: 320, h: 568 }, { w: 360, h: 640 }, { w: 390, h: 844 }];
const CASES = [...SIZES.map((s) => ({ ...s, safeTop: 0 })), { w: 390, h: 844, safeTop: 47 }, { w: 320, h: 568, safeTop: 47 }];
type R = { x: number; y: number; w: number; h: number };
const hit = (a: R, b: R) => a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5 && a.y < b.y + b.h - 0.5 && a.y + a.h > b.y + 0.5;

const inside = (a: R, b: R) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1; // a button nested in a card
async function layout(page: Page, scope: string, expandedAtLoad = false) {
  const attr = page.locator(`${scope} .maplibregl-ctrl-attrib`).first();
  if (expandedAtLoad) await expect(attr).toHaveClass(/maplibregl-compact-show/); // the credit starts expanded
  return page.evaluate((sc) => {
    const box = (el: Element): R => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const root = document.querySelector(sc)!;
    const controls = Array.from(root.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.closest('.maplibregl-ctrl-attrib'))
      .map((b) => ({ name: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), r: box(b) }));
    const banner = document.querySelector('.nv-banner');
    return { map: box(root), attr: box(root.querySelector('.maplibregl-ctrl-attrib')!), banner: banner ? box(banner) : null, controls };
  }, scope) as Promise<{ map: R; attr: R; banner: R | null; controls: { name: string; r: R }[] }>;
}

function assertLayout(l: Awaited<ReturnType<typeof layout>>) {
  for (const c of l.controls) {
    expect(c.r.x >= l.map.x - 1 && c.r.y >= l.map.y - 1 && c.r.x + c.r.w <= l.map.x + l.map.w + 1 && c.r.y + c.r.h <= l.map.y + l.map.h + 1, `${c.name} is inside the map`).toBe(true);
    expect(hit(c.r, l.attr), `${c.name} covers the credit`).toBe(false);
    if (l.banner) expect(hit(c.r, l.banner), `${c.name} covers the turn banner`).toBe(false);
  }
  for (let i = 0; i < l.controls.length; i++) for (let j = i + 1; j < l.controls.length; j++) if (!inside(l.controls[i].r, l.controls[j].r) && !inside(l.controls[j].r, l.controls[i].r)) expect(hit(l.controls[i].r, l.controls[j].r), `${l.controls[i].name} overlaps ${l.controls[j].name}`).toBe(false);
}

for (const c of CASES) {
  const tag = `${c.w}x${c.h}${c.safeTop ? ` safe-top ${c.safeTop}` : ''}`;
  test.describe(`layout ${tag}`, () => {
    test.use({ viewport: { width: c.w, height: c.h } });
    const notch = (page: Page) => c.safeTop ? page.addInitScript((v) => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `:root{--safe-top:${v}px !important}`; document.head.appendChild(s); }); }, c.safeTop) : Promise.resolve();

    test('trail page', async ({ page, context }) => {
      const errors = await setup(page, context); await notch(page);
      await page.goto(TRAIL);
      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 30_000 });
      assertLayout(await layout(page, '.trail-map', true)); // at load
      const box = (await page.locator('.trail-map .map').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 6 }); await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Fit trail' })).toBeVisible();
      assertLayout(await layout(page, '.trail-map')); // Fit trail showing
      expect(errors).toEqual([]);
    });

    test('Navigate', async ({ page, context }) => {
      const errors = await setup(page, context); await notch(page);
      await page.goto(TRAIL);
      await page.getByRole('button', { name: 'Start hike' }).click();
      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 40_000 });
      assertLayout(await layout(page, '.nv-map', true)); // following
      const box = (await page.locator('.nv-map .map').boundingBox())!;
      await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 3 + 70, box.y + box.height / 2 + 40, { steps: 14 }); await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Center on me' })).toBeVisible();
      assertLayout(await layout(page, '.nv-map')); // Center showing: the longest button stack
      expect(errors).toEqual([]);
    });

    test('Find, with a trail card open', async ({ page, context }) => {
      test.setTimeout(180_000);
      const errors = await setup(page, context); await notch(page);
      await page.goto('/');
      await page.getByRole('button', { name: /Explore the map/ }).click();
      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 30_000 });
      assertLayout(await layout(page, '.find-body', true));
      type M = { jumpTo(o: unknown): void; querySourceFeatures(s: string): { geometry: { coordinates: number[][] } }[]; project(c: number[]): { x: number; y: number }; getContainer(): HTMLElement };
      await page.evaluate(() => (window as unknown as { __ridgelineMap: M }).__ridgelineMap.jumpTo({ center: [-121.7717, 47.4356], zoom: 13 }));
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.getByRole('button', { name: 'Search this area' }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __ridgelineMap: M }).__ridgelineMap.querySourceFeatures('trails').length), { timeout: 20_000 }).toBeGreaterThan(0);
      await settle(page);
      const at = await page.evaluate(() => { const m = (window as unknown as { __ridgelineMap: M }).__ridgelineMap; const r = m.getContainer().getBoundingClientRect(); const pts = m.querySourceFeatures('trails').flatMap((f) => f.geometry.coordinates).map((c) => m.project(c)); const d = (p: { x: number; y: number }) => Math.hypot(p.x - r.width / 2, p.y - r.height / 2); const p = pts.reduce((a, b) => (d(b) < d(a) ? b : a)); return { x: r.left + p.x, y: r.top + p.y }; }); // the trail point nearest the middle of the map: a short map can have the middle of the trail off screen
      await page.mouse.click(at.x, at.y);
      await expect(page.locator('.map-pick')).toBeVisible();
      await settle(page);
      assertLayout(await layout(page, '.find-body'));
      expect(errors).toEqual([]);
    });
  });
}

// Short phones: on first load of Find's map, with nothing scrolled, the whole map sits above the tab bar, so the credit in its bottom
// right corner is fully on screen (the map used to have a 320 px minimum height, which pushed it under the tab bar below about 700 px).
for (const s of [{ w: 320, h: 568 }, { w: 360, h: 640 }, { w: 375, h: 667 }]) {
  test.describe(`credit above the tab bar ${s.w}x${s.h}`, () => {
    test.use({ viewport: { width: s.w, height: s.h } });
    test('Find map on first load', async ({ page, context }) => {
      const errors = await setup(page, context);
      await page.goto('/');
      await page.getByRole('button', { name: /Explore the map/ }).click();
      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 30_000 });
      const attr = page.locator('.find-body .maplibregl-ctrl-attrib');
      await expect(attr).toHaveClass(/maplibregl-compact-show/);
      const credit = (await attr.boundingBox())!;
      const tabs = (await page.locator('.tabbar2').boundingBox())!;
      const body = (await page.locator('.find-body').boundingBox())!;
      expect(credit.y, 'credit starts on screen').toBeGreaterThanOrEqual(0);
      expect(credit.x + credit.width, 'credit inside the width').toBeLessThanOrEqual(s.w + 0.5);
      expect(credit.y + credit.height, 'credit ends above the tab bar').toBeLessThanOrEqual(tabs.y + 0.5);
      expect(body.y + body.height, 'the whole map ends above the tab bar').toBeLessThanOrEqual(tabs.y + 0.5);
      expect(body.height, 'the map is still big enough to use').toBeGreaterThanOrEqual(150);
      expect(await page.locator('.screen').first().evaluate((el) => el.scrollTop), 'nothing scrolled').toBe(0);
      await checkAttribution(page, '.find-body', true);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/find-${s.w}x${s.h}.png` });
      expect(errors).toEqual([]);
    });
  });
}
