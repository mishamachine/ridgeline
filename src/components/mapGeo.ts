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

const CONE_ID = 'me-cone';
/** A soft wedge pointing up, drawn once: the way the phone faces. */
function coneImage(): ImageData {
  const n = 96, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 6, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(17,17,17,0.55)');
  grad.addColorStop(1, 'rgba(17,17,17,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(n / 2, n / 2);
  g.arc(n / 2, n / 2, n / 2 - 1, (-90 - 32) * (Math.PI / 180), (-90 + 32) * (Math.PI / 180));
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, n, n);
}

/** Shows (or, with null, hides) the facing-direction cone on the location dot. `heading` is degrees clockwise from north. */
export function setHeadingCone(map: MLMap, at: [number, number] | null, heading: number) {
  try {
    if (!map.getSource('me-heading')) {
      if (!at) return;
      if (!map.hasImage(CONE_ID)) map.addImage(CONE_ID, coneImage(), { pixelRatio: 2 });
      map.addSource('me-heading', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: CONE_ID, type: 'symbol', source: 'me-heading', layout: { 'icon-image': CONE_ID, 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'me-dot');
    }
    setGeo(map, 'me-heading', { type: 'FeatureCollection', features: at ? [{ type: 'Feature', properties: { heading }, geometry: { type: 'Point', coordinates: at } }] : [] });
  } catch { /* style not ready: the next reading draws it */ }
}
