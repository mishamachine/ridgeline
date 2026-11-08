-- Acceptance test for "Delete my whole account": afterwards EVERY user-keyed table has zero rows for that user.
-- The tables are found from the catalog, so a table added later is covered without editing this file:
--   * every table with a foreign key to auth.users, and
--   * every table with a user_id column, in any schema except Supabase's own.
-- A user-keyed table that is NOT tied to auth.users with ON DELETE CASCADE fails the first check, because deleting the auth user would leave its rows behind.
-- Run on a throwaway database (see README) and, before go-live, on a Supabase branch of the shared project, where it also covers the other apps' tables.
begin;
create extension if not exists pgtap;
select plan(4);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1');

create temp table user_keyed on commit drop as
  select n.nspname as sch, c.relname as tbl, a.attname as col
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and a.attname = 'user_id' and not a.attisdropped and a.attnum > 0
    and n.nspname not in ('auth', 'storage', 'vault', 'realtime', 'graphql', 'graphql_public', 'extensions', 'pgsodium', 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pg_catalog', 'information_schema')
  union
  select n.nspname, c.relname, a.attname
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
  where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and n.nspname <> 'auth';

select cmp_ok((select count(*)::int from user_keyed), '>=', 6, 'the catalog query finds the ridgeline tables (and any other user-keyed tables)');

-- 1. Every user-keyed table cascades from auth.users (otherwise a whole-account delete leaves rows behind).
select is((select coalesce(string_agg(u.sch || '.' || u.tbl, ', '), '') from user_keyed u
           where not exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
                             where k.conrelid = format('%I.%I', u.sch, u.tbl)::regclass and k.contype = 'f' and k.confrelid = 'auth.users'::regclass
                               and k.confdeltype = 'c' and a.attname = u.col)), '',
          'every user-keyed table has user_id -> auth.users ON DELETE CASCADE (tables listed here would keep the person''s rows)');

-- Fill every ridgeline table for the user.
insert into ridgeline.profiles (user_id) values ('00000000-0000-0000-0000-0000000000d1');
insert into ridgeline.shortlist (user_id, trail_id) values ('00000000-0000-0000-0000-0000000000d1', 'way/1');
insert into ridgeline.saved (user_id, trail_id) values ('00000000-0000-0000-0000-0000000000d1', 'way/1');
insert into ridgeline.activities (user_id, id, started_at) values ('00000000-0000-0000-0000-0000000000d1', 'h1', now());
insert into ridgeline.settings (user_id, data) values ('00000000-0000-0000-0000-0000000000d1', '{}');
set local role service_role;
select ridgeline.store_apple_token('00000000-0000-0000-0000-0000000000d1', 'refresh-token');
reset role;

-- The delete function's steps, in its order: the Vault secret, the Ridgeline rows, the auth user.
set local role service_role;
select ridgeline.delete_apple_token('00000000-0000-0000-0000-0000000000d1');
reset role;
delete from ridgeline.activities where user_id = '00000000-0000-0000-0000-0000000000d1';
delete from ridgeline.saved      where user_id = '00000000-0000-0000-0000-0000000000d1';
delete from ridgeline.shortlist  where user_id = '00000000-0000-0000-0000-0000000000d1';
delete from ridgeline.settings   where user_id = '00000000-0000-0000-0000-0000000000d1';
delete from ridgeline.profiles   where user_id = '00000000-0000-0000-0000-0000000000d1';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d1';

create function pg_temp.leftovers(uid uuid) returns text language plpgsql as $$
declare r record; n bigint; out text := '';
begin
  for r in select * from user_keyed loop
    execute format('select count(*) from %I.%I where %I = $1', r.sch, r.tbl, r.col) into n using uid;
    if n > 0 then out := out || r.sch || '.' || r.tbl || ' (' || n || '), '; end if;
  end loop;
  return out;
end $$;

-- 2. Nothing is left in any user-keyed table.
select is(pg_temp.leftovers('00000000-0000-0000-0000-0000000000d1'), '', 'after a whole-account delete every user-keyed table has zero rows for the user');
-- 3. And the Vault secret is gone.
select is((select count(*)::int from vault.secrets where name = 'ridgeline_apple_00000000-0000-0000-0000-0000000000d1'), 0, 'the Vault secret is gone');

select * from finish();
rollback;
