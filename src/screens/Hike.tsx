import { useEffect, useState } from 'react';
import { Placeholder } from '../components/Bobo';
import { statsLine } from '../components/TrailCard';
import { forHike, listAllSaved, type SavedItem } from '../lib/saved';
import type { Trail } from '../lib/trails';
import { Record } from './Record';

interface Props { visible: boolean; version: number; onStart: (t: Trail) => void; onFind: () => void }

/** The Hike tab when no hike is running: pick a saved trail, or record without one. */
export function Hike({ visible, version, onStart, onFind }: Props) {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [seg, setSeg] = useState<'trail' | 'free'>('trail');
  useEffect(() => { if (visible) listAllSaved().then((l) => setItems(forHike(l))); }, [visible, version]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{seg === 'trail' ? 'Start a hike' : 'Record'}</h1>
      </div>
      <div className="pad-x">
        <div className="seg seg-wide" role="group" aria-label="Hike type">
          <button aria-pressed={seg === 'trail'} onClick={() => setSeg('trail')}>On a trail</button>
          <button aria-pressed={seg === 'free'} onClick={() => setSeg('free')}>Record without a trail</button>
        </div>
      </div>
      {/* Record stays mounted so a recording in progress survives switching. */}
      <div hidden={seg !== 'free'} className="page-fill"><Record /></div>
      {seg === 'trail' && (
        <div className="page-list">
          {items === null && <Placeholder title="Loading…" />}
          {items?.length === 0 && (
            <Placeholder title="No saved trails yet">Save a trail first, ideally with its map downloaded, then start it here.
              <button className="btn btn-primary" onClick={onFind}>Find a trail</button>
            </Placeholder>
          )}
          {items?.map((i) => (
            <button key={i.trail.id} className="pick" onClick={() => onStart(i.trail)}>
              <span className="card-name">{i.trail.name}</span>
              <span className="card-stats">{statsLine(i.trail)}</span>
              <span className="card-foot">{i.offline ? <span className="pill">Ready offline</span> : <span className="away">Needs signal for the map</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
