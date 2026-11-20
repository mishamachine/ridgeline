import { expect, test, type Page } from '@playwright/test';
import { RICH_INDEX, richCell } from './fixtures';

// Find: the list reloads by itself after a pan or zoom settles, and a tap on a basemap path that is not one of our trails answers.
// Map servers are stubbed with empty tiles; trail data is the real cell fixture (e2e/fixtures.ts).
test.use({ viewport: { width: 375, height: 740 } });

type M = { jumpTo(o: unknown): void; addSource(id: string, s: unknown): void; addLayer(l: unknown): void; removeLayer(id: string): void };
const map = (page: Page) => page.evaluate(() => (window as unknown as { __ridgelineMap: unknown }).__ridgelineMap !== undefined);

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

async function openMap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the map/ }).click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => map(page)).toBe(true);
}

test('Find: panning the map reloads the list by itself, with no "Search this area" button', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  const cellRequests: number[] = [];
  page.on('request', (r) => { if (/\/trails\/\d+_\d+\.json$/.test(r.url())) cellRequests.push(Date.now()); });
  await openMap(page);
  await expect.poll(() => cellRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);                       // the first load has finished
  const before = cellRequests.length;
  const box = (await page.locator('.find-map .map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const dragged = Date.now();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y + 50, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => cellRequests.length, { timeout: 5_000 }).toBeGreaterThan(before);   // reloaded without any tap
  expect(cellRequests.at(-1)! - dragged, 'waits for the map to settle (debounced)').toBeGreaterThanOrEqual(350);
  await expect(page.getByRole('button', { name: 'Search this area' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Find: tapping a basemap path that is not ours says so, with its name; never nothing', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await openMap(page);
  // The stubbed tiles are empty, so put one named path into the basemap "path" layer, away from our trails.
  await page.evaluate(() => {
    const m = (window as unknown as { __ridgelineMap: M }).__ridgelineMap;
    m.jumpTo({ center: [-122.0, 47.6], zoom: 14 });
    m.removeLayer('path');
    m.addSource('e2e-path', { type: 'geojson', data: { type: 'Feature', properties: { class: 'path', name: 'Test Rail Path' }, geometry: { type: 'LineString', coordinates: [[-122.02, 47.6], [-121.98, 47.6]] } } });
    m.addLayer({ id: 'path', type: 'line', source: 'e2e-path', paint: { 'line-color': '#444', 'line-width': 4 } });
  });
  await page.waitForTimeout(800);
  const box = (await page.locator('.find-map .map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const note = page.getByRole('status').filter({ hasText: /Not in Ridgeline.s trail list yet/ });
  await expect(note).toBeVisible();
  await expect(note).toContainText('Test Rail Path');
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note).toHaveCount(0);
  // Empty map (no path under the finger): no message.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 120);
  await expect(page.getByText(/Not in Ridgeline.s trail list yet/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
