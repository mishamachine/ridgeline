-- Rollback for 20261107120000_ridgeline_schema.sql. Destroys all Ridgeline account data. Owner only.
-- Delete the Vault secrets first (they are not removed by the cascade).
delete from vault.secrets where id in (select secret_id from ridgeline.apple_tokens);
-- Take back the Vault right ONLY if this migration is the one that granted it (it marks the schema comment). A platform default stays.
do $$ begin
  if obj_description('ridgeline'::regnamespace, 'pg_namespace') = 'vault_delete_granted_by_migration' then
    revoke delete on vault.secrets from postgres;
  end if;
exception when others then raise notice 'ridgeline: vault revoke skipped (%)', sqlerrm; end $$;
drop schema ridgeline cascade;
