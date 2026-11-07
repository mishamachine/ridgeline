import { describe, expect, it } from 'vitest';
import type { Trail } from '../../src/lib/trails';
import { addToSitemap, canonicalBase, certainHighlights, describe as describeTrail, esc, jsonLd, renderPage, selectTrails } from './pages';
import { areaOf } from './places';

const line = (n = 40, lon = -121.6, lat = 47.8): [number, number][] => Array.from({ length: n }, (_, i) => [lon + i * 0.0006, lat + Math.sin(i / 5) * 0.0004]);
// Shape of a hosted-data trail: ids osm-r<relation> / osm-w<way>-<n>, tags from the cell files (sac_scale, surface...).
const trail = (o: Partial<Trail> = {}): Trail => ({
  id: 'osm-r123', name: 'Lake Serene Trail', coords: line(), lengthM: 3200, loop: false, partial: false,
  osmUrl: 'https://www.openstreetmap.org/relation/123', tags: {}, ...o,
});

const TEMPLATE = `<!doctype html><html><head><meta charset="utf-8">
  <script type="module" crossorigin src="/assets/index-abc.js"></script>
  <title>Ridgeline: offline hiking trail maps</title>
  <meta name="description" content="x">
  <link rel="canonical" href="https://hike.example.org/">
  <meta property="og:title" content="x"><meta name="twitter:title" content="x">
  <script type="application/ld+json">{"@type":"WebSite"}</script>
</head><body>
  <div id="root"><main><h1>Ridgeline</h1></main>
  </div>
</body></html>`;
const opts = { base: 'https://hike.example.org', appBase: '/', template: TEMPLATE };

describe('canonicalBase', () => {
  it('takes the origin from index.html, whatever the domain', () => {
    expect(canonicalBase(TEMPLATE)).toBe('https://hike.example.org');
    expect(canonicalBase('<link rel="canonical" href="https://hike.bbprojectfactory.com/">')).toBe('https://hike.bbprojectfactory.com');
  });
  it('fails the build when there is none', () => {
    expect(() => canonicalBase('<html></html>')).toThrow();
    expect(() => canonicalBase('<link rel="canonical" href="/relative">')).toThrow();
  });
});

describe('selectTrails', () => {
  const routes = Array.from({ length: 5 }, (_, i) => trail({ id: `osm-r${i + 1}`, name: `Route Number ${i + 1}`, coords: line(40, -121.6 + i * 0.5) }));
  const sacPath = trail({ id: 'osm-w9-0', name: 'Mailbox Peak Path', coords: line(40, -122.5), tags: { sac_scale: 'hiking' } });
  const plainPath = trail({ id: 'osm-w8-0', name: 'Some Other Path', coords: line(40, -123.5) });
  it('routes first, then sac_scale paths; plain paths are left out', () => {
    const ids = selectTrails([plainPath, sacPath, ...routes]).map((t) => t.id);
    expect(ids.slice(0, 5).sort()).toEqual(['osm-r1', 'osm-r2', 'osm-r3', 'osm-r4', 'osm-r5']);
    expect(ids[5]).toBe('osm-w9-0');
    expect(ids).not.toContain('osm-w8-0');
  });
  it('caps the count', () => expect(selectTrails(routes, 3)).toHaveLength(3));
  it('drops junk names, partial trails, unsafe ids and lengths outside 1-15 mi', () => {
    const bad = [
      trail({ id: 'osm-r50', name: 'NF-65', coords: line(40, -120) }),
      trail({ id: 'osm-r51', name: 'Closed Mine Trail', coords: line(40, -120.5) }),
      trail({ id: 'osm-r52', name: 'Cut Off Trail', partial: true, coords: line(40, -119) }),
      trail({ id: 'osm-r53"><script>', name: 'Evil Id Trail', coords: line(40, -118) }),
      trail({ id: 'osm-r54', name: 'Tiny Loop Trail', lengthM: 300, loop: true, coords: line(40, -117) }),
      trail({ id: 'osm-r55', name: 'Huge Route Trail', lengthM: 40000, coords: line(40, -116) }),
    ];
    expect(selectTrails(bad)).toEqual([]);
  });
  it('keeps one page for two trails with the same name in the same place', () => {
    const a = trail({ id: 'osm-r60', name: 'Twin Falls Trail' }), b = trail({ id: 'osm-r61', name: 'Twin Falls Trail' });
    expect(selectTrails([a, b])).toHaveLength(1);
  });
});

describe('page text', () => {
  it('uses only certain highlights and never the climb one', () => {
    const t = trail({ highlights: ['view', 'lake?', 'climb', 'dogs', 'long'] });
    expect(certainHighlights(t)).toEqual(['views', 'dogs allowed']);
    expect(describeTrail(t)).not.toMatch(/climb|\?|ft|difficult|easy|hard|moderate/i);
  });
  it('says loop or out and back, and whether a car park is mapped', () => {
    expect(describeTrail(trail({ loop: true, lengthM: 3218, trailheadIsParking: true }))).toMatch(/2\.0 mi loop.*A car park is mapped/);
    expect(describeTrail(trail({ trailheadIsParking: false }))).toMatch(/out and back.*No car park is mapped/);
  });
  it('labels the area by the nearest listed town, else Washington', () => {
    expect(areaOf([-121.55, 47.82])).toBe('near Index, WA');
    expect(areaOf([-119.9, 46.9])).toBe('in Washington');
  });
});

describe('renderPage', () => {
  const p = renderPage(trail({ trailhead: [-121.6, 47.8], trailheadIsParking: true, highlights: ['view'] }), opts);
  it('has title, description, canonical from the base, OG/Twitter, one h1, the SVG, safety line and credits', () => {
    expect(p.html).toContain('<title>Lake Serene Trail — 4.0 mi hike near Index, WA | Ridgeline</title>');
    expect(p.html).toContain('<link rel="canonical" href="https://hike.example.org/trail/osm-r123/">');
    expect(p.html).toContain('property="og:image" content="https://hike.example.org/og-image.png"');
    expect(p.html).toContain('name="twitter:image" content="https://hike.example.org/og-image.png"');
    expect(p.html.match(/<h1>/g)).toHaveLength(1);
    expect(p.html).toContain('<svg');
    expect(p.html).toContain('Directions are a guide; check conditions; not for emergency use.');
    expect(p.html).toContain('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL)');
    expect(p.html).toContain('Copernicus WorldDEM');
    expect(p.html).toContain('href="/trail/osm-r123"');
    expect(p.path).toBe('trail/osm-r123/index.html');
  });
  it('replaces the template head tags (one title, one canonical, one description) and keeps the app bundle', () => {
    for (const re of [/<title>/g, /rel="canonical"/g, /name="description"/g, /og:title/g, /application\/ld\+json/g]) expect(p.html.match(re)).toHaveLength(1);
    expect(p.html).not.toContain('WebSite');
    expect(p.html).toContain('src="/assets/index-abc.js"');
  });
  it('puts the trailhead only in the structured data, and the page is free of scripts other than the bundle and JSON-LD', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(p.html)![1]);
    expect(ld['@type']).toBe('TouristAttraction');
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 47.8, longitude: -121.6 });
    expect(p.html.match(/<script/g)).toHaveLength(2);
    expect(p.html).not.toMatch(/https?:\/\/(?!hike\.example\.org|www\.openstreetmap\.org|schema\.org|www\.w3\.org)/);
    expect(p.html).not.toMatch(/climb|difficulty|\bft\b/i);
  });
  it('escapes hostile names everywhere', () => {
    const evil = `</title><script>alert(1)</script>"'&`;
    const h = renderPage(trail({ name: evil }), opts).html;
    expect(h).not.toContain('<script>alert(1)');
    expect(h).not.toMatch(/<\/title><script/);
    expect(h.match(/<script/g)).toHaveLength(2);
    expect(h).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;');
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)![1];
    expect(ld).not.toContain('<');
    expect(JSON.parse(ld).name).toBe(evil);
  });
  it('refuses an unsafe id, and uses the app base path in links', () => {
    expect(() => renderPage(trail({ id: '../../x' }), opts)).toThrow();
    const gh = renderPage(trail(), { ...opts, appBase: '/ridgeline/' }).html;
    expect(gh).toContain('href="/ridgeline/trail/osm-r123"');
    expect(gh).toContain('href="https://hike.example.org/trail/osm-r123/"');
  });
  it('esc and jsonLd', () => {
    expect(esc(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(jsonLd({ a: '</script>\u2028' })).not.toMatch(/<|\u2028/);
  });
});

describe('addToSitemap', () => {
  const xml = '<urlset>\n  <url>\n    <loc>https://hike.example.org/</loc>\n    <lastmod>2026-10-29</lastmod>\n  </url>\n</urlset>\n';
  it('adds entries with the build date and replaces earlier trail entries', () => {
    const once = addToSitemap(xml, ['https://hike.example.org/trail/a/'], '2026-11-07');
    const twice = addToSitemap(once, ['https://hike.example.org/trail/b/'], '2026-11-08');
    expect(twice).toContain('<loc>https://hike.example.org/</loc>');
    expect(twice).toContain('<loc>https://hike.example.org/trail/b/</loc>');
    expect(twice).not.toContain('/trail/a/');
    expect(twice.match(/<loc>/g)).toHaveLength(2);
  });
});
