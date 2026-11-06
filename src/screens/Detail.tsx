import { useEffect, useMemo, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView, setGeo } from '../components/MapView';
import { ElevationChart } from '../components/ElevationChart';
import { HighlightChips } from '../components/Chips';
import { BackIcon } from '../components/Icons';
import { CheckIcon, DownloadIcon, DriveIcon, SavedIcon, ShareIcon } from '../components/NavIcons';
import { ConfirmSheet } from '../components/ConfirmSheet';
import type { Trail } from '../lib/trails';
import { getSaved, SavedTrail } from '../lib/store';
import { removeTrailOffline, tilesForTrail } from '../lib/offline';
import { bboxOf } from '../lib/geo';
import { ft, hrs, mb, mi } from '../lib/format';
import { level, roundTripClimbM, roundTripM, tripMinutes } from '../lib/plan';
import { detectPlatform, driveLabel, mapsOptions } from '../lib/maps';
import { shareTrail } from '../lib/share';
import { bookmark, unsave } from '../lib/saved';
import { useDownload } from '../lib/useDownload';
import { A2HS_TIP, isIOS, isStandalone } from '../lib/pwa';
import { requestCompassPermission } from '../lib/gps/compass';
import { ELEVATION_NOTICE, ELEVATION_LIABILITY, SAFETY_LINE } from '../lib/credits';

interface Props {
  tpl: string;
  trail: Trail;
  bookmarked: boolean;
  onBack: () => void;
  onStart: (t: Trail) => void;
  onSavedChange: () => void;
}

// Measured on the Rattlesnake Ledge download in dev: about 15 KB per tile (see PR notes). An estimate, shown as "about".
const AVG_TILE_BYTES = 15 * 1024;

const SAC: Record<string, string> = {
  hiking: 'Easy footing', mountain_hiking: 'Uneven, steep in places', demanding_mountain_hiking: 'Scrambling possible',
  alpine_hiking: 'Alpine terrain', demanding_alpine_hiking: 'Technical alpine', difficult_alpine_hiking: 'Technical alpine',
};

export function Detail({ tpl, trail, bookmarked, onBack, onStart, onSavedChange }: Props) {
  const [saved, setSaved] = useState<SavedTrail | undefined>();
  const [chooser, setChooser] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const dl = useDownload(trail, () => { setJustSaved(true); refresh(); onSavedChange(); });

  const refresh = () => getSaved(trail.id).then(setSaved);
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [trail.id]);

  const b = useMemo(() => bboxOf(trail.coords), [trail]);
  const onReady = (map: MLMap) => {
    setGeo(map, 'trails', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { active: true }, geometry: { type: 'LineString', coordinates: trail.coords } }],
    });
  };

  const lv = level(trail);
  const climb = roundTripClimbM(trail);
  const minutes = climb != null ? tripMinutes(trail) : null;
  const estimate = useMemo(() => tilesForTrail(trail).length * AVG_TILE_BYTES, [trail]);
  const options = mapsOptions(trail, detectPlatform());

  async function toggleBookmark() {
    if (bookmarked) {
      if (saved) setConfirmRemove(true);
      else { await unsave(trail.id); onSavedChange(); }
    } else { await bookmark(trail); onSavedChange(); }
  }

  async function removeAll() {
    setConfirmRemove(false);
    await unsave(trail.id);
    setSaved(undefined);
    setJustSaved(false);
    onSavedChange();
  }

  async function removeOffline() {
    await removeTrailOffline(trail.id);
    setSaved(undefined);
    setJustSaved(false);
    onSavedChange();
  }

  return (
    <div className="trail-page">
      <div className="trail-scroll">
        <div className="trail-map">
          <MapView tileTemplate={tpl} bounds={[[b.west, b.south], [b.east, b.north]]} interactive={false} onReady={onReady} label={`Map of ${trail.name}`} />
          <button className="round trail-back" aria-label="Back" onClick={onBack}><BackIcon /></button>
          <div className="trail-actions">
            <button className="round" aria-label={`Share ${trail.name}`} onClick={() => shareTrail(trail)}><ShareIcon /></button>
            <button className="round" aria-label={bookmarked ? 'Remove from Saved' : 'Save to Saved'} aria-pressed={bookmarked} onClick={toggleBookmark}><SavedIcon filled={bookmarked} /></button>
          </div>
        </div>

        <div className="trail-info">
          <div>
            <h1 className="trail-title">{trail.name}</h1>
            <div className="trail-sub">{trail.loop ? 'Loop' : 'Out and back'} · from OpenStreetMap</div>
            <HighlightChips trail={trail} max={5} />
          </div>

          {trail.partial && <p className="note">This route continues past the area loaded. Only the section shown is included.</p>}

          <div className="tiles">
            <div className="tile"><div className="tile-num">{mi(roundTripM(trail))} mi</div><div className="tile-lab">{trail.loop ? 'loop' : 'round trip'}</div></div>
            <div className="tile"><div className="tile-num">{climb != null ? ft(climb) : '—'}</div><div className="tile-lab">ft climb</div></div>
            <div className="tile"><div className="tile-num">{minutes != null ? hrs(minutes) : '—'}</div><div className="tile-lab">est. time</div></div>
            <div className="tile tile-dark"><div className="tile-word">{lv ?? '—'}</div><div className="tile-lab">level</div></div>
          </div>
          {lv && <p className="fine">Level is computed from distance and climb, not rated by anyone. Time assumes 3 mph plus 30 min per 1,000 ft up.</p>}

          <div className="panel">
            <div className="panel-head">Elevation{trail.loop ? '' : ', one way'}</div>
            {trail.elevation
              ? <ElevationChart elevation={trail.elevation} lengthM={trail.lengthM} />
              : <p className="fine" style={{ margin: 0 }}>Elevation isn’t available for this trail.</p>}
          </div>

          <ul className="facts">
            {trail.trailhead && <li><b>Parking:</b> {trail.trailheadIsParking ? 'a mapped parking lot is next to the trail start' : 'no parking lot mapped; the pin is where the trail starts'}</li>}
            {trail.tags.sac_scale && <li><b>Terrain:</b> {SAC[trail.tags.sac_scale] ?? trail.tags.sac_scale}</li>}
            {trail.tags.surface && <li><b>Surface:</b> {trail.tags.surface.replace(/_/g, ' ')}</li>}
            {trail.tags.dog && <li><b>Dogs:</b> {trail.tags.dog}</li>}
          </ul>

          {saved && (
            <p className="fine">Ready offline · {mb(saved.bytes)} · <button className="link-btn" onClick={removeOffline}>Remove download</button></p>
          )}
          {(justSaved || saved) && !isStandalone() && isIOS() && <p className="note">{A2HS_TIP}</p>}
          {dl.error && <p className="note note-alert" role="alert">{dl.error}</p>}

          <div className="fine credits">
            <p>{SAFETY_LINE}</p>
            <p>Map and trails © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. <a href={trail.osmUrl} target="_blank" rel="noopener">View or fix this trail</a>.</p>
            {trail.elevation && <p>Elevation: {ELEVATION_NOTICE}. {ELEVATION_LIABILITY}.</p>}
          </div>
        </div>
      </div>

      <div className="dock">
        {dl.progress != null && <div className="progress red" aria-hidden="true"><div style={{ width: `${dl.progress * 100}%` }} /></div>}
        <div className="dock-row">
          {options.length === 1 ? (
            <a className="btn btn-outline" href={options[0].url} target="_blank" rel="noopener"><DriveIcon size={20} /> {driveLabel(trail)}</a>
          ) : (
            <button className="btn btn-outline" onClick={() => setChooser(true)}><DriveIcon size={20} /> {driveLabel(trail)}</button>
          )}
          {saved ? (
            <button className="btn btn-outline" disabled><CheckIcon size={20} /> Ready offline</button>
          ) : dl.progress != null ? (
            <button className="btn btn-outline" onClick={dl.cancel}>Saving {Math.round(dl.progress * 100)}% · Cancel</button>
          ) : (
            <button className="btn btn-outline" onClick={dl.start}><DownloadIcon size={20} /> Save offline<small>about {mb(estimate)}</small></button>
          )}
        </div>
        <button className="btn btn-primary btn-big" onClick={() => { requestCompassPermission(); onStart(trail); }}>Start hike</button>
      </div>

      {chooser && (
        <div className="sheet-wrap" onClick={() => setChooser(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Open in maps" onClick={(e) => e.stopPropagation()}>
            <h2 className="sheet-title">Open directions in</h2>
            {options.map((o) => <a key={o.label} className="btn btn-outline" href={o.url} target="_blank" rel="noopener" onClick={() => setChooser(false)}>{o.label}</a>)}
            <button className="btn btn-outline" onClick={() => setChooser(false)}>Cancel</button>
          </div>
        </div>
      )}
      {confirmRemove && (
        <ConfirmSheet title="Remove from Saved?" body="This also deletes the offline map for this trail." confirmLabel="Remove" cancelLabel="Keep it" danger onConfirm={removeAll} onCancel={() => setConfirmRemove(false)} />
      )}
    </div>
  );
}
