// Text that names the sign-in providers, per platform. Android offers Google only in v1, so its copy never mentions Apple;
// web and iOS keep "Google or Apple".
export type Platform = 'ios' | 'android' | 'web';

export const providerWords = (platform: Platform): string => (platform === 'android' ? 'Google' : 'Google or Apple');

/** The Apple-disconnect sentence of the whole-account warning. Only where Apple sign-in exists. */
export const appleDisconnectSentence = (platform: Platform): string =>
  platform === 'android' ? '' : ' On iPhone Apple sign-ins we also disconnect Ridgeline from your Apple ID; otherwise remove it yourself in Apple ID settings.';

/** The one sentence about when deleted data is gone. Used verbatim in the delete screen, both confirmations and the privacy Accounts section. */
export const DELETION_TIMING = "Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over.";
