-- Rollback for 20261107130000_ridgeline_sync.sql. Owner only.
do $$
declare t text;
begin
  foreach t in array array['shortlist','saved','activities','settings'] loop
    execute format('drop trigger if exists %I on ridgeline.%I', t || '_sync_guard', t);
    execute format('drop index if exists ridgeline.%I', t || '_synced_idx');
    execute format('alter table ridgeline.%I drop column if exists synced_at', t);
  end loop;
end $$;
drop function if exists ridgeline.sync_guard();
