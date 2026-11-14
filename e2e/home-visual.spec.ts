import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Home at 320, 375 and 414 px in four states, as screenshots for a person to look at (CI uploads test-results/home-visual/),
// plus two hard checks: no sideways scroll, and tap targets of at least 44 px. Same trail stubs as offline.spec.ts: the index and
// the real Rattlesnake Ledge cell; nothing else is fetched, and no request may go to the map provider.
const ledgeCell = JSON.parse(readFileSync(new URL('../src/lib/fixtures/wa-cells.json', import.meta.url), 'utf8')).ledge[0];
const INDEX = { v: 1, built: '2026-11-06T00:00:00Z', source: 'e2e fixture', elevation: 'Copernicus DEM GLO-90', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] };
const OUT = 'test-results/home-visual';
const WIDTHS = [320, 375, 414];

async function open(page: Page) {
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: INDEX }));
  await page.route('**/trails/232_549.json', (route) => route.fulfill({ json: ledgeCell }));
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
  await page.screenshot({ path: `${OUT}/${state}-${width}.png`, fullPage: true });
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

    test('state 5: offline', async ({ page, context }) => {
      const provider = await open(page);
      await expect(page.getByRole('heading', { name: 'Top picks near you' })).toBeVisible({ timeout: 20_000 });
      await context.setOffline(true);
      await expect(page.getByText('You’re offline. Your offline maps still work.')).toBeVisible({ timeout: 10_000 });
      await check(page, '5-offline', width, provider);
    });
  });
}
