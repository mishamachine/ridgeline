import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { RICH_INDEX, richCell } from './fixtures';

// Search lists a named path under the index id "osm-w<lowest way id>"; the cells build the same trail as "osm-w<lowest way id>-<n>".
// Opening the bare id must still open the trail. The fixture path is one of the six named paths cut from real ways (see fixtures.ts).
const PATH = richCell().w[0];
const NAME = PATH.t.name as string;
const BARE = `osm-w${PATH.id}`;
const [LON, LAT] = [PATH.g[0], PATH.g[1]];
test.use({ viewport: { width: 375, height: 740 }, serviceWorkers: 'block' });   // so the page's own requests are the ones the test routes

async function setup(page: Page, context: BrowserContext) {
  await context.route('https://tiles.openfreemap.org/**', (route) => route.fulfill(route.request().url().endsWith('/planet')
    ? { json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } }
    : { status: 200, contentType: 'application/x-protobuf', body: '' }));
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: RICH_INDEX }));
  await page.route(/\/trails\/\d+_\d+\.json$/, (route) => route.fulfill({ json: richCell() }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [[BARE, NAME, LON, LAT, 1100]] } }));
  await page.addInitScript(() => { try { localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true, voice: false })); } catch { /* ignore */ } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const opened = async (page: Page) => {
  await expect(page.getByRole('heading', { name: NAME }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Trail not found')).toHaveCount(0);
};

test('Search: tapping a named path whose index id is bare opens that trail', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await page.goto('/');
  const box = page.getByRole('combobox');
  await box.click();
  await box.fill(NAME.slice(0, 8));
  await page.getByRole('option', { name: new RegExp(NAME) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/trail/${BARE}`));   // the link carries the index id, as in production
  await opened(page);
  await expect(page).toHaveURL(new RegExp(`/trail/${BARE}-0`));   // and the address settles on the trail's own id
  expect(errors).toEqual([]);
});

test('An old link with the bare id opens the trail, with the location hint and without', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, context);
  await page.goto(`/trail/${BARE}?ll=${LON},${LAT}`);
  await opened(page);
  await page.goto(`/trail/${BARE}`);   // no hint: the name index supplies the place
  await opened(page);
  expect(errors).toEqual([]);
});
