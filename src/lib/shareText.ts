import { M_TO_MI } from './geo';
import { formatTime } from './shareLinks';

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export const formatMiles = (distanceM: number) => (fin(distanceM) * M_TO_MI).toFixed(1);
export const formatClimb = (climbFt: number) => Math.round(Math.max(0, fin(climbFt))).toLocaleString('en-US');
export const formatHoursMinutes = (movingMs: number) => formatTime(fin(movingMs) / 60000);
