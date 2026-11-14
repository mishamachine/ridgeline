import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { LEDGE_CELL, LEDGE_INDEX } from './fixtures';

// "Add to home screen" screenshots for a person to look at: the tour card, the pop-up and the iPhone steps sheet, as iPhone and as
// Android Chrome, at 320, 375 and 414 px. They land in test-results/home-visual/install/, which CI already uploads.
// Android's system prompt is stood in for by a synthetic beforeinstallprompt event (the real one cannot be triggered in CI).
const OUT = 'test-results/home-visual/install';
const WIDTHS = [320, 375, 414];
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
} as const;

async function open(page: Page, settings: object, android: boolean) {
  await page.route('**/trails/index.json', (route) => route.fulfill({ json: LEDGE_INDEX }));
  await page.route(/\/trails\/\d+_\d+\.json$/, (route) => route.fulfill({ json: LEDGE_CELL }));
  await page.route('**/trails/names.json', (route) => route.fulfill({ json: { v: 1, e: [] } }));
  await page.addInitScript(([s]) => {
    try {
      if (!localStorage.getItem('ridgeline:settings')) localStorage.setItem('ridgeline:settings', JSON.stringify(s));
    } catch { /* ignore */ }
  }, [settings]);
  await page.goto('/');
  if (android) await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }; e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
}

async function noSideways(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(w[0], 'page scrolls sideways').toBeLessThanOrEqual(w[1]);
}

function isoDay(offset: number) { const d = new Date(Date.now() - offset * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

for (const kind of ['ios', 'android'] as const) {
  for (const width of WIDTHS) {
    test.describe(`${kind} at ${width} px`, () => {
      test.use({ viewport: { width, height: 780 }, userAgent: UA[kind], hasTouch: true });

      test('tour card', async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await open(page, {}, kind === 'android');
        await page.getByRole('button', { name: 'Next' }).click();
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByRole('heading', { name: 'Add Ridgeline to your home screen' })).toBeVisible();
        await expect(page.getByText('Open it like an app, without the browser bars, with your saved maps one tap away.')).toBeVisible();
        if (kind === 'ios') { await expect(page.getByText('Tap Add to Home Screen')).toBeVisible(); await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible(); }
        else { await expect(page.getByRole('button', { name: 'Add to home screen' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible(); }
        await noSideways(page);
        await page.screenshot({ path: `${OUT}/${kind}-tour-card-${width}.png` });
      });

      test('pop-up on the 3rd day, then the steps sheet', async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await open(page, { onboardingSeen: true, installSessions: 1, installDays: [isoDay(2), isoDay(1)] }, kind === 'android');
        const card = page.getByRole('region', { name: 'Add Ridgeline to your home screen' });
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card.getByRole('button', { name: 'Add' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Close' })).toBeVisible();
        for (const b of await card.getByRole('button').all()) { const r = (await b.boundingBox())!; expect(r.height, 'tap target').toBeGreaterThanOrEqual(44); }
        await noSideways(page);
        await page.screenshot({ path: `${OUT}/${kind}-popup-${width}.png` });
        if (kind === 'ios') {
          await card.getByRole('button', { name: 'Add' }).click();
          await expect(card.getByText('Tap Add to Home Screen')).toBeVisible();
          await expect(card.getByRole('button', { name: 'Got it' })).toBeVisible();
          await noSideways(page);
          await page.screenshot({ path: `${OUT}/ios-steps-sheet-${width}.png` });
        }
      });
    });
  }
}

test('never in the first session', async ({ page }) => {
  await open(page, { onboardingSeen: true, installSessions: 0, installDays: [isoDay(2), isoDay(1)] }, true);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Add Ridgeline to your home screen' })).toHaveCount(0);
});
