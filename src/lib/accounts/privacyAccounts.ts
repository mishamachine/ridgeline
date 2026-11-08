// The "Accounts" section of the privacy page. It is added to the built page ONLY when features.accounts is true
// (see vite.config.ts), so the public text is never ahead of the behaviour it describes. Wording is the approved draft; do not paraphrase.
/** The one line about Apple's web button. The host in it is tied to the script URL by a test. */
export const APPLE_PRIVACY_LINE = "Apple, when you open the sign-in screen on the web: your browser loads Apple's Sign in with Apple button from Apple's servers (appleid.cdn-apple.com). Apple sees your IP address and browser details. If you choose Apple, it handles your sign-in under its own privacy policy.";

export const ACCOUNTS_SECTION_HTML = `<h2>Accounts (optional)</h2>
<p><strong>Accounts (optional).</strong> You can use Ridgeline without an account. If you sign in with Google or Apple, we store:</p>
<ul>
<li>your email address, and the name and profile picture Google or Apple share with us</li>
<li>the trails you save and shortlist</li>
<li>your hike history (date, time, distance, climb, the trail, and the route you walked, with the first and last 200 m removed)</li>
<li>your settings</li>
</ul>
<p>We use these only to keep your hikes safe and on all your devices. You can keep routes on your phone only (Profile &rsaquo; Settings &rsaquo; &ldquo;Keep hike tracks on this phone only&rdquo;).</p>
<p><strong>One account across our apps.</strong> Your sign-in is one account shared with our other apps (B&amp;B and Bobo Learns). Signing in to Ridgeline doesn't share your hikes with those apps. If you sign in with Google and Apple using the same email address, they become one account (this doesn't happen if you chose Apple's &ldquo;Hide My Email&rdquo;). Signing in doesn't add you to any mailing list or create anything in our other apps.</p>
<p><strong>Who stores it.</strong> Supabase (our database provider) stores your data in the United States (Oregon). It's encrypted in transit. We don't sell it, and we don't use it for ads.</p>
<p><strong>Deleting.</strong> In Profile &rsaquo; Account or at hike.bbprojectfactory.com/account/delete/ you can delete your Ridgeline data only, or your whole account across our apps. Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over. If you delete your whole account and you signed in with Apple on an iPhone, we also tell Apple to disconnect Ridgeline. If you signed in with Apple on the web, or that doesn't work, to fully disconnect, also remove Ridgeline in your Apple ID settings &rsaquo; Sign in with Apple (appleid.apple.com).</p>
<p><strong>Outside services when you sign in.</strong></p>
<ul>
<li>${APPLE_PRIVACY_LINE}</li>
</ul>
<p><strong>Usage counts are separate.</strong> Usage counts are never linked to your account.</p>

`;

const ANCHOR = '<h2>Your choices</h2>';

/** Adds the section before "Your choices" when `on`; returns the page unchanged otherwise. */
export function injectAccountsSection(html: string, on: boolean): string {
  if (!on) return html;
  if (html.includes('Accounts (optional)')) return html; // the rewritten page already carries it
  if (!html.includes(ANCHOR)) throw new Error('privacy page: anchor "Your choices" not found');
  return html.replace(ANCHOR, ACCOUNTS_SECTION_HTML + ANCHOR);
}

/** Reads the flag out of features.ts text so there is one switch for the feature and its public text. */
export const accountsFlagOn = (featuresSource: string) => /^\s*accounts:\s*true\b/m.test(featuresSource);
