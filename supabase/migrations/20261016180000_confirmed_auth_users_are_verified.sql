-- Sign-up without our own email service (Sumit, Oct 16: "forget the brevo"): the website now
-- creates accounts with Supabase Auth directly (supabase.auth.signUp, customer picks a password).
-- Supabase Auth decides whether the address is confirmed (its "Confirm email" switch). Whenever it
-- marks a user confirmed, the profile follows, so /api/auth/login lets that customer in.
-- No DROP or DELETE: create-or-replace and a new trigger only.

create or replace function private.on_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    update public.profiles
    set email_verified_at = coalesce(email_verified_at, new.email_confirmed_at),
        status = 'active'
    where id = new.id and (email_verified_at is null or status <> 'active');
  end if;
  return new;
end;
$$;
revoke all on function private.on_auth_user_confirmed() from public;

-- runs after lww_on_auth_user_created (triggers fire in name order), so the profile exists
create trigger lww_on_auth_user_inserted_confirmed after insert on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function private.on_auth_user_confirmed();
create trigger lww_on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.on_auth_user_confirmed();
