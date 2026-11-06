import type { GpsState } from '../../lib/gps/engine';
import type { Step } from '../../lib/voice/forkpoints';
import type { OffSide } from '../../lib/voice/offroute';
import type { Units } from '../../lib/voice/prefs';
import { shortDistance } from '../../lib/voice/units';
import type { GlyphKind } from './Glyph';

/** What the banner (and pocket mode) says right now. */
export interface NavView { glyph: GlyphKind; big: string; line: string; sub?: string; off: boolean }

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compassWord = (deg: number) => POINTS[Math.round(deg / 45) % 8];

export function buildView(opts: { g: GpsState; step: Step | null; trailName: string; units: Units; offSide: { side: OffSide; distM: number } | null; paused: boolean }): NavView {
  const { g, step, trailName, units, offSide } = opts;
  if (!g.recalLastOffRoute && !g.hasFix && !g.stalePosition) return { glyph: 'wait', big: '—', line: 'Finding your position', sub: g.warmingUp ? 'Stay in the open for a moment' : undefined, off: false };
  if (g.recalLastOffRoute) return { glyph: 'off', big: '—', line: 'Off route (last known)', sub: 'Waiting for GPS', off: true };
  if (g.offRoute) {
    const d = offSide?.distM ?? g.offsetM ?? 0;
    const side = offSide?.side;
    return { glyph: 'off', big: shortDistance(d, units), line: "You're off the trail", sub: side ? (side === 'behind' ? 'The trail is behind you' : side === 'ahead' ? 'The trail is ahead' : `The trail is to your ${side}`) : undefined, off: true };
  }
  if (g.along == null || !step) {
    return { glyph: 'straight', big: g.offsetM != null ? shortDistance(g.offsetM, units) : '—', line: 'to the trail', sub: g.trailBearing != null ? `Head ${compassWord(g.trailBearing)}` : undefined, off: false };
  }
  if (step.kind === 'fork') {
    const f = step.fork;
    const now = step.toM <= 15;
    return {
      glyph: f.kind === 'turn' ? (f.side === 'left' ? 'turn-left' : 'turn-right') : f.side === 'left' ? 'stay-left' : 'stay-right',
      big: now ? 'Now' : shortDistance(step.toM, units),
      line: f.kind === 'turn' ? `Turn ${f.side}` : `Stay ${f.side} at the fork`,
      sub: `onto ${f.name}`,
      off: false,
    };
  }
  if (step.kind === 'turnaround') return { glyph: 'uturn', big: 'Now', line: 'Turnaround point', sub: 'Head back the way you came', off: false };
  return { glyph: 'straight', big: shortDistance(step.toM, units), line: `Follow ${trailName}`, sub: step.target === 'turnaround' ? 'to the turnaround' : 'to the end', off: false };
}
