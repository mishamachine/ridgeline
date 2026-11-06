import type { Units } from './settings';

const M_TO_FT = 3.28084, M_TO_MI = 0.000621371;

const oneDecimal = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US'));

export const distanceValue = (m: number, u: Units) => oneDecimal(u === 'imperial' ? m * M_TO_MI : m / 1000);
export const distanceUnit = (u: Units) => (u === 'imperial' ? 'mi' : 'km');
export const climbValue = (m: number, u: Units) => Math.round(u === 'imperial' ? m * M_TO_FT : m).toLocaleString('en-US');
export const climbUnit = (u: Units) => (u === 'imperial' ? 'ft' : 'm');
