-- pgTAP tests for the ridgeline schema (RLS, grants, Vault helpers, limits).
-- Run against a THROWAWAY database only (local Supabase `supabase test db`, or the script in tests/README.md).
-- Never run against the shared production project. Everything runs in one transaction and rolls back.
begin;
create extension if not exists pgtap;
select plan(75);

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
           where n.nspname = 'ridgeline' and c.relkind = 'r' and c.relname <> 'config'   -- config is a settings table, not user data
             and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'c')), 0,
          'every ridgeline table has a user_id foreign key to auth.users ON DELETE CASCADE');

-- Size caps.
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id, trail) values ('00000000-0000-0000-0000-00000000000b', 'big', jsonb_build_object('x', repeat('a', 70000)))$$, '23514', null, 'a trail snapshot over 64 KB is rejected');
select throws_ok($$insert into ridgeline.settings (user_id, data) values ('00000000-0000-0000-0000-00000000000b', jsonb_build_object('x', repeat('a', 70000)))$$, '23514', null, 'settings over 64 KB are rejected');

-- Row limits: 2,000 saved trails. Upserts of existing rows pass, tombstones do not count, a new live row is refused.
insert into ridgeline.saved (user_id, trail_id) select '00000000-0000-0000-0000-00000000000b', 't' || i from generate_series(1, 2000) i;
select lives_ok($$insert into ridgeline.saved (user_id, trail_id, updated_at) values ('00000000-0000-0000-0000-00000000000b', 't1', now()) on conflict (user_id, trail_id) do update set updated_at = excluded.updated_at$$, 'updating an existing row at the limit is allowed');
select throws_ok($$insert into ridgeline.saved (user_id, trail_id) values ('00000000-0000-0000-0000-00000000000b', 'one-too-many')$$, 'RL003', null, 'a new live row beyond the limit is refused');
select lives_ok($$insert into ridgeline.saved (user_id, trail_id, deleted) values ('00000000-0000-0000-0000-00000000000b', 'gone', true)$$, 'a tombstone is accepted at the limit (it is not a live row)');
select throws_ok($$update ridgeline.saved set deleted = false where trail_id = 'gone'$$, 'RL003', null, 'reviving a tombstone beyond the limit is refused');
update ridgeline.saved set deleted = true where trail_id = 't2';
select lives_ok($$update ridgeline.saved set deleted = false where trail_id = 'gone'$$, 'after a delete frees a slot the revive works');
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b' and not deleted), 2000, 'live count stays at the limit');


-- Tombstones carry no payload, and they are capped too (total rows per user and table, deleted ones included, at 2x the live limit).
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id, trail, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-with-data', '{"a":1}', true)$$, '23514', null, 'a tombstone with a trail snapshot is rejected');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, stats, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-stats', now(), '{"name":"x"}', true)$$, '23514', null, 'a hike tombstone with stats is rejected');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, track, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-track', now(), '[1]', true)$$, '23514', null, 'a hike tombstone with a route is rejected');
insert into ridgeline.saved (user_id, trail_id, deleted) select '00000000-0000-0000-0000-00000000000b', 'x' || i, true from generate_series(1, 1999) i;   -- 2,001 + 1,999 = 4,000 rows in all
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b'), 4000, 'tombstones fill the table up to twice the live limit');
select throws_ok($$insert into ridgeline.saved (user_id, trail_id, deleted) values ('00000000-0000-0000-0000-00000000000b', 'one-dead-too-many', true)$$, 'RL003', null, 'one more tombstone beyond 2x the limit is refused');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, track) values ('00000000-0000-0000-0000-00000000000b', 'huge', now(), jsonb_build_array(repeat('a', 1100000)))$$, '23514', null, 'a route over 1 MB is rejected');


-- If the owner may not delete from Vault, the fallback overwrites AND renames the secret (no token, no user id left).
-- The function is owned by `postgres`, so take the delete right away from it (and from the service role), then prove the fallback ran:
-- a renamed row must exist (a plain delete would leave none).
revoke delete on vault.secrets from postgres cascade;      -- inside this test transaction only
revoke delete on vault.secrets from service_role;
set local role service_role;
select ridgeline.store_apple_token('00000000-0000-0000-0000-00000000000b', 'refresh-token-2');
select ridgeline.delete_apple_token('00000000-0000-0000-0000-00000000000b');
reset role;
select is((select count(*)::int from vault.secrets where name like 'ridgeline_deleted_%'), 1, 'fallback: the secret still exists, renamed (so the delete really was refused)');
select is((select decrypted_secret from vault.decrypted_secrets where name like 'ridgeline_deleted_%'), 'deleted', 'fallback: its value is overwritten');
select is((select count(*)::int from vault.secrets where name like '%00000000-0000-0000-0000-00000000000b%'), 0, 'fallback: no secret name carries the user id');
select is((select count(*)::int from vault.decrypted_secrets where decrypted_secret = 'refresh-token-2'), 0, 'fallback: the token value is gone');
select is((select count(*)::int from ridgeline.apple_tokens where user_id = '00000000-0000-0000-0000-00000000000b'), 0, 'fallback: the reference row is gone');

select is((select n_rows from ridgeline.usage where user_id = '00000000-0000-0000-0000-00000000000b' and tbl = 'saved'), (select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b'), 'usage row counts match the real saved table (4,000 rows with tombstones)');
select is((select n_live from ridgeline.usage where user_id = '00000000-0000-0000-0000-00000000000b' and tbl = 'saved'), (select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-00000000000b' and not deleted), 'and the live count matches');
-- M1: identifier length, tombstone trail_id, route size, per-user advisory lock, and the byte cap.
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, trail_id) values ('00000000-0000-0000-0000-00000000000b', 'long-trail', now(), repeat('x', 201))$$, '23514', null, 'a hike trail_id over 200 characters is rejected');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, trail_id, deleted) values ('00000000-0000-0000-0000-00000000000b', 'dead-trail', now(), 'way/1', true)$$, '23514', null, 'a hike tombstone must have a null trail_id');
select ok((select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) >= 1, 'inserts take a per-user advisory lock (so two requests cannot both pass the count)');
create table ridgeline.zz_cap_test (user_id uuid not null references auth.users (id) on delete cascade, id text not null, deleted boolean not null default false, payload text, primary key (user_id, id));
create trigger zz_limit before insert or update on ridgeline.zz_cap_test for each row execute function ridgeline.enforce_row_limit(1000, 'id', 3000);
create trigger zz_usage after insert or update or delete on ridgeline.zz_cap_test for each row execute function ridgeline.track_usage(1000, 3000);
insert into ridgeline.zz_cap_test (user_id, id, payload) values ('00000000-0000-0000-0000-00000000000b', 'a', repeat('x', 1000)), ('00000000-0000-0000-0000-00000000000b', 'b', repeat('x', 1000));
select throws_ok($$insert into ridgeline.zz_cap_test (user_id, id, payload) values ('00000000-0000-0000-0000-00000000000b', 'c', repeat('x', 1500))$$, 'RL003', null, 'a row that would push the user over the byte cap is refused');
select lives_ok($$insert into ridgeline.zz_cap_test (user_id, id, payload) values ('00000000-0000-0000-0000-00000000000b', 'd', repeat('x', 100))$$, 'a small row under the byte cap is accepted');
-- H1: growing a row by UPDATE (or an upsert) counts against the cap too.
select throws_ok($$update ridgeline.zz_cap_test set payload = repeat('y', 2500) where id = 'a'$$, 'RL003', null, 'growing a row by UPDATE past the byte cap is refused');
select throws_ok($$insert into ridgeline.zz_cap_test (user_id, id, payload) values ('00000000-0000-0000-0000-00000000000b', 'a', repeat('y', 2500)) on conflict (user_id, id) do update set payload = excluded.payload$$, 'RL003', null, 'and so is growing it by upsert');
select lives_ok($$update ridgeline.zz_cap_test set payload = repeat('z', 200) where id = 'a'$$, 'shrinking a row is fine');
select lives_ok($$update ridgeline.zz_cap_test set payload = repeat('z', 900) where id = 'a'$$, 'a small growth that still fits is fine');
-- M1: usage is kept by deltas and matches the table, with no scan and no client access.
select is((select bytes from ridgeline.usage where user_id = '00000000-0000-0000-0000-00000000000b' and tbl = 'zz_cap_test'), (select sum(pg_column_size(t))::bigint from ridgeline.zz_cap_test t where user_id = '00000000-0000-0000-0000-00000000000b'), 'the usage row equals the real size after inserts, refused writes, shrinks and growth');
delete from ridgeline.zz_cap_test where id = 'd';
select is((select n_rows from ridgeline.usage where user_id = '00000000-0000-0000-0000-00000000000b' and tbl = 'zz_cap_test'), 2, 'a delete moves usage back');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$select * from ridgeline.usage$$, '42501', null, 'a signed-in user cannot read the usage table');
reset role;


-- H1': ONE statement writing many rows cannot get past a cap (the BEFORE check sees the usage from the start of the statement; the AFTER trigger sees it as it grows).
create function pg_temp.blob(n int) returns text language sql as $f$ select string_agg(md5(random()::text || g::text), '') from generate_series(1, n) g $f$;   -- n x 32 characters that do not compress much
create table ridgeline.zz_multi (user_id uuid not null references auth.users (id) on delete cascade, id text not null, deleted boolean not null default false, payload text, primary key (user_id, id));
create trigger zz_multi_limit before insert or update on ridgeline.zz_multi for each row execute function ridgeline.enforce_row_limit(5, 'id', 100000);
create trigger zz_multi_usage after insert or update or delete on ridgeline.zz_multi for each row execute function ridgeline.track_usage(5, 100000);
insert into ridgeline.zz_multi (user_id, id) select '00000000-0000-0000-0000-00000000000b', 'a' || i from generate_series(1, 3) i;
select throws_ok($$insert into ridgeline.zz_multi (user_id, id) select '00000000-0000-0000-0000-00000000000b', 'm' || i from generate_series(1, 4) i$$, 'RL003', null, 'one multi-row INSERT crossing the live-row limit (3 + 4 > 5) is refused');
select is((select count(*)::int from ridgeline.zz_multi), 3, 'and the whole statement rolled back (still 3 rows)');
select is((select n_live from ridgeline.usage where tbl = 'zz_multi' and user_id = '00000000-0000-0000-0000-00000000000b'), 3, 'and usage did not move');
select throws_ok($$insert into ridgeline.zz_multi (user_id, id, deleted) select '00000000-0000-0000-0000-00000000000b', 't' || i, true from generate_series(1, 8) i$$, 'RL003', null, 'one multi-row INSERT of tombstones crossing 2x the limit (3 + 8 > 10) is refused');
select throws_ok($$insert into ridgeline.zz_multi (user_id, id, payload) select '00000000-0000-0000-0000-00000000000b', 'b' || i, pg_temp.blob(4000) from generate_series(1, 2) i$$, 'RL003', null, 'one multi-row INSERT crossing the byte cap (2 x ~70 KB stored vs a 100 KB cap) is refused');
select lives_ok($$insert into ridgeline.zz_multi (user_id, id, payload) select '00000000-0000-0000-0000-00000000000b', 'ok' || i, pg_temp.blob(1000) from generate_series(1, 2) i$$, 'a multi-row INSERT that fits is accepted');
select throws_ok($$update ridgeline.zz_multi set payload = pg_temp.blob(4000) where id like 'a%' or id like 'ok%'$$, 'RL003', null, 'one multi-row UPDATE growing rows past the byte cap is refused');
select ok(abs((select sum(pg_column_size(t))::bigint from ridgeline.zz_multi t) - (select bytes from ridgeline.usage where tbl = 'zz_multi' and user_id = '00000000-0000-0000-0000-00000000000b')) <= 64, 'and usage still matches the real size after the rollback (within row alignment)');

-- M1: the big columns are stored UNCOMPRESSED, so the stored size, and the usage counted from it, equal the raw size.
select is((select string_agg(a.attrelid::regclass::text || '.' || a.attname || '=' || a.attstorage::text, ',' order by a.attrelid::regclass::text, a.attname) from pg_attribute a
           where (a.attrelid, a.attname) in (('ridgeline.activities'::regclass, 'track'), ('ridgeline.activities'::regclass, 'stats'), ('ridgeline.saved'::regclass, 'trail'), ('ridgeline.shortlist'::regclass, 'trail'), ('ridgeline.settings'::regclass, 'data'))),
          'ridgeline.activities.stats=e,ridgeline.activities.track=e,ridgeline.saved.trail=e,ridgeline.settings.data=e,ridgeline.shortlist.trail=e', 'the five big columns use external (uncompressed) storage');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1');
insert into ridgeline.activities (user_id, id, started_at, track) values ('00000000-0000-0000-0000-0000000000e1', 'big', now(), (select jsonb_agg(123456789012345678901234567890123456::numeric) from generate_series(1, 35700)));   -- about 1,000,000 raw bytes of a very repetitive track
select ok((select pg_column_size(track) from ridgeline.activities where user_id = '00000000-0000-0000-0000-0000000000e1' and id = 'big') > 990000, 'a ~1 MB raw track is STORED at ~1 MB (not compressed down to ~11 KB)');
select ok((select bytes from ridgeline.usage where user_id = '00000000-0000-0000-0000-0000000000e1' and tbl = 'activities') > 990000, 'and usage counts about 1 MB for it');

-- M2: an over-cap statement stops at the first row that crosses a cap, instead of writing everything and failing at the end.
create sequence ridgeline.zz_attempts;
create function ridgeline.zz_count() returns trigger language plpgsql as $f$ begin perform nextval('ridgeline.zz_attempts'); return new; end $f$;
create trigger saved_aa_attempts before insert on ridgeline.saved for each row execute function ridgeline.zz_count();     -- runs before the limit trigger, counts rows that get that far
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$insert into ridgeline.saved (user_id, trail_id) select '00000000-0000-0000-0000-0000000000e2', 'r' || i from generate_series(1, 3000) i$$, 'RL003', null, 'a 3,000-row statement over a 2,000-row limit is refused');
select ok((select last_value from ridgeline.zz_attempts) <= 2001, 'and it stopped at the first row over the limit (about 2,001 rows attempted, not 3,000)');
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-0000000000e2'), 0, 'and wrote nothing');
select setval('ridgeline.zz_attempts', 1, false);
select throws_ok($$insert into ridgeline.saved (user_id, trail_id, trail) select '00000000-0000-0000-0000-0000000000e2', 'b' || i, jsonb_build_object('x', repeat('a', 60000)) from generate_series(1, 700) i$$, 'RL003', null, 'a statement of 700 x 60 KB (cap 25 MB) is refused');
select ok((select last_value from ridgeline.zz_attempts) < 450, 'and it stopped after about 437 rows, not 700 (the over-cap rows were never attempted)');
select is((select count(*)::int from ridgeline.saved where user_id = '00000000-0000-0000-0000-0000000000e2'), 0, 'and wrote nothing');
drop trigger saved_aa_attempts on ridgeline.saved;

-- Deleting the auth user removes the Ridgeline rows.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from ridgeline.activities where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'auth user delete cascades to hikes');

select * from finish();
rollback;
