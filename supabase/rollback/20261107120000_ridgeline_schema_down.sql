-- Rollback for 20261107120000_ridgeline_schema.sql. Destroys all Ridgeline account data. owner only.
-- Delete the Vault secrets first (they are not removed by the cascade).
delete from vault.secrets where id in (select secret_id from ridgeline.apple_tokens);
drop schema ridgeline cascade;
-- Take back the Vault right the migration granted (only `delete`; `usage` on the vault schema may have been there before).
do $$ begin
  revoke delete on vault.secrets from postgres;
exception when others then raise notice 'ridgeline: vault revoke skipped (%)', sqlerrm; end $$;
