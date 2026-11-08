-- pgTAP tests for the ridgeline schema (RLS, grants, Vault helpers, limits).
-- Run against a THROWAWAY database only (local Supabase `supabase test db`, or the script in tests/README.md).
-- Never run against the shared production project. Everything runs in one transaction and rolls back.
begin;
create extension if not exists pgtap;
select plan(24);

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

-- Deleting the auth user removes the Ridgeline rows.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from ridgeline.activities where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'auth user delete cascades to hikes');

select * from finish();
rollback;
