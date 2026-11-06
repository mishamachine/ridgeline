// Voice and units for Navigate. They live in the shared settings (Profile edits the same values).
import { getSettings, updateSettings, type Units } from '../settings';

export type { Units };

export const getVoiceOn = () => getSettings().voice;
export const getUnits = (): Units => getSettings().units;
export const setVoiceOn = (on: boolean) => updateSettings({ voice: on });
