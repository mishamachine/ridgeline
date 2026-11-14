import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FindIcon, CloseIcon } from '../components/NavIcons';
import { getIndex } from '../lib/cells';
import type { LngLat } from '../lib/geo';
import {
  NO_FILTERS, applyFilters, regionNameAt, buildCollections, coverageRegions, defaultRegion, deviceTimeZone, greeting, isCovered, isFiltering,
  loadAround, nearestRegion, type Collection, type HomeFilters, type Region,
} from '../lib/home';
import { remember } from '../lib/lookup';
import { onEnter } from '../lib/homeSearch';
import type { Place } from '../lib/geocode';
import { loadNameIndex, searchNames, type NameEntry } from '../lib/nameIndex';
import { useSettings } from '../lib/settings';
import { listAllSaved, type SavedItem } from '../lib/saved';
import { getSetting, putSetting } from '../lib/store';
import type { Trail } from '../lib/trails';
import { HomeView, type Area, type HomeMode, type LocState } from './HomeView';

export interface BrowsePreset { id: number; collection?: Collection['id']; center?: LngLat; map?: boolean }

interface Props {
  visible: boolean;
  version: number;
  hike: Trail | null;
  savedIds: Set<string>;
  offlineIds: Set<string>;
  onOpen: (t: Trail) => void;
  onOpenId: (id: string, ll: LngLat) => void;
  onToggleSave: (t: Trail) => void;
  onResume: () => void;
  onBrowse: (p: Omit<BrowsePreset, 'id'>) => void;
}

interface Picked { name: string; center: LngLat; region?: boolean }
type IndexT = Awaited<ReturnType<typeof getIndex>>;

export function Home({ visible, version, hike, savedIds, offlineIds, onOpen, onOpenId, onToggleSave, onResume, onBrowse }: Props) {
  const [index, setIndex] = useState<IndexT>(null);
  const [indexTried, setIndexTried] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loc, setLoc] = useState<LocState>('unasked');
  const [me, setMe] = useState<LngLat | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [trails, setTrails] = useState<Trail[] | null>(null);
  const [outside, setOutside] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [{ units }] = useSettings();
  const [filters, setFilters] = useState<HomeFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Search: type-ahead reads only our own name index (no network on keystrokes). Enter may make ONE place lookup (a bridge until the build-time place index ships; see lib/homeSearch.ts).
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [focused, setFocused] = useState(false);
  const [names, setNames] = useState<NameEntry[]>([]);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const latestQ = useRef(''); // the text in the box now, so a slow answer for older text is dropped

  const regions = useMemo(() => coverageRegions(index), [index]);
  const region = useMemo(() => defaultRegion(regions, deviceTimeZone()), [regions]);

  useEffect(() => {
    let live = true;
    getIndex().then((i) => { if (live) { setIndex(i); setIndexTried(true); } });
    getSetting<Picked>('homePlace').then((p) => { if (live && p && Array.isArray(p.center)) setPicked(p); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const locate = useCallback((then?: () => void) => {
    if (!navigator.geolocation) { setLoc('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setMe([p.coords.longitude, p.coords.latitude]); setLoc('allowed'); then?.(); },
      () => setLoc('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  // Location already granted earlier: use it without asking again. Already refused: do not ask.
  useEffect(() => {
    let live = true;
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => {
      if (!live) return;
      if (s.state === 'granted') locate();
      else if (s.state === 'denied') setLoc('denied');
    }).catch(() => {});
    return () => { live = false; };
  }, [locate]);

  useEffect(() => { if (visible) listAllSaved().then(setSaved).catch(() => {}); }, [visible, version]);

  const origin: LngLat | null = loc === 'allowed' && me ? me : picked?.center ?? region?.center ?? null;
  const area: Area | null = loc === 'allowed' && me ? { kind: 'you', name: 'you' } : picked ? { kind: picked.region ? 'region' : 'place', name: picked.name } : region ? { kind: 'region', name: region.name } : null;
  const originKey = origin ? `${origin[0].toFixed(3)},${origin[1].toFixed(3)}` : '';

  useEffect(() => {
    if (!origin || !online) return;
    const ac = new AbortController();
    setFailed(false); setOutside(false); setTrails(null);
    if (index && !isCovered(index, origin)) { setOutside(true); return; }
    loadAround(origin, ac.signal).then((r) => {
      if (ac.signal.aborted) return;
      if (r.kind === 'ok') { remember(r.trails); setTrails(r.trails); }
      else if (r.kind === 'outside') setOutside(true);
      else setFailed(true);
    }).catch((e) => { if ((e as Error).name !== 'AbortError') setFailed(true); });
    return () => ac.abort();
    // origin is read through originKey so a new array with the same numbers does not reload
  }, [originKey, online, index, retry]);

  const collections = useMemo(() => (trails && origin ? buildCollections(trails, origin) : []), [trails, originKey]);
  const results = useMemo(() => (trails && origin && isFiltering(filters) ? applyFilters(trails, filters, origin, units) : null), [trails, originKey, filters, units]);

  let mode: HomeMode = 'loading';
  if (!online) mode = 'offline';
  else if (outside) mode = 'outside';
  else if (failed || (indexTried && (!index || index.cells.length === 0 || !origin))) mode = 'error';
  else if (trails) mode = 'ready';

  const matches = useMemo(() => searchNames(names, deferred, 6, origin ?? undefined), [names, deferred, originKey]);
  const q = query.trim();
  latestQ.current = q;
  const showSuggest = focused && q.length >= 2;

  async function focusSearch() {
    setFocused(true);
    if (!names.length) setNames(await loadNameIndex());
  }
  function closeSearch() { setQuery(''); setFocused(false); setSearchMsg(null); setPlaces(null); }

  /** Enter: open an exact trail name, else one place lookup (bridge), listed with any trail matches. */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (q.length < 2 || busy) return;
    const asked = q;
    setBusy(true); setSearchMsg(null);
    try {
      const list = names.length ? names : await loadNameIndex();
      if (!names.length) setNames(list);
      const r = await onEnter(asked, list, origin ?? undefined, navigator.onLine);
      if (latestQ.current !== asked) return; // the text changed while we waited
      if (r.kind === 'trail') { closeSearch(); onOpenId(r.entry[0], [r.entry[2], r.entry[3]]); }
      else if (r.kind === 'places') setPlaces(r.places);
      else setSearchMsg(r.kind === 'offline' ? 'Place search needs a connection.' : 'No match in our trails or places, try another name');
    } catch { if (latestQ.current === asked) setSearchMsg('Place search failed. Try again.'); }
    finally { setBusy(false); }
  }

  const choose = useCallback((p: Picked) => {
    setPicked(p);
    setLoc((l) => (l === 'allowed' ? 'unasked' : l));
    putSetting('homePlace', p).catch(() => {});
    setFilters(NO_FILTERS);
  }, []);

  const options = matches.length + (places?.length ?? 0);
  const optionEls = () => Array.from(document.querySelectorAll<HTMLElement>('#home-suggest [role="option"]'));
  const leave = (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); };
  const inputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && options) { e.preventDefault(); optionEls()[0]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  };
  const optionKey = (e: React.KeyboardEvent) => {
    const els = optionEls(), at = els.indexOf(e.currentTarget as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[Math.min(els.length - 1, at + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) document.getElementById('home-q')?.focus(); else els[at - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); document.getElementById('home-q')?.focus(); closeSearch(); }
  };

  const search = (
    <div className="hm-searchbox" onBlur={leave}>
      <form className="hm-search" onSubmit={onSubmit} role="search">
        <FindIcon />
        <label htmlFor="home-q" className="sr">Search a place or trail</label>
        <input id="home-q" type="search" role="combobox" aria-expanded={showSuggest && options > 0} aria-controls={options ? 'home-suggest' : undefined} aria-autocomplete="list" enterKeyHint="search"
          placeholder={online ? 'Search a place or trail' : 'Search trails (offline)'} value={query}
          onChange={(e) => { setQuery(e.target.value); setFocused(true); setSearchMsg(null); setPlaces(null); }}
          onKeyDown={inputKey} onFocus={focusSearch} autoComplete="off" autoCorrect="off" spellCheck={false} />
        {query && <button type="button" className="hm-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={closeSearch}><CloseIcon size={18} /></button>}
      </form>
      {showSuggest && (
        <div className="hm-suggest" onPointerDown={(e) => e.preventDefault()}>
          {options > 0 && (
            <div id="home-suggest" role="listbox" aria-label="Suggestions">
              {matches.map((m) => (
                <button key={m[0]} role="option" aria-selected="false" className="hm-sg" onKeyDown={optionKey} onClick={() => { closeSearch(); onOpenId(m[0], [m[2], m[3]]); }}>
                  <span className="hm-sg-name">{m[1]}</span>
                  <span className="hm-sg-sub">{regionNameAt(m[2], m[3]) ? `Trail · ${regionNameAt(m[2], m[3])}` : 'Trail'}</span>
                </button>
              ))}
              {places?.map((p, i) => (
                <button key={`${p.lon},${p.lat},${i}`} role="option" aria-selected="false" className="hm-sg" onKeyDown={optionKey} onClick={() => { closeSearch(); choose({ name: p.name, center: [p.lon, p.lat] }); }}>
                  <span className="hm-sg-name">{p.name}</span>
                  <span className="hm-sg-sub">Place · {p.detail}</span>
                </button>
              ))}
            </div>
          )}
          {busy && <div className="hm-sg-msg" role="status">Searching…</div>}
          {!busy && !places && !matches.length && !searchMsg && <div className="hm-sg-msg">Press Enter to search trails and places.</div>}
          {searchMsg && <div className="hm-sg-msg" role="status">{searchMsg}</div>}
        </div>
      )}
    </div>
  );

  const nearest = outside && origin ? nearestRegion(regions, origin) : null;

  return (
    <HomeView
      mode={mode} hello={greeting()} loc={loc} area={area} regions={regions} collections={collections} results={results}
      filters={filters} filtersOpen={filtersOpen} hike={hike} saved={saved} savedIds={savedIds} offlineIds={offlineIds}
      outsideName={picked && loc !== 'allowed' ? picked.name : null} nearestCovered={nearest} search={search}
      onOpen={onOpen} onToggleSave={onToggleSave}
      onUseLocation={() => locate(() => setPicked(null))}
      onPickRegion={(r: Region) => choose({ name: r.name, center: r.center, region: true })}
      onSeeAll={(id) => onBrowse({ collection: id, center: origin ?? undefined })}
      onMap={() => onBrowse({ map: true, center: origin ?? undefined })}
      onResume={onResume}
      onFilters={setFilters} onToggleFilters={() => setFiltersOpen((o) => !o)} onRetry={() => setRetry((n) => n + 1)}
    />
  );
}
