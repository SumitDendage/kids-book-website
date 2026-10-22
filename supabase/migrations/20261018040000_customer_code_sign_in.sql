-- Customers sign up and sign in with a 6-digit code emailed by Supabase Auth; the password
-- sign-in is for staff only and records a customer's attempt as 'otp_required'.
alter table public.login_activity drop constraint if exists login_activity_failure_reason_check;
alter table public.login_activity add constraint login_activity_failure_reason_check check (failure_reason in (
  'bad_credentials', 'email_unverified', 'account_locked', 'account_blocked',
  'agreement_required', 'rate_limited', 'staff_only', 'auth_unavailable', 'otp_required'));
