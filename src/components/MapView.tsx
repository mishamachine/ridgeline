import { useEffect, useRef } from 'react';
import { Map as MLMap, GeoJSONSource, setWorkerUrl, type LngLatBoundsLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre looks for its worker next to its own file, which bundling moves; point it at the bundled copy.
setWorkerUrl(workerUrl);
import { swissStyle, INK, RED } from '../lib/mapStyle';
import type { LngLat } from '../lib/geo';

interface Props {
  tileTemplate: string;
  center?: LngLat;
  zoom?: number;
  bounds?: LngLatBoundsLike;
  interactive?: boolean;
  onReady?: (map: MLMap) => void;
  label?: string;
}

/** A MapLibre map with the Swiss style and empty trail layers ready to fill. */
export function MapView({ tileTemplate, center, zoom = 12, bounds, interactive = true, onReady, label = 'Map' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    const map = new MLMap({
      container: ref.current!,
      style: swissStyle(tileTemplate),
      center: center ?? [-121.78, 47.49],
      zoom,
      bounds,
      fitBoundsOptions: { padding: 32 },
      interactive,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.on('load', () => {
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
    return () => map.remove();
    // The map is created once per mount; parents remount to change the template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileTemplate]);

  return <div ref={ref} className="map" role="region" aria-label={label} />;
}

export function setGeo(map: MLMap, source: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** Approximate pixel radius for a GPS accuracy circle at the current zoom. */
export function metersToPixels(map: MLMap, meters: number, lat: number) {
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  return meters / mPerPx;
}
