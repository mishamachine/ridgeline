import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { ZoomButtons } from './ZoomButtons';
import { isRotated, type FollowMode } from '../lib/followMode';

const svg = (children: ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

/** North arrow: the red half points to north, so it turns against the map. Shows only while the map is turned or tilted. */
export function Compass({ map, onNorth }: { map: MLMap | null; onNorth?: () => void }) {
  const [view, setView] = useState({ bearing: 0, pitch: 0 });
  useEffect(() => {
    if (!map) return;
    const sync = () => setView({ bearing: map.getBearing(), pitch: map.getPitch() });
    sync();
    map.on('rotate', sync); map.on('pitch', sync); map.on('moveend', sync);
    return () => { map.off('rotate', sync); map.off('pitch', sync); map.off('moveend', sync); };
  }, [map]);
  if (!map || !isRotated(view.bearing, view.pitch)) return null;
  return (
    <button type="button" className="round compass-btn" aria-label="Reset the map to north" onClick={() => { onNorth?.(); map.resetNorthPitch({ duration: 300 }); }}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-view.bearing}deg)` }}>
        <path d="M12 2l4 10H8z" fill="#B01C1C" />
        <path d="M12 22l-4-10h8z" fill="currentColor" opacity=".55" />
      </svg>
    </button>
  );
}

/** Locate / follow. Off: centre on me. Centred: turn on heading-up. Heading-up: off. */
export function FollowButton({ mode, pending, onPress }: { mode: FollowMode; pending: boolean; onPress: () => void }) {
  const state = mode === 'off' ? 'Off. Tap to centre on you.' : mode === 'centre' ? 'Centred on you. Tap for heading-up.' : 'Heading-up. Tap to turn off.';
  const id = useId();
  return (
    <button type="button" className={`round follow-btn follow-${mode}`} aria-label="Follow my location" aria-describedby={id} aria-pressed={mode !== 'off'} aria-busy={pending || undefined} data-follow={mode} onClick={onPress}>
      <span id={id} className="sr">{state}</span>
      {mode === 'heading'
        ? svg(<path d="M12 3l7 17-7-4-7 4z" fill="currentColor" />)
        : svg(<><circle cx="12" cy="12" r="4" fill={mode === 'centre' ? 'currentColor' : 'none'} /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>)}
    </button>
  );
}

/** A short line about the compass (denied, or none on this device). Fades after a few seconds. */
export function FollowNote({ note }: { note: string | null }) {
  const [shown, setShown] = useState(note);
  useEffect(() => {
    setShown(note);
    if (!note) return;
    const t = setTimeout(() => setShown(null), 7000);
    return () => clearTimeout(t);
  }, [note]);
  return shown ? <div className="follow-note" role="status">{shown}</div> : null;
}

interface Props {
  map: MLMap | null;
  minZoom?: number;
  maxZoom?: number;
  className?: string;
  onZoom?: () => void;
  follow?: { mode: FollowMode; pending: boolean; onPress: () => void };
  /** Called when the north arrow is tapped (heading-up must stop, or it would turn the map straight back). */
  onNorth?: () => void;
  /** More buttons for the same stack (full screen). */
  children?: ReactNode;
}

/** One stack, bottom right: zoom, locate/follow, compass, then anything the screen adds. Every button is 44 px. */
export function MapControls({ map, minZoom, maxZoom, className = '', onZoom, follow, onNorth, children }: Props) {
  return (
    <div className={`map-stack ${className}`}>
      <ZoomButtons map={map} minZoom={minZoom} maxZoom={maxZoom} onZoom={onZoom} />
      {follow && <FollowButton {...follow} />}
      <Compass map={map} onNorth={onNorth} />
      {children}
    </div>
  );
}
