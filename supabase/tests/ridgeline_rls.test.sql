-- pgTAP tests for the ridgeline schema (RLS, grants, Vault helpers, limits).
-- Run against a THROWAWAY database only (local Supabase `supabase test db`, or the script in tests/README.md).
-- Never run against the shared production project. Everything runs in one transaction and rolls back.
begin;
create extension if not exists pgtap;
select plan(42);

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;
end $$;

-- No blanket trigger on auth.users points into the ridgeline schema.
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
           where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and n.nspname = 'ridgeline'), 0, 'no ridgeline trigger on auth.users');

-- Every ridgeline table has RLS on.
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'ridgeline' and c.relkind = 'r' and not c.relrowsecurity), 0, 'RLS enabled on every ridgeline table');

-- Owner A writes own rows.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$insert into ridgeline.profiles (user_id) values ('00000000-0000-0000-0000-00000000000a')$$, 'A inserts own profile');
select lives_ok($$insert into ridgeline.shortlist (user_id, trail_id) values ('00000000-0000-0000-0000-00000000000a', 'way/1')$$, 'A inserts own shortlist row');
select lives_ok($$insert into ridgeline.activities (user_id, id, started_at, track) values ('00000000-0000-0000-0000-00000000000a', 'h1', now(), null)$$, 'A inserts own hike with no track');
select lives_ok($$insert into ridgeline.settings (user_id, data) values ('00000000-0000-0000-0000-00000000000a', '{"units":"metric"}')$$, 'A inserts own settings');
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id) values ('00000000-0000-0000-0000-00000000000b', 'way/9')$$, '42501', null, 'A cannot insert a row owned by B');
reset role;

-- User B sees and changes nothing of A's.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from ridgeline.profiles), 0, 'B reads no profiles of A');
select is((select count(*)::int from ridgeline.shortlist), 0, 'B reads no shortlist of A');
select is((select count(*)::int from ridgeline.activities), 0, 'B reads no hikes of A');
select is((select count(*)::int from ridgeline.settings), 0, 'B reads no settings of A');
with u as (update ridgeline.activities set deleted = true returning 1) select is((select count(*)::int from u), 0, 'B updates none of A''s hikes');
with d as (delete from ridgeline.shortlist returning 1) select is((select count(*)::int from d), 0, 'B deletes none of A''s rows');
reset role;

-- anon has no access at all.
set local role anon;
select throws_ok($$select * from ridgeline.activities$$, '42501', null, 'anon cannot read hikes');
reset role;

-- Apple token table and Vault helpers are service-role only.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$select * from ridgeline.apple_tokens$$, '42501', null, 'signed-in user cannot read apple_tokens');
select throws_ok($$select ridgeline.read_apple_token('00000000-0000-0000-0000-00000000000a')$$, '42501', null, 'signed-in user cannot call read_apple_token');
select throws_ok($$select ridgeline.store_apple_token('00000000-0000-0000-0000-00000000000a', 'x')$$, '42501', null, 'signed-in user cannot call store_apple_token');
reset role;
set local role anon;
select throws_ok($$select ridgeline.read_apple_token('00000000-0000-0000-0000-00000000000a')$$, '42501', null, 'anon cannot call read_apple_token');
reset role;

set local role service_role;
select lives_ok($$select ridgeline.store_apple_token('00000000-0000-0000-0000-00000000000a', 'refresh-token-1')$$, 'service role stores a token');
select is(ridgeline.read_apple_token('00000000-0000-0000-0000-00000000000a'), 'refresh-token-1', 'service role reads it back');
select ridgeline.delete_apple_token('00000000-0000-0000-0000-00000000000a');
select is(ridgeline.read_apple_token('00000000-0000-0000-0000-00000000000a'), null, 'token gone after delete');
reset role;
select is((select count(*)::int from vault.secrets where name = 'ridgeline_apple_00000000-0000-0000-0000-00000000000a'), 0, 'Vault secret removed too');

-- Limits.
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, track)
  values ('00000000-0000-0000-0000-00000000000b', 't', now(), (select jsonb_agg(i) from generate_series(1, 50001) i))$$, '23514', null, 'a track over 50,000 points is rejected');

-- Every table in the schema is tied to auth.users with ON DELETE CASCADE.
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'ridgeline' and c.relkind = 'r'
             and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'c')), 0,
          'every ridgeline table has a user_id foreign key to auth.users ON DELETE CASCADE');

-- Size caps.
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id, trail) values ('00000000-0000-0000-0000-00000000000b', 'big', jsonb_build_object('x', repeat('a', 70000)))$$, '23514', null, 'a trail snapshot over 64 KB is rejected');
select throws_ok($$insert into ridgeline.settings (user_id, data) values ('00000000-0000-0000-0000-00000000000b', jsonb_build_object('x', repeat('a', 70000)))$$, '23514', null, 'settings over 64 KB are rejected');

-- Row limits: 2,000 saved trails. Upserts of existing rows pass, tombstones do not count, a new live row is refused.
insert into ridgeline.saved (user_id, trail_id) select '00000000-0000-0000-0000-00000000000b', 't' || i from generate_series(1, 2000) i;
select lives_ok($$insert into ridgeline.saved (user_id, trail_id, updated_at) values ('00000000-0000-0000-0000-00000000000b', 't1', now()) on conflict (user_id, trail_id) do update set updated_at = excluded.updated_at$$, 'updating an existing row at the limit is allowed');
select throws_ok($$insert into ridgeline.saved (user_id, trail_id) values ('00000000-0000-0000-0000-00000000000b', 'one-too-many')$$, '54000', null, 'a new live row beyond the limit is refused');
select lives_ok($$insert into ridgeline.saved (user_id, trail_id, deleted) values ('00000000-0000-0000-0000-00000000000b', 'gone', true)$$, 'a tombstone is accepted at the limit (it is not a live row)');
select throws_ok($$update ridgeline.saved set deleted = false where trail_id = 'gone'$$, '54000', null, 'reviving a tombstone beyond the limit is refused');
update ridgeline.saved set deleted = true where trail_id = 't2';
select lives_ok($$update ridgeline.saved set deleted = false where trail_id = 'gone'$$, 'after a delete frees a slot the revive works');
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b' and not deleted), 2000, 'live count stays at the limit');


-- Tombstones carry no payload, and they are capped too (total rows per user and table, deleted ones included, at 2x the live limit).
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id, trail, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-with-data', '{"a":1}', true)$$, '23514', null, 'a tombstone with a trail snapshot is rejected');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, stats, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-stats', now(), '{"name":"x"}', true)$$, '23514', null, 'a hike tombstone with stats is rejected');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, track, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-track', now(), '[1]', true)$$, '23514', null, 'a hike tombstone with a route is rejected');
insert into ridgeline.saved (user_id, trail_id, deleted) select '00000000-0000-0000-0000-00000000000b', 'x' || i, true from generate_series(1, 1999) i;   -- 2,001 + 1,999 = 4,000 rows in all
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b'), 4000, 'tombstones fill the table up to twice the live limit');
select throws_ok($$insert into ridgeline.saved (user_id, trail_id, deleted) values ('00000000-0000-0000-0000-00000000000b', 'one-dead-too-many', true)$$, '54000', null, 'one more tombstone beyond 2x the limit is refused');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, track) values ('00000000-0000-0000-0000-00000000000b', 'huge', now(), jsonb_build_array(repeat('a', 4300000)))$$, '23514', null, 'a route over 4 MB is rejected');


-- If the hosted owner may not delete from Vault, the fallback overwrites AND renames the secret (no token, no user id left).
revoke delete on vault.secrets from postgres cascade;   -- inside this test transaction only
set local role service_role;
select ridgeline.store_apple_token('00000000-0000-0000-0000-00000000000b', 'refresh-token-2');
select ridgeline.delete_apple_token('00000000-0000-0000-0000-00000000000b');
reset role;
select is((select count(*)::int from vault.secrets where name like '%00000000-0000-0000-0000-00000000000b%'), 0, 'fallback: no Vault secret still carries the user id');
select is((select count(*)::int from vault.decrypted_secrets where decrypted_secret = 'refresh-token-2'), 0, 'fallback: the token value is gone');
select is((select count(*)::int from ridgeline.apple_tokens where user_id = '00000000-0000-0000-0000-00000000000b'), 0, 'fallback: the reference row is gone');

-- Deleting the auth user removes the Ridgeline rows.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from ridgeline.activities where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'auth user delete cascades to hikes');

select * from finish();
rollback;
