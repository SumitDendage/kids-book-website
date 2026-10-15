-- Learn With Why on Supabase · 7/10 · row-level security and grants
--
-- The website talks only to the "api" Edge Function. The browser roles (anon, authenticated)
-- get no direct access except the read-only rows below, so even if someone calls the Data API
-- with the public key they can read the public catalogue and, when signed in, their own rows.
-- The API role lww_api gets exactly the table rights it needs.

-- 1. Row security on every table in public (deny by default)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('revoke all on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
revoke all on public.subscriptions from anon, authenticated;

-- 2. The API role
grant select, insert, update, delete on all tables in schema public to lww_api;
grant usage, select on all sequences in schema public to lww_api;
-- logs and records that are only ever added to
revoke update, delete on public.audit_logs from lww_api;
revoke update, delete on public.agreement_acceptances from lww_api;
revoke delete on public.payments, public.payment_events, public.login_activity,
  public.security_events, public.access_log, public.orders, public.order_items,
  public.account_warnings, public.security_incidents from lww_api;
grant select, insert, update, delete on private.rate_limits, private.job_marks to lww_api;
grant execute on function
  private.fulfil_order(text, text, text, bigint, text, text, jsonb),
  private.refund_order(text, uuid, text),
  private.consume_delivery(bigint, text, integer),
  private.rate_limit_hit(text, integer, integer),
  private.active_warning_count(uuid),
  private.end_auth_sessions(uuid, uuid),
  private.sha256_hex(text)
to lww_api;

-- 3. Is the signed-in caller's session still allowed? (used by the policies below)
create or replace function private.jwt_session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- the token must belong to a sign-in the API opened (sessions made by calling Supabase Auth
  -- directly have no app_sessions row) that is still open, and to an active, unblocked account
  select exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.blocked_at is null and p.status = 'active')
    and exists (
      select 1 from public.app_sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and s.revoked_at is null and s.blocked_at is null and s.expires_at > now())
$$;
revoke all on function private.jwt_session_ok() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.jwt_session_ok() to authenticated;

-- 4. Public, read-only catalogue data
grant select on public.classes to anon, authenticated;
create policy classes_public_read on public.classes for select to anon, authenticated
  using (status <> 'hidden');

grant select on public.plans to anon, authenticated;
create policy plans_public_read on public.plans for select to anon, authenticated
  using (active);

grant select (id, title, description, class_id, subject, group_id, section, section_label, pages,
  price_inr, was_price_inr, status, thumb_url, cover_path, audience, rating, rating_count,
  review_avg, review_count, landscape, tags, sort)
  on public.products to anon, authenticated;
create policy products_public_read on public.products for select to anon, authenticated
  using (status = 'active');

grant select (id, question, answer, keywords, sort) on public.faq_entries to anon, authenticated;
create policy faq_public_read on public.faq_entries for select to anon, authenticated
  using (audience = 'public' and status = 'published');

grant select (key, value) on public.site_content to anon, authenticated;
create policy site_content_public_read on public.site_content for select to anon, authenticated
  using (published);

grant select (id, product_id, rating, title, body, created_at) on public.reviews to anon, authenticated;
create policy reviews_public_read on public.reviews for select to anon, authenticated
  using (status = 'published');

-- 5. A signed-in customer's own rows (read-only; every change goes through the API)
grant select (id, email, name, role, status, email_verified_at, created_at, last_login_at,
  subscription_suspended_at) on public.profiles to authenticated;
create policy profiles_own_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) and (select private.jwt_session_ok()));

grant select (id, user_id, scope, product_id, class_id, plan_id, kind, order_id, purchased_at, starts_at,
  expires_at, revoked_at) on public.entitlements to authenticated;
create policy entitlements_own_read on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()) and (select private.jwt_session_ok()));

grant select (id, user_id, kind, status, currency, total, total_inr, lines, coupon_code, method,
  created_at, paid_at) on public.orders to authenticated;
create policy orders_own_read on public.orders for select to authenticated
  using (user_id = (select auth.uid()) and (select private.jwt_session_ok()));

grant select on public.order_items to authenticated;
create policy order_items_own_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
         and (select private.jwt_session_ok()));

grant select on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated
  using (audience = 'customer' and user_id = (select auth.uid()) and (select private.jwt_session_ok()));

grant select (id, user_id, level, reason, issued_at, expires_at, acknowledged_at, revoked_at)
  on public.account_warnings to authenticated;
create policy warnings_own_read on public.account_warnings for select to authenticated
  using (user_id = (select auth.uid()) and (select private.jwt_session_ok()));

-- 6. Everything else (staff, logs, payments, outbox, sessions, tokens, settings, coupons,
--    quotes, analytics, audit) has row security on and no grants for anon/authenticated,
--    so the Data API returns nothing for them.

-- 7. First owner: after creating your own user in the Supabase dashboard (Authentication →
--    Users → Add user, with "Auto Confirm User"), run once in the SQL editor:
--      select private.make_owner('you@example.com');
create or replace function private.make_owner(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.profiles where email = lower(p_email);
  if v_id is null then
    raise exception 'No account with email % — add the user in Authentication → Users first', p_email;
  end if;
  update public.profiles
  set status = 'active', email_verified_at = coalesce(email_verified_at, now()), created_via = 'staff'
  where id = v_id;
  insert into public.staff_members (user_id, role, permissions, note)
  values (v_id, 'owner', '{}', 'first owner')
  on conflict (user_id) do update set role = 'owner', active = true;
  insert into public.audit_logs (actor_email, actor_role, action, target_type, target_id, detail)
  values ('sql editor', 'system', 'staff.owner_created', 'profile', v_id::text, jsonb_build_object('email', lower(p_email)));
  return 'owner: ' || lower(p_email);
end;
$$;
revoke all on function private.make_owner(text) from public;
