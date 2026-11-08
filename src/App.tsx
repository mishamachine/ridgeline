import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { Badge } from './lib/badges';
import { computeBadges, newBadgesFor } from './lib/badges';
import { listActivities, listSaved, type Activity } from './lib/store';
import { features } from './lib/features';
import { closeAbandoned } from './lib/abandoned';
import { getSettings, shouldShowOnboarding } from './lib/settings';
import { shareApp } from './lib/share';
import { isFinished } from './lib/hype';
import { toast } from './lib/toast';
import { detectPlatform } from './lib/maps';
import { toCelebrateSummary } from './components/nav/summary';
import type { HikeSummary } from './lib/hype';
import { ConfirmSheet } from './components/ConfirmSheet';
import { FindIcon, HikeIcon, ProfileIcon, SavedIcon } from './components/NavIcons';
import { count } from './lib/counter';
import { isCallbackPath, completeWebSignIn, takeReturn } from './lib/accounts/auth';
import { getClient } from './lib/accounts/client';
import { useAccount } from './lib/accounts/useAccount';
import { startFlagRefresh, useAccountsState } from './lib/accounts/flags';
import { useSync, DELETED_ELSEWHERE_MESSAGE, resolveOwnerMismatch } from './lib/sync/useSync';
import { pruneTombstones, clearTombstones } from './lib/store';
import { setHikeActive } from './lib/swUpdate';
import { Toaster } from './components/Toaster';
import { Later } from './components/ScreenBoundary';
import { Find } from './screens/Find';
import { Hike } from './screens/Hike';
import { Saved } from './screens/Saved';
import { Onboarding } from './screens/Onboarding';
import { GuestPrompt } from './components/GuestPrompt';
import type { PromptKind } from './lib/accounts/prompt';

// Screens people reach later load on demand (Find, Saved, Hike and the first-run tour stay in the first download);
// each shows the static Bobo loading state for the moment it takes. Navigate and the maps carry MapLibre.
const Detail = lazy(() => import('./screens/Detail').then((m) => ({ default: m.Detail })));
const Navigate = lazy(() => import('./screens/Navigate').then((m) => ({ default: m.Navigate })));
const SharedList = lazy(() => import('./screens/SharedList').then((m) => ({ default: m.SharedList })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const SignIn = lazy(() => import('./screens/SignIn').then((m) => ({ default: m.SignIn })));
const DeleteAccount = lazy(() => import('./screens/DeleteAccount').then((m) => ({ default: m.DeleteAccount })));
const Badges = lazy(() => import('./screens/Badges').then((m) => ({ default: m.Badges })));
const Celebrate = lazy(() => import('./screens/Celebrate').then((m) => ({ default: m.Celebrate })));
const Landing = lazy(() => import('./screens/Landing').then((m) => ({ default: m.Landing })));

export type { Tab };

const TABS: { tab: Tab; label: string; icon: () => React.ReactElement }[] = [
  { tab: 'find', label: 'Find', icon: () => <FindIcon /> },
  { tab: 'saved', label: 'Saved', icon: () => <SavedIcon /> },
  { tab: 'hike', label: 'Hike', icon: () => <HikeIcon /> },
  { tab: 'profile', label: 'Profile', icon: () => <ProfileIcon /> },
];

const base = appBase();
const readRoute = (): Route => parseRoute(location.pathname, location.search, base);

export function App() {
  const [tpl, setTpl] = useState<string | null>(null);
  const profileOpened = useRef(false);
  const [route, setRoute] = useState<Route>(readRoute);
  const [trail, setTrail] = useState<Trail | null>(null);       // trail shown on a /trail/<id> page
  const [trailState, setTrailState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [hike, setHike] = useState<Trail | null>(null);
  const [resume, setResume] = useState<Activity | null>(null);
  useEffect(() => { count('session'); }, []);
  // Web sign-in lands on /auth/callback: finish the session, then go to Profile. Off (and a no-op) while features.accounts is false.
  useEffect(() => {
    if (!isCallbackPath(location.pathname, base)) return;
    if (!features.accounts) return;
    getClient(features.accounts)?.then(completeWebSignIn).finally(() => {
      // Back to where the person was: the delete page if they signed in again to delete, else Profile.
      const next: Route = takeReturn() === 'account-delete' ? { kind: 'account-delete' } : { kind: 'tab', tab: 'profile' };
      history.replaceState(null, '', routePath(next, base)); setRoute(next);
    });
  }, []);
  const [saved, setSaved] = useState<{ marked: Set<string>; offline: Set<string>; version: number }>({ marked: new Set(), offline: new Set(), version: 0 });
  const [removing, setRemoving] = useState<Trail | null>(null);
  const [onboarding, setOnboarding] = useState<null | 'first' | 'replay'>(() => (shouldShowOnboarding() ? (getSettings().onboardingSeen ? 'replay' : 'first') : null));
  const [done, setDone] = useState<{ summary: HikeSummary; newBadges: Badge[]; badgeCount: number; promptKinds: PromptKind[] } | null>(null); // the celebration, once features.celebrate is on
  const [landing, setLanding] = useState<{ id: string; name: string | null } | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => { setHikeActive(!!hike || !!done); }, [hike, done]); // an update never reloads under a hike or its celebration
  const [depth, setDepth] = useState(0); // pages the app itself pushed, so Back knows whether it can go back

  const refreshSaved = useCallback(async () => {
    const all = await listAllSaved();
    setSaved((s) => ({
      marked: new Set(all.map((i) => i.trail.id)),
      offline: new Set(all.filter((i) => i.offline).map((i) => i.trail.id)),
      version: s.version + 1,
    }));
  }, []);

  const accountsLiveNow = useAccountsState() === 'live';
  const account = useAccount(accountsLiveNow);
  useEffect(() => startFlagRefresh(), []);   // read the runtime flag now and whenever the app returns to the front (no network while the build has no accounts)
  useSync(account.userId, () => { refreshSaved(); setProfileVersion((v) => v + 1); }, () => toast(DELETED_ELSEWHERE_MESSAGE), accountsLiveNow, () => setOwnerAsk((a) => a ?? true));
  const [ownerAsk, setOwnerAsk] = useState<boolean | null>(null);   // a different account signed in on a phone that kept another account's copy: ask before anything uploads

  useEffect(() => {
    // Tombstones only matter to sync: none are kept while accounts are off, and old ones are dropped when on.
    (features.accounts ? pruneTombstones() : clearTombstones()).catch(() => {});
    closeAbandoned().catch(() => {}); // hikes left open for over 6 hours are closed as Unfinished
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

  // A shared hike link: look up the trail's name for the landing page.
  const hikeId = route.kind === 'hike' ? route.id : null;
  useEffect(() => {
    if (!hikeId) return;
    let live = true;
    resolveTrail(hikeId).then((t) => live && setLanding({ id: hikeId, name: t?.name ?? null })).catch(() => live && setLanding({ id: hikeId, name: null }));
    return () => { live = false; };
  }, [hikeId]);

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
  const backToProfile = useCallback(() => { if (depth > 0) history.back(); else go({ kind: 'tab', tab: 'profile' }, true); }, [depth, go]);
  const back = useCallback(() => { if (depth > 0) history.back(); else go({ kind: 'tab', tab: 'find' }, true); }, [depth, go]);

  const toggleSave = useCallback(async (t: Trail) => {
    if (saved.marked.has(t.id)) {
      if (saved.offline.has(t.id)) setRemoving(t);
      else { await unsave(t.id); refreshSaved(); }
    } else { await bookmark(t); refreshSaved(); }
  }, [saved, refreshSaved]);

  const resumeHike = useCallback(async (a: Activity) => {
    const t = a.trailId ? await resolveTrail(a.trailId, a.points[0] ? [a.points[0].lon, a.points[0].lat] : null).catch(() => null) : null;
    if (!t) { toast('Could not load that trail. Try again with a signal.'); return; }
    setResume(a);
    setHike(t);
  }, []);
  const [switching, setSwitching] = useState<Trail | null>(null); // a different trail was chosen while a hike runs
  const startHike = useCallback((t: Trail) => {
    const a = startAction(hike, t);
    if (a === 'confirm') { setSwitching(t); return; }
    if (a === 'start') { setResume(null); setHike(t); count('hike_start'); }
    go({ kind: 'tab', tab: 'hike' }); // same trail: just go back to the hike in progress
  }, [go, hike]);

  const finishHike = useCallback(async (t: Trail, summary: Parameters<typeof toCelebrateSummary>[0], activity: Activity) => {
    let newBadges: Badge[] = [], badgeCount = 0;
    const promptKinds: PromptKind[] = []; // which guest prompts this finish stands for (the first finished hike, its first badge)
    try {
      const [others, savedTrails] = await Promise.all([listActivities(), listSaved()]);
      const trails = [t, ...savedTrails.map((x) => x.trail).filter((x) => x.id !== t.id)];
      newBadges = newBadgesFor(activity, others, trails);
      const firstFinished = isFinished(summary.completedFraction) && !others.some((o) => o.id !== activity.id && o.endedAt !== undefined && !o.unfinished);
      if (firstFinished) promptKinds.push('hike');
      badgeCount = computeBadges([...others.filter((o) => o.id !== activity.id), activity], trails).filter((b) => b.earned).length;
      if (newBadges.length > 0 && badgeCount === newBadges.length) promptKinds.push('badge');
    } catch { /* storage unavailable: no badge line */ }
    setHike(null);
    setProfileVersion((v) => v + 1);
    if (features.celebrate) setDone({ summary: toCelebrateSummary(summary), newBadges, badgeCount, promptKinds });
    else { if (newBadges.length) toast(`New badge: ${newBadges[0].name}`); openTrail(t); }
  }, [openTrail]);

  useEffect(() => { if (route.kind === 'tab' && route.tab === 'profile') setProfileVersion((v) => v + 1); }, [route]);

  const closeOnboarding = useCallback(() => {
    setOnboarding(null);
    if (new URLSearchParams(location.search).has('onboarding')) history.replaceState(null, '', routePath(route, base));
  }, [route]);

  const openActivity = useCallback((a: Activity) => {
    if (a.trailId) go({ kind: 'trail', id: a.trailId, ll: a.points[0] ? [a.points[0].lon, a.points[0].lat] : undefined });
  }, [go]);

  const tab: Tab | null = route.kind === 'tab' && !done ? route.tab : null; // the celebration covers the tabs
  const onTrail = route.kind === 'trail';
  const onShared = route.kind === 'shared';
  const onBadges = route.kind === 'badges';
  const onHike = route.kind === 'hike';
  const bookmarkedNow = useMemo(() => (trail ? saved.marked.has(trail.id) : false), [trail, saved]);

  if (tab === 'profile') profileOpened.current = true; // the Profile chunk loads the first time the tab is opened
  if (!tpl) return <div className="app"><Placeholder title="Loading Ridgeline…" /></div>;

  const hiking = !!hike && tab === 'hike';

  return (
    <div className="app">
      {/* Tabs stay mounted so the map, list and any recording keep their state. */}
      <div className="screen" hidden={tab !== 'find'}>
        <Find tpl={tpl} visible={tab === 'find'} savedIds={saved.marked} offlineIds={saved.offline} onOpen={openTrail} onOpenId={openId} onToggleSave={toggleSave} />
      </div>
      <div className="screen" hidden={tab !== 'saved'}>
        <Saved visible={tab === 'saved'} version={saved.version} renderPrompt={(has) => <GuestPrompt kinds={['save']} trigger={has && tab === 'saved'} hikeActive={!!hike} inList onSignIn={() => go({ kind: 'sign-in' })} />} onOpen={openTrail} onChange={refreshSaved} onFind={() => goTab('find')} />
      </div>
      <div className="screen" hidden={tab !== 'hike' || !!hike}>
        <Hike visible={tab === 'hike' && !hike} version={saved.version} onStart={startHike} onFind={() => goTab('find')} onResume={resumeHike} />
      </div>
      {profileOpened.current && (
        <div className="screen" hidden={tab !== 'profile'}>
          <Later><Profile version={profileVersion} onOpenDeleteAccount={() => go({ kind: 'account-delete' })} onOpenSignIn={() => go({ kind: 'sign-in' })} onOpenBadges={() => go({ kind: 'badges' })} onReplayTour={() => setOnboarding('replay')} onOpenActivity={openActivity} /></Later>
        </div>
      )}

      {hike && (
        <div className="screen" hidden={!hiking}>
          <Later><Navigate key={hike.id} tpl={tpl} trail={hike} resume={resume ?? undefined} saved={saved.offline.has(hike.id)} onEnd={() => { const t = hike; setHike(null); openTrail(t); }} onFinish={(sm, a) => finishHike(hike, sm, a)} /></Later>
        </div>
      )}

      {route.kind === 'sign-in' && (
        <div className="screen overlay"><Later><SignIn returnTo={route.returnTo} onBack={() => go(route.returnTo ? { kind: 'account-delete' } : { kind: 'tab', tab: 'profile' })} onDone={() => go(route.returnTo ? { kind: 'account-delete' } : { kind: 'tab', tab: 'profile' })} /></Later></div>
      )}

      {route.kind === 'account-delete' && (
        <div className="screen overlay"><Later><DeleteAccount onBack={() => go({ kind: 'tab', tab: 'profile' })} onSignIn={() => go({ kind: 'sign-in', returnTo: 'account-delete' })} /></Later></div>
      )}

      {onBadges && (
        <div className="screen overlay"><Later><Badges onBack={backToProfile} /></Later></div>
      )}

      {onHike && landing && landing.id === route.id && (
        <div className="screen overlay">
          <Later><Landing
            trail={landing.name ? { name: landing.name } : null}
            stats={route.stats}
            features={features}
            platform={/Android/i.test(navigator.userAgent) ? 'android' : detectPlatform() === 'ios' ? 'ios' : 'other'}
            onGetApp={() => { setOnboarding(getSettings().onboardingSeen ? 'replay' : 'first'); go({ kind: 'tab', tab: 'find' }, true); }}
            onSeeTrail={landing.name ? () => go({ kind: 'trail', id: route.id }) : undefined}
          /></Later>
        </div>
      )}

      {done && (
        <div className="screen overlay">
          <Later><Celebrate summary={done.summary} newBadges={done.newBadges} badgeCount={done.badgeCount}
            guestPrompt={done.promptKinds.length ? <GuestPrompt kinds={done.promptKinds} trigger tone="dark" onSignIn={() => { setDone(null); go({ kind: 'sign-in' }); }} /> : undefined}
            onDone={() => { setDone(null); go({ kind: 'tab', tab: 'profile' }); }} onShareApp={shareApp} /></Later>
        </div>
      )}

      {onShared && (
        <div className="screen overlay">
          <Later><SharedList ids={route.ids} lls={route.lls} onOpen={openTrail} onHome={() => go({ kind: 'tab', tab: 'find' })} /></Later>
        </div>
      )}

      {onTrail && (
        <div className="screen overlay">
          {trail && trail.id === route.id && trailState !== 'loading' ? (
            <Later><Detail key={trail.id} tpl={tpl} trail={trail} bookmarked={bookmarkedNow} onBack={back} onStart={startHike} onSavedChange={refreshSaved} /></Later>
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

      {!hiking && !(onTrail && trail) && !onBadges && !onHike && !done && (
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
      {ownerAsk && account.userId && (
        <div className="sheet-wrap">
          <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="owner-title">
            <h2 id="owner-title" className="sheet-title">Hikes from another account</h2>
            <p className="sheet-body">This phone still has saved trails and hikes from another account. Add them to this account, or remove them from this phone?</p>
            <button className="btn btn-primary" onClick={() => { const u = account.userId!; setOwnerAsk(null); resolveOwnerMismatch(u, 'add').then(refreshSaved); }}>Add them to this account</button>
            <button className="btn btn-outline" onClick={() => { const u = account.userId!; setOwnerAsk(null); resolveOwnerMismatch(u, 'remove').then(() => { refreshSaved(); setProfileVersion((v) => v + 1); }); }}>Remove them from this phone</button>
            <button className="btn btn-outline" onClick={() => setOwnerAsk(false)}>Not now (nothing is uploaded)</button>
          </div>
        </div>
      )}
      {onboarding && <Onboarding replay={onboarding === 'replay'} onDone={closeOnboarding} />}
      <Toaster />
    </div>
  );
}
