import { getSettings, updateSettings } from './settings';

/** The app was added to the home screen (appinstalled, or the system prompt was accepted). */
export const markInstalled = () => { if (!getSettings().installDone) updateSettings({ installDone: true }); };
