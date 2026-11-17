import { useEffect, useRef } from 'react';
import { Map as MLMap, setWorkerUrl, type LngLatBoundsLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre looks for its worker next to its own file, which bundling moves; point it at the bundled copy.
setWorkerUrl(workerUrl);
import { swissStyle, INK, RED } from '../lib/mapStyle';
import type { LngLat } from '../lib/geo';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../lib/mapZoom';
import { transformRequest } from '../lib/native/offlineMaps';

interface Props {
  tileTemplate: string;
  center?: LngLat;
  zoom?: number;
  bounds?: LngLatBoundsLike;
  interactive?: boolean;
  minZoom?: number;
  maxZoom?: number;
  /** One-finger drags scroll the page, two fingers move the map, the wheel zooms with Ctrl/Cmd (a map inside a scrolling page). */
  cooperative?: boolean;
  onReady?: (map: MLMap) => void;
  label?: string;
  /** Called when map data (tiles, style) fails to load, e.g. the tile server answers 429. */
  onProblem?: () => void;
}

/** A MapLibre map with the Swiss style and empty trail layers ready to fill. */
export function MapView({ tileTemplate, center, zoom = 12, bounds, interactive = true, minZoom = MAP_MIN_ZOOM, maxZoom = MAP_MAX_ZOOM, cooperative = false, onReady, label = 'Map', onProblem }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const mapRef = useRef<MLMap | null>(null);
  const problem = useRef(onProblem);
  problem.current = onProblem;

  useEffect(() => {
    const map = new MLMap({
      container: ref.current!,
      style: swissStyle(tileTemplate),
      center: center ?? [-121.78, 47.49],
      zoom,
      bounds,
      fitBoundsOptions: { padding: 32 },
      interactive,
      minZoom,
      maxZoom,
      cooperativeGestures: cooperative,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      transformRequest, // native apps only: saved maps come from Cache Storage (no service worker there)
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.on('error', (e) => { console.warn('[map]', e.error?.message ?? e); problem.current?.(); });
    (window as unknown as { __ridgelineMap?: MLMap }).__ridgelineMap = map;
    map.once('style.load', () => {
      const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
      map.addSource('trails', { type: 'geojson', data: empty });
      map.addSource('done', { type: 'geojson', data: empty });
      map.addSource('me', { type: 'geojson', data: empty });
      map.addLayer({ id: 'trails-hit', type: 'line', source: 'trails', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
      map.addLayer({ id: 'trails-halo', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': ['case', ['boolean', ['get', 'active'], false], 8, 6] } });
      map.addLayer({ id: 'trails-line', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['boolean', ['get', 'active'], false], RED, INK], 'line-width': ['case', ['boolean', ['get', 'active'], false], 4.5, 2.5] } });
      map.addLayer({ id: 'done-line', type: 'line', source: 'done', layout: { 'line-cap': 'round' }, paint: { 'line-color': INK, 'line-width': 2, 'line-dasharray': [1.5, 1.5] } });
      map.addLayer({ id: 'me-acc', type: 'circle', source: 'me', paint: { 'circle-radius': ['get', 'r'], 'circle-color': INK, 'circle-opacity': 0.08 } });
      map.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': INK, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } });
      ready.current?.(map);
    });
    return () => { mapRef.current = null; map.remove(); };
    // The map is created once per mount; parents remount to change the template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileTemplate]);

  // Limits can change while the map is open (the connection drops with a saved trail).
  useEffect(() => { mapRef.current?.setMinZoom(minZoom); mapRef.current?.setMaxZoom(maxZoom); }, [minZoom, maxZoom]);

  return <div ref={ref} className="map" role="region" aria-label={label} />;
}
