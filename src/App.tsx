import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTileTemplate } from './lib/offline';
import { listAllSaved } from './lib/saved';
import { bookmark, unsave } from './lib/saved';
import { remember, resolveTrail } from './lib/lookup';
import { appBase } from './lib/origin';
import { startAction } from './lib/hikeStart';
import { parseRoute, routePath, type Route, type Tab } from './lib/route';
import type { Trail } from './lib/trails';
import type { LngLat } from './lib/geo';
import { Bobo, Placeholder } from './components/Bobo';
import { ConfirmSheet } from './components/ConfirmSheet';
import { FindIcon, HikeIcon, ProfileIcon, SavedIcon } from './components/NavIcons';
import { setHikeActive } from './lib/swUpdate';
import { Toaster } from './components/Toaster';
import { Find } from './screens/Find';
import { Detail } from './screens/Detail';
import { Hike } from './screens/Hike';
import { Navigate } from './screens/Navigate';
import { Saved } from './screens/Saved';
import { SharedList } from './screens/SharedList';

export type { Tab };

const TABS: { tab: Tab; label: string; icon: () => React.ReactElement }[] = [
  { tab: 'find', label: 'Find', icon: () => <FindIcon /> },
  { tab: 'saved', label: 'Saved', icon: () => <SavedIcon /> },
  { tab: 'hike', label: 'Hike', icon: () => <HikeIcon /> },
  { tab: 'profile', label: 'Profile', icon: () => <ProfileIcon /> },
];

/** Stand-in until the real Profile screen lands. */
function ProfilePlaceholder() {
  return (
    <div className="page">
      <div className="page-head"><h1 className="page-title">Profile</h1></div>
      <Placeholder title="Coming soon">Your hikes, badges and settings will live here.</Placeholder>
    </div>
  );
}

const base = appBase();
const readRoute = (): Route => parseRoute(location.pathname, location.search, base);

export function App() {
  const [tpl, setTpl] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(readRoute);
  const [trail, setTrail] = useState<Trail | null>(null);       // trail shown on a /trail/<id> page
  const [trailState, setTrailState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [hike, setHike] = useState<Trail | null>(null);
  useEffect(() => { setHikeActive(!!hike); }, [hike]);
  const [saved, setSaved] = useState<{ marked: Set<string>; offline: Set<string>; version: number }>({ marked: new Set(), offline: new Set(), version: 0 });
  const [removing, setRemoving] = useState<Trail | null>(null);
  const [depth, setDepth] = useState(0); // pages the app itself pushed, so Back knows whether it can go back

  const refreshSaved = useCallback(async () => {
    const all = await listAllSaved();
    setSaved((s) => ({
      marked: new Set(all.map((i) => i.trail.id)),
      offline: new Set(all.filter((i) => i.offline).map((i) => i.trail.id)),
      version: s.version + 1,
    }));
  }, []);

  useEffect(() => {
    getTileTemplate().then(setTpl);
    refreshSaved();
  }, [refreshSaved]);

  // Browser Back / Forward.
  useEffect(() => {
    const onPop = () => { setRoute(readRoute()); setDepth((d) => Math.max(0, d - 1)); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Open the trail named in the address (a link, a refresh, or Back).
  const routeId = route.kind === 'trail' ? route.id : null;
  const routeLL = route.kind === 'trail' ? route.ll : undefined;
  useEffect(() => {
    if (!routeId) { setTrailState('idle'); return; }
    let live = true;
    setTrailState('loading');
    resolveTrail(routeId, routeLL).then((t) => {
      if (!live) return;
      setTrail(t);
      setTrailState(t ? 'idle' : 'missing');
    }).catch(() => live && setTrailState('missing'));
    return () => { live = false; };
  }, [routeId, routeLL]);

  const go = useCallback((r: Route, replace = false) => {
    const url = routePath(r, base);
    if (replace) history.replaceState(null, '', url); else { history.pushState(null, '', url); setDepth((d) => d + 1); }
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);

  const openTrail = useCallback((t: Trail) => { remember([t]); setTrail(t); go({ kind: 'trail', id: t.id, ll: [t.coords[0][0], t.coords[0][1]] }); }, [go]);
  const openId = useCallback((id: string, ll: LngLat) => go({ kind: 'trail', id, ll }), [go]);
  const goTab = useCallback((t: Tab) => {
    if (route.kind === 'tab' && route.tab === t) { window.scrollTo(0, 0); return; } // re-tap: nothing new to go back to
    go({ kind: 'tab', tab: t });
  }, [go, route]);
  const back = useCallback(() => { if (depth > 0) history.back(); else go({ kind: 'tab', tab: 'find' }, true); }, [depth, go]);

  const toggleSave = useCallback(async (t: Trail) => {
    if (saved.marked.has(t.id)) {
      if (saved.offline.has(t.id)) setRemoving(t);
      else { await unsave(t.id); refreshSaved(); }
    } else { await bookmark(t); refreshSaved(); }
  }, [saved, refreshSaved]);

  const [switching, setSwitching] = useState<Trail | null>(null); // a different trail was chosen while a hike runs
  const startHike = useCallback((t: Trail) => {
    const a = startAction(hike, t);
    if (a === 'confirm') { setSwitching(t); return; }
    if (a === 'start') setHike(t);
    go({ kind: 'tab', tab: 'hike' }); // same trail: just go back to the hike in progress
  }, [go, hike]);

  const tab: Tab | null = route.kind === 'tab' ? route.tab : null;
  const onTrail = route.kind === 'trail';
  const onShared = route.kind === 'shared';
  const bookmarkedNow = useMemo(() => (trail ? saved.marked.has(trail.id) : false), [trail, saved]);

  if (!tpl) return <div className="app"><Placeholder title="Loading Ridgeline…" /></div>;

  const hiking = !!hike && tab === 'hike';

  return (
    <div className="app">
      {/* Tabs stay mounted so the map, list and any recording keep their state. */}
      <div className="screen" hidden={tab !== 'find'}>
        <Find tpl={tpl} visible={tab === 'find'} savedIds={saved.marked} offlineIds={saved.offline} onOpen={openTrail} onOpenId={openId} onToggleSave={toggleSave} />
      </div>
      <div className="screen" hidden={tab !== 'saved'}>
        <Saved visible={tab === 'saved'} version={saved.version} onOpen={openTrail} onChange={refreshSaved} onFind={() => goTab('find')} />
      </div>
      <div className="screen" hidden={tab !== 'hike' || !!hike}>
        <Hike visible={tab === 'hike' && !hike} version={saved.version} onStart={startHike} onFind={() => goTab('find')} />
      </div>
      <div className="screen" hidden={tab !== 'profile'}><ProfilePlaceholder /></div>

      {hike && (
        <div className="screen" hidden={!hiking}>
          <Navigate key={hike.id} tpl={tpl} trail={hike} saved={saved.offline.has(hike.id)} onEnd={() => { const t = hike; setHike(null); openTrail(t); }} />
        </div>
      )}

      {onShared && (
        <div className="screen overlay">
          <SharedList ids={route.ids} lls={route.lls} onOpen={openTrail} onHome={() => go({ kind: 'tab', tab: 'find' })} />
        </div>
      )}

      {onTrail && (
        <div className="screen overlay">
          {trail && trail.id === route.id && trailState !== 'loading' ? (
            <Detail key={trail.id} tpl={tpl} trail={trail} bookmarked={bookmarkedNow} onBack={back} onStart={startHike} onSavedChange={refreshSaved} />
          ) : trailState === 'missing' ? (
            <div className="page">
              <div className="page-head"><Bobo size={44} /><h1 className="page-title">Trail not found</h1></div>
              <p className="fine pad-x">We couldn’t load this trail. It may be outside our coverage, or you may be offline.</p>
              <div className="page-list"><button className="btn btn-primary" onClick={() => go({ kind: 'tab', tab: 'find' }, true)}>Find a trail</button></div>
            </div>
          ) : (
            <Placeholder title="Loading trail…" />
          )}
        </div>
      )}

      {!hiking && !(onTrail && trail) && (
        <nav className="tabbar2" aria-label="Main">
          {TABS.map(({ tab: t, label, icon }) => (
            <button key={t} className="tab2" aria-current={tab === t ? 'page' : undefined} onClick={() => goTab(t)}>
              {icon()}<span>{label}{t === 'hike' && hike ? ' •' : ''}</span>
            </button>
          ))}
        </nav>
      )}

      {switching && hike && (
        <ConfirmSheet title="End current hike first?" body={`You’re hiking ${hike.name}. Finish it to start ${switching.name}; your track is saved.`}
          confirmLabel="Back to current hike" cancelLabel="Not now" onConfirm={() => { setSwitching(null); go({ kind: 'tab', tab: 'hike' }); }} onCancel={() => setSwitching(null)} />
      )}
      {removing && (
        <ConfirmSheet title="Remove from Saved?" body="This also deletes the offline map for this trail." confirmLabel="Remove" cancelLabel="Keep it" danger
          onConfirm={async () => { const t = removing; setRemoving(null); await unsave(t.id); refreshSaved(); }} onCancel={() => setRemoving(null)} />
      )}
      <Toaster />
    </div>
  );
}
