-- Learn With Why on Supabase · 5/10 · sharing rules, incidents, warnings, appeals, viewer log
--
-- How sharing is handled (also written up in docs/SECURITY.md):
--  * The API records what it observes: sessions, devices, networks and viewer use.
--  * Configurable rules turn patterns into INCIDENTS. An incident is only a suspicion: a changed
--    IP or one new device never creates one on its own.
--  * An incident becomes a WARNING only when staff confirm it, or automatically when the rule is
--    set to auto-confirm. Each incident can produce at most one warning (unique incident_id).
--  * Warnings 1/3, 2/3 and 3/3 email the customer and notify staff. At 3 active warnings the
--    customer's paid access (single sheets and class plans) is suspended automatically; sign-in,
--    My Account, order history, free sheets and appeals keep working.
--  * Warnings stop counting after settings.security.warningExpiryDays (365 by default), when
--    an appeal is accepted, or when staff reset them. Lifting the suspension is a staff action
--    (or follows automatically when an accepted appeal brings the count below 3).

create table public.security_rules (
  id text primary key check (id ~ '^[a-z_]{3,40}$'),
  name text not null,
  description text not null,
  enabled boolean not null default true,
  auto_confirm boolean not null default false,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  params jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger security_rules_touch before update on public.security_rules
  for each row execute function private.touch_updated_at();

create table public.security_incidents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rule_id text not null references public.security_rules (id) on update cascade,
  status text not null default 'open' check (status in ('open', 'confirmed', 'dismissed')),
  -- one incident per rule, customer and time bucket, however many requests trip it
  dedupe_key text not null unique,
  evidence jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (char_length(decision_note) <= 1000),
  created_at timestamptz not null default now()
);
create index security_incidents_user on public.security_incidents (user_id, created_at desc);
create index security_incidents_open on public.security_incidents (created_at desc) where status = 'open';

create table public.account_warnings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  incident_id bigint unique references public.security_incidents (id) on delete set null,
  level integer not null check (level between 1 and 20),
  reason text not null check (char_length(reason) between 1 and 500),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id) on delete set null,   -- null = issued automatically
  expires_at timestamptz,
  acknowledged_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 300)
);
create index account_warnings_user on public.account_warnings (user_id, issued_at desc);

create table public.account_appeals (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  warning_id bigint references public.account_warnings (id) on delete set null,
  kind text not null check (kind in ('warning', 'suspension', 'block')),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  staff_response text check (char_length(staff_response) <= 4000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index account_appeals_one_open on public.account_appeals (user_id) where status = 'open';
create index account_appeals_status on public.account_appeals (status, created_at desc);

-- Every viewer and access request, allowed or refused.
create table public.access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null,
  product_id text,
  entitlement_id bigint,
  session_id uuid,
  action text not null check (action in ('access', 'meta', 'pdf', 'page', 'print', 'download', 'view')),
  ok boolean not null,
  detail text check (char_length(detail) <= 300),
  ip text,
  ip_network text,
  device_id_hash text,
  country text
);
create index access_log_user on public.access_log (user_id, at desc);
create index access_log_at on public.access_log (at desc);

-- Active warnings for one customer (used by the API and the staff screens).
create or replace function private.active_warning_count(p_user uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.account_warnings w
  where w.user_id = p_user and w.revoked_at is null and (w.expires_at is null or w.expires_at > now())
$$;
