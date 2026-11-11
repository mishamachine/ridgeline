-- Ridgeline accounts: schema, owner-only RLS, Apple refresh-token table (Vault).
-- Lives in its own schema `ridgeline`. Touches no other app's tables and adds NO trigger on auth.users:
-- the app creates the Ridgeline profile row itself after sign-in (ensureProfile in src/lib/accounts).
-- Never store body or health fields in these tables. No display_name: the provider name stays in auth only.
-- Apply: owner only (shared project). After applying, add `ridgeline` to Settings > API > Exposed schemas.

create schema if not exists ridgeline;
revoke all on schema ridgeline from public, anon;
grant usage on schema ridgeline to authenticated, service_role;

-- A profile is a bare row: it proves the user opted in to Ridgeline. No marketing flag, no name.
-- json_ok: refuses JSON that is cheap to send and costly to handle. A jsonb number can carry an exponent like 1e999999999; storing it is cheap, but
-- comparing, casting or rendering it can pin a CPU. So every number must be 0 or sit between 1e-12 and 1e15 in size (real values: coordinates, millisecond
-- timestamps ~1.8e12, elevations, speeds, distances), and strings may not hold control characters other than tab, newline and carriage return.
-- (jsonb itself already refuses U+0000. Object KEYS are not scanned: the 64 KiB / 1 MiB size caps bound them.)
create function ridgeline.json_ok(j jsonb) returns boolean language sql immutable set search_path = '' as $$
  select j is null
     or (not jsonb_path_exists(j, 'strict $.** ? (@.type() == "number" && (@ > 1e15 || @ < -1e15 || (@ != 0 && @ < 1e-12 && @ > -1e-12)))')
         -- a ZERO can still carry a huge scale (0e-16383 is about 20 bytes stored and prints 16 KB): a zero may have at most 20 decimal places
         and not exists (select 1 from jsonb_path_query(j, 'strict $.** ? (@.type() == "number" && @ == 0)') v where scale(v::numeric) > 20)
         and not jsonb_path_exists(j, 'strict $.** ? (@.type() == "string" && @ like_regex "[\u0001-\u0008\u000b\u000c\u000e-\u001f]")'))
$$;
grant execute on function ridgeline.json_ok(jsonb) to authenticated, service_role;

create table ridgeline.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table ridgeline.shortlist (
  user_id    uuid not null references auth.users (id) on delete cascade,
  trail_id   text not null check (length(trail_id) between 1 and 200),
  trail      jsonb check (pg_column_size(trail) < 65536),
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  check (not deleted or trail is null),                 -- a tombstone carries no payload
  primary key (user_id, trail_id)
);

create table ridgeline.saved (
  user_id    uuid not null references auth.users (id) on delete cascade,
  trail_id   text not null check (length(trail_id) between 1 and 200),
  trail      jsonb check (pg_column_size(trail) < 65536),
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  check (not deleted or trail is null),                 -- a tombstone carries no payload
  primary key (user_id, trail_id)
);

create table ridgeline.activities (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 1 and 200),
  trail_id   text check (trail_id is null or length(trail_id) <= 200),
  started_at timestamptz not null,
  stats      jsonb not null default '{}'::jsonb check (pg_column_size(stats) < 65536),   -- name, endedAt, withDog, rain, snapshot, unfinished, pausedMs. Never body data.
  track      jsonb check (track is null or (jsonb_typeof(track) = 'array' and jsonb_array_length(track) <= 50000 and pg_column_size(track) < 1048576)),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  check (not deleted or (stats = '{}'::jsonb and track is null and trail_id is null)),   -- a tombstone carries no payload
  primary key (user_id, id)
);

create table ridgeline.settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 65536),
  updated_at timestamptz not null default now()
);

-- H1 (round 8): no number bombs, no control characters in any client-written JSON column.
alter table ridgeline.activities add constraint activities_track_json_ok check (ridgeline.json_ok(track));
alter table ridgeline.activities add constraint activities_stats_json_ok check (ridgeline.json_ok(stats));
alter table ridgeline.saved add constraint saved_trail_json_ok check (ridgeline.json_ok(trail));
alter table ridgeline.shortlist add constraint shortlist_trail_json_ok check (ridgeline.json_ok(trail));
alter table ridgeline.settings add constraint settings_data_json_ok check (ridgeline.json_ok(data));

-- Apple refresh token: the token itself sits in vault.secrets; this table only holds the secret id.
-- RLS on, no policy, no grant: reachable by the service role only.
create table ridgeline.apple_tokens (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  secret_id  uuid not null,
  created_at timestamptz not null default now()
);

-- Store the big columns UNCOMPRESSED (TOAST "external"). By default Postgres compresses them, and a size cap that counts the stored size would then count the
-- compressed bytes: a 1,000,004-byte track of repeated values is stored as about 11 KB, so one account could hold gigabytes of raw data, and a page of
-- rows could build a response hundreds of MB large. With external storage the stored size IS the raw size, so the caps mean what they say.
alter table ridgeline.activities alter column track set storage external;
alter table ridgeline.activities alter column stats set storage external;
alter table ridgeline.saved      alter column trail set storage external;
alter table ridgeline.shortlist  alter column trail set storage external;
alter table ridgeline.settings   alter column data  set storage external;

-- Per-user usage, kept by deltas. One row per user and table: stored bytes, rows (tombstones included) and live rows. The limits below read this row
-- instead of scanning the table (a whole-row size sum reads every stored route), and a trigger after each write keeps it current in the same
-- transaction, under the same per-user advisory lock. Clients have no grant on it.
create table ridgeline.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  tbl     text not null,
  bytes   bigint not null default 0,
  n_rows  integer not null default 0,
  n_live  integer not null default 0,
  primary key (user_id, tbl)
);

-- Row limits mirror backup.ts (5,000 hikes, 2,000 saved trails; shortlist capped at 5,000). Three caps per user and table:
--   live rows (not deleted) up to the limit; ALL rows, tombstones included, up to twice the limit; total stored bytes up to a cap.
-- A route is at most 1 MB (about 8,000 points; the app thins longer ones before upload). The byte cap bounds a user's storage: 25 MB of hikes, 25 MB each of saved
-- trails and shortlist. A write that GROWS a row (an update or an upsert) is checked against the cap too. A refused write raises RL003 ("account full").
-- Size of a row = the stored size of its big columns (uncompressed, see above; read without fetching them) plus 200 bytes of overhead.
-- Args: limit, name of the key column, byte cap. An upsert that updates an existing row is never blocked by the row counts.
-- One statement can write many rows, and the usage row only moves AFTER each row (track_usage), so:
--   * enforce_row_limit keeps a running tally (ONE transaction-local setting per table, ridgeline.tally_<table>, valued uid|bytes|rows|live; a tally that belongs to another user reads as NULL and the caller starts again from zero) of what this statement has written but track_usage has not yet
--     counted, and refuses at the FIRST row where usage + tally + this row crosses a cap: an over-cap statement stops early instead of writing everything first;
--   * track_usage is the authority: after moving the usage row it raises RL003 if a cap is crossed, which aborts and rolls back the whole statement.
-- ONE fixed setting name per table (not per user): a statement that writes rows for thousands of different users cannot create thousands of settings.
-- Reads the tally for this table and user: zeros when there is none, NULL when it belongs to another user (the caller then starts from zero, or leaves it alone).
create function ridgeline.tally_get(tbl text, uid uuid) returns bigint[] language plpgsql stable set search_path = '' as $$
declare v text := nullif(current_setting('ridgeline.tally_' || tbl, true), ''); p text[];
begin
  if v is null then return array[0, 0, 0]::bigint[]; end if;
  p := string_to_array(v, '|');
  if p[1] is distinct from uid::text then return null; end if;
  return array[p[2]::bigint, p[3]::bigint, p[4]::bigint];
end $$;
create function ridgeline.tally_set(tbl text, uid uuid, b bigint, r bigint, l bigint) returns void language plpgsql set search_path = '' as $$
begin perform set_config('ridgeline.tally_' || tbl, uid::text || '|' || b || '|' || r || '|' || l, true); end $$;

create function ridgeline.enforce_row_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int := tg_argv[0]::int; keycol text := tg_argv[1]; maxbytes bigint := tg_argv[2]::bigint;
        u ridgeline.usage; found boolean; nb bigint := 0; ob bigint := 0; d_bytes bigint; d_rows int := 0; d_live int := 0;
        tl bigint[]; t_bytes bigint := 0; t_rows int := 0; t_live int := 0;
        is_dead boolean := coalesce((to_jsonb(new)->>'deleted')::boolean, false);
begin
  if tg_table_name = 'activities' then nb := 200 + coalesce(pg_column_size(new.track), 0) + coalesce(pg_column_size(new.stats), 0);
  elsif tg_table_name in ('saved', 'shortlist') then nb := 200 + coalesce(pg_column_size(new.trail), 0);
  else nb := pg_column_size(new); end if;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  select * into u from ridgeline.usage where user_id = new.user_id and tbl = tg_table_name;
  tl := coalesce(ridgeline.tally_get(tg_table_name, new.user_id), array[0, 0, 0]::bigint[]);   -- another user's tally: start this user from zero
  t_bytes := tl[1]; t_rows := tl[2]::int; t_live := tl[3]::int;
  if tg_op = 'INSERT' then
    execute format('select exists(select 1 from %I.%I where user_id = $1 and %I::text = $2)', tg_table_schema, tg_table_name, keycol)
      into found using new.user_id, to_jsonb(new)->>keycol;
    if found then return new; end if;               -- the upsert path: the row exists, the UPDATE that follows does the accounting
    if coalesce(u.n_rows, 0) + t_rows >= 2 * lim then raise exception 'ridgeline: total row limit (%) reached for %', 2 * lim, tg_table_name using errcode = 'RL003'; end if;
    if not is_dead and coalesce(u.n_live, 0) + t_live >= lim then raise exception 'ridgeline: row limit (%) reached for %', lim, tg_table_name using errcode = 'RL003'; end if;
    d_bytes := nb; d_rows := 1; d_live := case when is_dead then 0 else 1 end;
  else
    if tg_table_name = 'activities' then ob := 200 + coalesce(pg_column_size(old.track), 0) + coalesce(pg_column_size(old.stats), 0);
    elsif tg_table_name in ('saved', 'shortlist') then ob := 200 + coalesce(pg_column_size(old.trail), 0);
    else ob := pg_column_size(old); end if;
    d_live := (case when is_dead then 0 else 1 end) - (case when coalesce((to_jsonb(old)->>'deleted')::boolean, false) then 0 else 1 end);
    if d_live > 0 and coalesce(u.n_live, 0) + t_live >= lim then   -- a revival adds a live row
      raise exception 'ridgeline: row limit (%) reached for %', lim, tg_table_name using errcode = 'RL003';
    end if;
    d_bytes := nb - ob;
  end if;
  if d_bytes > 0 and coalesce(u.bytes, 0) + t_bytes + d_bytes > maxbytes then raise exception 'ridgeline: storage limit reached for %', tg_table_name using errcode = 'RL003'; end if;
  -- This row passes: add it to the statement's tally (track_usage takes it back out once the usage row has it).
  perform ridgeline.tally_set(tg_table_name, new.user_id, t_bytes + d_bytes, t_rows + d_rows, t_live + d_live);
  return new;
end $$;

-- After every write that really happened: move the usage row by the change (deltas, never a scan), take the row back out of the statement's tally, and enforce the caps.
create function ridgeline.track_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid; nb bigint := 0; ob bigint := 0; d_rows int := 0; d_live int := 0;
        lim int := tg_argv[0]::int; maxbytes bigint := tg_argv[1]::bigint; cur record;
        tl bigint[];
begin
  if tg_op <> 'DELETE' then
    uid := new.user_id;
    if tg_table_name = 'activities' then nb := 200 + coalesce(pg_column_size(new.track), 0) + coalesce(pg_column_size(new.stats), 0);
    elsif tg_table_name in ('saved', 'shortlist') then nb := 200 + coalesce(pg_column_size(new.trail), 0);
    else nb := pg_column_size(new); end if;
  end if;
  if tg_op <> 'INSERT' then
    uid := old.user_id;
    if tg_table_name = 'activities' then ob := 200 + coalesce(pg_column_size(old.track), 0) + coalesce(pg_column_size(old.stats), 0);
    elsif tg_table_name in ('saved', 'shortlist') then ob := 200 + coalesce(pg_column_size(old.trail), 0);
    else ob := pg_column_size(old); end if;
  end if;
  if tg_op = 'INSERT' then d_rows := 1; d_live := case when coalesce((to_jsonb(new)->>'deleted')::boolean, false) then 0 else 1 end;
  elsif tg_op = 'DELETE' then d_rows := -1; d_live := - case when coalesce((to_jsonb(old)->>'deleted')::boolean, false) then 0 else 1 end;
  else d_live := (case when coalesce((to_jsonb(new)->>'deleted')::boolean, false) then 0 else 1 end) - (case when coalesce((to_jsonb(old)->>'deleted')::boolean, false) then 0 else 1 end);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || uid::text, 0));
  if tg_op = 'DELETE' then
    -- Only ever update here: when an account is deleted the cascade removes the user (and its usage rows) in the same statement.
    update ridgeline.usage set bytes = bytes + nb - ob, n_rows = n_rows + d_rows, n_live = n_live + d_live where user_id = uid and tbl = tg_table_name;
    return old;
  end if;
  insert into ridgeline.usage as u (user_id, tbl, bytes, n_rows, n_live) values (uid, tg_table_name, nb - ob, d_rows, d_live)
    on conflict (user_id, tbl) do update set bytes = u.bytes + (nb - ob), n_rows = u.n_rows + d_rows, n_live = u.n_live + d_live
    returning u.bytes, u.n_rows, u.n_live into cur;
  -- The row is counted now: take it back out of the tally (it was added by enforce_row_limit with the same numbers).
  -- A tally that now belongs to another user (a statement that wrote rows for several users) is left alone: it is not ours to change.
  tl := ridgeline.tally_get(tg_table_name, uid);
  if tl is not null then perform ridgeline.tally_set(tg_table_name, uid, tl[1] - (nb - ob), tl[2] - d_rows, tl[3] - d_live); end if;
  -- The real cap check: usage now includes every row written so far by this statement.
  if nb - ob > 0 and cur.bytes > maxbytes then raise exception 'ridgeline: storage limit reached for %', tg_table_name using errcode = 'RL003'; end if;
  if d_live > 0 and cur.n_live > lim then raise exception 'ridgeline: row limit (%) reached for %', lim, tg_table_name using errcode = 'RL003'; end if;
  if d_rows > 0 and cur.n_rows > 2 * lim then raise exception 'ridgeline: total row limit (%) reached for %', 2 * lim, tg_table_name using errcode = 'RL003'; end if;
  return new;
end $$;

-- Trigger names matter: BEFORE triggers run in name order, and the limit triggers must run AFTER <table>_sync_guard (migration 2). Then a forged user_id gets 42501
-- before any cap check, and every writer takes its locks in the same order as delete_user_data (epoch, then usage), so the two cannot deadlock.
create trigger activities_zz_limit before insert or update on ridgeline.activities for each row execute function ridgeline.enforce_row_limit(5000, 'id', 26214400);
create trigger saved_zz_limit      before insert or update on ridgeline.saved      for each row execute function ridgeline.enforce_row_limit(2000, 'trail_id', 26214400);
create trigger shortlist_zz_limit  before insert or update on ridgeline.shortlist  for each row execute function ridgeline.enforce_row_limit(5000, 'trail_id', 26214400);
create trigger activities_usage after insert or update or delete on ridgeline.activities for each row execute function ridgeline.track_usage(5000, 26214400);
create trigger saved_usage      after insert or update or delete on ridgeline.saved      for each row execute function ridgeline.track_usage(2000, 26214400);
create trigger shortlist_usage  after insert or update or delete on ridgeline.shortlist  for each row execute function ridgeline.track_usage(5000, 26214400);

-- RLS: owner only, signed-in users only. anon gets nothing.
do $$
declare t text;
begin
  foreach t in array array['profiles','shortlist','saved','activities','settings'] loop
    execute format('alter table ridgeline.%I enable row level security', t);
    execute format('revoke all on ridgeline.%I from public, anon', t);
    execute format('grant select, insert, update, delete on ridgeline.%I to authenticated', t);
    execute format('create policy %I on ridgeline.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end $$;
alter table ridgeline.apple_tokens enable row level security;
revoke all on ridgeline.apple_tokens from public, anon, authenticated;
grant select, insert, update, delete on ridgeline.apple_tokens to service_role;
grant select, insert, update, delete on ridgeline.profiles, ridgeline.shortlist, ridgeline.saved, ridgeline.activities, ridgeline.settings to service_role;

-- Vault helpers: SECURITY DEFINER, callable by the service role only.
create function ridgeline.store_apple_token(p_user uuid, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select secret_id into sid from ridgeline.apple_tokens where user_id = p_user;
  if sid is null then
    sid := vault.create_secret(p_token, 'ridgeline_apple_' || p_user::text, 'Ridgeline Sign in with Apple refresh token');
    insert into ridgeline.apple_tokens (user_id, secret_id) values (p_user, sid);
  else
    perform vault.update_secret(sid, p_token);
  end if;
end $$;

create function ridgeline.read_apple_token(p_user uuid) returns text
language sql security definer set search_path = '' as $$
  select s.decrypted_secret
  from ridgeline.apple_tokens t join vault.decrypted_secrets s on s.id = t.secret_id
  where t.user_id = p_user
$$;

-- Vault has no delete function of its own (only create_secret / update_secret), so we delete from vault.secrets.
-- On hosted Supabase the function owner is `postgres`; the grant below gives it that right. If the grant is refused,
-- or the delete is later refused, the secret's value is overwritten so no token stays readable. MUST be verified on a
-- Supabase branch before go-live (see the PR).
-- The grant is made only if the owner does not already have the right, and the schema comment records that WE made it, so the rollback
-- takes back only what this migration gave (never a platform default).
do $$
declare did_usage boolean := not has_schema_privilege('postgres', 'vault', 'USAGE'); did_delete boolean := not has_table_privilege('postgres', 'vault.secrets', 'DELETE');
begin
  if did_usage then grant usage on schema vault to postgres; end if;
  if did_delete then grant delete on vault.secrets to postgres; end if;
  if did_usage or did_delete then
    execute format('comment on schema ridgeline is %L', 'vault_granted_by_migration:' || case when did_usage then 'usage,' else '' end || case when did_delete then 'delete' else '' end);
  end if;
exception when others then
  raise notice 'ridgeline: vault grant skipped (%): verify delete_apple_token on a branch', sqlerrm;
end $$;

create function ridgeline.delete_apple_token(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select secret_id into sid from ridgeline.apple_tokens where user_id = p_user;
  if sid is not null then
    begin
      delete from vault.secrets where id = sid;
    exception when insufficient_privilege then
      -- Overwrite the value and rename it, so nothing readable and nothing carrying the person's id is left.
      perform vault.update_secret(sid, 'deleted', 'ridgeline_deleted_' || gen_random_uuid()::text, 'deleted');
      raise warning 'ridgeline: vault delete refused; secret value overwritten instead';
    end;
    delete from ridgeline.apple_tokens where user_id = p_user;
  end if;
end $$;

revoke execute on function ridgeline.store_apple_token(uuid, text), ridgeline.read_apple_token(uuid), ridgeline.delete_apple_token(uuid) from public, anon, authenticated;
grant  execute on function ridgeline.store_apple_token(uuid, text), ridgeline.read_apple_token(uuid), ridgeline.delete_apple_token(uuid) to service_role;
revoke execute on function ridgeline.enforce_row_limit(), ridgeline.track_usage(), ridgeline.tally_get(text, uuid), ridgeline.tally_set(text, uuid, bigint, bigint, bigint) from public, anon, authenticated;
alter table ridgeline.usage enable row level security;
revoke all on ridgeline.usage from public, anon, authenticated;
grant select, insert, update, delete on ridgeline.usage to service_role;

-- Deletion requests received by email (see docs/DELETE_BY_EMAIL.md). The admin delete path takes ONLY a request id and looks the rest up here, so a user id never
-- appears in a workflow input or a log. Service role only: no client policy, no client grant. No email address is stored: the account is identified by user_id,
-- the confirmation code only by its hash, the message only by its Gmail thread id. The code expires 23 days after the request.
create table ridgeline.deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  mode            text not null check (mode in ('data', 'account')),
  code_hash       text not null check (length(code_hash) >= 32),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '23 days'),
  used_at         timestamptz,
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'executing', 'done', 'closed', 'refused')),
  gmail_thread_id text
);
create index deletion_requests_user_idx on ridgeline.deletion_requests (user_id);
alter table ridgeline.deletion_requests enable row level security;
revoke all on ridgeline.deletion_requests from public, anon, authenticated;
grant select, insert, update on ridgeline.deletion_requests to service_role;
