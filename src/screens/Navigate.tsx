import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView, setGeo, metersToPixels } from '../components/MapView';
import { LocateIcon, SwapIcon } from '../components/Icons';
import { cumulative, totalAscent, LngLat } from '../lib/geo';
import { estimateMinutes, Trail } from '../lib/trails';
import { addPoint, newActivity, keepAwake, trackDistance } from '../lib/tracker';
import { putActivity, Activity } from '../lib/store';
import { duration, ft, mi } from '../lib/format';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { INK } from '../lib/mapStyle';
import { GpsEngine, GpsState } from '../lib/gps/engine';
import { WebLocationSource } from '../lib/gps/source';
import { QUALITY_LABEL } from '../lib/gps/quality';
import { requestCompassPermission, startCompass } from '../lib/gps/compass';

interface Props { tpl: string; trail: Trail; saved: boolean; onEnd: () => void }

const MIN_PROGRESS_M = 400;   // walked this far before adjusting time to your own pace

export function Navigate({ tpl, trail, saved, onEnd }: Props) {
  const mapRef = useRef<MLMap | null>(null);
  const actRef = useRef<Activity>(newActivity(trail.name, trail.id));
  const startAlongRef = useRef<number | null>(null);
  const wasOffRef = useRef(false);
  const followRef = useRef(true);
  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);

  const pausedRef = useRef(false);
  const hereRef = useRef(false);
  const [here, setHere] = useState(false);
  const [hereMsg, setHereMsg] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Route in walking direction.
  const route = useMemo(() => {
    const coords = reversed ? [...trail.coords].reverse() : trail.coords;
    const elevation = trail.elevation ? (reversed ? [...trail.elevation].reverse() : trail.elevation) : undefined;
    return { coords, elevation, cum: cumulative(coords) };
  }, [trail, reversed]);
  const total = route.cum.at(-1)!;

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
      release();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      clearInterval(tick);
    };
  }, [engine]);

  const pos: LngLat | null = g.position;
  const near = g.along != null;
  const offRoute = g.offRoute; // the engine holds alerts until you have joined the trail
  const along = g.along;
  const remaining = along != null ? total - along : total;

  // Note where you joined the trail.
  useEffect(() => {
    if (paused) return;
    if (along != null && startAlongRef.current == null) startAlongRef.current = along;
  }, [paused, along]);

  // Direction changed: measure pace from here.
  useEffect(() => { startAlongRef.current = null; }, [reversed]);

  // Buzz once when you leave the trail.
  useEffect(() => {
    if (offRoute && !wasOffRef.current) navigator.vibrate?.([200, 100, 200]);
    wasOffRef.current = !!offRoute;
  }, [offRoute]);

  // Climb ahead and time left, adjusted to your pace once you've walked a bit.
  const climbAhead = route.elevation
    ? totalAscent(route.elevation.slice(Math.min(route.elevation.length - 1, Math.floor(((along ?? 0) / total) * (route.elevation.length - 1)))))
    : null;
  const movingMin = (now - actRef.current.startedAt - pausedMsRef.current - (pauseStartRef.current ? now - pauseStartRef.current : 0)) / 60000;
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

  async function end() {
    const a = actRef.current;
    a.endedAt = Date.now();
    if (a.points.length > 1) await putActivity(a);
    onEnd();
  }

  const start = trail.coords[0];
  const status = g.error?.code === 'denied' || g.error?.code === 'unsupported' ? g.error.message
    : g.recalTimedOut ? 'No fresh GPS yet. Move to open sky and wait.'
    : g.recalibrating ? 'Recalibrating GPS…'
    : g.accuracyFt == null ? 'Looking for GPS…'
    : g.warmingUp ? `GPS warming up ±${g.accuracyFt} ft`
    : `GPS ${QUALITY_LABEL[g.quality!]} ±${g.accuracyFt} ft`;
  const net = online ? '' : saved ? ' · No signal, map saved' : ' · No signal';

  return (
    <>
      <div className="map-box" style={{ flex: 1, minHeight: 280, borderTop: 0 }}>
        <MapView tileTemplate={tpl} center={start} zoom={15} onReady={onReady} label={`Navigation map for ${trail.name}`} />
        <div className="map-badge" style={{ left: 16, top: 'calc(var(--safe-top) + 16px)' }} role="status">{status}{net}</div>
        <div style={{ position: 'absolute', right: 16, bottom: 28, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!trail.loop && <button className="text-btn reverse-btn" onClick={() => setReversed((r) => !r)}><SwapIcon size={18} /> Reverse direction</button>}
          {!following && <button className="icon-btn" aria-label="Center on me" onClick={recenter}><LocateIcon /></button>}
        </div>
      </div>

      <div className="pad" style={{ flex: 'none' }}>
        {offRoute ? (
          <div className="notice alert" style={{ margin: '12px 0 0' }} role="alert">Off route · {ft(g.offsetM ?? 0)} ft from the trail</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderBottom: '1px solid var(--hair)', fontWeight: 600 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, background: near ? 'var(--red)' : 'var(--grey)' }} />
            {paused ? 'Paused' : g.warmingUp && !near ? 'GPS warming up — get a lock at the trailhead' : near ? (g.anchored ? 'On route · position set by you' : 'On route') : g.offsetM != null ? `${mi(g.offsetM)} mi to the trail${g.trailBearing != null ? ` · ${compassPoint(g.trailBearing)}` : ''}` : 'Starting…'}
          </div>
        )}
        <div className="chips" style={{ padding: '10px 0' }}>
          <button className="chip" onClick={recalibrate}>Recalibrate</button>
          <button className="chip" aria-pressed={here} onClick={toggleHere}>I'm here</button>
        </div>
        {(here || hereMsg) && <div className="notice" style={{ margin: '0 0 10px' }} role="status">{here ? 'Tap the map where you are on the trail.' : hereMsg}</div>}
        {g.needsCalibration && <div className="notice" style={{ margin: '0 0 10px' }}>Compass needs calibrating. Move your phone in a figure 8.</div>}
        <div style={{ padding: '10px 0', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ font: '800 96px/0.9 var(--display)', letterSpacing: '-0.05em' }}>{mi(remaining)}</div>
          <div className="label">miles {near ? 'remaining' : 'on this trail'}</div>
        </div>
        <div className="stat-grid">
          <div className="stat" style={{ borderBottom: 0 }}><div className="num-md">{duration(minutesLeft)}</div><div className="label">to finish</div></div>
          <div className="stat" style={{ borderBottom: 0 }}><div className="num-md">{climbAhead != null ? `${ft(climbAhead)} ft` : '—'}</div><div className="label">climb ahead</div></div>
        </div>
        <div className="meta" style={{ paddingBottom: 10 }}>
          {mi(trackDistance(actRef.current.points))} mi walked · {duration(Math.max(0, movingMin))} moving{g.progress != null ? ` · ${Math.round(g.progress * 100)}% done` : ''}
        </div>
      </div>

      <div className="actions">
        <button className="action light" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="action dark" onClick={() => setConfirmEnd(true)}>End</button>
      </div>
      {confirmEnd && <ConfirmSheet title="Finish this hike?" body="Your track is saved on this phone." confirmLabel="Finish hike" onConfirm={end} onCancel={() => setConfirmEnd(false)} />}
    </>
  );
}

const compassPoint = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

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
