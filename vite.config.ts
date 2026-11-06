import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set at deploy time for GitHub Pages (e.g. "/ridgeline/").
const base = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    {
      // The GitHub Pages copy (BASE_PATH other than "/") must not compete with the canonical host.
      name: 'noindex-pages-copy',
      transformIndexHtml(html) {
        return base === '/' ? html : html.replace('</head>', '  <meta name="robots" content="noindex">\n  </head>');
      },
    },
    VitePWA({
      // The native apps bundle everything; no service worker there (vite build --mode native).
      disable: mode === 'native',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
