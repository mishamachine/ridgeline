// Text that names the sign-in providers, per platform. Android offers Google only in v1, so its copy never mentions Apple.
export type Platform = 'ios' | 'android' | 'web';

/** The Apple-disconnect sentence of the whole-account warning. Only where Apple sign-in exists. */
export const appleDisconnectSentence = (platform: Platform): string =>
  platform === 'android' ? '' : ' On iPhone Apple sign-ins we also disconnect Ridgeline from your Apple ID; otherwise remove it yourself in Apple ID settings.';

/** The one sentence about when deleted data is gone. Used verbatim in the delete screen, both confirmations and the privacy Accounts section. */
export const DELETION_TIMING = "Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over.";

/** Asking for deletion without the app (Google Play needs a way to do this). Used on /account/delete/ and in the privacy Accounts section. */
export const DELETE_EMAIL = 'machinemisha@gmail.com';
export const DELETE_MAILTO = `mailto:${DELETE_EMAIL}?subject=Ridgeline%20account%20deletion`;
