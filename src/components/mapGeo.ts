// Small map helpers. Types only from MapLibre, so screens can use them without pulling the library into their chunk.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';

export function setGeo(map: MLMap, source: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** Approximate pixel radius for a GPS accuracy circle at the current zoom. */
export function metersToPixels(map: MLMap, meters: number, lat: number) {
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  return meters / mPerPx;
}
