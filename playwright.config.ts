import { defineConfig } from '@playwright/test';

// Browser checks on the BUILT app (npm run build first): headless Chromium against `vite preview`.
// Locally, E2E_CHROMIUM=/path/to/chrome uses a browser you already have instead of Playwright's download.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4179',
    serviceWorkers: 'allow',
    permissions: ['geolocation'],
    geolocation: { latitude: 47.43564, longitude: -121.77165 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], // software WebGL for the map on CI machines without a GPU
      ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}),
    },
  },
  webServer: {
    command: 'node e2e/prepare.mjs && npx vite preview --port 4179 --strictPort',
    url: 'http://localhost:4179',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
