import { useEffect, useState } from 'react';
import { Placeholder } from '../components/Bobo';
import { PageHead } from '../components/PageHead';
import { statsLine } from '../components/TrailCard';
import { useSettings } from '../lib/settings';
import { forHike, listAllSaved, type SavedItem } from '../lib/saved';
import type { Trail } from '../lib/trails';
import { Record } from './Record';
import { closeAbandoned, resumable } from '../lib/abandoned';
import { putActivity, type Activity } from '../lib/store';

interface Props { visible: boolean; version: number; onStart: (t: Trail) => void; onFind: () => void; onResume: (a: Activity) => void }

/** The Hike tab when no hike is running: pick a saved trail, or record without one. */
export function Hike({ visible, version, onStart, onFind, onResume }: Props) {
  const [{ units }] = useSettings();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [seg, setSeg] = useState<'trail' | 'free'>('trail');
  const [open, setOpen] = useState<Activity | null>(null); // a hike that was left running, under 6 hours ago
  useEffect(() => { if (visible) listAllSaved().then((l) => setItems(forHike(l))); }, [visible, version]);
  useEffect(() => { if (visible) closeAbandoned().then((l) => setOpen(resumable(l, Date.now()))).catch(() => {}); }, [visible, version]);

  return (
    <div className="page">
      <PageHead title={seg === 'trail' ? 'Start a hike' : 'Record'} />
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
          {open && (
            <div className="note note-alert" role="group" aria-label="Resume hike?">
              <b>Resume hike?</b>
              <div>{open.name} was left running. It keeps your track so far.</div>
              <div className="act-row">
                <button className="btn btn-primary" onClick={() => onResume(open)}>Resume hike</button>
                <button className="btn" onClick={async () => { await putActivity({ ...open, endedAt: open.points.at(-1)?.t ?? open.startedAt, unfinished: true }); setOpen(null); }}>End it</button>
              </div>
            </div>
          )}
          {items === null && <Placeholder title="Loading…" />}
          {items?.length === 0 && (
            <Placeholder title="No saved trails yet">Save a trail first, ideally with its map downloaded, then start it here.
              <button className="btn btn-primary" onClick={onFind}>Find a trail</button>
            </Placeholder>
          )}
          {items?.map((i) => (
            <button key={i.trail.id} className="pick" onClick={() => onStart(i.trail)}>
              <span className="card-name">{i.trail.name}</span>
              <span className="card-stats">{statsLine(i.trail, units)}</span>
              <span className="card-foot">{i.offline ? <span className="pill">Ready offline</span> : <span className="away">Needs signal for the map</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
