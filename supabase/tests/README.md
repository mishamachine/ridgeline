# Ridgeline SQL tests

`ridgeline_rls.test.sql`, `ridgeline_sync.test.sql` and `ridgeline_delete.test.sql` (the last two run after the second migration) are pgTAP scripts. Run it only against a throwaway Postgres that has the Supabase roles, the `auth` and `vault` schemas
(the `supabase/postgres` image or `supabase start`). Never run it on the shared project.

```bash
docker run -d --name rl-pg -e POSTGRES_PASSWORD=pw public.ecr.aws/supabase/postgres:17.11.0.004
# wait for "ready to accept connections" in `docker logs rl-pg`
docker exec -i rl-pg psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261107120000_ridgeline_schema.sql
docker exec -i rl-pg psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/ridgeline_rls.test.sql
docker rm -f rl-pg
```

Every line must start with `ok`; a `not ok` line fails the run. CI does not run these (the repo's PR check has no database job).
