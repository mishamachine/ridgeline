-- Ridgeline accounts: schema, owner-only RLS, Apple refresh-token table (Vault).
-- Lives in its own schema `ridgeline`. Touches no other app's tables and adds NO trigger on auth.users:
-- the app creates the Ridgeline profile row itself after sign-in (ensureProfile in src/lib/accounts).
-- Never store body or health fields in these tables. No display_name: the provider name stays in auth only.
-- Apply: owner only (shared project). After applying, add `ridgeline` to Settings > API > Exposed schemas.

create schema if not exists ridgeline;
revoke all on schema ridgeline from public, anon;
grant usage on schema ridgeline to authenticated, service_role;

-- A profile is a bare row: it proves the user opted in to Ridgeline. No marketing flag, no name.
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
  primary key (user_id, trail_id)
);

create table ridgeline.saved (
  user_id    uuid not null references auth.users (id) on delete cascade,
  trail_id   text not null check (length(trail_id) between 1 and 200),
  trail      jsonb check (pg_column_size(trail) < 65536),
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, trail_id)
);

create table ridgeline.activities (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 1 and 200),
  trail_id   text,
  started_at timestamptz not null,
  stats      jsonb not null default '{}'::jsonb check (pg_column_size(stats) < 65536),   -- name, endedAt, withDog, rain, snapshot, unfinished, pausedMs. Never body data.
  track      jsonb check (track is null or (jsonb_typeof(track) = 'array' and jsonb_array_length(track) <= 50000)),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, id)
);

create table ridgeline.settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 65536),
  updated_at timestamptz not null default now()
);

-- Apple refresh token: the token itself sits in vault.secrets; this table only holds the secret id.
-- RLS on, no policy, no grant: reachable by the service role only.
create table ridgeline.apple_tokens (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  secret_id  uuid not null,
  created_at timestamptz not null default now()
);

-- Row limits mirror backup.ts (5,000 hikes, 2,000 saved trails; shortlist capped at 5,000). Only live rows count.
-- Args: limit, name of the key column. An upsert that updates an existing row is never blocked, and a tombstone never counts.
create function ridgeline.enforce_row_limit() returns trigger
language plpgsql set search_path = '' as $$
declare lim int := tg_argv[0]::int; keycol text := tg_argv[1]; n int; found boolean;
begin
  if coalesce((to_jsonb(new)->>'deleted')::boolean, false) then return new; end if;                  -- a tombstone is not a live row
  if tg_op = 'UPDATE' and not coalesce((to_jsonb(old)->>'deleted')::boolean, false) then return new; end if; -- already live: no growth
  if tg_op = 'INSERT' then                                                                           -- the upsert path: row already there
    execute format('select exists(select 1 from %I.%I where user_id = $1 and %I::text = $2)', tg_table_schema, tg_table_name, keycol)
      into found using new.user_id, to_jsonb(new)->>keycol;
    if found then return new; end if;
  end if;
  execute format('select count(*) from %I.%I where user_id = $1 and not deleted', tg_table_schema, tg_table_name) into n using new.user_id;
  if n >= lim then raise exception 'ridgeline: row limit (%) reached for %', lim, tg_table_name using errcode = '54000'; end if;
  return new;
end $$;
create trigger activities_limit before insert or update of deleted on ridgeline.activities for each row execute function ridgeline.enforce_row_limit(5000, 'id');
create trigger saved_limit      before insert or update of deleted on ridgeline.saved      for each row execute function ridgeline.enforce_row_limit(2000, 'trail_id');
create trigger shortlist_limit  before insert or update of deleted on ridgeline.shortlist  for each row execute function ridgeline.enforce_row_limit(5000, 'trail_id');

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
do $$
begin
  grant usage on schema vault to postgres;
  grant delete on vault.secrets to postgres;
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
      perform vault.update_secret(sid, 'deleted');
      raise warning 'ridgeline: vault delete refused; secret value overwritten instead';
    end;
    delete from ridgeline.apple_tokens where user_id = p_user;
  end if;
end $$;

revoke execute on function ridgeline.store_apple_token(uuid, text), ridgeline.read_apple_token(uuid), ridgeline.delete_apple_token(uuid) from public, anon, authenticated;
grant  execute on function ridgeline.store_apple_token(uuid, text), ridgeline.read_apple_token(uuid), ridgeline.delete_apple_token(uuid) to service_role;
revoke execute on function ridgeline.enforce_row_limit() from public, anon, authenticated;
