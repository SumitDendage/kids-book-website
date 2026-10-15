-- Learn With Why on Supabase · 1/10 · foundation
-- Extensions, the private schema, the least-privilege role the API runs as, and shared helpers.
-- Everything is created by the project's "postgres" role (not a superuser on Supabase).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Tables and functions the Data API must never expose live in "private".
create schema if not exists private;
revoke all on schema private from public;

-- The Edge Function connects as postgres and immediately runs `set local role lww_api`
-- inside each transaction, so every query it makes is limited to the grants below.
-- lww_api bypasses row security (it is the trusted server), but it only gets the table
-- privileges each table needs (for example audit_logs is insert + select only).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lww_api') then
    create role lww_api nologin noinherit bypassrls;
  end if;
  execute format('grant lww_api to %I', current_user);
  -- the function's database URL signs in as postgres, whoever runs this migration
  if current_user <> 'postgres' and exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'grant lww_api to postgres';
  end if;
end $$;

grant usage on schema public, private, extensions to lww_api;

-- New tables in public are not readable by the browser roles unless a migration says so.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges in schema private revoke execute on functions from public;

-- updated_at bookkeeping
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rows that must never change once written (audit trail).
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end;
$$;

-- Server-side secrets that never leave the database (for example the key that signs viewer
-- tokens). Only the API role can read them; they are generated here, never typed in.
create table if not exists private.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
insert into private.app_secrets (name, value)
values ('view_token_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
revoke all on private.app_secrets from public;
grant select on private.app_secrets to lww_api;

-- Small helpers used by checks and the API
create or replace function private.sha256_hex(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') $$;

grant execute on function private.sha256_hex(text) to lww_api;
