# Ridgeline SQL tests

The `ridgeline_*.test.sql` files are pgTAP scripts. Run them only against a throwaway Postgres that has the Supabase roles and the `auth` and `vault` schemas
(the `supabase/postgres` image or `supabase start`). Never run them on the shared project. `ridgeline_sync` and `ridgeline_delete` need the second migration too.

```bash
docker run -d --name rl-pg -e POSTGRES_PASSWORD=pw public.ecr.aws/supabase/postgres:17.11.0.004
# wait for "ready to accept connections" in `docker logs rl-pg`
# migrations as the `postgres` role (the hosted owner), tests as the superuser
docker exec -i rl-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261107120000_ridgeline_schema.sql
docker exec -i rl-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261107130000_ridgeline_sync.sql
for t in rls sync delete; do docker exec -i rl-pg psql -U supabase_admin -d postgres -At < supabase/tests/ridgeline_$t.test.sql | grep -E "^(not ok|1\.\.|ERROR|#)"; done
docker rm -f rl-pg
```

Every test line must start with `ok`; a `not ok` line fails the run. CI does not run these (the repo's PR check has no database job).
