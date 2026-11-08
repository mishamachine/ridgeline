-- pgTAP tests for 20261107130000_ridgeline_sync.sql. Same rules as ridgeline_rls.test.sql: throwaway database only.
begin;
create extension if not exists pgtap;
select plan(17);
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');

insert into ridgeline.shortlist (user_id, trail_id, updated_at) values ('00000000-0000-0000-0000-00000000000a', 'way/1', '2026-01-01T10:00:00Z');
select ok((select synced_at from ridgeline.shortlist where trail_id = 'way/1') > '2026-06-01', 'synced_at is set by the server, not the device clock');

-- A stale write does not overwrite a newer row.
update ridgeline.shortlist set deleted = true, updated_at = '2026-01-01T09:00:00Z' where trail_id = 'way/1';
select is((select deleted from ridgeline.shortlist where trail_id = 'way/1'), false, 'an older write is ignored');

-- A newer write wins and moves synced_at forward.
select pg_sleep(0.01);
update ridgeline.shortlist set deleted = true, updated_at = '2026-01-01T11:00:00Z' where trail_id = 'way/1';
select is((select deleted from ridgeline.shortlist where trail_id = 'way/1'), true, 'a newer write wins');

-- A tie is accepted (the app resolves ties itself).
update ridgeline.shortlist set deleted = false, updated_at = '2026-01-01T11:00:00Z' where trail_id = 'way/1';
select is((select deleted from ridgeline.shortlist where trail_id = 'way/1'), false, 'an equal-time write is accepted');

-- A clock in the future is clamped to now().
insert into ridgeline.settings (user_id, data, updated_at) values ('00000000-0000-0000-0000-00000000000a', '{}', now() + interval '10 days');
select ok((select updated_at from ridgeline.settings) <= now(), 'a future updated_at is clamped');

-- Every synced table has the column and the guard.
select is((select count(*)::int from information_schema.columns where table_schema = 'ridgeline' and column_name = 'synced_at'), 4, 'synced_at on all four synced tables');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ridgeline' and t.tgname like '%_sync_guard'), 4, 'sync_guard on all four synced tables');

-- data_epoch: a delete bumps it, and writes carrying an older epoch are refused.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000e');
insert into ridgeline.profiles (user_id) values ('00000000-0000-0000-0000-00000000000e');
insert into ridgeline.shortlist (user_id, trail_id, epoch) values ('00000000-0000-0000-0000-00000000000e', 'way/1', 0);
insert into ridgeline.activities (user_id, id, started_at, epoch) values ('00000000-0000-0000-0000-00000000000e', 'h1', now(), 0);
select is((select data_epoch from ridgeline.profiles where user_id = '00000000-0000-0000-0000-00000000000e'), 0, 'a new profile starts at epoch 0');
set local role service_role;
select ridgeline.delete_user_data('00000000-0000-0000-0000-00000000000e');
reset role;
select is((select data_epoch from ridgeline.profiles where user_id = '00000000-0000-0000-0000-00000000000e'), 1, 'delete_user_data raises the epoch');
select is((select count(*)::int from ridgeline.shortlist where user_id = '00000000-0000-0000-0000-00000000000e') + (select count(*)::int from ridgeline.activities where user_id = '00000000-0000-0000-0000-00000000000e'), 0, 'and the server holds zero rows');
select throws_ok($$insert into ridgeline.shortlist (user_id, trail_id, epoch) values ('00000000-0000-0000-0000-00000000000e', 'way/2', 0)$$, 'RL001', null, 'a write from a device that still has epoch 0 is refused');
select throws_ok($$insert into ridgeline.activities (user_id, id, started_at, epoch, deleted) values ('00000000-0000-0000-0000-00000000000e', 'h9', now(), 0, true)$$, 'RL001', null, 'so is a stale tombstone');
select lives_ok($$insert into ridgeline.shortlist (user_id, trail_id, epoch) values ('00000000-0000-0000-0000-00000000000e', 'way/3', 1)$$, 'a device that has seen the new epoch can write again');
set local role service_role;
select ridgeline.delete_user_data('00000000-0000-0000-0000-00000000000e');
reset role;
select is((select data_epoch from ridgeline.profiles where user_id = '00000000-0000-0000-0000-00000000000e'), 2, 'a second delete raises it again');
-- A signed-in user cannot move their own epoch.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000e', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
select throws_ok($$update ridgeline.profiles set data_epoch = 0$$, '42501', null, 'a signed-in user cannot lower their epoch');
select throws_ok($$delete from ridgeline.profiles$$, '42501', null, 'or delete the profile row to reset it');
select is((select data_epoch from ridgeline.profiles), 2, 'but can read it');
reset role;

select * from finish();
rollback;
