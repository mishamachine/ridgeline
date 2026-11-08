-- Rollback for 20261107120000_ridgeline_schema.sql. Destroys all Ridgeline account data. owner only.
-- Delete the Vault secrets first (they are not removed by the cascade).
delete from vault.secrets where id in (select secret_id from ridgeline.apple_tokens);
drop schema ridgeline cascade;
