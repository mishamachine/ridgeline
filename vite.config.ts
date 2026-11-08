/// <reference types="vitest/config" />
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { accountsFlagOn, injectAccountsSection } from './src/lib/accounts/privacyAccounts';

// BASE_PATH is set at deploy time for GitHub Pages (e.g. "/ridgeline/").
const base = process.env.BASE_PATH ?? '/';

// GitHub Pages answers unknown paths (/ridgeline/trail/<id>) with 404.html: serve the app from it.
let outDir = 'dist';
const spaFallback: Plugin = {
  name: 'spa-404',
  apply: 'build',
  configResolved(config) { outDir = join(config.root, config.build.outDir); },
  closeBundle() {
    const dir = outDir;
    if (existsSync(join(dir, 'index.html'))) copyFileSync(join(dir, 'index.html'), join(dir, '404.html'));
  },
};

// The privacy page gets its "Accounts" section only when features.accounts is true: the text ships with the behaviour, never before it.
let privacyOut = 'dist';
const privacyAccounts: Plugin = {
  name: 'privacy-accounts',
  apply: 'build',
  configResolved(config) { privacyOut = join(config.root, config.build.outDir); },
  closeBundle() {
    const f = join(privacyOut, 'privacy', 'index.html');
    if (!existsSync(f)) return;
    const on = accountsFlagOn(readFileSync(join('src', 'lib', 'features.ts'), 'utf8'));
    writeFileSync(f, injectAccountsSection(readFileSync(f, 'utf8'), on));
  },
};

// Dev only: a local .dev-data/names.json (git-ignored) stands in for the name index until it is deployed.
const devNames: Plugin = {
  name: 'dev-names',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/trails/names.json', (_req, res, next) => {
      const f = join(process.cwd(), '.dev-data', 'names.json');
      if (!existsSync(f)) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(f));
    });
  },
};

export default defineConfig(({ mode }) => ({
  base,
  test: { exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'test-results/**'] }, // e2e/ is Playwright's (npm run e2e)
  // Dev only: set TRAILS_PROXY=https://<host> to read hosted trail cells from a live site.
  server: process.env.TRAILS_PROXY ? { proxy: { '/trails': { target: process.env.TRAILS_PROXY, changeOrigin: true } } } : {},
  plugins: [
    react(),
    privacyAccounts,
    {
      // The GitHub Pages copy (BASE_PATH other than "/") must not compete with the canonical host.
      name: 'noindex-pages-copy',
      transformIndexHtml(html) {
        return base === '/' ? html : html.replace('</head>', '  <meta name="robots" content="noindex">\n  </head>');
      },
    },
    spaFallback,
    devNames,
    VitePWA({
      // The native apps bundle everything and have no service worker (vite build --mode native).
      disable: mode === 'native',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // registration lives in src/lib/swUpdate.ts
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Ridgeline',
        short_name: 'Ridgeline',
        description: 'Bold, simple trail maps that work offline.',
        theme_color: '#111111',
        background_color: '#F7F7F5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
}));
