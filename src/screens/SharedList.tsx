import { useEffect, useState } from 'react';
import { TrailCard } from '../components/TrailCard';
import { Bobo, Placeholder } from '../components/Bobo';
import { resolveTrail } from '../lib/lookup';
import type { LngLat } from '../lib/geo';
import type { Trail } from '../lib/trails';

interface Props { ids: string[]; lls: (LngLat | null)[]; onOpen: (t: Trail) => void; onHome: () => void }

/** A shortlist someone sent. Read-only: nothing is stored and no account is needed. */
export function SharedList({ ids, lls, onOpen, onHome }: Props) {
  const [trails, setTrails] = useState<(Trail | null)[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(ids.map((id, i) => resolveTrail(id, lls[i]).catch(() => null))).then((r) => { if (live) setTrails(r); });
    return () => { live = false; };
  }, [ids, lls]);
  const found = trails?.filter((t): t is Trail => !!t) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <Bobo size={44} />
        <h1 className="page-title">A friend’s shortlist</h1>
      </div>
      <p className="fine pad-x">{ids.length} trail{ids.length === 1 ? '' : 's'} shared with you. This list is read-only; voting isn’t in yet. Tap a trail for its map, climb and directions.</p>
      <div className="page-list">
        {!trails && <Placeholder title="Loading the list…" />}
        {trails && found.length === 0 && <Placeholder title="Couldn’t load these trails">Check your connection, or ask your friend to send the link again.</Placeholder>}
        {found.map((t) => <TrailCard key={t.id} trail={t} saved={false} onOpen={onOpen} />)}
        {trails && found.length < ids.length && found.length > 0 && <p className="fine">{ids.length - found.length} trail{ids.length - found.length === 1 ? '' : 's'} couldn’t be found.</p>}
        <button className="btn btn-outline" onClick={onHome}>Open Ridgeline</button>
      </div>
    </div>
  );
}
