-- Sync support. Depends on 20261107120000_ridgeline_schema.sql.
--  * synced_at: set by the server on every write, so a device that comes online late (with an old updated_at)
--    is still picked up by other devices pulling "everything since my last sync".
--  * updated_at (the device's clock, used for last-write-wins) cannot be set into the future.
--  * an older write never overwrites a newer row (last write wins is enforced here too, not only in the app).

do $$
declare t text;
begin
  foreach t in array array['shortlist','saved','activities','settings'] loop
    execute format('alter table ridgeline.%I add column synced_at timestamptz not null default now()', t);
    execute format('create index %I on ridgeline.%I (user_id, synced_at)', t || '_synced_idx', t);
  end loop;
end $$;

create function ridgeline.sync_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
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
