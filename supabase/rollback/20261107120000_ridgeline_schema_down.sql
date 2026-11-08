-- Rollback for 20261107120000_ridgeline_schema.sql. Destroys all Ridgeline account data. Owner only.
-- Delete the Vault secrets first (they are not removed by the cascade).
delete from vault.secrets where id in (select secret_id from ridgeline.apple_tokens);
-- Take back a Vault right ONLY if this migration is the one that granted it (it records which on the schema comment). A platform default stays.
do $$
declare c text := coalesce(obj_description('ridgeline'::regnamespace, 'pg_namespace'), '');
begin
  if c like 'vault_granted_by_migration:%' and c like '%delete%' then revoke delete on vault.secrets from postgres; end if;
  if c like 'vault_granted_by_migration:%' and c like '%usage%' then revoke usage on schema vault from postgres; end if;
exception when others then raise notice 'ridgeline: vault revoke skipped (%)', sqlerrm; end $$;
drop schema ridgeline cascade;
