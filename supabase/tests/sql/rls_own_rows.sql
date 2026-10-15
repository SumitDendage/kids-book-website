-- Local only (needs to create auth users): a signed-in customer reads only their own rows, and
-- only while the API session behind the token is open. Rolled back at the end.
begin;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@example.com', now(), '{"name":"A"}'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@example.com', now(), '{"name":"B"}');
update public.profiles set status = 'active', email_verified_at = now()
  where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
insert into public.app_sessions (id, user_id, expires_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', now() + interval '1 hour');
insert into public.entitlements (user_id, scope, product_id, kind, starts_at, expires_at)
select u, 'worksheet', 'az-A', 'grant', now(), now() + interval '30 days'
from unnest(array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.notifications (audience, user_id, kind, title) values
  ('customer', '00000000-0000-4000-8000-00000000000a', 'test', 'for A'),
  ('customer', '00000000-0000-4000-8000-00000000000b', 'test', 'for B'),
  ('staff', null, 'test', 'for staff');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000a","session_id":"00000000-0000-4000-8000-0000000000a1"}', true);
do $$
begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'A should see exactly one profile'; end if;
  if (select email from public.profiles) <> 'rls-a@example.com' then raise exception 'A sees the wrong profile'; end if;
  if (select count(*) from public.entitlements) <> 1 then raise exception 'A should see exactly one entitlement'; end if;
  if (select count(*) from public.notifications) <> 1 then raise exception 'A should see exactly one notification'; end if;
end $$;

-- the same token after staff block that session: nothing
reset role;
update public.app_sessions set blocked_at = now() where id = '00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$
begin
  if (select count(*) from public.entitlements) <> 0 then raise exception 'blocked session still reads entitlements'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'blocked session still reads the profile'; end if;
end $$;

-- a session the API never opened (signed in to Supabase Auth directly): nothing
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000b","session_id":"00000000-0000-4000-8000-0000000000ff"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.entitlements) <> 0 then raise exception 'unknown session reads entitlements'; end if;
end $$;

-- B's real session, but the account is blocked: nothing
reset role;
update public.profiles set blocked_at = now(), blocked_reason = 'test' where id = '00000000-0000-4000-8000-00000000000b';
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000b","session_id":"00000000-0000-4000-8000-0000000000b1"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.entitlements) <> 0 then raise exception 'blocked account reads entitlements'; end if;
end $$;

reset role;
select 'rls_own_rows ok' as result;
rollback;
