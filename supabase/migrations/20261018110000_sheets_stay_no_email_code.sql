-- Learn With Why · bought sheets stay for good, and sign-up has no email code (Sumit, Oct 18:
-- "remove it completely"; he chose "OTP and 24-hour" on the decision card).
--  1. fulfil_order: a sheet bought on its own gets no end date (expires_at null means open for
--     good, and every check already reads it that way). The entitlements_expiry rule, which only
--     let free sheets go without an end, now lets bought sheets too. Class plans keep their months.
--  2. Sheets bought before stay too: their end date is cleared, also where the 24 hours ran out.
--  3. Accounts made while the email code was on, whose code was never typed, are confirmed, so
--     they sign in with their password (the 20261016180000 trigger marks their profiles too).
--  4. The FAQ answer and the old setting's note say a bought sheet is yours to keep.
-- No data is dropped or deleted.

alter table public.entitlements
  drop constraint entitlements_expiry,
  add constraint entitlements_expiry check (kind = 'free' or (kind = 'paid' and scope = 'worksheet') or expires_at is not null);

create or replace function private.fulfil_order(
  p_order_id text,
  p_provider text,
  p_payment_id text,
  p_amount_minor bigint,
  p_currency text,
  p_source text,
  p_raw jsonb default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  o public.orders;
  it public.order_items;
  c public.coupons;
  v_start timestamptz;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_now timestamptz := now();
  v_total integer;
  v_mine integer;
  v_over text;
  v_out jsonb;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'unknown_order');
  end if;
  if o.method <> p_provider then
    return jsonb_build_object('status', 'rejected', 'reason', 'method_mismatch');
  end if;
  if p_amount_minor is distinct from o.amount_minor or upper(p_currency) is distinct from o.currency then
    return jsonb_build_object('status', 'rejected', 'reason', 'amount_mismatch',
      'expected', jsonb_build_object('amount_minor', o.amount_minor, 'currency', o.currency));
  end if;
  -- the gateway already said this payment went back (its refund can arrive before its capture)
  if exists (select 1 from public.gateway_refunds r where r.provider = p_provider and r.payment_id = p_payment_id) then
    return jsonb_build_object('status', 'rejected', 'reason', 'payment_refunded');
  end if;
  if o.status = 'refunded' then
    return jsonb_build_object('status', 'rejected', 'reason', 'refunded');
  end if;

  insert into public.payments (order_id, provider, provider_payment_id, amount_minor, currency, status, source, raw)
  values (o.id, p_provider, p_payment_id, p_amount_minor, upper(p_currency), 'captured', p_source, p_raw)
  on conflict (provider, provider_payment_id) do nothing;

  if o.status = 'paid' then
    select coalesce(array_agg(e.id order by e.id), '{}') into v_ids from public.entitlements e where e.order_id = o.id;
    return jsonb_build_object('status', 'already_paid', 'entitlements', to_jsonb(v_ids),
      'duplicate_payment', o.gateway_payment_id is distinct from p_payment_id);
  end if;

  -- one grant at a time per customer: a second order settled at the same moment waits here and
  -- then sees this one's access, so class plans chain instead of running over the same months
  perform pg_advisory_xact_lock(hashtextextended('lww-grant:' || o.user_id::text, 0));

  -- created, failed, cancelled or expired: the money arrived, so the customer gets access
  update public.orders
  set status = 'paid', paid_at = v_now, gateway_payment_id = p_payment_id, failure_reason = null
  where id = o.id;

  for it in select * from public.order_items where order_id = o.id order by id loop
    if it.kind = 'worksheet' then
      -- a sheet bought on its own stays on the account for good: no end date
      insert into public.entitlements (user_id, scope, product_id, kind, order_id, order_item_id, purchased_at, starts_at, expires_at)
      values (o.user_id, 'worksheet', it.product_id, 'paid', o.id, it.id, v_now, v_now, null)
      on conflict (order_item_id) do nothing
      returning id into v_id;
      update public.products set stock = greatest(stock - 1, 0) where id = it.product_id and stock is not null;
    else
      -- a new plan starts when the customer's running plans for that class end
      select greatest(v_now, coalesce(max(e.expires_at), v_now)) into v_start
      from public.entitlements e
      where e.user_id = o.user_id and e.scope = 'class' and e.class_id = it.class_id
        and e.revoked_at is null and e.expires_at > v_now;
      insert into public.entitlements (user_id, scope, class_id, plan_id, kind, order_id, order_item_id, purchased_at, starts_at, expires_at)
      values (o.user_id, 'class', it.class_id, it.plan_id, 'paid', o.id, it.id, v_now, v_start, v_start + make_interval(months => it.months))
      on conflict (order_item_id) do nothing
      returning id into v_id;
    end if;
    if v_id is not null then v_ids := v_ids || v_id; end if;
    v_id := null;
  end loop;

  -- the coupon is redeemed here, under its row lock, within its limits. A payment for an order
  -- whose code ran out meanwhile (paid after it was cancelled or expired) still opens access,
  -- because the money arrived, but it is not counted as another redemption: the caller tells staff.
  if o.coupon_code is not null then
    select * into c from public.coupons where code = o.coupon_code for update;
    if found then
      select count(*)::int, (count(*) filter (where r.user_id = o.user_id))::int into v_total, v_mine
      from public.coupon_redemptions r where r.coupon_code = c.code and r.order_id <> o.id;
      if c.max_uses > 0 and v_total >= c.max_uses then
        v_over := 'max_uses';
      elsif c.per_user_limit > 0 and v_mine >= c.per_user_limit then
        v_over := 'per_user_limit';
      else
        insert into public.coupon_redemptions (coupon_code, order_id, user_id, discount_inr)
        values (o.coupon_code, o.id, o.user_id, o.discount_inr)
        on conflict (order_id) do nothing;
      end if;
    end if;
  end if;

  v_out := jsonb_build_object('status', 'paid', 'entitlements', to_jsonb(v_ids), 'previous_status', o.status);
  if v_over is not null then
    v_out := v_out || jsonb_build_object('coupon_over_limit', v_over, 'coupon', o.coupon_code::text,
      'coupon_limit', case when v_over = 'max_uses' then c.max_uses else c.per_user_limit end);
  end if;
  return v_out;
end;
$$;

update public.entitlements
set expires_at = null
where scope = 'worksheet' and kind = 'paid' and revoked_at is null and expires_at is not null;

do $$
begin
  update auth.users
  set email_confirmed_at = now()
  where email_confirmed_at is null and deleted_at is null and coalesce(is_anonymous, false) = false;
exception when insufficient_privilege then
  raise warning 'could not confirm waiting accounts: %', sqlerrm;
end;
$$;

update public.settings
set description = 'Not used any more: a bought sheet stays on the account for good (a class plan lasts its own number of months).'
where key = 'worksheet_access';

update public.faq_entries
set answer = 'A sheet you buy stays on your account for good. Open it from My Account → My Worksheets as often as you like. A class plan opens its sheets for as long as the plan runs.'
where question = 'How long can I open a sheet I bought?';
