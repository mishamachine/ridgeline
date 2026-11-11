# Deleting an account by email (runbook)

For people who ask for deletion by email instead of in the app (Google Play requires a way to ask without the app). The published address is machinemisha@gmail.com; the delete page and the privacy Accounts section say:

> You can also email machinemisha@gmail.com from your account's email address. We'll send a confirmation to that address, and once you confirm, we delete within 7 days. (If you signed in with Apple's Hide My Email, delete in Profile › Account instead.)

**Who handles it:** the team member or agent that reads the mailbox handles each request from start to finish, and tells the owner afterwards (step 6). Nothing here is done ad hoc: the delete itself only ever runs through the admin delete path (step 5), which is the same code as the in-app delete.

**Private log:** requests are logged in a private log kept outside this repository. It holds the mail thread id, the date received, the due dates, the confirmation code's hash and expiry, and the result. **Never write the requester's email address, a code in clear text, or any token into the log, a ticket, the owner's note or this repository.**

**Clocks (the legal one-month clock runs from the first request):**
- send the confirmation (step 4) within **2 days** of the request;
- the code is single-use and expires after **30 days**; with no valid confirmation after 30 days, close the request with a short reply and log it (step 7);
- once a valid confirmation arrives, delete within **7 days** (step 5).

## The 7 steps

### 1. Intake
Log the mail thread id, the date received, "confirmation due" (received + 2 days) and "close if unconfirmed" (received + 30 days). Do not log the sender's address.

### 2. Authenticity of the request
Read the message in **RAW** format (the Gmail connector's raw format exposes the receiving server's header). Then:
- Trust **only** the `Authentication-Results` header added by `mx.google.com`, the topmost one, added on receipt. **Ignore every other `Authentication-Results` header and every `ARC-*` header: a sender can forge those.**
- Require `dkim=pass` **and** `dmarc=pass`, with `header.from` equal to the domain of the message's From address.
- Anything else (`fail`, `none`, `temperror`, a mismatch, a missing header) means **no delete**. Send template A.

### 3. Does the sender match an account? (read-only)
Compare the verified From address, as an exact case-insensitive match, with `auth.users.email`. Use a read-only query that returns only whether there is one match and, if so, the user id and the sign-in providers:
```sql
select id, (select array_agg(provider) from auth.identities i where i.user_id = u.id) as providers
from auth.users u where lower(email) = lower('<verified From address>');
```
- **Apple "Hide My Email" account** (`@privaterelay.appleid.com`, or the sender cannot be an exact match): do not delete by email. Send template C (use the in-app delete).
- **No match, or more than one:** send template B (the generic reply). Never say whether an account exists.
- **Exactly one match:** continue.

### 4. Confirmation (a NEW message, not a reply)
Generate a random one-time code (at least 10 characters), store only its hash and its expiry (30 days) in the private log, and send a **new** message to the account's email on file (not a reply to the request) with template D. The code is single-use. No valid code, no delete.

The two options in the confirmation:
- reply `DELETE RIDGELINE <code>` to delete Ridgeline data only (mode `data`);
- reply `DELETE ALL <code>` to delete the whole account (mode `account`), which removes the sign-in and the data in Ridgeline, our language app (woof.bobolearns.com), the BoboLearns Hub sign-in and any other B&B app signed in to. Bobo Learns Chess doesn't use accounts; its anonymous data is covered at chess.bobolearns.com/privacy/.

A reply with a wrong, expired, already-used or missing code, or from a different address than the account's, gets template E and **never** a delete.

### 5. Execute (only through the admin delete path)
Run the GitHub Actions workflow **Admin delete** (`.github/workflows/admin-delete.yml`) with the user id and the mode, or call the `admin-delete-account` function directly from a private shell (see "Setup" for the secret). **Never run ad-hoc SQL for a deletion and never delete the auth user by hand:** the admin path is the same code as the in-app delete (`delete_user_data` in one transaction, the Apple revoke when a token is stored, the Vault secret, then the auth user), so the result is the same: `ok`, `partial` or `failed`.
- `ok`: finish (step 6).
- `partial` (the data is gone but the account could not be closed): run it again; if it is still partial, keep the request open, log it, and tell the owner.
- `failed`: nothing was deleted; run it again, and if it still fails tell the owner.

The admin path does **not** ask for a recent sign-in: the one-time code sent to the account's own address replaces that check.

### 6. Reply, log, tell the owner
Send template F (or G if only some of it could be done), log the result, and tell the owner afterwards in **one line with no personal data** (for example "email deletion done, thread <id>, mode <data|account>").

### 7. The clocks
- A valid confirmation → delete within 7 days of it (step 5).
- No valid confirmation after 30 days from the request → close the request with template H and log it.
- Code expired before use → template E; the person may start again by writing in again.

## Reply templates
Keep them short and plain. Do not name the account or say whether one exists, except in D, F and G.

**A. The request could not be verified**
> Subject: Your Ridgeline deletion request
>
> We could not verify that this message came from the address it says it did, so we have not deleted anything. You can delete your account yourself in the app (Profile › Account) or at hike.bbprojectfactory.com/account/delete/, or write to us again from your account's email address.

**B. No account found (generic)**
> If an account exists for this address, we've sent a confirmation to it.

**C. Apple "Hide My Email" account**
> Because you signed in with Apple's Hide My Email, we can't match this message to your account by email. Please delete it in the app (Profile › Account) or at hike.bbprojectfactory.com/account/delete/ while signed in with Apple.

**D. Confirmation (a new message to the account's email on file)**
> Subject: Confirm your Ridgeline deletion request
>
> Someone asked us to delete the Ridgeline account for this address. If that was you, reply to this message with one of these, exactly:
> - `DELETE RIDGELINE <code>` to delete your Ridgeline data only (your sign-in stays);
> - `DELETE ALL <code>` to delete your whole account: your sign-in and your data in Ridgeline, our language app (woof.bobolearns.com), the BoboLearns Hub sign-in and any other B&B app you've signed in to. This cannot be undone. (Bobo Learns Chess doesn't use accounts; to delete its anonymous data, see chess.bobolearns.com/privacy/.)
>
> This code works once and expires in 30 days. If you didn't ask for this, ignore this message and nothing will be deleted.

**E. Code missing, wrong, used or expired**
> We couldn't use that reply, so nothing has been deleted. Please reply to our confirmation message with the exact words and the code from it, or write to us again to get a new confirmation. You can also delete in the app (Profile › Account).

**F. Done**
> We have deleted your [Ridgeline data / account]. Deleting removes your data from our live systems, normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over. [Whole account, Apple with a stored token: We also disconnected Ridgeline from your Apple ID.] [Whole account, Apple without a stored token: To fully disconnect, also remove Ridgeline in your Apple ID settings › Sign in with Apple (appleid.apple.com).] If you did not ask for this, tell us right away.

**G. Partly done**
> We deleted your Ridgeline data but could not yet close your account. We are finishing it and will write again when it is done.

**H. Closed without confirmation**
> We didn't get a confirmation within 30 days, so we closed your deletion request and nothing was deleted. You can ask again at any time, or delete in the app (Profile › Account).

## Setup (the owner does this once; nothing here is done by the build)
1. Choose a long random value (at least 32 random bytes) for `ADMIN_DELETE_SECRET`. Do not put it in the repository, an issue or a chat.
2. In Supabase (the shared project) add it as an Edge Function secret named `ADMIN_DELETE_SECRET`, next to the Apple secrets the in-app delete already uses (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`).
3. Deploy the `admin-delete-account` function **with JWT verification off** (`supabase functions deploy admin-delete-account --no-verify-jwt`); it does its own check of the secret.
4. In the GitHub repository add the same value as the Actions secret `ADMIN_DELETE_SECRET`, and add the function's URL as the Actions **variable** `ADMIN_DELETE_URL`.
5. Test once with a throwaway account (both modes) before relying on it.

**Public repository note:** GitHub shows a workflow run's inputs on the run page, and this repository is public. The only input is the random user id (never an email address) and the workflow masks it in its log and prints only its last 4 characters, but if that is not acceptable, call the function from a private shell instead:
`curl -X POST "$ADMIN_DELETE_URL" -H "x-admin-delete-secret: $ADMIN_DELETE_SECRET" -H 'content-type: application/json' --data '{"user_id":"<uuid>","mode":"data"}'`.

## While sign-in is paused
Email deletion still works: it uses the service role and none of the app's sign-in or sync. See [PAUSE.md](PAUSE.md).
