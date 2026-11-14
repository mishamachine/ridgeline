// Text that names the sign-in providers, per platform. Android offers Google only in v1, so its copy never mentions Apple.
export type Platform = 'ios' | 'android' | 'web';

/** The Apple-disconnect sentence of the whole-account warning. Only where Apple sign-in exists. */
export const appleDisconnectSentence = (platform: Platform): string =>
  platform === 'android' ? '' : ' On iPhone Apple sign-ins we also disconnect Ridgeline from your Apple ID; otherwise remove it yourself in Apple ID settings.';

/** The one sentence about when deleted data is gone. Used verbatim in the delete screen, both confirmations and the privacy Accounts section. */
export const DELETION_TIMING = "Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 8 days, when backups roll over.";

/**
 * Asking for deletion without the app (Google Play needs a way to do this). ONE source for the sentence, used on /account/delete/ and in the privacy
 * Accounts section. The address is the published contact address; the confirmation and the 7-day rule are what docs/DELETE_BY_EMAIL.md does.
 */
export const DELETE_EMAIL = 'machinemisha@gmail.com';
export const DELETE_MAILTO = `mailto:${DELETE_EMAIL}?subject=Ridgeline%20account%20deletion`;
export const DELETE_EMAIL_BEFORE = 'You can also email ';
export const DELETE_EMAIL_AFTER = " from your account's email address. We'll send a confirmation to that address. Once you confirm, we delete within 7 days, and never more than one month after your request. The confirmation code expires after 23 days. (If you signed in with Apple's Hide My Email, delete in Profile › Account instead.)";
/** The whole sentence as plain text. */
export const DELETE_EMAIL_LINE = DELETE_EMAIL_BEFORE + DELETE_EMAIL + DELETE_EMAIL_AFTER;
/** The same sentence as HTML for the privacy page (the address is a mailto link, the arrow an entity). */
export const deleteEmailLineHtml = () => `${DELETE_EMAIL_BEFORE}<a href="${DELETE_MAILTO}">${DELETE_EMAIL}</a>${DELETE_EMAIL_AFTER.replace('›', '&rsaquo;')}`;
