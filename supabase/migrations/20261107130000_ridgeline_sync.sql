-- Sync support. Depends on 20261107120000_ridgeline_schema.sql.
--  * synced_at: set by the server on every write, so a device that comes online late (with an old updated_at)
--    is still picked up by other devices pulling "everything since my last sync".
--  * updated_at (the device's clock, used for last-write-wins) cannot be set into the future.
--  * an older write never overwrites a newer row (last write wins is enforced here too, not only in the app).

-- data_epoch: goes up by one on "Delete my Ridgeline data". Every write carries the epoch the device last saw; an older one is refused,
-- so a phone that was offline (or mid-sync) during the delete cannot put the deleted data back.
alter table ridgeline.profiles add column data_epoch integer not null default 0;

do $$
declare t text;
begin
  foreach t in array array['shortlist','saved','activities','settings'] loop
    execute format('alter table ridgeline.%I add column epoch integer not null default 0', t);
    execute format('alter table ridgeline.%I add column synced_at timestamptz not null default now()', t);
    execute format('create index %I on ridgeline.%I (user_id, synced_at)', t || '_synced_idx', t);
  end loop;
end $$;

-- The pause switch: one row in ridgeline.config. While 'accounts_paused' is true, every write to the four synced tables is refused (RL002), so even an
-- old client cannot sync. Deleting still works: delete_user_data only deletes (no trigger on delete) and bumps the profile. Service role sets the row.
create table ridgeline.config (key text primary key, value jsonb not null);
alter table ridgeline.config enable row level security;
revoke all on ridgeline.config from public, anon, authenticated;
grant select, insert, update, delete on ridgeline.config to service_role;
insert into ridgeline.config (key, value) values ('accounts_paused', 'false'::jsonb);

create function ridgeline.sync_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
begin
  -- A signed-in caller may only write their own rows. Checked FIRST, so a forged user_id learns nothing (not even whether that person has an epoch):
  -- this trigger runs before the row-level policy would refuse the write. The check follows the database role the API switches to; direct sessions and the service role are not affected.
  if current_setting('role', true) in ('authenticated', 'anon') and new.user_id is distinct from nullif(claims->>'sub', '')::uuid then
    raise exception 'ridgeline: not your data' using errcode = '42501';
  end if;
  if coalesce((select c.value from ridgeline.config c where c.key = 'accounts_paused'), 'false'::jsonb) = 'true'::jsonb then
    raise exception 'ridgeline: sign-in is paused' using errcode = 'RL002';
  end if;
  -- Shared lock: delete_user_data takes the exclusive one, so a write is either seen by the delete or refused after it.
  perform pg_advisory_xact_lock_shared(hashtextextended('ridgeline:epoch:' || new.user_id::text, 0));
  if new.epoch <> coalesce((select p.data_epoch from ridgeline.profiles p where p.user_id = new.user_id), 0) then   -- older (stale) or higher (forged): both refused
    raise exception 'ridgeline: stale data epoch' using errcode = 'RL001';
  end if;
  if new.updated_at > now() then new.updated_at := now(); end if;
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then return null; end if;  -- stale write: keep the newer row
  new.synced_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['shortlist','saved','activities','settings'] loop
    execute format('create trigger %I before insert or update on ridgeline.%I for each row execute function ridgeline.sync_guard()', t || '_sync_guard', t);
  end loop;
end $$;
revoke execute on function ridgeline.sync_guard() from public, anon, authenticated;

-- "Delete my Ridgeline data" in ONE transaction (a function body is atomic): either every Ridgeline row of the person is gone or none is,
-- and the person's data_epoch goes up so other devices learn of the delete. The profile row stays on purpose: it is the only place the epoch lives, and it holds
-- nothing else (user_id, created_at, data_epoch). Without it a phone that was offline during the delete could not be told to drop its copy.
-- the Apple token row is left to the account step, which needs it for the revoke. Service role only.
create function ridgeline.delete_user_data(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ridgeline:epoch:' || uid::text, 0));
  delete from ridgeline.activities where user_id = uid;
  delete from ridgeline.saved      where user_id = uid;
  delete from ridgeline.shortlist  where user_id = uid;
  delete from ridgeline.settings   where user_id = uid;
  delete from ridgeline.usage      where user_id = uid;     -- counters for data that no longer exists
  insert into ridgeline.profiles (user_id, data_epoch) values (uid, 1)
    on conflict (user_id) do update set data_epoch = ridgeline.profiles.data_epoch + 1;
end $$;
revoke execute on function ridgeline.delete_user_data(uuid) from public, anon, authenticated;
grant  execute on function ridgeline.delete_user_data(uuid) to service_role;

-- The epoch is the server's to change: a signed-in user may create their profile row (user_id only) and read it, nothing else.
revoke update, delete, insert on ridgeline.profiles from authenticated;
grant insert (user_id) on ridgeline.profiles to authenticated;
