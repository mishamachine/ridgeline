// The share card: pure layout first (testable), then a thin Canvas 2D drawer. Everything runs on the device; no network.
import qrcode from 'qrcode-generator';
import { LngLat, cumulative, pointAt } from './geo';
import { BOBO_MARK_URL } from './boboMark';
import { ELEVATION_NOTICE } from './credits';
import { HikeSummary, boboLine, cardHeadline } from './hype';
import { SITE_HOST, trailUrl } from './shareLinks';
import { formatMiles, formatClimb, formatHoursMinutes } from './shareText';

export type CardFormat = 'story' | 'square';
export const CARD_SIZES: Record<CardFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };

/** Instagram story UI covers the top and bottom ~14%; keep text out of it. */
export const STORY_SAFE = 0.14;
export const TRIM_M = 200;
export const OSM_CREDIT = '© OpenStreetMap contributors';
export const CARD_FOOTER = 'Hike it yourself, free and offline';

export type CardTheme = 'dark' | 'light';
export interface Palette { bg: string; text: string; grey: string; body: string; ground: string; ridge: string; line: string; casing: string; pillBg: string; pillText: string; url: string }
export const PALETTES: Record<CardTheme, Palette> = {
  dark: { bg: '#111111', text: '#F7F7F5', grey: '#BDBDBD', body: '#D9D9D4', ground: '#1E1E1E', ridge: '#2E2E2C', line: '#F7F7F5', casing: '#111111', pillBg: '#F7F7F5', pillText: '#111111', url: '#F7F7F5' },
  light: { bg: '#F7F7F5', text: '#111111', grey: '#595959', body: '#3A3A3A', ground: '#E9ECE4', ridge: '#C9CFC2', line: '#111111', casing: '#FFFFFF', pillBg: '#111111', pillText: '#FFFFFF', url: '#D52B26' },
};
export const RED = '#D52B26';

export interface CardOptions {
  format: CardFormat;
  /** Off by default. Nothing about the route is drawn unless the person turns it on. */
  showRoute: boolean;
  /** On by default. Cuts the first and last 200 m of the track. */
  hideStart: boolean;
  /** Dark is the default; light is the alternate. */
  theme: CardTheme;
}
export const DEFAULT_CARD_OPTIONS: CardOptions = { format: 'story', showRoute: false, hideStart: true, theme: 'dark' };

export interface CardInput {
  summary: HikeSummary;
  newBadge?: { name: string } | null;
  badgeCount?: number;
  options: CardOptions;
}

export type Measure = (text: string, size: number, weight: number, family: 'display' | 'text') => number;
type Pt = [number, number];
type Rect = { x: number; y: number; w: number; h: number };

export type Op =
  | ({ kind: 'rect'; r: number; fill: string } & Rect)
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: number; family: 'display' | 'text'; color: string; align: 'left' | 'right'; tracking?: number }
  | { kind: 'bobo'; x: number; y: number; size: number }
  | { kind: 'route'; points: Pt[]; end: Pt }
  | { kind: 'elevation'; points: Pt[]; base: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: string }
  | { kind: 'qr'; x: number; y: number; size: number; modules: boolean[][] };

export interface CardLayout {
  w: number;
  h: number;
  ops: Op[];
  hero: Rect;
  routeShown: boolean;
  elevationShown: boolean;
  /** Lines printed under the hero (map and elevation credits). */
  credits: string[];
  footerH: number;
  theme: CardTheme;
}

// ---------- track privacy ----------

/** Drops the first and last `trimM` metres of a track. Returns [] when too little would be left to show. */
export function trimTrack(track: { lat: number; lon: number }[], trimM = TRIM_M, minLeftM = 100): LngLat[] {
  const pts: LngLat[] = track.map((p) => [p.lon, p.lat]);
  if (pts.length < 2) return [];
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  if (total - 2 * trimM < minLeftM) return [];
  const out: LngLat[] = [pointAt(pts, cum, trimM)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > trimM && cum[i] < total - trimM) out.push(pts[i]);
  out.push(pointAt(pts, cum, total - trimM));
  return out;
}

/** The track the card may draw, or [] if nothing safe is left. */
export function routeForCard(track: { lat: number; lon: number }[], hideStart: boolean): LngLat[] {
  if (!hideStart) return track.length >= 2 ? track.map((p): LngLat => [p.lon, p.lat]) : [];
  return trimTrack(track);
}

/** Fits a track into a rectangle as flat pixel points. No coordinates survive this step. */
export function projectRoute(coords: LngLat[], rect: Rect, pad: number, maxPoints = 240): Pt[] {
  if (coords.length < 2) return [];
  const step = Math.max(1, Math.ceil(coords.length / maxPoints));
  const picked = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  const latMid = picked.reduce((a, c) => a + c[1], 0) / picked.length;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const flat = picked.map(([lon, lat]) => [lon * kx, -lat] as Pt);
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1e-9, spanY = Math.max(...ys) - minY || 1e-9;
  const availW = rect.w - 2 * pad, availH = rect.h - 2 * pad;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offX = rect.x + pad + (availW - spanX * scale) / 2;
  const offY = rect.y + pad + (availH - spanY * scale) / 2;
  return flat.map(([x, y]) => [Math.round((offX + (x - minX) * scale) * 10) / 10, Math.round((offY + (y - minY) * scale) * 10) / 10] as Pt);
}

export function projectElevation(elev: number[], rect: Rect, minSpanM = 60): { points: Pt[]; base: number } {
  const lo = Math.min(...elev), hi = Math.max(...elev);
  const span = Math.max(hi - lo, minSpanM);
  const points = elev.map((e, i): Pt => [rect.x + (i / (elev.length - 1)) * rect.w, rect.y + rect.h - ((e - lo) / span) * rect.h]);
  return { points, base: rect.y + rect.h };
}

// ---------- text helpers ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function cardDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function wrap(text: string, maxW: number, size: number, weight: number, measure: Measure, family: 'display' | 'text' = 'display'): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(next, size, weight, family) > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitTitle(text: string, maxW: number, maxSize: number, minSize: number, measure: Measure): { lines: string[]; size: number } {
  const fits = (lines: string[], size: number) => lines.every((l) => measure(l, size, 800, 'display') <= maxW);
  for (let size = maxSize; size >= Math.round(maxSize * 0.72); size -= 4) {
    const lines = wrap(text, maxW, size, 800, measure);
    if (lines.length === 1 && fits(lines, size)) return { lines, size };
  }
  for (let size = maxSize; size >= minSize; size -= 4) {
    const lines = wrap(text, maxW, size, 800, measure);
    if (lines.length <= 2 && fits(lines, size)) return { lines, size };
  }
  let lines = wrap(text, maxW, minSize, 800, measure).slice(0, 2);
  let last = lines[lines.length - 1] ?? '';
  while (last.length > 1 && measure(`${last}…`, minSize, 800, 'display') > maxW) last = last.slice(0, -1);
  lines = [...lines.slice(0, -1), `${last.trimEnd()}…`];
  return { lines, size: minSize };
}

export function truncate(text: string, maxW: number, size: number, weight: number, measure: Measure): string {
  if (measure(text, size, weight, 'text') <= maxW) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, size, weight, 'text') > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function qrModules(url: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// ---------- layout ----------

export const QR_QUIET = 4;
export const MIN_QR_CELL = 4;
/** Whole pixels per module, so the code stays sharp when the card is shrunk. */
export const qrCell = (size: number, modules: number) => Math.floor(size / (modules + 2 * QR_QUIET));

const MIN_HERO = { story: 360, square: 190 };

export function layoutCard(input: CardInput, measure: Measure): CardLayout {
  const story = input.options.format === 'story';
  const maxTitle = story ? 96 : 80;
  const tries: [number, boolean][] = [[maxTitle, true], [maxTitle, false], [Math.round(maxTitle * 0.84), false], [Math.round(maxTitle * 0.7), false]];
  let last!: CardLayout;
  for (const [size, bobo] of tries) {
    last = build(input, measure, size, bobo);
    if (last.hero.h >= MIN_HERO[input.options.format]) break;
  }
  return last;
}

function build(input: CardInput, measure: Measure, titleMax: number, wantBobo: boolean): CardLayout {
  const { summary, options } = input;
  const P = PALETTES[options.theme ?? 'dark'];
  const { w, h } = CARD_SIZES[options.format];
  const story = options.format === 'story';
  const M = story ? 72 : 64;
  const top = story ? Math.round(h * STORY_SAFE) : M;
  const bottom = h - (story ? Math.round(h * STORY_SAFE) : M);
  const cw = w - 2 * M;
  const ops: Op[] = [{ kind: 'rect', x: 0, y: 0, w, h, r: 0, fill: P.bg }];
  const text = (o: Omit<Extract<Op, { kind: 'text' }>, 'kind' | 'align'> & { align?: 'left' | 'right' }) => ops.push({ kind: 'text', align: 'left', ...o });

  // header
  const hs = story ? 88 : 72;
  ops.push({ kind: 'bobo', x: M, y: top, size: hs });
  text({ x: M + hs + 20, y: top + hs * 0.63, text: 'RIDGELINE', size: story ? 40 : 34, weight: 800, family: 'display', color: P.text, tracking: 5 });
  text({ x: w - M, y: top + hs * 0.62, text: cardDate(summary.startedAt), size: story ? 34 : 30, weight: 600, family: 'text', color: P.grey, align: 'right' });
  let y = top + hs + (story ? 40 : 24);

  // headline
  const title = fitTitle(cardHeadline(summary), cw, titleMax, 52, measure);
  title.lines.forEach((line, i) => text({ x: M, y: y + title.size * (0.8 + i * 0.98), text: line, size: title.size, weight: 900, family: 'display', color: P.text }));
  y += title.size * (0.98 * title.lines.length + 0.1) + 12;

  // blocks measured from the bottom
  const gap = story ? 24 : 16;
  const modules = qrModules(trailUrl(summary.trail.id));
  const qrSize = Math.max(story ? 210 : 168, MIN_QR_CELL * (modules.length + 2 * QR_QUIET));
  const footerH = qrSize + 18; // rule + QR row; at most 15% of the card height
  const badgeText = input.newBadge?.name ? `New badge: ${input.newBadge.name}` : '';
  const route = options.showRoute ? routeForCard(summary.track, options.hideStart) : [];
  const routeShown = route.length >= 2;
  const elevation = !routeShown && (summary.trail.elevation?.length ?? 0) >= 2 ? summary.trail.elevation! : null;

  const creditSize = story ? 24 : 22;
  const creditLine = Math.round(creditSize * 1.25);
  const credits: string[] = [];
  if (elevation) credits.push(...wrap(ELEVATION_NOTICE, cw, creditSize, 600, measure, 'text'));
  if (routeShown) credits.push(OSM_CREDIT);
  const creditH = credits.length ? credits.length * creditLine + 6 : 0;

  const statSize = story ? 112 : 84;
  const statsH = statSize + 8;
  const pillH = badgeText ? (story ? 64 : 54) : 0;
  const boboH = story ? 44 : 38;
  const heroBottom = bottom - footerH - gap - (creditH ? creditH + gap : 0) - (pillH ? pillH + gap : 0) - statsH - gap;
  const heroTop = y + (wantBobo ? boboH + gap : 0);
  if (wantBobo) text({ x: M, y: y + boboH * 0.78, text: boboLine(summary), size: story ? 36 : 30, weight: 600, family: 'text', color: P.body });
  const hero: Rect = { x: M, y: heroTop, w: cw, h: Math.max(0, heroBottom - heroTop) };

  ops.push({ kind: 'rect', ...hero, r: 40, fill: P.ground });
  if (routeShown) {
    const points = projectRoute(route, hero, story ? 90 : 60);
    ops.push({ kind: 'route', points, end: points[points.length - 1] });
  } else if (elevation) {
    const area: Rect = { x: hero.x + 40, y: hero.y + hero.h * 0.3, w: hero.w - 80, h: hero.h * 0.5 };
    const prof = projectElevation(elevation, area);
    ops.push({ kind: 'elevation', ...prof });
    const peak = prof.points.reduce((a, p) => (p[1] < a[1] ? p : a));
    const bs = Math.min(hero.h * 0.3, 190);
    ops.push({ kind: 'bobo', x: Math.max(hero.x + 16, Math.min(peak[0] - bs / 2, hero.x + hero.w - bs - 16)), y: Math.max(hero.y + 16, peak[1] - bs - 8), size: bs });
  } else {
    const bs = Math.min(hero.h - 48, hero.w * 0.6, 560);
    ops.push({ kind: 'bobo', x: hero.x + (hero.w - bs) / 2, y: hero.y + (hero.h - bs) / 2, size: bs });
  }
  credits.forEach((c, i) => text({ x: M, y: hero.y + hero.h + gap + creditSize + i * creditLine, text: c, size: creditSize, weight: 600, family: 'text', color: P.grey }));
  y = hero.y + hero.h + gap + (creditH ? creditH + gap : 0);

  // stats on one line; units stay >= 36px at weight 700
  const stats: [string, string][] = [
    [formatMiles(summary.distanceM), 'mi'],
    [formatClimb(summary.climbFt), 'ft'],
    [formatHoursMinutes(summary.movingMs), 'hr'],
  ];
  const unitSize = story ? 40 : 36;
  const sep = story ? 40 : 28;
  const width = (ns: number) => stats.reduce((a, [n, u]) => a + measure(n, ns, 800, 'display') + 10 + measure(u, unitSize, 700, 'text'), 0) + 2 * sep;
  let ns = statSize;
  while (ns > 40 && width(ns) > cw) ns -= 2;
  let sx = M;
  for (const [n, u] of stats) {
    text({ x: sx, y: y + ns * 0.82, text: n, size: ns, weight: 800, family: 'display', color: P.text });
    sx += measure(n, ns, 800, 'display') + 10;
    text({ x: sx, y: y + ns * 0.82, text: u, size: unitSize, weight: 700, family: 'text', color: P.grey });
    sx += measure(u, unitSize, 700, 'text') + sep;
  }
  y += statsH + gap;

  // badge pill, clamped to the card width
  if (badgeText) {
    const ps = story ? 34 : 29;
    const label = truncate(badgeText, cw - 52, ps, 600, measure);
    const pw = measure(label, ps, 600, 'text') + 52;
    ops.push({ kind: 'rect', x: M, y, w: pw, h: pillH, r: pillH / 2, fill: P.pillBg });
    text({ x: M + 26, y: y + pillH * 0.68, text: label, size: ps, weight: 600, family: 'text', color: P.pillText });
    const count = input.badgeCount && input.badgeCount > 1 ? `${input.badgeCount} badges so far` : '';
    if (count && M + pw + 20 + measure(count, ps, 600, 'text') <= w - M) text({ x: M + pw + 20, y: y + pillH * 0.68, text: count, size: ps, weight: 600, family: 'text', color: P.grey });
    y += pillH + gap;
  }

  // footer: rule, call to action, URL, QR
  const fy = bottom - qrSize;
  ops.push({ kind: 'line', x1: M, y1: fy - 14, x2: w - M, y2: fy - 14, width: 4, color: P.text });
  const textW = cw - qrSize - 32;
  let fs = story ? 42 : 32;
  while (fs > 22 && measure(CARD_FOOTER, fs, 600, 'text') > textW) fs -= 2;
  text({ x: M, y: fy + qrSize * 0.4, text: CARD_FOOTER, size: fs, weight: 600, family: 'text', color: P.text });
  text({ x: M, y: fy + qrSize * 0.4 + fs * 1.35, text: SITE_HOST, size: Math.round(fs * 0.85), weight: 600, family: 'text', color: P.url });
  ops.push({ kind: 'qr', x: w - M - qrSize, y: fy, size: qrSize, modules });

  return { w, h, ops, hero, routeShown, elevationShown: !!elevation, credits, footerH, theme: options.theme ?? 'dark' };
}

// ---------- drawing ----------

const FAMILY = { display: '"Inter Tight", "Inter", system-ui, sans-serif', text: '"Inter", system-ui, sans-serif' };
const fontOf = (size: number, weight: number, family: 'display' | 'text') => `${weight} ${size}px ${FAMILY[family]}`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawCard(ctx: CanvasRenderingContext2D, layout: CardLayout, bobo: CanvasImageSource) {
  const P = PALETTES[layout.theme];
  for (const op of layout.ops) {
    if (op.kind === 'rect') {
      ctx.fillStyle = op.fill;
      if (op.r) { roundRect(ctx, op.x, op.y, op.w, op.h, op.r); ctx.fill(); } else ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === 'text') {
      ctx.font = fontOf(op.size, op.weight, op.family);
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align;
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${op.tracking ?? 0}px`;
      ctx.fillText(op.text, op.x, op.y);
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    } else if (op.kind === 'bobo') {
      ctx.drawImage(bobo, op.x, op.y, op.size, op.size);
    } else if (op.kind === 'route') {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const path = () => { ctx.beginPath(); op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
      ctx.strokeStyle = P.casing; ctx.lineWidth = 30; path(); ctx.stroke();
      ctx.strokeStyle = RED; ctx.lineWidth = 18; path(); ctx.stroke();
      ctx.fillStyle = P.casing; ctx.beginPath(); ctx.arc(op.end[0], op.end[1], 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P.line; ctx.beginPath(); ctx.arc(op.end[0], op.end[1], 16, 0, Math.PI * 2); ctx.fill();
    } else if (op.kind === 'elevation') {
      ctx.beginPath();
      op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(op.points[op.points.length - 1][0], op.base);
      ctx.lineTo(op.points[0][0], op.base);
      ctx.closePath();
      ctx.fillStyle = P.ridge; ctx.fill();
      ctx.beginPath();
      op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = P.line; ctx.lineWidth = 8; ctx.stroke();
    } else if (op.kind === 'line') {
      ctx.strokeStyle = op.color; ctx.lineWidth = op.width; ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke();
    } else if (op.kind === 'qr') {
      const quiet = QR_QUIET;
      const n = op.modules.length;
      const cell = qrCell(op.size, n);
      const off = (op.size - cell * (n + 2 * quiet)) / 2;
      ctx.fillStyle = '#FFFFFF'; roundRect(ctx, op.x, op.y, op.size, op.size, 14); ctx.fill();
      ctx.fillStyle = '#111111';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (op.modules[r][c]) ctx.fillRect(op.x + off + (c + quiet) * cell, op.y + off + (r + quiet) * cell, cell, cell);
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

async function loadFonts() {
  const faces = ['900 48px "Inter Tight"', '800 48px "Inter Tight"', '600 48px "Inter"', '700 48px "Inter"'];
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => [])));
  await document.fonts.ready;
}

/** Draws the card to a PNG on this device. */
export async function renderCard(input: CardInput): Promise<{ blob: Blob; layout: CardLayout }> {
  await loadFonts();
  const bobo = await loadImage(BOBO_MARK_URL);
  const { w, h } = CARD_SIZES[input.options.format];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const measure: Measure = (t, size, weight, family) => { ctx.font = fontOf(size, weight, family); return ctx.measureText(t).width; };
  const layout = layoutCard(input, measure);
  drawCard(ctx, layout, bobo);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not make the image');
  return { blob, layout };
}
