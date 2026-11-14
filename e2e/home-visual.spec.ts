import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { LEDGE_CELL, LEDGE_INDEX, RICH_INDEX, richCell } from './fixtures';

// Home at 320, 375 and 414 px in four states, as screenshots for a person to look at (CI uploads test-results/home-visual/),
// plus two hard checks: no sideways scroll, and tap targets of at least 44 px. Same trail stubs as offline.spec.ts: the index and
// the real Rattlesnake Ledge cell; nothing else is fetched, and no request may go to the map provider.
// Two fixtures (e2e/fixtures.ts): the single real Ledge cell, and a "rich" merged file built from the six real slices in the repo
// (real geometry and heights, tags added so every row fills) behind a block of cells around Seattle and Snoqualmie.
const OUT = 'test-results/home-visual';
const WIDTHS = [320, 375, 414];

async function open(page: Page, rich = false) {
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: rich ? RICH_INDEX : LEDGE_INDEX }));
  await page.route(/\/trails\/\d+_\d+\.json$/, (route) => route.fulfill({ json: rich ? richCell() : LEDGE_CELL }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [] } }));
  const provider: string[] = [];
  page.on('request', (r) => { if (/openfreemap\.org/.test(r.url())) provider.push(r.url()); });
  await page.addInitScript(() => { try { localStorage.setItem('ridgeline:settings', JSON.stringify({ onboardingSeen: true })); } catch { /* ignore */ } });
  await page.goto('/');
  return provider;
}

/** The checks every state shares. */
async function check(page: Page, state: string, width: number, provider: string[]) {
  mkdirSync(OUT, { recursive: true });
  // The app scrolls inside its screen, not the document, so grow the window to the content height to capture all of it.
  const view = page.viewportSize()!;
  const content = await page.evaluate(() => (document.querySelector('.screen:not([hidden])') as HTMLElement | null)?.scrollHeight ?? 0);
  await page.setViewportSize({ width: view.width, height: Math.min(6000, Math.max(view.height, content + 90)) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${state}-${width}.png` });
  await page.setViewportSize(view);
  const sizes = await page.evaluate(() => {
    const de = document.documentElement;
    const hm = document.querySelector('.hm') as HTMLElement | null;
    const small = Array.from(document.querySelectorAll<HTMLElement>('.hm button, .hm input, .hm summary, .tab2'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { el: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((s) => s.w < 44 || s.h < 44);
    return { page: [de.scrollWidth, de.clientWidth], home: hm ? [hm.scrollWidth, hm.clientWidth] : null, small };
  });
  expect(sizes.page[0], 'page scrolls sideways').toBeLessThanOrEqual(sizes.page[1]);
  if (sizes.home) expect(sizes.home[0], 'Home scrolls sideways').toBeLessThanOrEqual(sizes.home[1]);
  expect(sizes.small, 'tap targets under 44 px').toEqual([]);
  // A button whose text colour matches its background has no visible label (the map button once did).
  for (const b of await page.locator('.hm button:visible').all()) {
    const c = await b.evaluate((el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, (el.textContent || '').trim().slice(0, 30)]; });
    if (c[2]) expect(c[0], `"${c[2]}" label colour vs its background`).not.toBe(c[1]);
  }
  const map = page.getByRole('button', { name: /Explore the map/ });
  if (await map.count()) expect(await map.evaluate((el) => getComputedStyle(el).color), 'map button label colour').toBe('rgb(255, 255, 255)');
  expect(provider, 'no request to the map provider from Home').toEqual([]);
}

for (const width of WIDTHS) {
  test.describe(`Home at ${width} px`, () => {
    test.use({ viewport: { width, height: 780 } });

    test.describe('state 1: first visit, location not asked', () => {
      test.use({ permissions: [] });
      test('shows the region start and one Use my location button', async ({ page }) => {
        // Headless Chromium answers "denied" when nothing was granted; a real first visit is "prompt".
        await page.addInitScript(() => { navigator.permissions.query = async () => ({ state: 'prompt', onchange: null }) as unknown as PermissionStatus; });
        const provider = await open(page);
        await expect(page.getByText('Your exact location never leaves this device.')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
        await expect(page.getByRole('heading', { name: /Top picks in Washington/ })).toBeVisible({ timeout: 20_000 });
        await check(page, '1-first-visit', width, provider);
      });
    });

    test('state 2: location granted, near you', async ({ page }) => {
      const provider = await open(page);
      await expect(page.getByRole('heading', { name: 'Top picks near you' })).toBeVisible({ timeout: 20_000 });
      await check(page, '2-near-you', width, provider);
    });

    test.describe('state 4: outside coverage', () => {
      test.use({ geolocation: { latitude: 30.27, longitude: -97.74 } });
      test('says we do not cover here and offers the covered region', async ({ page }) => {
        const provider = await open(page);
        await expect(page.getByRole('heading', { name: 'We don’t cover here yet' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'Show trails in Washington' })).toBeVisible();
        await check(page, '4-outside-coverage', width, provider);
      });
    });

    test('state 6: returning user, saved trail and a hike in progress', async ({ page, context }) => {
      await context.route('https://tiles.openfreemap.org/**', (route) => route.fulfill(route.request().url().endsWith('/planet')
        ? { json: { tiles: ['https://tiles.openfreemap.org/planet/20261101_000000_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } }
        : { status: 200, contentType: 'application/x-protobuf', body: '' }));
      await open(page);
      await expect(page.getByRole('heading', { name: 'Top picks near you' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /Rattlesnake Ledge Trail/ }).first().click();       // opens the trail page (in the app, no reload)
      await page.getByRole('button', { name: 'Save to Saved' }).click();
      await page.getByRole('button', { name: 'Start hike' }).click();
      await expect(page.getByText('climb left')).toBeVisible({ timeout: 20_000 });
      await page.goBack(); await page.goBack();                                                    // hike tab, trail page, then Home
      await expect(page.getByText('Hike in progress')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
      await check(page, '6-returning', width, []); // the map was opened on the trail page, so the no-provider rule does not apply here
    });

    test('state 5: offline', async ({ page, context }) => {
      const provider = await open(page);
      await expect(page.getByRole('heading', { name: 'Top picks near you' })).toBeVisible({ timeout: 20_000 });
      await context.setOffline(true);
      await expect(page.getByText('You’re offline. Your offline maps still work.')).toBeVisible({ timeout: 10_000 });
      await check(page, '5-offline', width, provider);
    });
  });
}

// Rows filled from real geometry (see e2e/fixtures.ts), at 375 px, full page.
test.describe('Home with every row filled (real geometry), 375 px', () => {
  test.use({ viewport: { width: 375, height: 780 }, geolocation: { latitude: 47.53, longitude: -122.03 } }); // Issaquah

  test.describe('first visit', () => {
    test.use({ permissions: [] });
    test('state 1', async ({ page }) => {
      await page.addInitScript(() => { navigator.permissions.query = async () => ({ state: 'prompt', onchange: null }) as unknown as PermissionStatus; });
      const provider = await open(page, true);
      for (const h of [/Top picks in Washington/, 'Short with a view', 'Dog-friendly', 'Waterfalls']) await expect(page.getByRole('heading', { name: h })).toBeVisible({ timeout: 20_000 });
      await check(page, '1-first-visit-real-data', 375, provider);
    });
  });

  test('state 2: near you', async ({ page }) => {
    const provider = await open(page, true);
    for (const h of ['Top picks near you', 'Short with a view', 'Dog-friendly', 'Waterfalls']) await expect(page.getByRole('heading', { name: h })).toBeVisible({ timeout: 20_000 });
    await check(page, '2-near-you-real-data', 375, provider);
  });
});
