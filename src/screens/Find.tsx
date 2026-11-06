import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView, setGeo } from '../components/MapView';
import { TrailRow } from '../components/TrailRow';
import { SearchIcon, LocateIcon } from '../components/Icons';
import { fetchCellTrails } from '../lib/cells';
import { fetchTrails, difficulty, Trail } from '../lib/trails';
import { getSetting, putSetting } from '../lib/store';
import { M_TO_MI, LngLat } from '../lib/geo';

interface Props { tpl: string; visible: boolean; savedIds: Set<string>; onOpen: (t: Trail) => void }
type Status = { kind: 'idle' | 'loading' | 'zoom' | 'error' | 'offline'; msg?: string };

const MAX_SPAN_DEG = 0.5; // ~35 km across: a handful of trail cells

export function Find({ tpl, visible, savedIds, onOpen }: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [moved, setMoved] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ short: false, loops: false, easy: false });
  const [activeId, setActiveId] = useState<string | null>(null);

  // Resize the map when the tab is shown again (it was laid out while hidden).
  useEffect(() => { if (visible) mapRef.current?.resize(); }, [visible]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trails.filter((t) =>
      (!q || t.name.toLowerCase().includes(q)) &&
      (!filters.short || t.lengthM * M_TO_MI <= 5) &&
      (!filters.loops || t.loop) &&
      (!filters.easy || difficulty(t) === 'Easy'));
  }, [trails, query, filters]);

  // Draw the trails on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setGeo(map, 'trails', {
      type: 'FeatureCollection',
      features: shown.map((t) => ({
        type: 'Feature', id: t.id,
        properties: { id: t.id, active: t.id === activeId },
        geometry: { type: 'LineString', coordinates: t.coords },
      })),
    });
  }, [shown, activeId]);

  async function loadArea() {
    const map = mapRef.current;
    if (!map) return;
    setMoved(false);
    const b = map.getBounds();
    if (b.getEast() - b.getWest() > MAX_SPAN_DEG || b.getNorth() - b.getSouth() > MAX_SPAN_DEG) {
      setStatus({ kind: 'zoom' });
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ kind: 'loading' });
    const box = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    try {
      // Hosted trail files first (fast, cached for offline); public Overpass servers outside coverage.
      let found = await fetchCellTrails(box, ac.signal).catch((e) => {
        if ((e as Error).name === 'AbortError') throw e;
        return null;
      });
      if (!found) {
        if (!navigator.onLine) { setStatus({ kind: 'offline' }); return; }
        found = await fetchTrails(box, ac.signal);
      }
      setTrails(found);
      setStatus({ kind: 'idle' });
      const c = map.getCenter();
      putSetting('lastView', { center: [c.lng, c.lat], zoom: map.getZoom() });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function onReady(map: MLMap) {
    mapRef.current = map;
    map.on('moveend', (e) => { if ((e as { originalEvent?: unknown }).originalEvent) setMoved(true); });
    map.on('click', 'trails-hit', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) {
        setActiveId(id);
        document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    map.on('mouseenter', 'trails-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'trails-hit', () => (map.getCanvas().style.cursor = ''));

    // Show trails right away (last place or a default), then move to the user if location arrives.
    const last = await getSetting<{ center: LngLat; zoom: number }>('lastView');
    if (last) map.jumpTo({ center: last.center, zoom: last.zoom });
    loadArea();
    if (!last) locate(true);
  }

  function locate(quiet = false) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        mapRef.current?.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 12 });
        loadArea();
      },
      () => { if (!quiet) setStatus({ kind: 'error', msg: 'Location is off. Search for a place instead.' }); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || shown.length > 0) return; // typed text already filters the list
    if (!navigator.onLine) { setStatus({ kind: 'offline' }); return; }
    try {
      setStatus({ kind: 'loading' });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      const [hit] = await res.json();
      if (!hit) { setStatus({ kind: 'error', msg: `No place called “${q}”.` }); return; }
      setQuery('');
      const [s, n, w, ea] = hit.boundingbox.map(Number);
      const map = mapRef.current!;
      map.fitBounds([[w, s], [ea, n]], { padding: 24, maxZoom: 13, duration: 0 });
      if (map.getZoom() < 11) map.jumpTo({ center: [Number(hit.lon), Number(hit.lat)], zoom: 11 });
      loadArea();
    } catch {
      setStatus({ kind: 'error', msg: 'Place search failed. Try again.' });
    }
  }

  const toggle = (k: keyof typeof filters) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  return (
    <>
      <div className="top" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1>Find</h1>
          <span className="meta">{status.kind === 'loading' ? 'Searching…' : `${shown.length} trail${shown.length === 1 ? '' : 's'} here`}</span>
        </div>
        <form className="search" onSubmit={onSearch} role="search">
          <label htmlFor="q" className="sr">Search trails or places</label>
          <SearchIcon />
          <input id="q" type="search" enterKeyHint="search" placeholder="Search trails or places" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </form>
        <div className="chips" role="group" aria-label="Filters">
          <button className="chip" aria-pressed={filters.short} onClick={() => toggle('short')}>≤ 5 mi</button>
          <button className="chip" aria-pressed={filters.loops} onClick={() => toggle('loops')}>Loops</button>
          <button className="chip" aria-pressed={filters.easy} onClick={() => toggle('easy')}>Easy</button>
        </div>
      </div>

      <div className="map-box" style={{ height: '42vh', minHeight: 240, flex: 'none' }}>
        <MapView tileTemplate={tpl} onReady={onReady} label="Trail map" />
        {moved && status.kind !== 'loading' && <button className="map-action" onClick={loadArea}>Search this area</button>}
        <button className="icon-btn" aria-label="Go to my location" onClick={() => locate()} style={{ position: 'absolute', right: 12, bottom: 28, zIndex: 2 }}><LocateIcon /></button>
      </div>

      {status.kind === 'zoom' && <p className="notice">Zoom in to find trails in this area.</p>}
      {status.kind === 'offline' && <p className="notice">You’re offline and this area hasn’t been viewed before. Your saved trails are in the Offline tab.</p>}
      {status.kind === 'error' && <p className="notice">{status.msg}</p>}

      <div className="pad" style={{ flex: 1 }}>
        {shown.map((t) => (
          <div id={`row-${t.id}`} key={t.id}>
            <TrailRow trail={t} saved={savedIds.has(t.id)} active={t.id === activeId} onClick={() => onOpen(t)} />
          </div>
        ))}
        {status.kind === 'idle' && trails.length > 0 && shown.length === 0 && (
          <p className="empty">No trails match. {query && 'Press search to look for a place with that name.'}</p>
        )}
        {status.kind === 'idle' && trails.length === 0 && <p className="empty">No mapped trails here yet. Try another area.</p>}
      </div>
    </>
  );
}
