
-- Short-lived server-side challenges for email-OTP login.
-- Live since Oct 22 2026 (made by hand on Mumbai then); written with "if not exists" so applying
-- it there again changes nothing.
-- No plaintext OTP or session tokens are stored here.
create table if not exists public.login_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  email extensions.citext not null,
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  encrypted_session text not null,
  remember boolean not null default false,
  is_staff boolean not null default false,
  agreement_version text,
  agreement_text_sha256 text,
  agreement_reaccept boolean not null default false,
  ip text,
  ip_network text,
  country text,
  user_agent text check (char_length(user_agent) <= 400),
  device_label text check (char_length(device_label) <= 80),
  device_id_hash text check (device_id_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  resend_count integer not null default 0 check (resend_count between 0 and 3),
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_otp_challenges_user_created
  on public.login_otp_challenges (user_id, created_at desc);

create index if not exists login_otp_challenges_expiry
  on public.login_otp_challenges (expires_at);

-- Only the server's database role may access challenges.
alter table public.login_otp_challenges enable row level security;
revoke all on public.login_otp_challenges from public, anon, authenticated;
grant select, insert, update, delete
  on public.login_otp_challenges to lww_api;
