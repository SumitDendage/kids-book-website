-- Learn With Why on Supabase · 2/10 · accounts, staff, sessions and the sign-in trail
-- Passwords live only in Supabase Auth (auth.users, hashed by Supabase). Nothing here stores
-- a password or a raw token: verification and reset links are stored as SHA-256 hashes.

-- ── customer and staff profiles (one row per auth.users row) ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null unique
    check (char_length(email::text) between 3 and 254 and email::text like '%_@_%'),
  name text not null default '' check (char_length(name) <= 80),
  role text check (role in ('parent', 'teacher', 'tutor', 'school')),
  -- pending_verification until the confirmation link is used; a block is tracked separately
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'active')),
  email_verified_at timestamptz,
  created_via text not null default 'dashboard'
    check (created_via in ('signup', 'staff', 'dashboard', 'import')),
  agreement_version text,
  agreement_accepted_at timestamptz,
  failed_login_attempts integer not null default 0 check (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  -- account block: no sign-in, every session ends (staff action, reversible)
  blocked_at timestamptz,
  blocked_reason text check (char_length(blocked_reason) <= 500),
  blocked_by uuid references auth.users (id) on delete set null,
  -- subscription suspension: signed in, but no paid sheet opens (3/3 warnings or staff)
  subscription_suspended_at timestamptz,
  suspension_reason text check (suspension_reason in ('warnings', 'staff')),
  suspended_by uuid references auth.users (id) on delete set null,
  country text check (country ~ '^[A-Z]{2}$|^OTHER$'),
  time_zone text check (time_zone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+){0,2}$' and char_length(time_zone) <= 64),
  legacy_user_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_active_is_verified check (status <> 'active' or email_verified_at is not null),
  constraint profiles_block_reason check (blocked_at is not null or blocked_reason is null),
  constraint profiles_suspension_reason check ((subscription_suspended_at is null) = (suspension_reason is null))
);
create index profiles_created_at on public.profiles (created_at desc);
create index profiles_name_trgm on public.profiles using gin (name extensions.gin_trgm_ops);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Every new auth user gets a profile, whoever created it (the API, the dashboard, or a direct
-- call to Supabase Auth). Only accounts the API creates are marked created_via = 'signup'/'staff';
-- the API refuses to sign in an account that never accepted the sharing agreement.
create or replace function private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via text := coalesce(new.raw_app_meta_data ->> 'lww_created_via', 'dashboard');
begin
  if v_via not in ('signup', 'staff', 'dashboard', 'import') then v_via := 'dashboard'; end if;
  insert into public.profiles (id, email, name, created_via)
  values (
    new.id,
    lower(coalesce(new.email, new.id::text || '@no-email.invalid')),
    left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'name', ''), '[[:cntrl:]<>]', '', 'g'), 80),
    v_via
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger lww_on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

create or replace function private.on_auth_user_email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;
create trigger lww_on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.on_auth_user_email_changed();

revoke all on function private.on_auth_user_created() from public;
revoke all on function private.on_auth_user_email_changed() from public;

-- ── the account-sharing agreement, recorded every time it is accepted ─────────────────────
create table public.agreement_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  context text not null default 'signup' check (context in ('signup', 'reaccept')),
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index agreement_acceptances_user on public.agreement_acceptances (user_id, accepted_at desc);

-- ── staff: who may use the admin and developer panels, and for what ──────────────────────
create table public.staff_permissions (
  id text primary key check (id ~ '^[a-z]+\.[a-z_]+$'),
  description text not null
);

create table public.staff_role_templates (
  role text primary key check (role in ('owner', 'admin', 'support', 'content', 'developer')),
  label text not null,
  permissions text[] not null default '{}'
);

create table public.staff_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null references public.staff_role_templates (role),
  -- explicit list; owners implicitly hold every permission
  permissions text[] not null default '{}',
  active boolean not null default true,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger staff_members_touch before update on public.staff_members
  for each row execute function private.touch_updated_at();

-- every permission named on a staff row or template must exist
create or replace function private.check_staff_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_unknown text;
begin
  select p into v_unknown
  from unnest(new.permissions) as p
  where not exists (select 1 from public.staff_permissions sp where sp.id = p)
  limit 1;
  if v_unknown is not null then
    raise exception 'unknown staff permission: %', v_unknown using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger staff_members_permissions before insert or update of permissions on public.staff_members
  for each row execute function private.check_staff_permissions();
create trigger staff_role_templates_permissions before insert or update of permissions on public.staff_role_templates
  for each row execute function private.check_staff_permissions();

-- the last active owner can never be removed or demoted
create or replace function private.keep_one_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active)) then
    if not exists (
      select 1 from public.staff_members s
      where s.role = 'owner' and s.active and s.user_id <> old.user_id
    ) then
      raise exception 'the last owner cannot be removed or demoted' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger staff_members_keep_owner before update or delete on public.staff_members
  for each row execute function private.keep_one_owner();

-- ── one-time links: email confirmation and password reset (hashes only) ──────────────────
create table public.auth_tokens (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_ip text
);
create index auth_tokens_user on public.auth_tokens (user_id, purpose);
create index auth_tokens_expires on public.auth_tokens (expires_at);

-- ── sessions the backend has seen (one per Supabase Auth session) ────────────────────────
create table public.app_sessions (
  id uuid primary key,                 -- the Supabase Auth session id (JWT claim session_id)
  user_id uuid not null references public.profiles (id) on delete cascade,
  remember boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,     -- our own limit: 12 h, or 30 days with "remember me"
  ip text,
  ip_network text,                     -- /24 (IPv4) or /48 (IPv6), for sharing rules
  country text,
  user_agent text check (char_length(user_agent) <= 400),
  device_label text check (char_length(device_label) <= 80),
  device_id_hash text check (device_id_hash ~ '^[0-9a-f]{64}$'),
  is_staff boolean not null default false,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('logout', 'password_reset', 'account_blocked', 'staff', 'expired', 'replaced')),
  blocked_at timestamptz,
  blocked_by uuid references auth.users (id) on delete set null,
  block_reason text check (char_length(block_reason) <= 300)
);
create index app_sessions_user on public.app_sessions (user_id, last_seen_at desc);
create index app_sessions_live on public.app_sessions (user_id) where revoked_at is null;

-- Ends Supabase Auth sessions (their refresh tokens stop working at once; access tokens are
-- refused by the API because the matching app_sessions row is revoked too).
create or replace function private.end_auth_sessions(p_user uuid, p_keep uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v integer;
begin
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics v = row_count;
  return v;
end;
$$;
revoke all on function private.end_auth_sessions(uuid, uuid) from public;

-- ── sign-in attempts and the security trail ──────────────────────────────────────────────
create table public.login_activity (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  email extensions.citext not null,
  success boolean not null,
  failure_reason text check (failure_reason in (
    'bad_credentials', 'email_unverified', 'account_locked', 'account_blocked',
    'agreement_required', 'rate_limited', 'staff_only', 'auth_unavailable')),
  ip text,
  user_agent text,
  session_id uuid,
  created_at timestamptz not null default now(),
  constraint login_activity_reason check (success = (failure_reason is null))
);
create index login_activity_user on public.login_activity (user_id, created_at desc);
create index login_activity_at on public.login_activity (created_at desc);

create table public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z_.]{2,60}$'),
  detail jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index security_events_user on public.security_events (user_id, created_at desc);
create index security_events_at on public.security_events (created_at desc);
