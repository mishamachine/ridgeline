import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { RICH_INDEX, richCell } from './fixtures';

// The map pass: free pinch and pan (no "use two fingers"), full-screen trail map, the north arrow, follow-me (centre, heading-up, off),
// the scale bar in the units setting, and one control stack that stays clear of the map credit.
// Map servers are stubbed with empty tiles. Screenshots at phone width go to test-results/map-pass/.
const OUT = 'test-results/map-pass';
const TRAIL = '/trail/osm-r5588030?ll=-121.7717,47.4356';
test.use({ viewport: { width: 375, height: 740 } });

type M = { getBearing(): number; setBearing(b: number): void; getZoom(): number; jumpTo(o: unknown): void; querySourceFeatures(s: string): unknown[]; getPitch(): number };
const map = <T,>(page: Page, f: (m: M) => T) => page.evaluate(`(${f.toString()})(window.__ridgelineMap)`) as Promise<T>;
const settle = (page: Page) => page.waitForTimeout(500);

async function setup(page: Page, context: BrowserContext, settings: Record<string, unknown> = {}) {
  await context.route('https://tiles.openfreemap.org/**', (route) => route.fulfill(route.request().url().endsWith('/planet')
    ? { json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } }
    : { status: 200, contentType: 'application/x-protobuf', body: '' }));
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: RICH_INDEX }));
  await page.route(/\/trails\/\d+_\d+\.json$/, (route) => route.fulfill({ json: richCell() }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [] } }));
  await page.addInitScript((s) => { try { localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true, voice: false, ...s })); } catch { /* ignore */ } }, settings);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Every visible control in the scope is 44 px or more, and none covers the map credit. */
async function checkStack(page: Page, scope: string) {
  const attr = page.locator(`${scope} .maplibregl-ctrl-attrib`).first();
  await expect(attr).toBeVisible({ timeout: 20_000 });
  const a = (await attr.boundingBox())!;
  const bad = await page.locator(`${scope} .map-stack button:visible`).evaluateAll((els, ar) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { el: el.getAttribute('aria-label'), small: r.width < 43.5 || r.height < 43.5, hit: r.left < ar.x + ar.w && r.right > ar.x && r.top < ar.y + ar.h && r.bottom > ar.y };
  }).filter((x) => x.small || x.hit), { x: a.x, y: a.y, w: a.width, h: a.height });
  expect(bad, `controls under 44 px or over the credit in ${scope}`).toEqual([]);
}

/** A compass reading, as the phone's sensor would send it (alpha 270 = facing east). */
const sensor = (page: Page, alpha: number) => page.evaluate((a) => { const e = new Event('deviceorientationabsolute'); Object.assign(e, { absolute: true, alpha: a }); window.dispatchEvent(e); }, alpha);

test('Detail: no two-finger overlay, rotate shows the north arrow, which resets north; full screen opens and closes', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto(TRAIL);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('.maplibregl-cooperative-gesture-screen').count()).toBe(0);
  await expect(page.getByText(/two fingers/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset the map to north' })).toHaveCount(0);
  await checkStack(page, '.trail-map');
  await settle(page);
  const before = await map(page, (m) => m.getBearing());
  expect(before).toBe(0);
  // A one-finger drag pans the map and does not scroll the page.
  const m0 = (await page.locator('.trail-map .map').boundingBox())!;
  const c0 = await map(page, (m) => { const c = (m as unknown as { getCenter(): { lng: number } }).getCenter(); return c.lng; });
  await page.mouse.move(m0.x + 120, m0.y + 150); await page.mouse.down(); await page.mouse.move(m0.x + 200, m0.y + 190, { steps: 8 }); await page.mouse.up(); await settle(page);
  expect(Math.abs((await map(page, (m) => (m as unknown as { getCenter(): { lng: number } }).getCenter().lng)) - c0)).toBeGreaterThan(0);
  expect(await page.locator('.trail-scroll').evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: 'Fit trail' })).toBeVisible(); // the drag counts as moving
  await page.getByRole('button', { name: 'Fit trail' }).click(); await settle(page);
  await map(page, (m) => m.setBearing(50));
  const compass = page.getByRole('button', { name: 'Reset the map to north' });
  await expect(compass).toBeVisible();
  await checkStack(page, '.trail-map');
  const share = (await page.locator('.trail-actions').boundingBox())!, stack = (await page.locator('.trail-map .map-stack').boundingBox())!;
  expect(stack.y, 'the tallest stack (with the north arrow) stays below Share and Save').toBeGreaterThanOrEqual(share.y + share.height);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/detail-rotated-375.png` });
  await compass.click(); await settle(page);
  expect(Math.abs(await map(page, (m) => m.getBearing()))).toBeLessThan(0.5);
  await expect(compass).toHaveCount(0);
  // Full screen.
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  const box = (await page.locator('.trail-map').boundingBox())!;
  expect(box.x).toBe(0); expect(box.y).toBe(0); expect(Math.round(box.width)).toBe(375); expect(Math.round(box.height)).toBe(740);
  await checkStack(page, '.trail-map');
  await page.screenshot({ path: `${OUT}/detail-fullscreen-375.png` });
  await page.getByRole('button', { name: 'Close full screen map' }).click(); await settle(page);
  expect((await page.locator('.trail-map').boundingBox())!.height).toBeLessThan(400);
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  await page.getByRole('button', { name: 'Back to the trail page' }).click(); await settle(page); // in-page Back leaves full screen, not the trail
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await page.getByRole('button', { name: 'Full screen map' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Full screen map' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Detail: Back closes full screen and stays on the trail page; Close and Escape leave no extra history entry', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto('/');
  await page.goto(TRAIL);
  await expect(page.getByRole('button', { name: 'Full screen map' })).toBeVisible({ timeout: 20_000 });
  const fullBox = async () => Math.round((await page.locator('.trail-map').boundingBox())!.height);
  // Browser / hardware / Android Back
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  expect(await fullBox()).toBe(740);
  await page.goBack(); await settle(page);
  await expect(page).toHaveURL(/\/trail\//);
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  expect(await fullBox()).toBeLessThan(400);
  // A double tap on Close, or a held Escape, must not pop twice and leave the trail page.
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  await page.getByRole('button', { name: 'Close full screen map' }).dblclick(); await settle(page);
  await expect(page).toHaveURL(/\/trail\//);
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  await page.keyboard.down('Escape'); await page.keyboard.down('Escape'); await page.keyboard.down('Escape'); await page.keyboard.up('Escape'); await settle(page);
  await expect(page).toHaveURL(/\/trail\//);
  await expect(page.getByRole('heading', { name: 'Rattlesnake Ledge Trail' })).toBeVisible();
  // Close button, then Escape: each leaves nothing behind, so one more Back leaves the trail page.
  for (const how of ['close', 'escape'] as const) {
    await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
    if (how === 'close') await page.getByRole('button', { name: 'Close full screen map' }).click(); else await page.keyboard.press('Escape');
    await settle(page);
    await expect(page).toHaveURL(/\/trail\//);
    expect(await fullBox()).toBeLessThan(400);
    expect(await page.evaluate(() => (history.state as { mapFull?: boolean } | null)?.mapFull ?? false), `${how}: the page's own history entry is current`).toBe(false);
  }
  await page.goBack(); await settle(page);
  await expect(page).not.toHaveURL(/\/trail\//); // one Back from the trail page goes to where we came from
  expect(errors).toEqual([]);
});

test('Detail wheel: inline, the plain wheel scrolls the page and Ctrl+wheel zooms; full screen, the plain wheel zooms', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto(TRAIL);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const box = (await page.locator('.trail-map .map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const z0 = await map(page, (m) => m.getZoom());
  await page.mouse.move(x, y); await page.mouse.wheel(0, 300); await settle(page);
  expect(await map(page, (m) => m.getZoom())).toBeCloseTo(z0, 1);
  expect(await page.locator('.trail-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('.trail-scroll').evaluate((el) => { el.scrollTop = 0; }); await settle(page);
  await page.mouse.move(x, y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control'); await settle(page);
  expect(await map(page, (m) => m.getZoom())).toBeGreaterThan(z0 + 0.05);
  const z1 = await map(page, (m) => m.getZoom());
  await page.getByRole('button', { name: 'Full screen map' }).click(); await settle(page);
  await page.mouse.move(375 / 2, 740 / 2); await page.mouse.wheel(0, -300); await settle(page);
  expect(await map(page, (m) => m.getZoom())).toBeGreaterThan(z1 + 0.05);
  expect(errors).toEqual([]);
});

test('scale bar follows the units setting (miles by default, km when metric)', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.goto(TRAIL);
  const scale = page.locator('.trail-map .maplibregl-ctrl-scale');
  await expect(scale).toBeVisible({ timeout: 20_000 });
  await expect(scale).toHaveText(/\d\s?(ft|mi)$/);
  expect(errors).toEqual([]);
});
test.describe('metric', () => {
  test('scale bar shows m and km', async ({ page, context }) => {
    const errors = await setup(page, context, { units: 'metric' });
    await page.goto(TRAIL);
    const scale = page.locator('.trail-map .maplibregl-ctrl-scale');
    await expect(scale).toBeVisible({ timeout: 20_000 });
    await expect(scale).toHaveText(/\d\s?(m|km)$/);
    expect(errors).toEqual([]);
  });
});

/** Headless Chromium has no orientation API: this gives the page one, like a phone's. `answer` is what iOS's permission dialog would say (undefined: no dialog, as on Android). */
const withSensor = (page: Page, answer?: 'granted' | 'denied') => page.addInitScript((a) => {
  class Orientation extends Event {}
  if (a) (Orientation as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => Promise.resolve(a);
  (window as unknown as { DeviceOrientationEvent: unknown }).DeviceOrientationEvent = Orientation;
}, answer);

async function startHike(page: Page) {
  await page.goto(TRAIL);
  await page.getByRole('button', { name: 'Start hike' }).click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 40_000 });
  return page.locator('.nv-map .follow-btn');
}

test('Navigate: follow button goes centre, heading-up, off; the north arrow leaves heading-up', async ({ page, context }) => {
  const errors = await setup(page, context);
  await withSensor(page, 'granted'); // iOS style: asks once, from the tap
  const follow = await startHike(page);
  await checkStack(page, '.nv-map');
  await expect(follow).toHaveAttribute('data-follow', 'centre'); // a hike starts centred on you
  await follow.click(); await sensor(page, 270); // tap 2, then the sensor answers (facing east)
  await expect(follow).toHaveAttribute('data-follow', 'heading');
  for (const a of [268, 266, 270, 270, 270]) { await page.waitForTimeout(120); await sensor(page, a); }
  await expect.poll(() => map(page, (m) => m.getBearing()), { timeout: 5000 }).toBeGreaterThan(60);
  await expect.poll(() => map(page, (m) => m.querySourceFeatures('me-heading').length), { timeout: 5000 }).toBeGreaterThan(0); // the cone on the dot
  await expect(page.getByRole('button', { name: 'Reset the map to north' })).toBeVisible();
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/navigate-heading-375.png` });
  await checkStack(page, '.nv-map');
  // The north arrow ends heading-up (centring stays on) and turns the map back to north.
  await page.getByRole('button', { name: 'Reset the map to north' }).click();
  await expect(follow).toHaveAttribute('data-follow', 'centre');
  await sensor(page, 200); await settle(page);
  expect(Math.abs(await map(page, (m) => m.getBearing()))).toBeLessThan(1);
  await follow.click(); await sensor(page, 270); // heading-up again, then tap 3: off
  await expect(follow).toHaveAttribute('data-follow', 'heading');
  await follow.click();
  await expect(follow).toHaveAttribute('data-follow', 'off');
  await expect(follow).toHaveAccessibleName('Follow my location');
  await expect(follow).toHaveAccessibleDescription(/Off\. Tap to centre on you/);
  expect(errors).toEqual([]);
});

test('Navigate: compass permission denied keeps centring, with a short note', async ({ page, context }) => {
  const errors = await setup(page, context);
  await withSensor(page, 'denied');
  const follow = await startHike(page);
  await follow.click();
  await expect(page.getByText(/Compass is off for this app/)).toBeVisible({ timeout: 5000 });
  await expect(follow).toHaveAttribute('data-follow', 'centre');
  expect(await map(page, (m) => m.getBearing())).toBe(0);
  expect(errors).toEqual([]);
});

test('Navigate: no compass on the device keeps centring, with a short note', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.addInitScript(() => { Object.defineProperty(window, 'DeviceOrientationEvent', { value: undefined, configurable: true }); }); // a browser with no orientation API
  const follow = await startHike(page);
  await follow.click();
  await expect(page.getByText(/No compass on this device/)).toBeVisible({ timeout: 5000 });
  await expect(follow).toHaveAttribute('data-follow', 'centre');
  expect(errors).toEqual([]);
});

test('Navigate: a sensor that never answers gives up after a moment and stays centred', async ({ page, context }) => {
  const errors = await setup(page, context);
  await withSensor(page); // the API exists but no reading comes
  const follow = await startHike(page);
  await follow.click();
  await expect(follow).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText(/No compass on this device/)).toBeVisible({ timeout: 6000 });
  await expect(follow).toHaveAttribute('data-follow', 'centre');
  expect(errors).toEqual([]);
});

test('Navigate: on the trail the distance left shows once (the sheet), with no extra chip', async ({ page, context }) => {
  const errors = await setup(page, context);
  await context.setGeolocation({ latitude: 47.43564, longitude: -121.77165, accuracy: 12 });
  await startHike(page);
  const chip = page.locator('.nv-map .nv-trail');
  await expect(page.locator('.nv-stats')).toContainText(/\d.*(mi|ft)\s*to go/, { timeout: 40_000 }); // the distance left is in the sheet, once
  await expect(page.getByText(/GPS \w+ ±39 ft/).first()).toBeVisible(); // the chip shows the fix's real accuracy (12 m), not a fixed number
  await expect(chip, 'no extra "left" chip on the trail').toHaveCount(0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/navigate-ontrail-375.png` });
  expect(errors).toEqual([]);
});

const trailhead = { latitude: 47.43564, longitude: -121.77165 };
const east = (m: number) => ({ ...trailhead, longitude: trailhead.longitude + m / (111320 * Math.cos((47.4356 * Math.PI) / 180)) });

test('Navigate: no "Off the trail" chip while you have not reached the trail yet', async ({ page, context }) => {
  const errors = await setup(page, context);
  await context.setGeolocation(east(700)); // starts far from the trail
  await startHike(page);
  await page.waitForTimeout(4000);
  await expect(page.locator('.nv-map .nv-trail'), 'the "to the trail" banner is enough before you have joined it').toHaveCount(0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/navigate-before-trail-375.png` });
  expect(errors).toEqual([]);
});

test('Navigate: once you have been on the trail, walking more than about 50 m off it shows "Off the trail"', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await context.setGeolocation(trailhead);
  await startHike(page);
  const chip = page.locator('.nv-map .nv-trail');
  await expect(page.locator('.nv-stats')).toContainText(/to go/, { timeout: 40_000 });
  await expect(chip).toHaveCount(0); // on the trail: no chip
  for (let m = 10; m <= 120; m += 10) { await context.setGeolocation(east(m)); await page.waitForTimeout(1000); } // walks away in small steps
  await expect(chip).toContainText('Off the trail', { timeout: 30_000 });
  await expect(chip).toContainText('left');
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/navigate-offtrail-375.png` });
  expect(errors).toEqual([]);
});

test('Find: the locate button follows you, with a dot on the map, then heading-up, then off', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await withSensor(page, 'granted');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the map/ }).click();
  const locate = page.getByRole('button', { name: 'Follow my location' });
  await expect(locate).toBeVisible({ timeout: 30_000 });
  await checkStack(page, '.find-body');
  await locate.click();
  const follow = page.locator('.find-body .follow-btn');
  await expect(follow).toHaveAttribute('data-follow', 'centre');
  await expect.poll(() => map(page, (m) => m.querySourceFeatures('me').length), { timeout: 20_000 }).toBeGreaterThan(0);
  await follow.click(); await sensor(page, 270); // alpha 270 = facing east (heading 90)
  await expect(follow).toHaveAttribute('data-follow', 'heading');
  for (const a of [270, 269, 270, 270]) { await page.waitForTimeout(700); await sensor(page, a); } // a phone sends readings all the time
  await expect.poll(() => map(page, (m) => m.getBearing()), { timeout: 5000 }).toBeGreaterThan(60); // 90 degrees facing: the map turns toward it (smoothed)
  await expect.poll(() => map(page, (m) => m.querySourceFeatures('me-heading').length), { timeout: 5000 }).toBeGreaterThan(0); // the cone
  await expect(page.locator('.count')).not.toContainText('Loading', { timeout: 60_000 }); // trails are in
  await page.waitForTimeout(1500); await page.evaluate(() => new Promise((r) => { const m = (window as unknown as { __ridgelineMap: { once(e: string, f: () => void): void; loaded(): boolean } }).__ridgelineMap; if (m.loaded()) r(null); else m.once('idle', () => r(null)); })); // tiles and the cone are drawn
  await page.screenshot({ path: `${OUT}/find-heading-375.png` });
  await checkStack(page, '.find-body');
  await follow.click();
  await expect(follow).toHaveAttribute('data-follow', 'off');
  expect(errors).toEqual([]);
});

/** Counts the geolocation watches still running, and the trail-cell requests, so a test can see Find stop watching and reload. */
async function spyWatches(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __watches: Set<number> };
    w.__watches = new Set();
    const g = navigator.geolocation, wp = g.watchPosition.bind(g), cw = g.clearWatch.bind(g);
    g.watchPosition = (a, b, c) => { const id = wp(a, b, c); w.__watches.add(id); return id; };
    g.clearWatch = (id) => { w.__watches.delete(id); cw(id); };
  });
}
const watches = (page: Page) => page.evaluate(() => (window as unknown as { __watches: Set<number> }).__watches.size);

test('Find: Locate loads trails for where it lands; following reloads only after about 2 km', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  // The page's own fetch calls for trail cells are counted (the service worker may answer them from its cache, so the network would hide them).
  await page.addInitScript(() => {
    const w = window as unknown as { __cellFetches: number }; w.__cellFetches = 0;
    const f = window.fetch.bind(window);
    window.fetch = (input, init) => { if (/\/trails\/\d+_\d+\.json/.test(String(input instanceof Request ? input.url : input))) w.__cellFetches++; return f(input, init); };
  });
  const cellCount = () => page.evaluate(() => (window as unknown as { __cellFetches: number }).__cellFetches);
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the map/ }).click();
  const follow = page.locator('.find-body .follow-btn');
  await expect(follow).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled({ timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { __ridgelineMap?: unknown }).__ridgelineMap);
  await map(page, (m) => (m as unknown as { jumpTo(o: unknown): void }).jumpTo({ center: [-122.4, 47.9], zoom: 12 })); // far from the geolocation
  await settle(page);
  const before = await cellCount();
  await follow.click();
  await expect.poll(cellCount, { timeout: 20_000 }).toBeGreaterThan(before); // Locate loaded the trails where it landed
  await expect.poll(() => map(page, (m) => m.getZoom()), { timeout: 5000 }).toBeCloseTo(13, 0); // and ended at the old Near me level, zoom 13
  await page.waitForTimeout(4000); // the arrival load (and the location watch's first fix) settle
  const afterLocate = await cellCount();
  await context.setGeolocation({ latitude: 47.43564 + 0.004, longitude: -121.77165 }); // about 450 m: no reload
  await page.waitForTimeout(3000);
  expect(await cellCount()).toBe(afterLocate);
  await context.setGeolocation({ latitude: 47.43564 + 0.06, longitude: -121.77165 }); // about 6.7 km: reload
  await expect.poll(cellCount, { timeout: 20_000 }).toBeGreaterThan(afterLocate);
  expect(errors).toEqual([]);
});

test('Find: following stops (location watch and compass) when the list view or another tab is showing', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await spyWatches(page);
  await withSensor(page, 'granted');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the map/ }).click();
  const follow = page.locator('.find-body .follow-btn');
  await expect(follow).toBeVisible({ timeout: 30_000 });
  await follow.click();
  await expect.poll(() => watches(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /List/ }).click(); // list view
  await expect.poll(() => watches(page), { timeout: 10_000 }).toBe(0);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /Map/ }).click();
  await expect(page.locator('.find-body .follow-btn')).toHaveAttribute('data-follow', 'off');
  await page.locator('.find-body .follow-btn').click();
  await expect.poll(() => watches(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.locator('.tabbar2').getByRole('button', { name: 'Home' }).click(); // another tab: Find stays mounted but hidden
  await expect.poll(() => watches(page), { timeout: 10_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test.describe('outside the hosted area', () => {
  test.use({ serviceWorkers: 'block' }); // so the page's own requests are the ones the test routes
  test('Find: following outside the areas we host makes no Overpass request; "Load trails here" makes exactly one', async ({ page, context }) => {
    test.setTimeout(120_000);
    const errors = await setup(page, context);
    let overpass = 0;
    await context.route(/overpass/, (route) => { overpass++; return route.fulfill({ json: { elements: [] } }); });
    await context.setGeolocation({ latitude: 47.99, longitude: -121.77165 }); // inside the hosted area (it ends at 48.0 north)
    await page.goto('/');
    await page.getByRole('button', { name: /Explore the map/ }).click();
    const follow = page.locator('.find-body .follow-btn');
    await expect(follow).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled({ timeout: 30_000 });
    await follow.click();
    await page.waitForTimeout(5000);
    await expect(page.getByRole('button', { name: 'Load trails here' })).toHaveCount(0); // inside: hosted cells, no button
    const base = overpass; // the app's own first load may have asked Overpass before we started following; follow itself must add none
    await context.setGeolocation({ latitude: 48.03, longitude: -121.77165 }); // about 4.4 km north: the view is now wholly outside the hosted area
    await expect(page.getByRole('button', { name: 'Load trails here' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect(overpass, 'follow-driven moves never call Overpass outside coverage').toBe(base);
    await page.screenshot({ path: `${OUT}/find-load-here-375.png` });
    await page.getByRole('button', { name: 'Load trails here' }).click();
    await expect.poll(() => overpass, { timeout: 20_000 }).toBe(base + 1);
    await page.waitForTimeout(2000);
    expect(overpass).toBe(base + 1); // exactly one request
    expect(errors).toEqual([]);
  });

  /** Starts Find following at `lat` (the hosted area ends at 48.0 north) with every Overpass request counted. */
  async function followAt(page: Page, context: BrowserContext, lat: number) {
    const errors = await setup(page, context);
    const o = { n: 0 };
    await context.route(/overpass/, (route) => { o.n++; return route.fulfill({ json: { elements: [] } }); });
    await context.setGeolocation({ latitude: lat, longitude: -121.77165 });
    await page.goto('/');
    await page.getByRole('button', { name: /Explore the map/ }).click();
    const follow = page.locator('.find-body .follow-btn');
    await expect(follow).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled({ timeout: 30_000 });
    await follow.click();
    await page.waitForTimeout(5000);
    await expect(follow).toHaveAttribute('data-follow', 'centre');
    return { errors, o };
  }
  async function zoomTwoWays(page: Page) {
    const box = (await page.locator('.find-map .map').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); // a pinch arrives as Ctrl + wheel
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Zoom out' }).click(); // the zoom buttons
    await page.waitForTimeout(2500);
  }

  test('Find: following outside the areas we host, a pinch (Ctrl+wheel) and a zoom-button tap make no Overpass request', async ({ page, context }) => {
    test.setTimeout(120_000);
    const { errors, o } = await followAt(page, context, 47.99);
    await context.setGeolocation({ latitude: 48.03, longitude: -121.77165 }); // now wholly outside the hosted area
    await expect(page.getByRole('button', { name: 'Load trails here' })).toBeVisible({ timeout: 30_000 });
    const base = o.n;
    await zoomTwoWays(page);
    expect(o.n, 'zooming while following never reaches a public server').toBe(base);
    expect(errors).toEqual([]);
  });

  test('Find: turning follow off within 1.5 s of a zoom outside the hosted area still makes no Overpass request', async ({ page, context }) => {
    test.setTimeout(120_000);
    await withSensor(page, 'granted');
    const { errors, o } = await followAt(page, context, 47.99);
    await context.setGeolocation({ latitude: 48.03, longitude: -121.77165 }); // now wholly outside the hosted area
    await expect(page.getByRole('button', { name: 'Load trails here' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    const base = o.n;
    // A zoom-button tap is the gesture that schedules a map reload here (a Ctrl+wheel zoom in desktop Chromium does not, so it cannot show the bug).
    await page.getByRole('button', { name: 'Zoom out' }).click();
    const follow = page.locator('.find-body .follow-btn');
    await follow.click(); await sensor(page, 270);          // heading-up
    await expect(follow).toHaveAttribute('data-follow', 'heading');
    await follow.click();                                    // off, before the reload timer fires
    await expect(follow).toHaveAttribute('data-follow', 'off');
    await page.waitForTimeout(3500);                         // well past the 1.5 s reload delay
    expect(o.n, 'the reload was decided when the zoom happened, while following').toBe(base);
    expect(errors).toEqual([]);
  });

  test('Find: following with the view only partly over the hosted area makes no Overpass request', async ({ page, context }) => {
    test.setTimeout(120_000);
    const { errors, o } = await followAt(page, context, 47.99); // the view reaches past 48.0 north
    const base = o.n;
    await zoomTwoWays(page);
    expect(o.n).toBe(base);
    expect(errors).toEqual([]);
  });
});
