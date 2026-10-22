import { difficulty, Difficulty, Trail } from '../lib/trails';
import { ft, mi } from '../lib/format';
import { ChevronIcon } from './Icons';

/** Trail-blaze shapes so difficulty never relies on color alone. */
export const BLAZE: Record<Difficulty, string> = { Easy: '●', Moderate: '■', Hard: '◆' };

export function TrailRow({ trail, saved, active, onClick }: { trail: Trail; saved?: boolean; active?: boolean; onClick: () => void }) {
  const d = difficulty(trail);
  const parts = [
    d ? `${BLAZE[d]} ${d}` : null,
    `${mi(trail.lengthM)} mi`,
    trail.ascentM != null ? `${ft(trail.ascentM)} ft` : null,
    trail.loop ? 'Loop' : 'One way',
  ].filter(Boolean);
  return (
    <button className={`row${active ? ' active' : ''}`} onClick={onClick}>
      <span className="idx" aria-hidden="true">{d ? BLAZE[d] : '–'}</span>
      <span>
        <span className="name" style={{ display: 'block' }}>{trail.name}</span>
        <span className="meta">{parts.join(' · ')}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {saved && <span className="badge">Offline ✓</span>}
        <ChevronIcon />
      </span>
    </button>
  );
}
