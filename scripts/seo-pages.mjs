// Usage: BASE_PATH=/ node scripts/seo-pages.mjs <built dir> [cap]   (run after the trail data is in <dir>/trails)
// Writes <dir>/trail/<id>/index.html for the top trails and adds them to <dir>/sitemap.xml.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const dir = process.argv[2];
const cap = Number(process.argv[3] ?? process.env.SEO_PAGE_CAP ?? 300);
if (!dir || !Number.isFinite(cap)) { console.error('usage: node scripts/seo-pages.mjs <built dir> [cap]'); process.exit(2); }
const t0 = Date.now();
const [{ module: seo }, { module: cells }] = await Promise.all([
  runnerImport('./scripts/seo/pages.ts'), runnerImport('./src/lib/cells.ts'),
]);
const template = readFileSync(join(dir, 'index.html'), 'utf8');
const base = seo.canonicalBase(template);
const appBase = process.env.BASE_PATH ?? '/';
const trailDir = join(dir, 'trails');
const files = readdirSync(trailDir).filter((f) => /^\d+_\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(trailDir, f), 'utf8')));
const picked = seo.selectTrails(cells.cellsToTrails(files), cap);
let bytes = 0;
for (const t of picked) {
  const p = seo.renderPage(t, { base, appBase, template });
  mkdirSync(join(dir, 'trail', t.id), { recursive: true });
  writeFileSync(join(dir, p.path), p.html);
  bytes += Buffer.byteLength(p.html);
}
const sm = join(dir, 'sitemap.xml');
const date = new Date().toISOString().slice(0, 10);
writeFileSync(sm, seo.addToSitemap(readFileSync(sm, 'utf8'), picked.map((t) => `${base}/trail/${t.id}/`), date));
console.log(`seo pages: ${picked.length} in ${dir}/trail, ${(bytes / 1e6).toFixed(2)} MB, canonical ${base}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
