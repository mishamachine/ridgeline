# Pausing sign-in

Pausing is two small changes, in two places. Together they stop accounts without a store release and without touching anyone's data. Guest mode keeps working exactly as before.

## What pausing does

1. **`flags.json` says `{"accounts": false}`.** Every phone and browser reads this file from our own host (`https://hike.bbprojectfactory.com/flags.json`) when the app starts and when it comes back to the front, at most once an hour. While it says false, the app hides sign-in, shows only "Sign-in is paused for now. Your hikes are safe on this phone.", starts no sync, and leaves the copy on the phone alone. If a phone cannot reach the file it keeps the last value it saw; a new install that has never read it shows nothing about accounts.
2. **The config row `accounts_paused` is `true`.** The database then refuses every write to the synced tables (error code `RL002`), so even an old app version that has not read the flag cannot sync. **Deleting keeps working while paused**, so people can always delete their data or their account: Profile › Account still shows "Delete my Ridgeline data" and "Delete my whole account" to anyone who has a session on the phone, and `/account/delete/` stays reachable (the sign-in screen is the one place Apple's and Google's buttons exist, and while paused it can be opened only from the delete flow, to confirm who is deleting: Apple's script may load there, nowhere else).

## Who may pull it

**Emergency pause, pre-authorized by the owner on 8 Nov 2026.** The CTO may pull the pause alone and tells the owner straight after.

Triggers (any one):
- a nightly health check reports orphan rows greater than 0;
- a nightly health check reports any Vault leftover;
- any failed or partial `delete-account` result;
- an Apple revoke that FAILED (a skipped revoke does not count);
- a confirmed report that a deleted person's data is still there or came back.

When pulling the pause, make exactly these two changes and **nothing else**: no data edits, no migrations, no deploys of the app, no auth changes.

**Resuming needs the owner's go.**

## Steps to pause

1. **Edit the live `flags.json`** on the host so it reads exactly:
   ```json
   {"accounts": false}
   ```
   Edit the file on the host itself (it is served as-is and is never cached: `Cache-Control: no-cache`). Do not wait for an app deploy. Then check it: open `https://hike.bbprojectfactory.com/flags.json` in a browser and confirm it shows `false`. Also update `public/flags.json` in the repo in the next change so the next deploy does not undo it.
2. **Set the config row** with the service role (the SQL editor or any service-role connection):
   ```sql
   update ridgeline.config set value = 'true'::jsonb where key = 'accounts_paused';
   ```
   Check: `select value from ridgeline.config where key = 'accounts_paused';` returns `true`.
3. Tell the owner straight after: what triggered it, the time, and that both changes are made.

Phones pick up the flag within an hour (sooner when the app is reopened). The database refuses writes at once.

## Steps to resume (owner's go first)

1. Set the config row back (this lets queued edits upload again):
   ```sql
   update ridgeline.config set value = 'false'::jsonb where key = 'accounts_paused';
   ```
2. Set the live `flags.json` back to `{"accounts": true}`, and check it in the browser.
3. Nothing is lost: edits made on a phone while paused stay on the phone and upload on the first sync after both changes are undone. A phone that was signed in while paused is still signed in.

## Checks

- Paused: the database refuses a write with `RL002`, and `ridgeline.delete_user_data` still runs (tests in `supabase/tests/ridgeline_sync.test.sql`).
- Paused: no sync call is made, sign-in is hidden, and the delete page still works (tests in `src/lib/accounts/pause.test.tsx` and `src/lib/sync/pausedSync.test.ts`).
- Resumed: edits made during the pause upload with no loss (same tests).
