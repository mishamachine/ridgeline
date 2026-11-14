import { useState, type ReactNode } from 'react';
import { isNative } from '../lib/native/platform';
import { Bobo } from '../components/Bobo';
import { HomeCard } from '../components/HomeCard';
import { ChevronIcon } from '../components/Icons';
import { FilterIcon, MapIcon } from '../components/NavIcons';
import type { SavedItem } from '../lib/saved';
import type { Trail } from '../lib/trails';
import { DRIVE_TIME_ENABLED } from '../lib/flags';
import { METRIC_COPY } from '../lib/metricCopy';
import { useSettings } from '../lib/settings';
import {
  DIFFICULTIES, DIFFICULTY_NOTE, HOW_WE_RANK, LENGTHS, SORTS, coverageLine,
  type Collection, type HomeFilters, type Region,
} from '../lib/home';

export type HomeMode = 'loading' | 'ready' | 'outside' | 'offline' | 'error';
export type LocState = 'unasked' | 'allowed' | 'denied';
/** Where the rows are centred: a covered region (first visit), the person ("near you"), or a place they picked. */
export interface Area { kind: 'region' | 'you' | 'place'; name: string }

export interface HomeViewProps {
  mode: HomeMode;
  hello: string;
  loc: LocState;
  area: Area | null;
  regions: Region[];
  collections: Collection[];
  /** Set while a filter or sort is on: the results replace the rows. */
  results: Trail[] | null;
  filters: HomeFilters;
  filtersOpen: boolean;
  hike: Trail | null;
  saved: SavedItem[];
  savedIds: Set<string>;
  offlineIds: Set<string>;
  /** Place the person searched for outside coverage; null when it is their own location. */
  outsideName: string | null;
  nearestCovered: Region | null;
  /** The search box and its suggestions, built by the screen. */
  search: ReactNode;
  onOpen: (t: Trail) => void;
  onToggleSave: (t: Trail) => void;
  onUseLocation: () => void;
  onPickRegion: (r: Region) => void;
  onSeeAll: (id: Collection['id']) => void;
  onMap: () => void;
  onResume: () => void;
  onFilters: (f: HomeFilters) => void;
  onToggleFilters: () => void;
  onRetry: () => void;
}

const rowTitle = (c: Collection, area: Area | null) => {
  if (c.id !== 'top' || !area) return c.title;
  return area.kind === 'you' ? 'Top picks near you' : area.kind === 'place' ? `Top picks around ${area.name}` : `Top picks in ${area.name}`;
};

function Chip({ on, children, onClick, disabled }: { on?: boolean; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="hm-chip" aria-pressed={on} disabled={disabled} onClick={onClick}>{children}</button>;
}

function FilterPanel({ f, set }: { f: HomeFilters; set: (f: HomeFilters) => void }) {
  const [{ units }] = useSettings();
  return (
    <section className="hm-filters" id="home-filters" aria-label="Filter and sort">
      <div role="group" aria-label="Length (round trip)" className="hm-chips">
        {LENGTHS.map((l) => <Chip key={l.id} on={f.length === l.id} onClick={() => set({ ...f, length: f.length === l.id ? null : l.id })}>{units === 'metric' ? METRIC_COPY.lengthChips[l.id] : l.label}</Chip>)}
      </div>
      <div role="group" aria-label="Difficulty" className="hm-chips">
        {DIFFICULTIES.map((d) => <Chip key={d} on={f.difficulty === d} onClick={() => set({ ...f, difficulty: f.difficulty === d ? null : d })}>{d}</Chip>)}
      </div>
      <p className="hm-note">{DIFFICULTY_NOTE}</p>
      <div role="group" aria-label={DRIVE_TIME_ENABLED ? 'Dogs and drive time' : 'Dogs'} className="hm-chips">
        <Chip on={f.dogs} onClick={() => set({ ...f, dogs: !f.dogs })}>Dogs: tagged yes</Chip>
        {DRIVE_TIME_ENABLED && <Chip disabled>Drive time: later</Chip>}
      </div>
      <div role="group" aria-label="Sort" className="hm-chips">
        {SORTS.map((s) => <Chip key={s.id} on={f.sort === s.id} onClick={() => set({ ...f, sort: s.id })}>Sort: {s.label}</Chip>)}
      </div>
    </section>
  );
}

function RegionList({ p }: { p: HomeViewProps }) {
  return (
    <details className="hm-regions"><summary>Change region</summary>
      <ul>{p.regions.map((r) => <li key={r.code}><button className="hm-chip" onClick={() => p.onPickRegion(r)}>{r.name}</button></li>)}</ul>
    </details>
  );
}

function Rail({ c, p }: { c: Collection; p: HomeViewProps }) {
  const [why, setWhy] = useState(false);
  const id = `row-${c.id}`;
  return (
    <section className="hm-row" aria-labelledby={id}>
      <div className="hm-rowh">
        <div>
          <h2 id={id}>{rowTitle(c, p.area)}</h2>
          <p>{c.sub}{c.id === 'top' && <> <button className="hm-why" aria-expanded={why} onClick={() => setWhy(!why)}>How we rank</button></>}</p>
          {why && c.id === 'top' && <p className="hm-note" role="note">{HOW_WE_RANK}</p>}
        </div>
        <button className="hm-link" aria-label={`See all: ${c.title}`} onClick={() => p.onSeeAll(c.id)}>See all</button>
      </div>
      <ul className="hm-rail">
        {c.trails.map((t) => (
          <li key={t.id}><HomeCard trail={t} saved={p.savedIds.has(t.id)} offline={p.offlineIds.has(t.id)} onOpen={p.onOpen} onToggleSave={p.onToggleSave} /></li>
        ))}
      </ul>
    </section>
  );
}

function Grid({ trails, p, driveLater = DRIVE_TIME_ENABLED }: { trails: Trail[]; p: HomeViewProps; driveLater?: boolean }) {
  return (
    <ul className="hm-grid">
      {trails.map((t) => (
        <li key={t.id}><HomeCard trail={t} saved={p.savedIds.has(t.id)} offline={p.offlineIds.has(t.id)} driveLater={driveLater} onOpen={p.onOpen} onToggleSave={p.onToggleSave} /></li>
      ))}
    </ul>
  );
}

export function HomeView(p: HomeViewProps) {
  const returning = !!p.hike || p.saved.length > 0;
  const outside = p.mode === 'outside';
  const offline = p.mode === 'offline';
  const hello = outside || offline ? null : returning ? 'Welcome back' : p.hello;
  const savedShown = p.saved.slice(0, offline ? 24 : 3);
  const device = isNative() ? 'phone' : 'device';
  const anyOffline = p.saved.some((s) => s.offline);

  return (
    <div className="hm">
      <header className="hm-top">
        {outside ? <span className="hm-wm">Ridgeline</span> : <h1 className="hm-wm"><Bobo size={24} />Ridgeline</h1>}
        {hello && <span className="hm-hi">{hello}</span>}
      </header>

      {offline && <div className="hm-banner" role="status">You’re offline. Your offline maps still work.</div>}

      <div className="hm-bar">
        {p.search}
        {!offline && !outside && (
          <button className="hm-fbtn" aria-label="Filter and sort" aria-expanded={p.filtersOpen} aria-controls="home-filters" onClick={p.onToggleFilters}><FilterIcon /></button>
        )}
      </div>
      {offline && <p className="hm-note hm-pad">Place search needs a connection.</p>}
      {p.filtersOpen && !offline && !outside && <FilterPanel f={p.filters} set={p.onFilters} />}

      {p.hike && !outside && (
        <section className="hm-cstrip" aria-label="Continue">
          <div className="hm-tx"><div className="hm-e">Hike in progress</div><div className="hm-n">{p.hike.name}</div></div>
          <button className="hm-btn hm-pri" onClick={p.onResume}>Resume</button>
        </section>
      )}

      {outside && (
        <>
          <div className="hm-empty">
            <Bobo size={72} />
            <h1>We don’t cover here yet</h1>
            <p>Ridgeline doesn’t have trails for {p.outsideName ?? 'your location'}. Here is where we do.</p>
          </div>
          <ul className="hm-pills">{p.regions.map((r) => <li key={r.code} className="hm-pill">{r.name}</li>)}</ul>
          {p.nearestCovered && (
            <div className="hm-pad hm-gap"><button className="hm-btn hm-pri" onClick={() => p.onPickRegion(p.nearestCovered!)}>Show trails in {p.nearestCovered.name}</button></div>
          )}
          <div className="hm-pad hm-gap"><button className="hm-btn hm-ghost" onClick={p.onMap}>Browse all trails</button></div>
        </>
      )}

      {!outside && !offline && p.loc !== 'allowed' && p.area && (
        <section className="hm-loc" aria-label="Where trails are shown">
          <div className="hm-tx">
            {p.loc === 'denied' ? <>Location is off.<small>Showing {p.area.name}</small></> : <>Starting in {p.area.name}<small>Your exact location never leaves this device.</small></>}
          </div>
          {p.loc !== 'denied' && <button className="hm-btn hm-pri" onClick={p.onUseLocation}>Use my location</button>}
          {p.regions.length > 0 && <RegionList p={p} />}
        </section>
      )}

      {p.mode === 'loading' && <p className="hm-note hm-pad" role="status">Loading trails…</p>}
      {p.mode === 'error' && (
        <div className="hm-pad">
          <p className="hm-note hm-alert" role="alert">Couldn’t load trails. <button className="hm-link" onClick={p.onRetry}>Try again</button></p>
          <div className="hm-gap"><button className="hm-btn hm-ghost" onClick={p.onMap}>Browse all trails</button></div>
        </div>
      )}

      {p.mode === 'ready' && p.results && (
        <section className="hm-pad" aria-label="Results">
          <p className="hm-count" role="status">{p.results.length} trail{p.results.length === 1 ? '' : 's'}</p>
          {p.results.length ? <Grid trails={p.results.slice(0, 24)} p={p} /> : <p className="hm-note">No trails match these filters.</p>}
        </section>
      )}

      {p.mode === 'ready' && !p.results && p.collections.map((c, i) => (
        <div key={c.id}>
          <Rail c={c} p={p} />
          {i === 0 && (
            <button className="hm-mapfab" onClick={p.onMap}><MapIcon size={22} /> Explore the map<span className="hm-sp" /><ChevronIcon size={18} /></button>
          )}
        </div>
      ))}
      {p.mode === 'ready' && !p.results && p.collections.length === 0 && (
        <>
          <p className="hm-note hm-pad">No trails found near here yet. Change region or open the map.</p>
          <button className="hm-mapfab" onClick={p.onMap}><MapIcon size={22} /> Explore the map<span className="hm-sp" /><ChevronIcon size={18} /></button>
          {p.regions.length > 0 && <div className="hm-pad hm-gap"><RegionList p={p} /></div>}
        </>
      )}

      {!outside && p.saved.length > 0 && (
        <section className="hm-row" aria-labelledby="row-saved">
          <div className="hm-rowh"><div><h2 id="row-saved">{offline ? 'Offline trails' : 'Saved'}</h2><p>{offline ? `Saved on this ${device}` : anyOffline ? 'Offline maps ready' : `Saved on this ${device}`}</p></div></div>
          <Grid trails={savedShown.map((s) => s.trail)} p={p} driveLater={false} />
        </section>
      )}
      {offline && p.saved.length === 0 && <p className="hm-note hm-pad">Nothing saved on this {device} yet.</p>}

      {!offline && <p className="hm-note hm-cov">{coverageLine(p.regions)}</p>}
    </div>
  );
}
