import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, type Map as MLMap } from 'maplibre-gl';
import { LazyMap as MapView } from '../components/LazyMap';
import { setGeo, metersToPixels } from '../components/mapGeo';
import { LocateIcon, SwapIcon } from '../components/Icons';
import { Banner } from '../components/nav/Banner';
import { PocketMode } from '../components/nav/PocketMode';
import { buildView } from '../components/nav/view';
import { buildSummary, type HikeSummary } from '../components/nav/summary';
import { cumulative, haversine, pointAt, totalAscent, LngLat } from '../lib/geo';
import { estimateMinutes, Trail } from '../lib/trails';
import { addPoint, keepAwake, progressFromTrack } from '../lib/tracker';
import { putActivity, Activity } from '../lib/store';
import { duration } from '../lib/format';
import { INK } from '../lib/mapStyle';
import { GpsEngine, GpsState } from '../lib/gps/engine';
import { WebLocationSource } from '../lib/gps/source';
import { QUALITY_LABEL } from '../lib/gps/quality';
import { requestCompassPermission, startCompass } from '../lib/gps/compass';
import { findReversals } from '../lib/gps/reversals';
import { Announcer } from '../lib/voice/announcer';
import { forksFor, nextStep } from '../lib/voice/forkpoints';
import { OffRouteWords, offRouteSide, type OffWords } from '../lib/voice/offroute';
import { useSettings } from '../lib/settings';
import { endActivity, startActivity } from '../lib/finish';
import { cancelSpeech, primeSpeech, speak } from '../lib/voice/speak';
import { climbText, shortDistance } from '../lib/voice/units';
import { offRouteText } from '../lib/voice/announcer';
import { BACK_M, FlipBack, TurnBack } from '../lib/voice/turnback';

export type { HikeSummary };

interface Props {
  tpl: string;
  trail: Trail;
  saved: boolean;
  /** Picks up a hike that was left running: its earlier track is kept. */
  resume?: Activity;
  onEnd: () => void;
  /** Called with the hike's numbers when the hiker finishes. Without it, Finish just calls onEnd. */
  onFinish?: (summary: HikeSummary, activity: Activity) => void;
}

const MIN_PROGRESS_M = 400;   // walked this far before adjusting time to your own pace

export function Navigate({ tpl, trail, saved, resume, onEnd, onFinish }: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const actRef = useRef<Activity>(null as unknown as Activity);
  if (!actRef.current) actRef.current = resume ?? startActivity(trail);
  const startAlongRef = useRef<number | null>(null);
  const maxAlongRef = useRef(0);
  const walkedRef = useRef(0);
  const autoTurnedRef = useRef(false);
  const priorFractionRef = useRef(0);
  const priorClimbRef = useRef(0);
  const followRef = useRef(true);
  const pausedMsRef = useRef(resume ? (resume.pausedMs ?? 0) + Math.max(0, Date.now() - (resume.points.at(-1)?.t ?? Date.now())) : 0); // earlier pauses, plus the time the app was closed
  const pauseStartRef = useRef<number | null>(null);
  const markersRef = useRef<{ key: string; list: Marker[] }>({ key: '', list: [] });

  const pausedRef = useRef(false);
  const hereRef = useRef(false);
  const [here, setHere] = useState(false);
  const [hereMsg, setHereMsg] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const [mapOn, setMapOn] = useState(false);
  const [pocket, setPocket] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [more, setMore] = useState(false);
  const [headingBack, setHeadingBack] = useState(false);
  const [settings, updateSettings] = useSettings();
  const units = settings.units;
  const voiceOn = settings.voice;
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  // Route in walking direction.
  const route = useMemo(() => {
    const coords = reversed ? [...trail.coords].reverse() : trail.coords;
    const elevation = trail.elevation ? (reversed ? [...trail.elevation].reverse() : trail.elevation) : undefined;
    return { coords, elevation, cum: cumulative(coords) };
  }, [trail, reversed]);
  const total = route.cum.at(-1)!;
  // A resumed hike picks its progress up from the track already recorded, not from 0.
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    const p = resume ? progressFromTrack(resume.points, route.coords, route.cum) : null;
    if (p) { startAlongRef.current = p.start; maxAlongRef.current = p.max; }
    if (resume) resume.pausedMs = pausedMsRef.current; // saved with the next track write
  }

  const forks = useMemo(() => forksFor(trail.coords, trail.junctions, reversed, trail.name), [trail, reversed]);
  const tips = useMemo(() => findReversals(route.coords, route.cum), [route]);
  // One announcer per walking direction. "You made it." is said once per direction, and a hand-tapped switch hushes fork lines for a while.
  const finishedDir = useRef<Record<string, boolean>>({});
  const hushNext = useRef<false | 'timed' | 'walked'>(false);
  const announcer = useMemo(() => {
    const a = new Announcer({ forks, turnarounds: tips, total }, units);
    if (finishedDir.current[String(reversed)]) a.markFinished();
    if (hushNext.current === 'walked') a.hushForksUntilWalked(BACK_M);
    else if (hushNext.current) a.hushForks();
    hushNext.current = false;
    return a;
  }, [forks, tips, total, units]);

  const [engine] = useState(() => new GpsEngine(new WebLocationSource(), {
    route: { coords: route.coords, elevation: route.elevation },
    onAccepted: (f) => {
      if (pausedRef.current) return;
      const last = actRef.current.points.at(-1);
      if (addPoint(actRef.current, { lon: f.lon, lat: f.lat, alt: f.altitude ?? null, acc: f.accuracy, t: f.t }) && last) walkedRef.current += haversine([last.lon, last.lat], [f.lon, f.lat]);
    },
  }));
  const [g, setG] = useState<GpsState>(engine.state);
  useEffect(() => {
    engine.setRoute({ coords: route.coords, elevation: route.elevation });
  }, [engine, route]);

  // GPS, screen wake lock, connectivity, clock.
  useEffect(() => {
    let release = () => {};
    keepAwake().then((r) => (release = r));
    const onVis = () => { if (document.visibilityState === 'visible') keepAwake().then((r) => { release(); release = r; }); };
    document.addEventListener('visibilitychange', onVis);
    const net = () => setOnline(navigator.onLine);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    const tick = setInterval(() => { setNow(Date.now()); engine.tick(Date.now()); }, 1000);
    const unsub = engine.subscribe(setG);
    const stopCompass = startCompass((r) => engine.ingestCompass(r));
    engine.start();
    return () => {
      unsub();
      stopCompass();
      engine.stop();
      cancelSpeech();
      release();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      clearInterval(tick);
    };
  }, [engine]);

  const pos: LngLat | null = g.position;
  const near = g.along != null;
  const offRoute = g.offRoute; // the engine holds this until you have joined the trail
  const along = g.along;
  const remaining = along != null ? total - along : total;

  // Note where you joined the trail, and the furthest you have been.
  useEffect(() => {
    if (paused) return;
    if (along != null && startAlongRef.current == null) startAlongRef.current = along;
    if (along != null && !offRoute) maxAlongRef.current = Math.max(maxAlongRef.current, along);
  }, [paused, along, offRoute]);

  // Direction changed: measure pace from here.
  const reversedBefore = useRef(reversed);
  useEffect(() => {
    if (reversedBefore.current === reversed) return; // not on first render: a resumed hike keeps its seeded progress
    reversedBefore.current = reversed;
    startAlongRef.current = null; maxAlongRef.current = 0;
  }, [reversed]);

  // Switching direction (tapped, or after the end of an out-and-back). The outbound leg stays part of this hike.
  const flipRef = useRef<{ det: FlipBack; before: boolean } | null>(null);
  function switchDirection(auto: boolean) {
    priorFractionRef.current = Math.max(priorFractionRef.current, maxAlongRef.current / total);
    if (route.elevation && startAlongRef.current != null && total > 0) {
      const k = (d: number) => Math.round((d / total) * (route.elevation!.length - 1));
      priorClimbRef.current += totalAscent(route.elevation.slice(k(startAlongRef.current), k(maxAlongRef.current) + 1));
    }
    flipRef.current = flipRef.current ? null : { det: new FlipBack(), before: reversed }; // tapping again undoes it by hand, so the net stands down
    hushNext.current = auto ? 'walked' : 'timed'; // a tap may be a mistake and an auto switch may be a mis-snap: no fork sides until the hiker has really walked the new way
    if (auto) {
      navigator.vibrate?.([120]);
      if (voiceRef.current) speak("Heading back. I'll call the forks on the way down.", false);
    }
    setHeadingBack(auto ? true : !headingBack);
    setReversed((r) => !r);
  }
  const turnBack = useMemo(() => new TurnBack(total, !!trail.loop), [total, trail.loop, reversed]);
  useEffect(() => {
    if (paused || g !== engine.state) return;
    // After the end of an out-and-back, a real walk back switches to the way down.
    if (!autoTurnedRef.current && !flipRef.current && turnBack.update(along, offRoute)) { autoTurnedRef.current = true; switchDirection(true); return; }
    // Safety net: still walking the original way after a switch: undo it, quietly.
    const fl = flipRef.current;
    if (fl && along != null) {
      const original = reversed === fl.before ? along : total - along;
      if (fl.det.update(original, offRoute)) { flipRef.current = null; autoTurnedRef.current = true; hushNext.current = 'timed'; setHeadingBack(false); setReversed(fl.before); }
    }
  }, [g, turnBack, paused, along, offRoute]);

  // Which way the trail lies when you are off it. Read once per fix (an effect, so it runs exactly once per fix) even before the alert,
  // so the words are settled when it comes: the side holds for 3 fixes, and no reminder while you walk back.
  const wordsRef = useRef(new OffRouteWords());
  const [offSide, setOffSide] = useState<OffWords | null>(null);
  const wordsFix = useRef<{ g: GpsState; w: OffWords | null } | null>(null);

  // Talk, only when there is something to say. Vibrate with it.
  useEffect(() => {
    // After a reversal the screen can still hold the old direction's state for one render: wait for the engine's first state on the new route.
    if (g !== engine.state) return;
    if (wordsFix.current?.g !== g) { // one reading per fix, even when the effect re-runs for another reason
      wordsFix.current = { g, w: wordsRef.current.push(g.filtered && (offRoute || (g.offsetM ?? 0) > 25) ? offRouteSide(route.coords, g.filtered, g.heading) : null) };
    }
    const w = wordsFix.current.w;
    setOffSide(offRoute ? w : null);
    if (paused) return;
    for (const u of announcer.update({ t: Date.now(), along, offRoute, holdOff: g.recalLastOffRoute, walkedM: walkedRef.current, off: offRoute && w?.settled ? w : undefined, closing: offRoute ? w?.closing : false })) {
      if (u.kind === 'finish') finishedDir.current[String(reversed)] = true;
      navigator.vibrate?.(u.vibrate);
      if (voiceRef.current) speak(u.text, u.interrupt);
    }
  }, [g, announcer, paused, along, offRoute, route]);

  // iOS only starts speech from a completed tap (click or touchend, not pointerdown): unlock it on the first one on this screen.
  useEffect(() => {
    const once = () => primeSpeech();
    window.addEventListener('click', once, { once: true });
    window.addEventListener('touchend', once, { once: true });
    return () => { window.removeEventListener('click', once); window.removeEventListener('touchend', once); };
  }, []);

  // "Take me back to the trail": show the straight line to the nearest trail point and say it again.
  function takeMeBack() {
    const map = mapRef.current;
    if (!map || !g.filtered || !offSide) return;
    setGeo(map, 'back', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [g.filtered, offSide.target] } }] });
    followRef.current = false;
    setFollowing(false);
    const [a, b] = [g.filtered, offSide.target];
    map.fitBounds([[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]], { padding: 70, maxZoom: 17, duration: 500 });
    if (voiceRef.current) speak(offRouteText(offSide.distM, offSide.side, units), true);
  }
  useEffect(() => {
    // The line goes once you are back.
    if (!offRoute && mapRef.current) setGeo(mapRef.current, 'back', { type: 'FeatureCollection', features: [] });
  }, [offRoute]);

  function toggleVoice() {
    const on = !voiceOn;
    updateSettings({ voice: on });
    if (on) speak('Voice on.', true); else cancelSpeech();
  }

  // Climb ahead and time left, adjusted to your pace once you've walked a bit.
  const aheadElev = route.elevation?.slice(Math.min(route.elevation.length - 1, Math.floor(((along ?? 0) / total) * (route.elevation.length - 1))));
  const climbAhead = aheadElev ? totalAscent(aheadElev) : null;
  // Outbound on an out-and-back, show the same "gain" as the trail page (the bigger way); heading back or on a loop, the climb actually ahead.
  const climbShown = aheadElev ? (!trail.loop && !headingBack ? Math.max(climbAhead!, totalAscent([...aheadElev].reverse())) : climbAhead) : null;
  const pausedNow = pausedMsRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0);
  const movingMin = (now - actRef.current.startedAt - pausedNow) / 60000;
  let minutesLeft = estimateMinutes(remaining, climbAhead ?? 0);
  const progressed = along != null && startAlongRef.current != null ? along - startAlongRef.current : 0;
  if (progressed > MIN_PROGRESS_M && route.elevation) {
    const k0 = Math.floor((startAlongRef.current! / total) * (route.elevation.length - 1));
    const k1 = Math.floor((along! / total) * (route.elevation.length - 1));
    const expected = estimateMinutes(progressed, totalAscent(route.elevation.slice(k0, k1 + 1)));
    minutesLeft *= Math.min(2.5, Math.max(0.5, movingMin / expected));
  }

  // Map: route ahead in red, behind as a dashed line, you as a dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ahead = along != null ? sliceFrom(route.coords, route.cum, along) : route.coords;
    const behind = along != null ? sliceTo(route.coords, route.cum, along) : [];
    setGeo(map, 'trails', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { active: true }, geometry: { type: 'LineString', coordinates: ahead } }] });
    setGeo(map, 'done', { type: 'FeatureCollection', features: behind.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: behind } }] : [] });
    if (pos) {
      setGeo(map, 'me', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { r: metersToPixels(map, g.uncertaintyM ?? 0, pos[1]), anchored: g.anchored || g.stalePosition }, geometry: { type: 'Point', coordinates: pos } }] });
      if (followRef.current) map.easeTo({ center: pos, duration: 600 });
    }
  }, [g, route]);

  // Labels on the next two forks ahead.
  const upcoming = forks.filter((f) => f.along > (along ?? 0) - 15).slice(0, 2);
  const markKey = upcoming.map((f) => `${f.along.toFixed(0)}${f.side}`).join('|') + (reversed ? 'r' : '');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapOn || markersRef.current.key === markKey) return;
    markersRef.current.list.forEach((m) => m.remove());
    markersRef.current = {
      key: markKey,
      list: upcoming.map((f) => {
        const el = document.createElement('div');
        el.className = 'nv-fork';
        const dot = document.createElement('i');
        const label = document.createElement('b');
        label.textContent = f.kind === 'turn' ? `Turn ${f.side}` : `Fork · stay ${f.side}`;
        el.append(dot, label);
        const at = pointAt(route.coords, route.cum, f.along);
        return new Marker({ element: el, anchor: 'left', offset: [-9, 0] }).setLngLat(at).addTo(map);
      }),
    };
  }, [markKey, mapOn, route]);
  useEffect(() => () => markersRef.current.list.forEach((m) => m.remove()), []);

  function onReady(map: MLMap) {
    mapRef.current = map;
    map.on('dragstart', () => { followRef.current = false; setFollowing(false); });
    // Hollow dot while the position is a manual "I'm here" anchor.
    map.setPaintProperty('me-dot', 'circle-color', ['case', ['boolean', ['get', 'anchored'], false], '#FFFFFF', INK]);
    map.setPaintProperty('me-dot', 'circle-stroke-color', ['case', ['boolean', ['get', 'anchored'], false], INK, '#FFFFFF']);
    map.on('click', (e) => {
      if (!hereRef.current) return;
      const r = engine.manualAnchor([e.lngLat.lng, e.lngLat.lat]);
      hereRef.current = false;
      setHere(false);
      setHereMsg(r.ok ? 'Position set to the trail. It clears when GPS agrees again.' : r.reason);
    });
    map.addSource('back', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'back-line', type: 'line', source: 'back', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#B01C1C', 'line-width': 4, 'line-dasharray': [1, 1.5] } });
    setGeo(map, 'trails', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { active: true }, geometry: { type: 'LineString', coordinates: route.coords } }] });
    setMapOn(true);
  }

  function recenter() {
    followRef.current = true;
    setFollowing(true);
    if (pos) mapRef.current?.easeTo({ center: pos, zoom: Math.max(15, mapRef.current.getZoom()) });
  }

  function recalibrate() {
    setHereMsg(null);
    engine.recalibrate();
    requestCompassPermission(); // iOS asks on a tap
  }

  function toggleHere() {
    hereRef.current = !here;
    setHere(!here);
    setHereMsg(null);
  }

  function togglePause() {
    if (paused) {
      pausedMsRef.current += Date.now() - (pauseStartRef.current ?? Date.now());
      pauseStartRef.current = null;
      actRef.current.pausedMs = pausedMsRef.current;
      putActivity(actRef.current);
    } else pauseStartRef.current = Date.now();
    pausedRef.current = !paused;
    setPaused(!paused);
  }

  async function finish() {
    const a = actRef.current;
    const endedAt = Date.now();
    if (pauseStartRef.current) { pausedMsRef.current += endedAt - pauseStartRef.current; pauseStartRef.current = null; }
    a.pausedMs = pausedMsRef.current;
    if (endActivity(a, trail, endedAt)) await putActivity(a);
    cancelSpeech();
    if (!onFinish) return onEnd();
    onFinish(buildSummary({
      trail, activity: a, endedAt, pausedMs: pausedMsRef.current, elevation: route.elevation, total,
      startAlong: startAlongRef.current, maxAlong: Math.max(maxAlongRef.current, priorFractionRef.current * total), priorClimbM: priorClimbRef.current,
    }), a);
  }

  const start = trail.coords[0];
  const step = along != null ? nextStep(forks, tips, total, along) : null;
  const view = buildView({ g, step, trailName: trail.name, units, offSide, paused });
  const pct = g.progress;
  const toGo = shortDistance(remaining, units);
  const pace = `${duration(minutesLeft)}`;
  const climb = climbShown != null ? climbText(climbShown, units) : '—';

  const status = g.error?.code === 'denied' || g.error?.code === 'unsupported' ? g.error.message
    : g.recalTimedOut ? 'No fresh GPS yet. Move to open sky and wait.'
    : g.recalibrating ? 'Recalibrating GPS…'
    : g.accuracyFt == null ? 'Looking for GPS…'
    : g.warmingUp ? `GPS warming up ±${g.accuracyFt} ft`
    : `GPS ${QUALITY_LABEL[g.quality!]} ±${g.accuracyFt} ft`;
  const caution = g.quality === 'weak' || g.recalTimedOut || !online || g.error != null;
  const net = online ? '' : saved ? ' · No signal, map saved' : ' · No signal';

  return (
    <div className="nv">
      <Banner view={view} voiceOn={voiceOn} onVoice={toggleVoice} onBack={offRoute && offSide ? takeMeBack : undefined} onSwitch={!trail.loop && !offRoute && (headingBack || (pct ?? 0) >= 0.25) ? () => switchDirection(false) : undefined} />

      <div className="nv-map">
        <MapView tileTemplate={tpl} center={start} zoom={15} onReady={onReady} label={`Navigation map for ${trail.name}`} />
        <div className={`nv-chip${caution ? ' caution' : ''}`} style={{ top: 8 }} role="status">{paused ? 'Paused · ' : ''}{status}{net}</div>
        {headingBack && <div className="nv-tag">Heading back</div>}
        <div className="nv-map-btns">
          {!following && <button className="nv-pill" aria-label="Center on me" onClick={recenter}><LocateIcon size={18} />Center</button>}
          <button className="nv-pill" onClick={() => setMore(true)}>More</button>
        </div>
      </div>

      <div className="nv-sheet">
        <div className="nv-prog">
          <div className="nv-bar" role="progressbar" aria-label="Trail done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct != null ? Math.round(pct * 100) : undefined}>
            <div style={{ width: `${pct != null ? Math.round(pct * 100) : 0}%` }} />
          </div>
          <div className="nv-pct">{pct != null ? `${Math.round(pct * 100)}% done` : near ? '' : 'Not on the trail yet'}</div>
        </div>
        <div className="nv-stats">
          <div><b>{toGo}</b><span>to go</span></div>
          <div><b>{pace}</b><span>at your pace</span></div>
          <div><b>{climb}</b><span>climb left</span></div>
        </div>
        {(here || hereMsg) && <div className="nv-msg" role="status">{here ? 'Tap the map where you are on the trail.' : hereMsg}</div>}
        {g.needsCalibration && <div className="nv-msg">Compass needs calibrating. Move your phone in a figure 8.</div>}
        <div className="nv-acts">
          <button className="nv-btn" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="nv-btn primary" onClick={() => setConfirming(true)}>Finish hike</button>
        </div>
        <div className="nv-note"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="#111111" /></svg>Location on for this hike only · {saved ? 'Offline map ready' : 'Map not saved offline'}</div>
        <div className="nv-safety">Directions are a guide; check conditions; not for emergency use.</div>
      </div>

      {confirming && (
        <div className="nv-confirm" role="dialog" aria-modal="true" aria-label="Finish this hike?">
          <div>
            <h2>Finish this hike?</h2>
            <div className="muted">{pct != null ? `You are ${Math.round(pct * 100)}% of the way along ${trail.name}.` : trail.name}</div>
            <div className="nv-acts">
              <button className="nv-btn" onClick={() => setConfirming(false)}>Keep hiking</button>
              <button className="nv-btn primary" onClick={finish}>Finish hike</button>
            </div>
          </div>
        </div>
      )}

      {more && (
        <div className="nv-confirm" role="dialog" aria-modal="true" aria-label="More" onClick={() => setMore(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <button className="nv-item" onClick={() => { setMore(false); recalibrate(); }}>Recalibrate GPS</button>
            <button className="nv-item" aria-pressed={here} onClick={() => { setMore(false); toggleHere(); }}>I'm here on the trail</button>
            <button className="nv-item" onClick={() => { setMore(false); primeSpeech(); setPocket(true); }}>Pocket mode</button>
            {!trail.loop && <button className="nv-item" onClick={() => { setMore(false); switchDirection(false); }}><SwapIcon size={20} />Reverse direction</button>}
            <button className="nv-btn" onClick={() => setMore(false)}>Close</button>
          </div>
        </div>
      )}

      {pocket && <PocketMode view={view} trailName={trail.name} voiceOn={voiceOn} toGo={toGo} pace={pace} climb={climb} pct={pct} now={now} onExit={() => setPocket(false)} />}
    </div>
  );
}

function sliceFrom(coords: LngLat[], cum: number[], d: number): LngLat[] {
  const i = cum.findIndex((c) => c > d);
  if (i < 0) return [coords.at(-1)!];
  return [interp(coords, cum, i, d), ...coords.slice(i)];
}
function sliceTo(coords: LngLat[], cum: number[], d: number): LngLat[] {
  const i = cum.findIndex((c) => c > d);
  if (i < 0) return coords;
  return [...coords.slice(0, i), interp(coords, cum, i, d)];
}
function interp(coords: LngLat[], cum: number[], i: number, d: number): LngLat {
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = coords[i - 1], b = coords[i];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
