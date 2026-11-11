# Deleting an account by email (runbook)

For people who ask for deletion by email instead of in the app (Google Play requires a way to ask without the app). The address is on the delete page and in the privacy Accounts section.

**Who does it: the owner/operator, and only the owner/operator.** Every email deletion is a production action (it deletes user data and an auth user), so it is done by hand, one request at a time, with service-role access. It is not automated and no agent does it.

**Deadline: reply within 7 days of the request, and finish the deletion within 7 days.** (The privacy text says data leaves live systems normally straight away and always within 7 days; backup copies are erased within 7 days, when backups roll over.)

## 1. Check who is asking
1. The email must come FROM the address on the account. Look it up (service role, SQL editor):
   ```sql
   select id, email, created_at, last_sign_in_at,
          (select array_agg(provider) from auth.identities i where i.user_id = u.id) as providers
   from auth.users u where lower(email) = lower('<sender address>');
   ```
   If the sender's address matches exactly one row, continue. If there is no match, or more than one, do NOT delete; reply asking them to write from the sign-in address or to delete in the app.
2. **Apple "Hide My Email" (private relay) accounts** (`@privaterelay.appleid.com`): the sender cannot be matched to the relay address by email. Reply pointing them to the in-app path (Profile › Account › Delete, or hike.bbprojectfactory.com/account/delete/ on the web, signing in with Apple). Do not delete by email.
3. If anything is doubtful, ask them to delete in the app. Never delete on a request that only names someone else's address.

## 2. Delete (exact service-role steps, in this order)
Use `<uid>` = the `id` from step 1.
1. **Ridgeline data (one transaction):**
   ```sql
   select ridgeline.delete_user_data('<uid>');
   ```
   If it fails with a deadlock (`40P01`), run it again.
2. **Apple (only if `providers` includes `apple`):** read the stored refresh token, tell Apple to revoke it, then delete the Vault secret.
   ```sql
   select ridgeline.read_apple_token('<uid>');      -- null: nothing to revoke (a web-only Apple user): skip the revoke, and tell them to remove Ridgeline in Apple ID settings
   ```
   Revoke with the repo helper (needs the Apple key, which only the owner holds; never paste the key or the token into a chat or ticket):
   ```ts
   // deno eval, from the repo root, with APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID and TOKEN set in the shell
   import { appleClientSecret, revokeAppleToken } from './supabase/functions/_shared/apple.ts';
   const id = Deno.env.get('APPLE_BUNDLE_ID')!;
   const secret = await appleClientSecret({ teamId: Deno.env.get('APPLE_TEAM_ID')!, keyId: Deno.env.get('APPLE_KEY_ID')!, privateKeyPem: Deno.env.get('APPLE_PRIVATE_KEY')! }, id);
   await revokeAppleToken(fetch, id, secret, Deno.env.get('TOKEN')!);
   ```
   If Apple refuses, stop and keep the token (it is the only way to retry). Then:
   ```sql
   select ridgeline.delete_apple_token('<uid>');     -- removes the Vault secret and the reference row
   ```
3. **The auth user** (this removes the account for every B&B app that uses it): Supabase dashboard › Authentication › Users › the user › Delete, or with the service role `auth.admin.deleteUser('<uid>')`. Deleting it cascades to every table that references it with ON DELETE CASCADE.
4. **Check** (all should return zero rows):
   ```sql
   select count(*) from auth.users where id = '<uid>';
   select count(*) from ridgeline.profiles where user_id = '<uid>';
   select count(*) from ridgeline.apple_tokens where user_id = '<uid>';
   select count(*) from vault.secrets where name like '%<uid>%';
   ```
   For a wider check, run `supabase/tests/ridgeline_delete.test.sql`'s catalog query on a branch: every user-keyed table must be empty for the user.
5. Record it: the date, the request, what was run, and who ran it, in the escalation log. Do not store the email's contents or any token.

## 3. Reply (template)
> Subject: Your Ridgeline deletion request
>
> Hello,
>
> We have deleted your Ridgeline account and its data from our live systems. Backup copies are erased within 7 days, when backups roll over. [If you signed in with Apple: we also told Apple to disconnect Ridgeline. / If you used Sign in with Apple on the web: to fully disconnect, also remove Ridgeline in your Apple ID settings › Sign in with Apple (appleid.apple.com).]
>
> Your sign-in was one account shared with our other apps (B&B and Bobo Learns), so those apps' data for this account is gone too. If you did not ask for this, tell us right away.
>
> The Ridgeline team

If the request could not be verified, reply with the in-app path instead of deleting (step 1).

## While sign-in is paused
Email deletion still works: it uses the service role and none of the app's sign-in or sync. See [PAUSE.md](PAUSE.md).
