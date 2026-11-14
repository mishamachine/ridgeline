// The reader prefers trails/v2/ and falls back to the frozen old-format copy at trails/ (Washington only) when v2 is not deployed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const v1 = fx('wa-cells.json').ledge[0], v2 = fx('wa-cells-v2.json').ledge[0];
const index = { v: 1, built: '', source: 'fixture', cell: 0.25, bbox: [-122, 47.25, -121.5, 47.5], cells: ['232_549'] };
const box = { west: -121.8, south: 47.4, east: -121.7, north: 47.45 };

function deploy(files: Record<string, unknown>, asHtml: string[] = []) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (u: string) => {
    urls.push(u);
    const path = u.replace(/^.*\/trails\//, '');
    if (asHtml.includes(path)) return new Response('<html></html>', { status: 200 });   // a host that answers 200 with a page
    return path in files ? new Response(JSON.stringify(files[path])) : new Response('', { status: 404 });
  });
  return urls;
}
const load = async () => { vi.resetModules(); return import('./cells'); };
afterEach(() => vi.unstubAllGlobals());

describe('versioned trail data', () => {
  it('reads trails/v2/ when it exists', async () => {
    const urls = deploy({ 'v2/index.json': { ...index, v: 2 }, 'v2/232_549.json': v2, 'index.json': index, '232_549.json': v1 });
    const { fetchCellTrails, getIndex } = await load();
    const trails = await fetchCellTrails(box);
    expect(trails!.some((t) => t.id === 'osm-r5588030')).toBe(true);
    expect((await getIndex())!.base).toMatch(/trails\/v2\/$/);
    expect(urls.some((u) => /trails\/232_549\.json/.test(u))).toBe(false);
  });

  it('falls back to the old path on 404', async () => {
    const urls = deploy({ 'index.json': index, '232_549.json': v1 });
    const { fetchCellTrails, getIndex } = await load();
    const trails = await fetchCellTrails(box);
    expect(trails!.find((t) => t.id === 'osm-r5588030')!.ascentM).toBeGreaterThan(300);
    expect((await getIndex())!.base).toMatch(/trails\/$/);
    expect(urls[0]).toMatch(/trails\/v2\/index\.json$/);
  });

  it('falls back when v2/index.json answers 200 with a page instead of JSON', async () => {
    deploy({ 'index.json': index, '232_549.json': v1 }, ['v2/index.json']);
    const { getIndex } = await load();
    expect((await getIndex())!.base).toMatch(/trails\/$/);
  });

  it('is null when neither exists', async () => {
    deploy({});
    const { getIndex, fetchCellTrails } = await load();
    expect(await getIndex()).toBeNull();
    expect(await fetchCellTrails(box)).toBeNull();
  });

  it('v1 and v2 give the same trail', async () => {
    deploy({ 'index.json': index, '232_549.json': v1 });
    const a = (await (await load()).fetchCellTrails(box))!.find((t) => t.id === 'osm-r5588030')!;
    deploy({ 'v2/index.json': index, 'v2/232_549.json': v2 });
    const b = (await (await load()).fetchCellTrails(box))!.find((t) => t.id === 'osm-r5588030')!;
    expect(Math.abs(b.ascentM! / a.ascentM! - 1)).toBeLessThan(0.04);
    expect(b.name).toBe(a.name);
  });
});
