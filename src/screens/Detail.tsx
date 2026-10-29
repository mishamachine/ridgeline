import { useEffect, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView, setGeo } from '../components/MapView';
import { ElevationChart } from '../components/ElevationChart';
import { BackIcon } from '../components/Icons';
import { BLAZE } from '../components/TrailRow';
import { difficulty, estimateMinutes, Trail } from '../lib/trails';
import { getSaved, SavedTrail } from '../lib/store';
import { saveTrailOffline, removeTrailOffline } from '../lib/offline';
import { bboxOf } from '../lib/geo';
import { ft, hm, mb, mi } from '../lib/format';
import { ELEVATION_NOTICE, ELEVATION_LIABILITY } from '../lib/credits';

interface Props {
  tpl: string;
  trail: Trail;
  onBack: () => void;
  onStart: (t: Trail) => void;
  onSavedChange: () => void;
}

const SAC: Record<string, string> = {
  hiking: 'Easy footing', mountain_hiking: 'Uneven, steep in places', demanding_mountain_hiking: 'Scrambling possible',
  alpine_hiking: 'Alpine terrain', demanding_alpine_hiking: 'Technical alpine', difficult_alpine_hiking: 'Technical alpine',
};

export function Detail({ tpl, trail: initial, onBack, onStart, onSavedChange }: Props) {
  const [trail, setTrail] = useState(initial);
  const [saved, setSaved] = useState<SavedTrail | undefined>();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getSaved(trail.id).then((s) => {
      setSaved(s);
      if (s?.trail.elevation) setTrail(s.trail);
    });
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const b = bboxOf(trail.coords);
  const onReady = (map: MLMap) => {
    setGeo(map, 'trails', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { active: true }, geometry: { type: 'LineString', coordinates: trail.coords } }],
    });
  };

  async function save() {
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(0);
    try {
      const s = await saveTrailOffline(trail, (d, n) => setProgress(d / n), ac.signal);
      setSaved(s);
      onSavedChange();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    await removeTrailOffline(trail.id);
    setSaved(undefined);
    onSavedChange();
  }

  const d = difficulty(trail);
  const minutes = trail.ascentM != null ? estimateMinutes(trail.lengthM, trail.ascentM) : null;

  return (
    <>
      <div style={{ padding: 'calc(var(--safe-top) + 16px) 20px 0' }}>
        <button className="icon-btn" aria-label="Back" onClick={onBack}><BackIcon /></button>
      </div>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ink)' }}>
        <div className="eyebrow">{trail.loop ? 'Loop' : 'One way'} · OpenStreetMap</div>
        <h1 style={{ fontSize: 40, marginTop: 8, lineHeight: 0.98 }}>{trail.name}</h1>
      </div>

      <div className="map-box" style={{ height: 200, flex: 'none', borderTop: 0 }}>
        <MapView tileTemplate={tpl} bounds={[[b.west, b.south], [b.east, b.north]]} onReady={onReady} label={`Map of ${trail.name}`} />
      </div>

      {trail.partial && <p className="notice">This route continues past the area you searched. Only the section shown is included.</p>}

      <div className="pad stat-grid">
        <div className="stat"><div className="num">{mi(trail.lengthM)}</div><div className="label">miles{trail.loop ? '' : ' one way'}</div></div>
        <div className="stat"><div className="num">{trail.ascentM != null ? ft(trail.ascentM) : '—'}</div><div className="label">feet of climb</div></div>
        <div className="stat"><div className="num">{minutes != null ? hm(minutes) : '—'}</div><div className="label">hours, estimated</div></div>
        <div className="stat">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>{d ? BLAZE[d] : ''}</span>
            <span style={{ font: '700 22px var(--display)' }}>{d ?? '—'}</span>
          </div>
          <div className="label" style={{ marginTop: 6 }}>difficulty</div>
        </div>
      </div>

      <div className="pad" style={{ paddingTop: 12, paddingBottom: 12 }}>
        {trail.elevation
          ? <ElevationChart elevation={trail.elevation} lengthM={trail.lengthM} />
          : <p className="meta">Elevation isn’t available for this trail.</p>}
      </div>

      <div className="pad" style={{ paddingBottom: 16 }}>
        {trail.tags.sac_scale && <p className="meta" style={{ margin: '0 0 4px' }}>Terrain: {SAC[trail.tags.sac_scale] ?? trail.tags.sac_scale}</p>}
        {trail.tags.surface && <p className="meta" style={{ margin: '0 0 4px' }}>Surface: {trail.tags.surface.replace(/_/g, ' ')}</p>}
        {trail.tags.dog && <p className="meta" style={{ margin: '0 0 4px' }}>Dogs: {trail.tags.dog}</p>}
        <a href={trail.osmUrl} target="_blank" rel="noopener" className="meta" style={{ color: 'var(--ink)' }}>View or fix this trail on OpenStreetMap</a>
        {trail.elevation && (
          <p className="meta" style={{ margin: '12px 0 0', fontSize: 12 }}>
            Elevation: {ELEVATION_NOTICE}. {ELEVATION_LIABILITY}.
          </p>
        )}
        {saved && (
          <p className="meta" style={{ marginTop: 12 }}>
            Saved offline · {mb(saved.bytes)} · <button className="link-btn" onClick={remove}>Remove</button>
          </p>
        )}
        {error && <p className="notice alert" style={{ margin: '12px 0 0' }}>{error}</p>}
      </div>

      <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, zIndex: 3, background: 'var(--paper)' }}>
      {progress != null && <div className="progress red" aria-hidden="true"><div style={{ width: `${progress * 100}%` }} /></div>}
      <div className="actions">
        {saved ? (
          <button className="action light" disabled><span>Ready offline ✓</span><small>Map, route and profile</small></button>
        ) : progress != null ? (
          <button className="action primary" onClick={() => abortRef.current?.abort()}><span>Saving {Math.round(progress * 100)}%</span><small>Tap to cancel</small></button>
        ) : (
          <button className="action primary" onClick={save}><span>Save offline</span><small>Map, route and profile</small></button>
        )}
        <button className="action dark" onClick={() => onStart(trail)}><span>Start hike</span><small>Live GPS</small></button>
      </div>
      </div>
    </>
  );
}
