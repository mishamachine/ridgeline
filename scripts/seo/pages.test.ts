import { describe, expect, it } from 'vitest';
import type { Trail } from '../../src/lib/trails';
import { cellsToTrails, type CellFile } from '../../src/lib/cells';
import { addToSitemap, canonicalBase, certainHighlights, describe as describeTrail, esc, findSeed, hikingSignal, jsonLd, renderPage, selectTrails, selectWithSeeds, type Seed } from './pages';
import seedList from './seed.json';
import fixtureCells from './fixtures/cells.json';
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
  const sacPath = trail({ id: 'osm-w9-0', name: 'Some Rocky Path', coords: line(40, -122.5), tags: { sac_scale: 'hiking' } });
  const plainPath = trail({ id: 'osm-w8-0', name: 'Some Other Path', coords: line(40, -123.5) });
  it('routes before sac_scale paths of the same kind; plain paths are left out', () => {
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
  it('says loop or out and back, and mentions a car park only when one is mapped', () => {
    expect(describeTrail(trail({ loop: true, lengthM: 3218, trailheadIsParking: true }))).toMatch(/2\.0 mi loop.*A car park is mapped/);
    expect(describeTrail(trail({ trailheadIsParking: false }))).toMatch(/out and back/);
    expect(describeTrail(trail({ trailheadIsParking: false }))).not.toMatch(/car park|parking/i);
  });
  it('labels the area by the nearest listed town, else Washington', () => {
    expect(areaOf([-121.55, 47.82])).toBe('near Index, WA');
    expect(areaOf([-119.9, 46.9])).toBe('in Washington');
  });
});

describe('renderPage', () => {
  it('never states an absence of parking: no sentence or list item when no lot is matched', () => {
    for (const flag of [false, undefined]) {
      const h = renderPage(trail({ trailheadIsParking: flag }), opts).html;
      expect(h).not.toMatch(/car park|parking/i);
      expect(h).not.toMatch(/\bno\b[^.<]*(mapped|parking)/i);
    }
    expect(renderPage(trail({ trailheadIsParking: true }), opts).html).toContain('Car park mapped at the trailhead');
  });
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
    expect(ld.isAccessibleForFree).toBeUndefined(); // no fee data: never claim free
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

// Real cell shapes (thinned) for flagship routes plus the Bridle Crest Trail, from the hosted data of 6 Nov 2026.
const real = cellsToTrails([fixtureCells as unknown as CellFile]);
const seeds = seedList as Seed[];
const routes = Array.from({ length: 5 }, (_, i) => trail({ id: `osm-r${i + 1}`, name: `Route Number ${i + 1}`, coords: line(40, -121.6 + i * 0.5) }));

describe('seed list', () => {
  it('has the ten must-haves and four bench trails, each with an OSM id and a spot', () => {
    expect(seeds.filter((s) => !s.bench)).toHaveLength(10);
    expect(seeds.filter((s) => s.bench)).toHaveLength(4);
    for (const s of seeds) { expect(s.osm.length).toBeGreaterThan(0); s.osm.forEach((o) => expect(o).toMatch(/^[rw]\d+$/)); expect(s.near).toHaveLength(2); }
    for (const l of ['Rattlesnake Ledge', 'Lake 22', 'Wallace Falls', 'Maple Pass (Loop)', 'Mount Si', 'Lake Serene', 'Mailbox Peak']) expect(seeds.map((s) => s.label)).toContain(l);
  });
  it('finds flagships by OSM id even when the name differs', () => {
    const lake22 = seeds.find((s) => s.label === 'Lake 22')!;
    expect(findSeed(real, lake22)?.id).toBe('osm-r5537770');
    expect(findSeed(real, seeds.find((s) => s.label === 'Wallace Falls')!)?.id).toBe('osm-r5634476');
  });
  it('matches a split way trail on its min way id, else by name near the spot', () => {
    const split = trail({ id: 'osm-w456-1', name: 'Some Peak Trail', coords: line(40, -121.5, 47.5) });
    expect(findSeed([split], { label: 'x', osm: ['w456'], near: [0, 0] })?.id).toBe('osm-w456-1');
    expect(findSeed([split], { label: 'Some Peak', osm: ['w999'], near: [-121.49, 47.5] })?.id).toBe('osm-w456-1');
    expect(findSeed([split], { label: 'Some Peak', osm: ['w999'], near: [-120, 47.5] })).toBeUndefined();
  });
  it('name fallback skips junk names, other trails, and keeps the trail own name', () => {
    const sd: Seed = { label: 'Mount Si', osm: ['r1'], near: [-121.5, 47.5], name: 'Mount Si' };
    expect(findSeed([trail({ id: 'osm-w5-0', name: 'Trail', coords: line(40, -121.5, 47.5) })], sd)).toBeUndefined();
    const old = trail({ id: 'osm-r9', name: 'Old Mount Si Trail', coords: line(40, -121.5, 47.5) });
    expect(selectWithSeeds([old], [sd]).trails[0].name).toBe('Old Mount Si Trail');
  });
  it('two seeds on the same trail: the second is reported missing', () => {
    const sel = selectWithSeeds(routes, [{ label: 'A', osm: ['r1'], near: [0, 0] }, { label: 'B', osm: ['r1'], near: [0, 0] }]);
    expect(sel.seeded).toHaveLength(1);
    expect(sel.missing).toEqual(['B']);
  });
  it('puts seeds first, allows up to 20 mi, and applies a display name', () => {
    const big = trail({ id: 'osm-r700', name: 'Big Peak Trail', lengthM: 14000, coords: line(40, -121.9) }); // ~17 mi out and back
    const sel = selectWithSeeds([...routes, big], [{ label: 'Big Peak', osm: ['r700'], near: [-121.9, 47.8], name: 'Big Peak (Seed)' }], 4);
    expect(sel.trails[0]).toMatchObject({ id: 'osm-r700', name: 'Big Peak (Seed)' });
    expect(selectTrails([big])).toEqual([]);
    expect(sel.trails).toHaveLength(4);
    expect(sel.missing).toEqual([]);
  });
  it('reports a seed it cannot find instead of throwing', () => {
    const sel = selectWithSeeds(routes, [{ label: 'Nowhere Peak', osm: ['r99999'], near: [0, 0] }]);
    expect(sel.missing).toEqual(['Nowhere Peak']);
    expect(sel.trails.length).toBe(routes.length);
  });
  it('real flagship fixture: every fixture seed is found', () => {
    const sel = selectWithSeeds(real, seeds);
    expect(sel.seeded.map((s) => s.id).sort()).toEqual(['osm-r5426108', 'osm-r5537770', 'osm-r5537775', 'osm-r5588030', 'osm-r5634476']);
    expect(sel.missing).toContain('Maple Pass (Loop)');
  });
});

describe('hiking signal', () => {
  const bridle = real.find((t) => t.name === 'Bridle Crest Trail')!;
  const pilchuck = real.find((t) => t.name === 'Mount Pilchuck Trail')!;
  it('puts a hiking peak route above a Bridle Crest-like path', () => {
    expect(hikingSignal(pilchuck)).toBeGreaterThan(hikingSignal(bridle));
    const ids = selectTrails([bridle, pilchuck]).map((t) => t.id);
    expect(ids).toEqual(['osm-r5537775', 'osm-r10668791']);
  });
  it('pushes down connectors, horse-only and access paths', () => {
    const base = hikingSignal(trail({ name: 'Fern Lake Trail' }));
    expect(hikingSignal(trail({ name: 'Fern Lake Connector' }))).toBeLessThan(base);
    const way = { id: 'osm-w1-0', name: 'Fern Lake Trail' };
    expect(hikingSignal(trail({ ...way, tags: { horse: 'designated' } }))).toBeLessThan(hikingSignal(trail(way)));
    expect(hikingSignal(trail({ name: 'Fern Lake Trail', tags: { horse: 'designated', foot: 'designated' } }))).toBe(base);
    expect(hikingSignal(trail({ name: 'Fern Lake Trail', tags: { horse: 'designated' } }))).toBe(base); // a route with foot unset is not penalised
  });
  it('is deterministic whatever the input order', () => {
    const a = selectTrails(real).map((t) => t.id), b = selectTrails([...real].reverse()).map((t) => t.id);
    expect(a).toEqual(b);
  });
});
