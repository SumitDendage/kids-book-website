-- Learn With Why · bought sheets open for a number of HOURS (Sumit, Oct 17: "you can access for
-- certain hours, there is a timer, then it is removed from the user account").
--  1. order_items.access_hours: how long each bought sheet opens (access_days stays, rounded up,
--     for older readers and the existing check).
--  2. fulfil_order counts the hours when a line has them (older lines keep their days).
--  3. the shop-wide setting starts at 24 hours; staff change it in Admin → Settings.
--  4. the FAQ answer says the sheet is removed when its time is up.

alter table public.order_items
  add column if not exists access_hours integer check (access_hours between 1 and 87600);

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
      insert into public.entitlements (user_id, scope, product_id, kind, order_id, order_item_id, purchased_at, starts_at, expires_at)
      values (o.user_id, 'worksheet', it.product_id, 'paid', o.id, it.id, v_now, v_now, v_now + coalesce(make_interval(hours => it.access_hours), make_interval(days => it.access_days)))
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

insert into public.settings (key, value, description)
values ('worksheet_access', '{"days":1,"hours":24}'::jsonb, 'How long a bought sheet stays open, in hours (a class plan lasts its own number of months).')
on conflict (key) do update
set value = '{"days":1,"hours":24}'::jsonb,
    description = 'How long a bought sheet stays open, in hours (a class plan lasts its own number of months).';

update public.faq_entries
set answer = 'Each sheet you buy stays open for {accessDays} days, counted from your verified payment. My Account → My Worksheets shows the time left. When the time is up, the sheet is removed from your account, and you can buy it again from the shop.'
where question = 'How long can I open a sheet I bought?';
