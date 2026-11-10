// A sheet or modal is opening. The native Apple button floats ABOVE the web page, so it must disappear the instant anything opens over it,
// not on the next poll. Anything that opens an overlay calls announceOverlayOpen() when it mounts.
import { useEffect } from 'react';

export const OVERLAY_EVENT = 'ridgeline:overlay-open';
export const announceOverlayOpen = () => { try { window.dispatchEvent(new Event(OVERLAY_EVENT)); } catch { /* no window */ } };
/** Call from a component that is an overlay: it announces itself when it appears. */
export function useAnnounceOverlay() { useEffect(() => { announceOverlayOpen(); }, []); }
