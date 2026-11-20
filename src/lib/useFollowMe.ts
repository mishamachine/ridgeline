import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import type { LngLat } from './geo';
import { angleDiff, followStep, FOLLOW_START, smoothHeading, toBearing, type FollowMode, type FollowState } from './followMode';
import { compassSupported, requestCompassPermission, startCompass } from './gps/compass';
import { setHeadingCone } from '../components/mapGeo';

const SENSOR_WAIT_MS = 1500;   // no reading by then: there is no usable compass
const TICK_MS = 100;           // camera updates per second, at most 10
const DEAD_DEG = 2;            // smaller turns are sensor noise

/**
 * Follow-me for a map: off, centred on you, or heading-up (the map turns with the way the phone faces, with a cone on the dot).
 * Compass and location readings stay in this tab: nothing here sends them anywhere, and nothing is logged to analytics.
 * `position` is where you are. The hook moves the camera (centre, and bearing in heading-up) on each fix and each compass reading.
 */
export function useFollowMe(map: MLMap | null, position: LngLat | null, initial: FollowMode = 'off', centreZoom = 15) {
  const [state, dispatch] = useReducer(followStep, { ...FOLLOW_START, mode: initial } as FollowState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const posRef = useRef(position);
  posRef.current = position;
  const heading = useRef<number | null>(null);
  const lastApply = useRef(0);
  const sensorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pendingZoom = useRef(false); // tap 1 came before the first fix: zoom in on that fix
  const apply = useCallback((duration: number, withZoom = false) => {
    const s = stateRef.current;
    if (!map || s.mode === 'off' || map.isZooming()) return;
    const p = posRef.current;
    const o: { center?: LngLat; bearing?: number; duration: number; easing: (t: number) => number; zoom?: number } = { duration, easing: (t) => t }; // reduced motion is respected (no `essential`)
    if (p) o.center = p;
    if (p && withZoom) o.zoom = Math.max(centreZoom, map.getZoom());
    if (s.mode === 'heading' && heading.current != null) o.bearing = toBearing(heading.current);
    if (o.center || o.bearing != null) map.easeTo(o);
  }, [map, centreZoom]);

  // Compass listener: runs while heading-up is on or being asked for.
  const listening = state.mode === 'heading' || state.pending;
  useEffect(() => {
    if (!listening) return;
    let got = false;
    const stop = startCompass((r) => {
      const prev = heading.current;
      const deg = r.degrees + (typeof screen !== 'undefined' ? screen.orientation?.angle ?? 0 : 0); // a turned screen
      if (!got) { got = true; clearTimeout(sensorTimer.current); dispatch({ type: 'headingResult', ok: true }); }
      if (prev != null && Math.abs(angleDiff(prev, deg)) < DEAD_DEG) return; // the dead band is on the raw turn, so small real turns add up instead of being swallowed
      const next = smoothHeading(prev, deg);
      heading.current = next;
      const t = performance.now();
      if (t - lastApply.current >= TICK_MS) { // the cone and the camera move together, at most 10 times a second
        lastApply.current = t;
        if (map && posRef.current) setHeadingCone(map, posRef.current, next);
        apply(TICK_MS * 2.5);
      }
    });
    return () => { stop(); };
  }, [listening, map, apply]);

  // Heading-up has just switched on (the sensor answered): turn the map to the way you face now.
  useEffect(() => { if (state.mode === 'heading') apply(TICK_MS * 2.5); }, [state.mode, apply]);

  // Leaving heading-up: the cone goes. The map keeps its bearing; the north arrow turns it back.
  useEffect(() => { if (state.mode !== 'heading' && map) { heading.current = null; setHeadingCone(map, null, 0); } }, [state.mode, map]);

  // A new fix moves the camera while following.
  useEffect(() => {
    if (!position) return;
    if (map && stateRef.current.mode === 'heading' && heading.current != null) setHeadingCone(map, position, heading.current);
    const z = pendingZoom.current;
    pendingZoom.current = false;
    apply(600, z);
  }, [position, apply, map]);

  // A camera move that was skipped because the map was zooming (a zoom button, a pinch, the first Locate) is made once the zoom ends:
  // otherwise a phone held still, whose compass reading does not change, would never turn the map.
  useEffect(() => {
    if (!map) return;
    const again = () => apply(300);
    map.on('zoomend', again);
    return () => { map.off('zoomend', again); };
  }, [map, apply]);

  // The person takes over: a drag ends following; turning the map by hand ends heading-up.
  useEffect(() => {
    if (!map) return;
    const drag = () => dispatch({ type: 'drag' });
    const rot = (e: { originalEvent?: unknown }) => { if (e.originalEvent) dispatch({ type: 'rotate' }); };
    map.on('dragstart', drag);
    map.on('rotatestart', rot);
    return () => { map.off('dragstart', drag); map.off('rotatestart', rot); };
  }, [map]);

  useEffect(() => () => clearTimeout(sensorTimer.current), []);

  /** One tap on the button. The iOS permission request must start here, inside the tap, before anything awaits. */
  const press = useCallback(() => {
    const s = stateRef.current;
    const wantsHeading = s.mode === 'centre' && !s.pending;
    const ask = wantsHeading && compassSupported() ? requestCompassPermission() : null;
    dispatch({ type: 'tap' });
    if (wantsHeading && !ask) dispatch({ type: 'noSensor' }); // no sensor API at all: stay centred, with a note
    if (s.mode === 'off' && map && posRef.current) map.easeTo({ center: posRef.current, zoom: Math.max(centreZoom, map.getZoom()), duration: 500 }); // tap 1 centres at once; later fixes follow
    else if (s.mode === 'off') pendingZoom.current = true;
    if (ask) {
      ask.then((ok) => {
        if (!ok) { dispatch({ type: 'headingResult', ok: false }); return; }
        clearTimeout(sensorTimer.current);
        sensorTimer.current = setTimeout(() => { if (stateRef.current.pending) dispatch({ type: 'noSensor' }); }, SENSOR_WAIT_MS);
      });
    }
  }, [apply, map, centreZoom]);

  return {
    mode: state.mode, pending: state.pending, note: state.note,
    press,
    /** Turn following off (a banner action moved the camera) or on without the compass. */
    setMode: useCallback((m: 'off' | 'centre') => dispatch({ type: m === 'off' ? 'drag' : 'centre' }), []),
  };
}
