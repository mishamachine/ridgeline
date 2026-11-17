import { useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { atZoomLimit, zoomStep } from '../lib/mapZoom';

const icon = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>;

/** A vertical + / - pair in the same round style as the locate button. Greys out at either end of the zoom range. */
export function ZoomButtons({ map, onZoom, className = '', minZoom, maxZoom }: { map: MLMap | null; onZoom?: () => void; className?: string; minZoom?: number; maxZoom?: number }) {
  const [lim, setLim] = useState({ min: false, max: false });
  useEffect(() => {
    if (!map) return;
    const sync = () => setLim(atZoomLimit(map));
    sync();
    map.on('zoom', sync);
    map.on('zoomend', sync);
    return () => { map.off('zoom', sync); map.off('zoomend', sync); };
  }, [map, minZoom, maxZoom]); // the limits change when the connection does (MapView applies them first)
  const step = (d: 1 | -1) => { if (map) { zoomStep(map, d); onZoom?.(); } };
  return (
    <div className={`zoom-pair ${className}`} role="group" aria-label="Map zoom">
      <button type="button" className="round" aria-label="Zoom in" disabled={!map || lim.max} onClick={() => step(1)}>{icon('M12 5v14M5 12h14')}</button>
      <button type="button" className="round" aria-label="Zoom out" disabled={!map || lim.min} onClick={() => step(-1)}>{icon('M5 12h14')}</button>
    </div>
  );
}
