import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { setGeo } from '../components/mapGeo';
import { LazyMap as MapView } from '../components/LazyMap';
import { Placeholder } from '../components/Bobo';
import { PageHead } from '../components/PageHead';
import { TrailCard } from '../components/TrailCard';
import { hasHighlight } from '../components/Chips';
import { FindIcon, ListIcon, MapIcon, ShareIcon, CloseIcon } from '../components/NavIcons';
import { LocateIcon } from '../components/Icons';
import { fetchCellTrails, getIndex } from '../lib/cells';
import { byDistance, centreOf, inCoverage, listNames, regionsOf, type CoverageRegion } from '../lib/coverage';
import { fetchTrails, Trail } from '../lib/trails';
import { getSetting, putSetting } from '../lib/store';
import { haversine, M_TO_MI, LngLat } from '../lib/geo';
import { filterTrails, rankTrails } from '../lib/quality';
import { level, tripMinutes } from '../lib/plan';
import { trailheadOf } from '../lib/maps';
import { loadNameIndex, searchNames, type NameEntry } from '../lib/nameIndex';
import { searchPlaces, type Place } from '../lib/geocode';
import { remember } from '../lib/lookup';
import { shareApp } from '../lib/share';
import { mi } from '../lib/format';
import { regionNameAt, roundTripMi } from '../lib/home';
import type { BrowsePreset } from './Home';

interface Props {
  tpl: string;
  visible: boolean;
  savedIds: Set<string>;
  offlineIds: Set<string>;
  onOpen: (t: Trail) => void;
  onOpenId: (id: string, ll: LngLat) => void;
  onToggleSave: (t: Trail) => void;
  /** Set when Home sent the person here (See all, Explore the map); null if they never came from Home. */
  preset?: BrowsePreset | null;
  onHome?: () => void;
}
type Status = { kind: 'idle' | 'loading' | 'zoom' | 'error' | 'offline'; msg?: string };
type Chip = 'near' | 'under3' | 'easy' | 'views' | 'dogs' | 'short' | 'falls';

/** The filters each Home row stands for, so "See all" lists the same trails. */
const PRESET_CHIPS: Record<NonNullable<BrowsePreset['collection']>, Chip[]> = { top: [], view: ['short', 'views'], dogs: ['dogs'], falls: ['falls'] };

const MAX_SPAN_DEG = 0.5;                          // ~35 km across: a handful of trail cells
const DEFAULT_VIEW = { center: [-121.78, 47.49] as LngLat, zoom: 12 }; // North Bend, WA: many trails within an hour of Seattle
const PAGE = 30;

/** Search box that stays responsive while the trail list re-renders. */
const List = memo(function List({ trails, savedIds, offlineIds, me, onOpen, onToggleSave }: {
  trails: Trail[]; savedIds: Set<string>; offlineIds: Set<string>; me: LngLat | null;
  onOpen: (t: Trail) => void; onToggleSave: (t: Trail) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [trails]);
  return (
    <>
      {trails.slice(0, limit).map((t) => {
        const th = trailheadOf(t);
        return (
          <TrailCard key={t.id} trail={t} saved={savedIds.has(t.id)} offline={offlineIds.has(t.id)}
            awayMi={me ? haversine(me, [th.lon, th.lat]) * M_TO_MI : null} onOpen={onOpen} onToggleSave={onToggleSave} />
        );
      })}
      {trails.length > limit && <button className="btn btn-outline" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, trails.length - limit)} more</button>}
    </>
  );
});

export function Find({ tpl, visible, savedIds, offlineIds, onOpen, onOpenId, onToggleSave, preset, onHome }: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const viewRef = useRef<{ center: LngLat; zoom: number }>(DEFAULT_VIEW);
  const abortRef = useRef<AbortController | null>(null);
  const presetCenter = useRef(preset?.center);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [moved, setMoved] = useState(false);
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [me, setMe] = useState<LngLat | null>(null);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapMsg, setMapMsg] = useState(false);
  const [drawTick, setDrawTick] = useState(0);
  const [retry, setRetry] = useState(0);
  const [regions, setRegions] = useState<CoverageRegion[]>([]); // covered regions, from the data
  const regionsRef = useRef<CoverageRegion[]>([]);
  const [outside, setOutside] = useState(false);

  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<NameEntry[]>([]);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);

  useEffect(() => { if (visible) mapRef.current?.resize(); }, [visible, mode]);

  const matches = useMemo(() => searchNames(names, deferred, 6, viewRef.current.center), [names, deferred]);

  const { shown, hasHighlights } = useMemo(() => {
    const clean = rankTrails(filterTrails(trails), me ?? viewRef.current.center);
    let out = clean.filter((t) =>
      (!chips.has('under3') || tripMinutes(t) <= 180) &&
      (!chips.has('easy') || level(t) === 'Easy') &&
      (!chips.has('views') || hasHighlight(t, 'view')) &&
      (!chips.has('dogs') || hasHighlight(t, 'dogs')) &&
      (!chips.has('short') || roundTripMi(t) < 3) &&
      (!chips.has('falls') || hasHighlight(t, 'falls')));
    if (chips.has('near') && me) out = [...out].sort((a, b) => dist(me, a) - dist(me, b));
    return { shown: out, hasHighlights: clean.some((t) => t.highlights?.length) };
  }, [trails, chips, me]);

  // Draw the shown trails on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setGeo(map, 'trails', {
      type: 'FeatureCollection',
      features: shown.map((t) => ({
        type: 'Feature', id: t.id,
        properties: { id: t.id, active: t.id === selected },
        geometry: { type: 'LineString', coordinates: t.coords },
      })),
    });
  }, [shown, selected, drawTick]);

  /** Load trails for the map's view, or for the remembered view while the map itself is still starting. */
  const loadArea = useCallback(async () => {
    setMoved(false);
    const map = mapRef.current;
    let box;
    if (map) {
      const b = map.getBounds();
      box = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } else {
      const [x, y] = viewRef.current.center;
      box = { west: x - 0.1, east: x + 0.1, south: y - 0.07, north: y + 0.07 };
    }
    if (box.east - box.west > MAX_SPAN_DEG || box.north - box.south > MAX_SPAN_DEG) { setStatus({ kind: 'zoom' }); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ kind: 'loading' });
    setOutside(!inCoverage(regionsRef.current, [(box.west + box.east) / 2, (box.south + box.north) / 2]));
    try {
      // Hosted trail files first (fast, cached for offline); public Overpass servers outside coverage.
      let found = await fetchCellTrails(box, ac.signal).catch((e) => {
        if ((e as Error).name === 'AbortError') throw e;
        return null;
      });
      if (!found) {
        if (!navigator.onLine) { setStatus({ kind: 'offline' }); setLoaded(true); return; }
        found = await fetchTrails(box, ac.signal);
      }
      remember(found);
      setTrails(found);
      setLoaded(true);
      setStatus({ kind: 'idle' });
      if (map) {
        const c = map.getCenter();
        viewRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
        putSetting('lastView', viewRef.current);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setLoaded(true);
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }, []);

  // Start loading trails at once; they do not wait for the map style.
  useEffect(() => {
    let live = true;
    Promise.all([getSetting<{ center: LngLat; zoom: number }>('lastView'), getIndex().catch(() => null)]).then(([last, idx]) => {
      const r = regionsOf(idx);
      regionsRef.current = r;
      if (live) setRegions(r);
      if (live && last && inCoverage(r, last.center) && !presetCenter.current) viewRef.current = last;
      if (live) loadArea();
    });
    return () => { live = false; abortRef.current?.abort(); };
  }, [loadArea]);

  // Home's "See all" and "Explore the map": apply that row's filters and look where Home was looking.
  useEffect(() => {
    if (!preset) return;
    setChips(new Set(preset.collection ? PRESET_CHIPS[preset.collection] : []));
    setMode(preset.map ? 'map' : 'list');
    if (preset.center) {
      viewRef.current = { center: preset.center, zoom: 12 };
      mapRef.current?.jumpTo({ center: preset.center, zoom: 12 });
      loadArea();
    }
  }, [preset?.id]);

  function onReady(map: MLMap) {
    mapRef.current = map;
    map.jumpTo({ center: viewRef.current.center, zoom: viewRef.current.zoom });
    map.on('moveend', (e) => { if ((e as { originalEvent?: unknown }).originalEvent) setMoved(true); });
    map.on('click', 'trails-hit', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) setSelected(id);
    });
    map.on('click', (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ['trails-hit'] }).length) setSelected(null); });
    setGeo(map, 'trails', { type: 'FeatureCollection', features: [] });
    setDrawTick((k) => k + 1); // redraw the trails already loaded
  }

  function flyTo(center: LngLat, zoom = 12, bbox?: [number, number, number, number]) {
    const map = mapRef.current;
    viewRef.current = { center, zoom };
    if (map) {
      if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 24, maxZoom: 13, duration: 0 });
      if (!bbox || map.getZoom() < 11) map.jumpTo({ center, zoom: Math.max(11, zoom) });
    }
    loadArea();
  }

  function nearMe() {
    if (me && chips.has('near')) { toggle('near'); return; }
    if (!navigator.geolocation) { setStatus({ kind: 'error', msg: 'This device has no location. Search for a place instead.' }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here: LngLat = [p.coords.longitude, p.coords.latitude];
        setMe(here);
        setChips((c) => new Set(c).add('near'));
        setAreaLabel('you');
        flyTo(here, 12);
      },
      () => setStatus({ kind: 'error', msg: 'Location is off. Search for a place instead.' }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  const toggle = (c: Chip) => setChips((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  async function focusSearch() {
    setOpen(true);
    if (!names.length) setNames(await loadNameIndex(viewRef.current.center));
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2 || placeBusy) return;
    if (!navigator.onLine) { setPlaceMsg('You’re offline. Place search needs a connection.'); return; }
    setPlaceBusy(true); setPlaceMsg(null);
    try {
      const found = await searchPlaces(q);
      setPlaces(found);
      if (!found.length) setPlaceMsg(`No place called “${q}”.`);
    } catch {
      setPlaceMsg('Place search failed. Try again.');
    } finally { setPlaceBusy(false); }
  }

  function pickPlace(p: Place) {
    closeSearch();
    setAreaLabel(p.name);
    setChips((c) => { const n = new Set(c); n.delete('near'); return n; });
    flyTo([p.lon, p.lat], 11, p.bbox);
  }

  function closeSearch() { setQuery(''); setOpen(false); setPlaces(null); setPlaceMsg(null); }

  const activeSelected = shown.find((t) => t.id === selected) ?? null;
  const filtering = chips.size > 0 && !(chips.size === 1 && chips.has('near'));
  const q = query.trim();
  const showSuggest = open && q.length >= 2;

  return (
    <>
      <div className="find-head">
        {onHome && <button className="hm-link hm-back" onClick={onHome}>‹ Home</button>}
        <PageHead title="All trails" byline><button className="round" aria-label="Share Ridgeline" onClick={shareApp}><ShareIcon /></button></PageHead>
        <div className="searchbox">
          <form className="search2" onSubmit={onSearch} role="search">
            <FindIcon />
            <label htmlFor="q" className="sr">Search trails, parks or towns</label>
            <input id="q" type="search" role="combobox" aria-expanded={showSuggest} aria-controls="suggest" aria-autocomplete="list" enterKeyHint="search" placeholder="Trail, park or town" value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); setPlaces(null); setPlaceMsg(null); }}
              onFocus={focusSearch} onBlur={() => setOpen(false)} autoComplete="off" autoCorrect="off" spellCheck={false} />
            {query && <button type="button" className="clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={closeSearch}><CloseIcon size={18} /></button>}
          </form>
          {showSuggest && (
            <div className="suggest" id="suggest" role="listbox" onPointerDown={(e) => e.preventDefault()}>
              {matches.map((m) => (
                <button key={m[0]} role="option" aria-selected="false" className="sg" onClick={() => { closeSearch(); onOpenId(m[0], [m[2], m[3]]); }}>
                  <span className="sg-name">{m[1]}</span>
                  <span className="sg-sub">{regionNameAt(m[2], m[3]) ? `Trail · ${regionNameAt(m[2], m[3])}` : 'Trail'}</span>
                </button>
              ))}
              {places?.map((p, i) => (
                <button key={`${p.lon},${p.lat},${i}`} role="option" aria-selected="false" className="sg" onClick={() => pickPlace(p)}>
                  <span className="sg-name">{p.name}</span>
                  <span className="sg-sub">Place · {p.detail}</span>
                </button>
              ))}
              {!places && (
                <button className="sg sg-place" disabled={placeBusy} onClick={onSearch}>
                  <span className="sg-name">{placeBusy ? 'Searching places…' : `Search places for “${q}”`}</span>
                </button>
              )}
              {placeMsg && <div className="sg-msg">{placeMsg}</div>}
              {!names.length && !places && <div className="sg-msg">Trail names load when you’re online.</div>}
            </div>
          )}
        </div>
        <div className="chips2" role="group" aria-label="Quick filters">
          <button className="chip2" aria-pressed={chips.has('near')} onClick={nearMe}>Near me</button>
          <button className="chip2" aria-pressed={chips.has('under3')} onClick={() => toggle('under3')}>Under 3 h</button>
          <button className="chip2" aria-pressed={chips.has('easy')} onClick={() => toggle('easy')}>Easy</button>
          {hasHighlights && <button className="chip2" aria-pressed={chips.has('views')} onClick={() => toggle('views')}>Views</button>}
          {hasHighlights && <button className="chip2" aria-pressed={chips.has('dogs')} onClick={() => toggle('dogs')}>Dogs: tagged yes</button>}
          <button className="chip2" aria-pressed={chips.has('short')} onClick={() => toggle('short')}>Under 3 mi</button>
          {hasHighlights && <button className="chip2" aria-pressed={chips.has('falls')} onClick={() => toggle('falls')}>Waterfalls</button>}
        </div>
        <div className="row-between">
          <div className="count" role="status">
            {status.kind === 'loading' && !loaded ? 'Loading trails…' : `${shown.length} trail${shown.length === 1 ? '' : 's'} ${areaLabel ? `near ${areaLabel}` : 'in this area'}`}
          </div>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}><ListIcon size={16} /> List</button>
            <button aria-pressed={mode === 'map'} onClick={() => setMode('map')}><MapIcon size={16} /> Map</button>
          </div>
        </div>
      </div>

      <div className="find-body">
        <div className="find-map" inert={mode !== 'map'}>
          <MapView key={retry} tileTemplate={tpl} onReady={onReady} label="Trail map" onProblem={() => setMapMsg(true)} />
        </div>
        {mode === 'map' && (
          <>
            {moved && status.kind !== 'loading' && <button className="map-action2" onClick={loadArea}>Search this area</button>}
            <button className="round map-locate" aria-label="Go to my location" onClick={nearMe}><LocateIcon /></button>
            {mapMsg && <div className="map-note" role="status">The map is slow right now. The list still works. <button className="link-btn" onClick={() => { setMapMsg(false); setRetry((n) => n + 1); }}>Retry</button></div>}
            {activeSelected && (
              <div className="map-pick">
                <TrailCard trail={activeSelected} saved={savedIds.has(activeSelected.id)} offline={offlineIds.has(activeSelected.id)} onOpen={onOpen} onToggleSave={onToggleSave} />
              </div>
            )}
          </>
        )}
        {mode === 'list' && (
          <div className="find-list">
            {status.kind === 'zoom' && <p className="note">Zoom the map in, or search a place, to see trails.</p>}
            {status.kind === 'offline' && <p className="note">You’re offline and this area hasn’t been viewed before. Your saved trails are in Saved.</p>}
            {status.kind === 'error' && <p className="note note-alert" role="alert">{status.msg} <button className="link-btn" onClick={loadArea}>Try again</button></p>}
            {!loaded && status.kind === 'loading' && <Placeholder title="Loading trails…">Finding hikes {areaLabel ? `near ${areaLabel}` : 'in this area'}.</Placeholder>}
            {loaded && shown.length === 0 && status.kind !== 'loading' && status.kind !== 'error' && (
              trails.length > 0 && filtering ? (
                <Placeholder title="No trails match these filters">
                  <button className="btn btn-outline" onClick={() => setChips((c) => new Set([...c].filter((x) => x === 'near')))}>Clear filters</button>
                </Placeholder>
              ) : outside ? (
                <Placeholder title="Outside our trail coverage">
                  Ridgeline has trails for {listNames(regions)} so far.
                  {byDistance(regions, viewRef.current.center).slice(0, 2).map((r) => (
                    <button key={r.id} className="btn btn-outline" onClick={() => { setAreaLabel(r.name); flyTo(centreOf(r), 11); }}>Go to {r.name}</button>
                  ))}
                </Placeholder>
              ) : (
                <Placeholder title="No hiking trails mapped in this view">Search a park or town above, or tap Map and move it.</Placeholder>
              )
            )}
            <List trails={shown} savedIds={savedIds} offlineIds={offlineIds} me={me} onOpen={onOpen} onToggleSave={onToggleSave} />
          </div>
        )}
      </div>
    </>
  );
}

const dist = (me: LngLat, t: Trail) => { const th = trailheadOf(t); return haversine(me, [th.lon, th.lat]); };
