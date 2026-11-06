import { M_TO_MI } from './geo';
import { formatTime } from './shareLinks';

/** Below this share of the trail, we never say "summit" or "finished". We celebrate the effort instead. */
export const FINISHED_FRACTION = 0.8;
export const BIG_CLIMB_FT = 1000;
export const LONG_MILES = 8;
export const EARLY_HOUR = 7;

export interface HikeSummary {
  trail: { id: string; name: string; highlights?: string[]; /** Elevation (m), evenly spaced, start to end. */ elevation?: number[] };
  distanceM: number;
  climbFt: number;
  movingMs: number;
  startedAt: number;
  endedAt: number;
  highlightsHit: string[];
  completedFraction: number;
  track: { lat: number; lon: number }[];
}

export interface Hype {
  eyebrow: string;
  headline: string;
  sub: string;
  finished: boolean;
}

const num = (n: number) => (Number.isFinite(n) ? n : 0);
export const isFinished = (fraction: number) => num(fraction) >= FINISHED_FRACTION;

export function hikeMiles(s: Pick<HikeSummary, 'distanceM'>) {
  return num(s.distanceM) * M_TO_MI;
}

const fmtFt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Headline and sub line built only from numbers the hike really produced. */
export function hype(s: HikeSummary): Hype {
  const miles = hikeMiles(s);
  const climb = Math.max(0, num(s.climbFt));
  const name = s.trail.name || 'the trail';
  const time = formatTime(num(s.movingMs) / 60000);
  const finished = isFinished(s.completedFraction);
  const startHour = new Date(s.startedAt).getHours();
  const stats = `${miles.toFixed(1)} mi, ${fmtFt(climb)} ft climbed, ${time}.`;

  if (!finished) {
    if (miles < 0.25) {
      return { eyebrow: 'You got out there', headline: 'You started. That counts.', sub: 'Every hike begins with the first step. Bobo is proud of you.', finished };
    }
    return {
      eyebrow: 'Nice hike',
      headline: `${miles.toFixed(1)} miles on ${name}.`,
      sub: `${stats} Every mile counts, and Bobo is proud of you.`,
      finished,
    };
  }
  if (climb >= BIG_CLIMB_FT) {
    return { eyebrow: 'Hike complete', headline: `${fmtFt(climb)} ft up.\nYou crushed ${name}.`, sub: `${miles.toFixed(1)} mi in ${time}. Bobo is impressed.`, finished };
  }
  if (miles >= LONG_MILES) {
    return { eyebrow: 'Hike complete', headline: `${miles.toFixed(1)} miles.\nYou owned ${name}.`, sub: `${fmtFt(climb)} ft climbed in ${time}. That is a real day out.`, finished };
  }
  if (startHour < EARLY_HOUR) {
    return { eyebrow: 'Hike complete', headline: `Up before the sun.\nDone with ${name}.`, sub: `${stats} Bobo is impressed.`, finished };
  }
  return { eyebrow: 'Hike complete', headline: `You crushed\n${name}.`, sub: `${stats} Bobo is impressed.`, finished };
}

/** Highlights the user hit that are also really on this trail (case-insensitive), in the trail's own words. */
export function highlightChips(trail: HikeSummary['trail'], hit: string[]): string[] {
  const onTrail = trail.highlights ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hit) {
    const match = onTrail.find((t) => t.toLowerCase() === h.toLowerCase());
    if (match && !seen.has(match.toLowerCase())) { seen.add(match.toLowerCase()); out.push(match); }
  }
  return out;
}

/** The one human line on the share card. 8 words at most, no exclamation marks. */
export function boboLine(s: HikeSummary): string {
  const climb = Math.round(Math.max(0, num(s.climbFt)));
  if (isFinished(s.completedFraction) && climb >= BIG_CLIMB_FT) return `Bobo says: ${fmtFt(climb)} ft, worth it.`;
  if (isFinished(s.completedFraction)) return 'Bobo says: good day outside.';
  return 'Bobo says: every mile counts.';
}

