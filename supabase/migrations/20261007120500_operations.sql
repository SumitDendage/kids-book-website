-- Learn With Why on Supabase · 6/10 · contact inbox, notifications, email outbox, analytics,
-- audit log and rate limits

create table public.contact_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  email extensions.citext not null check (char_length(email::text) <= 200),
  body text not null check (char_length(body) between 10 and 5000),
  user_id uuid references public.profiles (id) on delete set null,
  ip text,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
  read_at timestamptz,
  read_by uuid references auth.users (id) on delete set null,
  replied_at timestamptz,
  replied_by uuid references auth.users (id) on delete set null,
  mailed boolean not null default false,
  mail_error text,
  outbox_id bigint
);
create index contact_messages_created on public.contact_messages (created_at desc);
create index contact_messages_status on public.contact_messages (status, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  audience text not null check (audience in ('customer', 'staff')),
  user_id uuid references public.profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_.]{2,60}$'),
  title text not null check (char_length(title) <= 160),
  body text check (char_length(body) <= 2000),
  link text check (char_length(link) <= 300),
  data jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_target check (audience = 'staff' or user_id is not null)
);
create index notifications_user on public.notifications (user_id, created_at desc) where audience = 'customer';
create index notifications_staff on public.notifications (created_at desc) where audience = 'staff';

-- Emails are written here first, then sent; failures are retried with back-off.
-- Emails that carry a password or a one-time link are "sensitive": their text is never stored,
-- only who/when/status, so they are sent once and cannot be re-sent from the outbox.
create table public.email_outbox (
  id bigint generated always as identity primary key,
  template text not null check (template ~ '^[a-z_]{2,40}$'),
  to_email extensions.citext not null,
  to_user_id uuid references public.profiles (id) on delete set null,
  reply_to text,
  subject text not null check (char_length(subject) <= 200),
  body_html text,
  body_text text,
  sensitive boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (char_length(last_error) <= 1000),
  provider text,
  provider_message_id text,
  dedupe_key text unique,
  related_type text,
  related_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_outbox_sensitive_bodies check (not sensitive or (body_html is null and body_text is null))
);
create index email_outbox_due on public.email_outbox (next_attempt_at) where status in ('queued', 'failed');
create index email_outbox_created on public.email_outbox (created_at desc);

-- Visits and shop events. Client events are limited to a fixed list and never count as sales;
-- sign-ups, orders and purchases are recorded by the server itself.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'page_view', 'product_view', 'checkout_start', 'search',
    'signup', 'login', 'order_created', 'purchase', 'viewer_open', 'refund')),
  source text not null check (source in ('client', 'server')),
  visitor_id text check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  user_id uuid references public.profiles (id) on delete set null,
  path text check (char_length(path) <= 200),
  product_id text,
  order_id text,
  value_inr numeric(12, 2),
  country text,
  referrer_host text check (char_length(referrer_host) <= 120),
  device text check (device in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  meta jsonb
);
create index analytics_events_at on public.analytics_events (at desc);
create index analytics_events_kind on public.analytics_events (kind, at desc);

-- Who did what in the staff panels and to accounts. Append-only for everyone.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null check (action ~ '^[a-z_.]{3,80}$'),
  target_type text,
  target_id text,
  ip text,
  detail jsonb
);
create index audit_logs_at on public.audit_logs (at desc);
create index audit_logs_target on public.audit_logs (target_type, target_id, at desc);
create index audit_logs_actor on public.audit_logs (actor_id, at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.forbid_change();

-- Fixed-window counters shared by every copy of the API.
create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- A tiny key/value table for timers the API keeps (for example when the outbox was last swept).
create table private.job_marks (
  name text primary key,
  ran_at timestamptz not null
);
