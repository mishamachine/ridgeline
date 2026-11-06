// Voice and units preferences. Profile/settings will own these later; until then the keys are read directly.
export type Units = 'imperial' | 'metric';

export const VOICE_KEY = 'ridgeline.voice';
export const UNITS_KEY = 'ridgeline.units';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export const getVoiceOn = () => read(VOICE_KEY) !== 'off';
export const getUnits = (): Units => (read(UNITS_KEY) === 'metric' ? 'metric' : 'imperial');

export function setVoiceOn(on: boolean) {
  try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch { /* private mode: keep it for this session only */ }
}
