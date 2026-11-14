// Usage: node scripts/trail-stats.mjs <region build dir> <region id>
// Reads the full-resolution cells (<dir>/full), stitches every trail with the app's own code (src/lib/cells.ts), and stores each
// trail's length, ascent and descent, computed from the FULL line, into the v2 cells (<dir>/<x>_<y>.json, key "s"):
//   s: { "<key>": [length m, ascent m, descent m] }   key "r<relation id>" for routes, "w<lon,lat>|<lon,lat>" (its two ends, sorted) for named paths.
// The app uses these instead of measuring the simplified drawn line. Also writes <dir>/stats.json (not published) with the trail list and, for each
// classic trail in scripts/regions.json, what the app's own name search ranks first.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const [dir, regionId] = process.argv.slice(2);
if (!dir || !regionId) { console.error('usage: node scripts/trail-stats.mjs <region build dir> <region id>'); process.exit(2); }
const CELL = 0.25;
const t0 = Date.now();
const [{ module: cells }, { module: names }, { module: geo }] = await Promise.all([runnerImport('./src/lib/cells.ts'), runnerImport('./src/lib/nameIndex.ts'), runnerImport('./src/lib/geo.ts')]);
const haversine = geo.haversine;

const full = join(dir, 'full');
const keys = JSON.parse(readFileSync(join(full, 'index.json'), 'utf8')).cells;
const files = keys.map((k) => JSON.parse(readFileSync(join(full, `${k}.json`), 'utf8')));
const relCells = new Map();   // relation id -> cell keys that hold it
files.forEach((f, i) => { for (const r of f.r) { const s = relCells.get(r.id) ?? new Set(); s.add(keys[i]); relCells.set(r.id, s); } });
const have = new Set(keys);
const trails = cells.cellsToTrails(files);

const fmt = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const stored = new Map();   // cell key -> { trail key: [L, up, down] }
const list = [];
let skipped = 0;
for (const t of trails) {
  if (t.partial || t.ascentM == null) { skipped++; continue; }
  const m = /^osm-r(\d+)$/.exec(t.id);
  const ends = [fmt(t.coords[0]), fmt(t.coords.at(-1))].sort();
  const key = m ? `r${m[1]}` : `w${ends.join('|')}`;
  let into;
  if (m) into = relCells.get(+m[1]) ?? new Set();
  else {
    const xs = t.coords.map((c) => c[0]), ys = t.coords.map((c) => c[1]);
    into = new Set();
    for (let x = Math.floor((Math.min(...xs) + 180) / CELL); x <= Math.floor((Math.max(...xs) + 180) / CELL); x++)
      for (let y = Math.floor((Math.min(...ys) + 90) / CELL); y <= Math.floor((Math.max(...ys) + 90) / CELL); y++) if (have.has(`${x}_${y}`)) into.add(`${x}_${y}`);
  }
  const s = [Math.round(t.lengthM), Math.round(t.ascentM), Math.round(t.descentM ?? 0)];
  for (const c of into) { const o = stored.get(c) ?? {}; o[key] = s; stored.set(c, o); }
  list.push({ name: t.name, key, L: s[0], up: s[1], down: s[2], loop: t.loop });
}
// How much of its gain a trail loses when measured on the drawn (simplified) v2 line instead of the full line.
// The app shows the stored full-line numbers, but the profile it draws comes from the simplified line, so this is gated too.
const v2Files = readdirSync(dir).filter((f) => /^\d+_\d+\.json$/.test(f)).map((f) => { const c = JSON.parse(readFileSync(join(dir, f), 'utf8')); delete c.s; return c; });   // drawn numbers only: no stored stats, so a re-run gives the same answer
const keyOf = (t) => { const m = /^osm-r(\d+)$/.exec(t.id); return m ? `r${m[1]}` : `w${[t.coords[0], t.coords.at(-1)].map(fmt).sort().join('|')}`; };
const gain = (t) => (t.loop ? t.ascentM : Math.max(t.ascentM, t.descentM ?? 0));
const drawn = new Map(cells.cellsToTrails(v2Files).filter((t) => !t.partial && t.ascentM != null).map((t) => [keyOf(t), t]));
const fidelity = [];
for (const t of trails) {
  if (t.partial || t.ascentM == null) continue;
  const d = drawn.get(keyOf(t));
  if (d) fidelity.push({ name: t.name, key: keyOf(t), L: Math.round(t.lengthM), drawnL: Math.round(d.lengthM), gain: Math.round(gain(t)), drawnGain: Math.round(gain(d)) });
}
const judged = fidelity.filter((f) => f.gain >= 30);   // under 30 m (100 ft) of gain, the 8 m noise gate decides everything
const lost = judged.filter((f) => f.drawnGain < 0.75 * f.gain);
const loss = { judged: judged.length, over25: lost.length, share: judged.length ? lost.length / judged.length : 0 };
let bytes = 0;
for (const f of readdirSync(dir).filter((f) => /^\d+_\d+\.json$/.test(f))) {
  const p = join(dir, f), c = JSON.parse(readFileSync(p, 'utf8'));
  const s = stored.get(f.replace('.json', ''));
  if (s) { c.s = s; const body = JSON.stringify(c); writeFileSync(p, body); bytes += JSON.stringify(s).length; }
}

// Chains that are not one route (the Dog Mountain signature): the profile dips to a low point in the middle that is far below an end,
// as when a leg runs down to the trailhead mid-chain. Counted on the full-resolution profiles, over every stitched trail with heights.
const LOW_M = 100;
const withElev = trails.filter((t) => t.elevation && t.elevation.length >= 20);
const lows = [];
for (const t of withElev) {
  const e = t.elevation, k = Math.floor(e.length * 0.05);
  let lo = Infinity, at = -1;
  for (let i = k; i < e.length - k; i++) if (e[i] < lo) { lo = e[i]; at = i; }
  const first = e[0], last = e.at(-1);
  const bothEnds = lo < Math.min(first, last) - LOW_M;   // interior low point more than 100 m below BOTH ends
  const startEnd = lo < first - LOW_M && last - lo >= 50;  // ... or more than 100 m below the start end only, and then climbing again (a plain descent is not a dip)
  if (startEnd || bothEnds) lows.push({ id: t.id, name: t.name, lengthM: Math.round(t.lengthM), first, last, low: lo, at, bothEnds, startEnd, partial: t.partial });
}
// Another proxy: the car park picked as trailhead is not at a chain end (more than 150 m from both ends).
const farTh = withElev.filter((t) => t.trailheadIsParking && t.trailhead && Math.min(haversine(t.trailhead, t.coords[0]), haversine(t.trailhead, t.coords.at(-1))) > 150).map((t) => ({ id: t.id, name: t.name }));
const dayTotal = withElev.filter((t) => t.lengthM <= 20000).length;   // day-hike length: long through-trails have real valleys
const day = (l) => l.lengthM <= 20000;
const lowpoint = { total: withElev.length, day_total: dayTotal, day_below_both_ends: lows.filter((l) => l.bothEnds && day(l)).length, day_below_start_end: lows.filter((l) => l.startEnd && day(l)).length, below_both_ends: lows.filter((l) => l.bothEnds).length, below_start_end: lows.filter((l) => l.startEnd).length, trailhead_off_end: farTh.length,
  examples: lows.filter((l) => l.bothEnds && day(l) && l.id.startsWith('osm-r')).sort((a, b) => b.lengthM - a.lengthM).slice(0, 8) };

// What the app's own name search ranks first for each classic trail.
const regions = JSON.parse(readFileSync('./scripts/regions.json', 'utf8')).regions;
const entries = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8')).e;
const classics = (regions.find((r) => r.id === regionId)?.classics ?? []).map((c) => ({ name: c.name, top: names.searchNames(entries, c.name, 1)[0] ?? null }));
writeFileSync(join(dir, 'stats.json'), JSON.stringify({ trails: list, classics, stored: list.length, skipped, bytes, loss, fidelity, lowpoint }));
console.log(`drawn-profile gain loss: ${loss.over25} of ${loss.judged} trails (${(loss.share * 100).toFixed(2)}%) lose more than 25% of their gain on the simplified line`);
console.log(`mid-chain low points (>${LOW_M} m below an end, full-resolution profiles): below both ends ${lowpoint.below_both_ends}, below the start end ${lowpoint.below_start_end}, of ${lowpoint.total} stitched trails; of which up to 20 km long: ${lowpoint.day_below_both_ends} below both ends, ${lowpoint.day_below_start_end} below the start end, of ${lowpoint.day_total}; chosen trailhead more than 150 m from both chain ends: ${lowpoint.trailhead_off_end}`);
console.log(`trail stats: ${list.length} trails stored (${skipped} partial or without elevation skipped), ${(bytes / 1e6).toFixed(2)} MB added to the cells, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
