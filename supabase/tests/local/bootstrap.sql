-- Local stand-in for the parts of a hosted Supabase database that the migrations rely on.
-- Run as a SUPERUSER on an empty database, then run every migration as role sb_postgres,
-- which has the same limited powers as the hosted "postgres" role (not a superuser).
-- Only used by the local test suite; never applied to the real project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'sb_postgres') then
    create role sb_postgres login createrole bypassrls password 'sb_postgres';
  end if;
end $$;

grant create, connect, temporary on database :"DBNAME" to sb_postgres;
alter schema public owner to sb_postgres;
-- like the hosted postgres role, sb_postgres may act as the API roles (used by the row-security checks)
grant anon, authenticated, service_role to sb_postgres;

create schema if not exists extensions authorization sb_postgres;
grant usage on schema extensions to sb_postgres, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- auth schema (only the columns the app touches)
create schema if not exists auth authorization supabase_auth_admin;
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255) default 'authenticated',
  role varchar(255) default 'authenticated',
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  not_after timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet
);
alter table auth.users owner to supabase_auth_admin;
alter table auth.sessions owner to supabase_auth_admin;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;

grant usage on schema auth to sb_postgres, anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to sb_postgres, anon, authenticated, service_role;
-- the hosted "postgres" role: read/update/trigger on auth.users, read/delete on auth.sessions
grant select, update, trigger, references on auth.users to sb_postgres;
grant select, delete on auth.sessions to sb_postgres;
-- the local fake GoTrue writes through this role too
grant all on auth.users, auth.sessions to supabase_auth_admin;

-- storage schema
create schema if not exists storage authorization supabase_storage_admin;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.objects enable row level security;
grant usage on schema storage to sb_postgres, anon, authenticated, service_role;
grant select, insert, update on storage.buckets to sb_postgres;
grant select on storage.objects to sb_postgres;

-- vault stand-in (the migrations do not depend on it, kept for parity)
create schema if not exists vault;

-- a login role the local fakes use to write auth and storage rows
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sb_fake_services') then
    create role sb_fake_services login password 'sb_fake_services' in role supabase_auth_admin, supabase_storage_admin;
  end if;
end $$;
grant usage on schema auth, storage to sb_fake_services;
grant all on all tables in schema auth, storage to sb_fake_services;
