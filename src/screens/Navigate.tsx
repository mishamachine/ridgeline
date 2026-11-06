import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, type Map as MLMap } from 'maplibre-gl';
import { MapView, setGeo, metersToPixels } from '../components/MapView';
import { LocateIcon, SwapIcon } from '../components/Icons';
import { Banner } from '../components/nav/Banner';
import { PocketMode } from '../components/nav/PocketMode';
import { buildView } from '../components/nav/view';
import { buildSummary, type HikeSummary } from '../components/nav/summary';
import { cumulative, pointAt, totalAscent, LngLat } from '../lib/geo';
import { estimateMinutes, Trail } from '../lib/trails';
import { addPoint, newActivity, keepAwake } from '../lib/tracker';
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
import { offRouteSide } from '../lib/voice/offroute';
import { getUnits, getVoiceOn, setVoiceOn } from '../lib/voice/prefs';
import { cancelSpeech, speak } from '../lib/voice/speak';
import { climbText, shortDistance } from '../lib/voice/units';

export type { HikeSummary };

interface Props {
  tpl: string;
  trail: Trail;
  saved: boolean;
  onEnd: () => void;
  /** Called with the hike's numbers when the hiker finishes. Without it, Finish just calls onEnd. */
  onFinish?: (summary: HikeSummary) => void;
}

const MIN_PROGRESS_M = 400;   // walked this far before adjusting time to your own pace

export function Navigate({ tpl, trail, saved, onEnd, onFinish }: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const actRef = useRef<Activity>(newActivity(trail.name, trail.id));
  const startAlongRef = useRef<number | null>(null);
  const maxAlongRef = useRef(0);
  const followRef = useRef(true);
  const pausedMsRef = useRef(0);
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
  const [units] = useState(getUnits);
  const [voiceOn, setVoice] = useState(getVoiceOn);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  // Route in walking direction.
  const route = useMemo(() => {
    const coords = reversed ? [...trail.coords].reverse() : trail.coords;
    const elevation = trail.elevation ? (reversed ? [...trail.elevation].reverse() : trail.elevation) : undefined;
    return { coords, elevation, cum: cumulative(coords) };
  }, [trail, reversed]);
  const total = route.cum.at(-1)!;

  const forks = useMemo(() => forksFor(trail.coords, trail.junctions, reversed, trail.name), [trail, reversed]);
  const tips = useMemo(() => findReversals(route.coords, route.cum), [route]);
  const announcer = useMemo(() => new Announcer({ forks, turnarounds: tips, total }, units), [forks, tips, total, units]);

  const [engine] = useState(() => new GpsEngine(new WebLocationSource(), {
    route: { coords: route.coords, elevation: route.elevation },
    onAccepted: (f) => {
      if (!pausedRef.current) addPoint(actRef.current, { lon: f.lon, lat: f.lat, alt: f.altitude ?? null, acc: f.accuracy, t: f.t });
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
  useEffect(() => { startAlongRef.current = null; maxAlongRef.current = 0; }, [reversed]);

  // Which way the trail lies when you are off it.
  const offSide = useMemo(
    () => (offRoute && g.filtered ? offRouteSide(route.coords, g.filtered, g.heading) : null),
    [offRoute, g.filtered, g.heading, route],
  );

  // Talk, only when there is something to say. Vibrate with it.
  useEffect(() => {
    if (paused || g.recalLastOffRoute) return; // Recalibrating: say nothing new, and do not call "back on the trail"
    for (const u of announcer.update({ t: Date.now(), along, offRoute, off: offSide ?? undefined })) {
      navigator.vibrate?.(u.vibrate);
      if (voiceRef.current) speak(u.text, u.interrupt);
    }
  }, [g, announcer, paused, along, offRoute, offSide]);

  function toggleVoice() {
    const on = !voiceOn;
    setVoice(on);
    setVoiceOn(on);
    if (on) speak('Voice on.', true); else cancelSpeech();
  }

  // Climb ahead and time left, adjusted to your pace once you've walked a bit.
  const climbAhead = route.elevation
    ? totalAscent(route.elevation.slice(Math.min(route.elevation.length - 1, Math.floor(((along ?? 0) / total) * (route.elevation.length - 1)))))
    : null;
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
    } else pauseStartRef.current = Date.now();
    pausedRef.current = !paused;
    setPaused(!paused);
  }

  async function finish() {
    const a = actRef.current;
    const endedAt = Date.now();
    a.endedAt = endedAt;
    if (pauseStartRef.current) { pausedMsRef.current += endedAt - pauseStartRef.current; pauseStartRef.current = null; }
    if (a.points.length > 1) await putActivity(a);
    cancelSpeech();
    if (!onFinish) return onEnd();
    onFinish(buildSummary({
      trail, activity: a, endedAt, pausedMs: pausedMsRef.current, elevation: route.elevation, total,
      startAlong: startAlongRef.current, maxAlong: maxAlongRef.current,
    }));
  }

  const start = trail.coords[0];
  const step = along != null ? nextStep(forks, tips, total, along) : null;
  const view = buildView({ g, step, trailName: trail.name, units, offSide, paused });
  const pct = g.progress;
  const toGo = shortDistance(remaining, units);
  const pace = `${duration(minutesLeft)}`;
  const climb = climbAhead != null ? climbText(climbAhead, units) : '—';

  const status = g.error?.code === 'denied' || g.error?.code === 'unsupported' ? g.error.message
    : g.recalTimedOut ? 'No fresh GPS yet. Move to open sky and wait.'
    : g.recalibrating ? 'Recalibrating GPS…'
    : g.accuracyFt == null ? 'Looking for GPS…'
    : g.warmingUp ? `GPS warming up ±${g.accuracyFt} ft`
    : `GPS ${QUALITY_LABEL[g.quality!]} ±${g.accuracyFt} ft`;
  const net = online ? '' : saved ? ' · No signal, map saved' : ' · No signal';

  return (
    <div className="nv">
      <Banner view={view} voiceOn={voiceOn} onVoice={toggleVoice} />

      <div className="nv-map">
        <MapView tileTemplate={tpl} center={start} zoom={15} onReady={onReady} label={`Navigation map for ${trail.name}`} />
        <div className="nv-chip" style={{ top: 8 }} role="status">{paused ? 'Paused · ' : ''}{status}{net}</div>
        <div className="nv-map-btns">
          {!following && <button className="nv-pill" aria-label="Center on me" onClick={recenter}><LocateIcon size={18} />Center</button>}
          {!trail.loop && <button className="nv-pill" onClick={() => setReversed((r) => !r)}><SwapIcon size={18} />Reverse direction</button>}
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
        <div className="nv-row">
          <button className="chip" onClick={recalibrate}>Recalibrate</button>
          <button className="chip" aria-pressed={here} onClick={toggleHere}>I'm here</button>
          <button className="chip" onClick={() => setPocket(true)}>Pocket mode</button>
        </div>
        <div className="nv-acts">
          <button className="nv-btn" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="nv-btn dark" onClick={() => setConfirming(true)}>Finish hike</button>
        </div>
        <div className="nv-note"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="#D52B26" /></svg>Location on for this hike only · {saved ? 'Offline map ready' : 'Map not saved offline'}</div>
        <div className="nv-safety">Directions are a guide; check conditions; not for emergency use.</div>
      </div>

      {confirming && (
        <div className="nv-confirm" role="dialog" aria-modal="true" aria-label="Finish this hike?">
          <div>
            <h2>Finish this hike?</h2>
            <div className="muted">{pct != null ? `You are ${Math.round(pct * 100)}% of the way along ${trail.name}.` : trail.name}</div>
            <div className="nv-acts">
              <button className="nv-btn" onClick={() => setConfirming(false)}>Keep hiking</button>
              <button className="nv-btn dark" onClick={finish}>Finish hike</button>
            </div>
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
