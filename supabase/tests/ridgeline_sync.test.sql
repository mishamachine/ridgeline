-- pgTAP tests for 20261107130000_ridgeline_sync.sql. Same rules as ridgeline_rls.test.sql: throwaway database only.
begin;
create extension if not exists pgtap;
select plan(7);
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
select * from finish();
rollback;
