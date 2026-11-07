// Thin pre-rendered trail pages for search engines. Pure functions here; scripts/seo-pages.mjs does the file work.
// No climb or difficulty yet: the climb figures are being fixed (cto/test-pass-fixes). TODO(climb): add them once that lands.
import { M_TO_MI, haversine, resample, type LngLat } from '../../src/lib/geo';
import { mi } from '../../src/lib/format';
import { roundTripM } from '../../src/lib/plan';
import { filterTrails, isJunkName, isRoute, relevance } from '../../src/lib/quality';
import { ELEVATION_NOTICE, SAFETY_LINE } from '../../src/lib/credits';
import type { Trail } from '../../src/lib/trails';
import { areaOf } from './places';

export const MIN_MI = 1, MAX_MI = 15, DEFAULT_CAP = 300;
const ID_OK = /^osm-[rw]\d{1,15}(-\d{1,6})?$/;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** JSON for an inline <script type="application/ld+json">: nothing in it can close the tag. */
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The site's own address from index.html's <link rel="canonical">, without a trailing slash. */
export function canonicalBase(indexHtml: string): string {
  const m = /<link\s+rel="canonical"\s+href="(https?:\/\/[^"\s]+)"/i.exec(indexHtml);
  if (!m) throw new Error('index.html has no absolute <link rel="canonical">');
  return new URL(m[1]).origin;
}

const DESTINATION = /\b(lake|lakes|peak|mount|mountain|mt|falls|viewpoint|lookout|ridge|pass|point|summit|butte|basin|meadows?|ledge|crest|divide|glacier)\b/i;
const URBAN = /\b(connector|bridle|horse|horses|equestrian|greenway|spur|access|cutoff|cut-off|sidewalk|bike|bicycle)\b/i;

/** How much a trail looks like a real hike, before length. Higher is better; deterministic. */
export function hikingSignal(t: Trail): number {
  let s = 0;
  if (isRoute(t) && (!t.tags.route || t.tags.route === 'hiking')) s += 3;
  if (t.tags.sac_scale) s += 2;
  if (DESTINATION.test(t.name)) s += 2;
  s += Math.min(2, certainHighlights(t).filter((h) => /views|lake|waterfall/.test(h)).length);
  if (URBAN.test(t.name)) s -= 5;
  if (t.tags.horse === 'designated' && (t.tags.foot === 'no' || (!t.tags.foot && !isRoute(t)))) s -= 4;
  return s;
}

export interface Seed { label: string; osm: string[]; near: [number, number]; name?: string; bench?: boolean }
export const SEED_MAX_MI = 20, SEED_NEAR_M = 1000;

const hasOsm = (t: Trail, osm: string) => t.id === `osm-${osm}` || t.id.startsWith(`osm-${osm}-`);
const lc = (s: string) => s.toLowerCase();

/** The built trail for a seed: by OSM id (in the order listed), else by a matching name within 1 km of `near`. */
export function findSeed(all: Trail[], seed: Seed): Trail | undefined {
  const usable = (t: Trail) => !t.partial && !isJunkName(t.name) && ID_OK.test(t.id) && t.coords.length >= 2 && roundTripM(t) * M_TO_MI <= SEED_MAX_MI;
  for (const o of seed.osm) {
    const hit = all.find((t) => usable(t) && hasOsm(t, o));
    if (hit) return hit;
  }
  const key = lc(seed.label);
  return all.filter((t) => usable(t) && lc(t.name).includes(key) && t.coords.some((c) => haversine(c, seed.near) <= SEED_NEAR_M))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

export interface Selection { trails: Trail[]; seeded: { label: string; id: string }[]; missing: string[] }

/** Seeds first (must-haves, then bench), then the rest by hiking signal before length. A seed that cannot be found is reported, not fatal. */
export function selectWithSeeds(all: Trail[], seeds: Seed[], cap = DEFAULT_CAP): Selection {
  const picked: Trail[] = [], seeded: Selection['seeded'] = [], missing: string[] = [];
  for (const sd of [...seeds.filter((s) => !s.bench), ...seeds.filter((s) => s.bench)]) {
    const t = findSeed(all, sd);
    if (!t) { missing.push(sd.label); continue; }
    if (picked.some((p) => p.id === t.id)) { missing.push(sd.label); continue; }
    picked.push(sd.name && sd.osm.some((o) => hasOsm(t, o)) ? { ...t, name: sd.name } : t);
    seeded.push({ label: sd.label, id: t.id });
  }
  const taken = new Set(picked.map((t) => t.id));
  const rest = selectTrails(all, Infinity).filter((t) => !taken.has(t.id));
  return { trails: [...picked, ...rest].slice(0, cap), seeded, missing };
}

export function selectTrails(all: Trail[], cap = DEFAULT_CAP): Trail[] {
  const ok = (t: Trail) => !t.partial && ID_OK.test(t.id) && !isJunkName(t.name) && t.coords.length >= 2 && (() => {
    const x = roundTripM(t) * M_TO_MI;
    return x >= MIN_MI && x <= MAX_MI;
  })();
  const pool = filterTrails(all).filter(ok).filter((t) => isRoute(t) || !!t.tags.sac_scale);
  const sig = new Map(pool.map((t) => [t.id, hikingSignal(t)]));
  return pool.sort((a, b) => sig.get(b.id)! - sig.get(a.id)! || relevance(b) - relevance(a) || a.id.localeCompare(b.id)).slice(0, cap);
}

const HIGHLIGHT_TEXT: Record<string, string> = {
  view: 'views', lake: 'a lake', falls: 'a waterfall', beach: 'a beach',
  bikes: 'bikes allowed', horses: 'horses allowed', dogs: 'dogs allowed', nodogs: 'no dogs',
};
/** Highlights that are certain and do not depend on climb: no '?' ones, no 'climb'. */
export function certainHighlights(t: Trail): string[] {
  return (t.highlights ?? []).filter((h) => !h.endsWith('?') && HIGHLIGHT_TEXT[h]).map((h) => HIGHLIGHT_TEXT[h]);
}

export interface Page { id: string; title: string; description: string; area: string; html: string; path: string }

export function sketch(coords: LngLat[], w = 320, h = 200, pad = 14): string {
  const pts = resample(coords, 80);
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => -p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const s = Math.min((w - 2 * pad) / (Math.max(...xs) - x0 || 1e-9), (h - 2 * pad) / (Math.max(...ys) - y0 || 1e-9));
  const ox = (w - s * (Math.max(...xs) - x0)) / 2, oy = (h - s * (Math.max(...ys) - y0)) / 2;
  const xy = pts.map((_, i) => [ox + s * (xs[i] - x0), oy + s * (ys[i] - y0)].map((n) => n.toFixed(1)));
  const [a, b] = [xy[0], xy[xy.length - 1]];
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Sketch of the trail's shape" style="max-width:100%;height:auto;background:#E9ECE4;border-radius:12px">`
    + `<polyline fill="none" stroke="#111111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${xy.map((p) => p.join(',')).join(' ')}"/>`
    + `<circle cx="${a[0]}" cy="${a[1]}" r="5" fill="#ffffff" stroke="#111111" stroke-width="2"/><circle cx="${b[0]}" cy="${b[1]}" r="5" fill="#D52B26"/></svg>`;
}

export function describe(t: Trail): string {
  const d = mi(roundTripM(t)), area = areaOf(t.coords[0]);
  const shape = t.loop ? `a ${d} mi loop` : `a ${mi(t.lengthM)} mi trail (${d} mi out and back)`;
  const hl = certainHighlights(t);
  const parts = [`${t.name} is ${shape} ${area}, mapped in OpenStreetMap.`];
  if (hl.length) parts.push(`Mapped highlights: ${hl.join(', ')}.`);
  parts.push(t.trailheadIsParking ? 'A car park is mapped at the trailhead.' : 'No car park is mapped at the trailhead.');
  return parts.join(' ');
}

export interface Opts { base: string; appBase: string; template: string }

/** Remove everything the page re-declares, so the template's own head tags do not double up. */
function stripHead(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, '')
    .replace(/<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<!--[\s\S]*?-->\s*/g, (c) => (c.includes('Absolute on purpose') ? '' : c))
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
}

export function renderPage(t: Trail, o: Opts): Page {
  if (!ID_OK.test(t.id)) throw new Error('unsafe trail id');
  const area = areaOf(t.coords[0]);
  const d = mi(roundTripM(t));
  const title = `${t.name} — ${d} mi hike ${area} | Ridgeline`;
  const description = describe(t);
  const url = `${o.base}/trail/${t.id}/`;
  const image = `${o.base}/og-image.png`;
  const th = t.trailhead ?? t.coords[0];
  const ld = {
    '@context': 'https://schema.org', '@type': 'TouristAttraction', name: t.name, description, url, image,
    geo: { '@type': 'GeoCoordinates', latitude: +th[1].toFixed(5), longitude: +th[0].toFixed(5) },
    sameAs: t.osmUrl,
  };
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Ridgeline">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`, `<meta property="og:image" content="${esc(image)}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="Ridgeline logo: a white ridge line with a red summit dot on black">',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<script type="application/ld+json">${jsonLd(ld)}</script>`,
  ].join('\n  ');
  const hl = certainHighlights(t);
  const body = `<div id="root"><!-- Static trail page for crawlers and no-JS visitors; replaced when the app mounts. -->
    <main style="max-width:40rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif;color:#111">
      <p><a href="${o.appBase}">Ridgeline</a></p>
      <h1>${esc(t.name)}</h1>
      <p>${esc(description)}</p>
      ${sketch(t.coords)}
      <ul>
        <li>${t.loop ? 'Loop' : 'Out and back'}: ${d} mi ${t.loop ? 'around' : 'round trip'}</li>${hl.length ? `\n        <li>Mapped highlights: ${esc(hl.join(', '))}</li>` : ''}
        <li>${t.trailheadIsParking ? 'Car park mapped at the trailhead' : 'No car park mapped at the trailhead'}</li>
      </ul>
      <p><a href="${o.appBase}trail/${t.id}" style="display:inline-block;padding:.8rem 1.2rem;background:#D52B26;color:#fff;border-radius:10px;text-decoration:none;min-height:44px;box-sizing:border-box">Open in Ridgeline</a></p>
      <p><strong>${esc(SAFETY_LINE)}</strong></p>
      <p style="font-size:.85rem;color:#6A6A6A">Trail data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL). Elevation in the Ridgeline app: ${esc(ELEVATION_NOTICE)}.</p>
    </main>
  </div>`;
  const out = stripHead(o.template);
  if (!/<div id="root">[\s\S]*?<\/main>\s*<\/div>/.test(out)) throw new Error('template: root block not found');
  const html = out.replace('</head>', `\n  ${head}\n</head>`).replace(/<div id="root">[\s\S]*?<\/main>\s*<\/div>/, () => body);
  return { id: t.id, title, description, area, html, path: `trail/${t.id}/index.html` };
}

/** Sitemap with one entry per page; entries from an earlier run are replaced. */
export function addToSitemap(xml: string, urls: string[], date: string): string {
  const kept = xml.replace(/\s*<url>\s*<loc>[^<]*\/trail\/[^<]*<\/loc>[\s\S]*?<\/url>/g, '');
  const add = urls.map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n    <lastmod>${date}</lastmod>\n  </url>\n`).join('');
  return kept.replace('</urlset>', `${add}</urlset>`);
}
