-- Learn With Why on Supabase · review fixes (October 2026)
--
-- Fixes found in the security review, each with a regression test in tests/api. Additive and safe
-- to run again: new tables, columns, indexes and constraints are created only when missing, and
-- functions are replaced with "create or replace" (same names and arguments, so every grant stays).
--
--  1. A sign-in never lasts more than 90 days (SECURITY.md), whatever the settings row says.
--  2. A refund the gateway reports is remembered by payment id, so a capture that arrives later
--     (out of order) never opens access, and refunding a duplicate payment leaves the order and the
--     access its own payment bought alone (private.gateway_refund).
--  3. private.fulfil_order: refuses a refunded payment, serialises grants for one customer (two
--     class plans paid together chain instead of overlapping) and checks the coupon's limits where
--     the code is actually redeemed.
--  4. Print and download allowances are counted per access record AND per sheet, so a class plan
--     gives every sheet its own allowance (public.delivery_counts, private.consume_sheet_delivery).
--  5. Page pictures: a sheet's own numbered pictures win over a single <base>.jpg, and staff
--     uploads (uploads/...) are only ever found by their numbered names, so sheet "x-2" can never
--     show page 2 of sheet "x".
--  6. An index for "every access record of one customer" (My Account, staff lists, exports).
--  7. The sharing-rule descriptions say what the rules count.

-- ── 1. the 90-day sign-in cap ───────────────────────────────────────────────────────────────

update public.settings
set value = value
  || jsonb_build_object('maxDays', least(coalesce((value ->> 'maxDays')::numeric, 90), 90)::int)
  || jsonb_build_object('rememberDays', least(coalesce((value ->> 'rememberDays')::numeric, 30), 90)::int)
where key = 'sessions'
  and (coalesce((value ->> 'maxDays')::numeric, 0) > 90 or coalesce((value ->> 'rememberDays')::numeric, 0) > 90);

update public.app_sessions
set expires_at = created_at + interval '90 days'
where expires_at > created_at + interval '90 days';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'app_sessions_at_most_90_days' and conrelid = 'public.app_sessions'::regclass) then
    alter table public.app_sessions
      add constraint app_sessions_at_most_90_days check (expires_at <= created_at + interval '90 days');
  end if;
end $$;

-- ── 2. refunds reported by a gateway ────────────────────────────────────────────────────────

-- One row per gateway payment that was refunded in full, whether or not we had seen it captured.
create table if not exists public.gateway_refunds (
  provider text not null check (provider in ('razorpay', 'stripe', 'paypal')),
  payment_id text not null check (char_length(payment_id) between 1 and 255),
  refund_id text check (char_length(refund_id) <= 255),
  order_id text,
  amount_minor bigint,
  currency text,
  recorded_at timestamptz not null default now(),
  primary key (provider, payment_id)
);
create index if not exists gateway_refunds_order on public.gateway_refunds (order_id);
alter table public.gateway_refunds enable row level security;
revoke all on public.gateway_refunds from anon, authenticated;
grant select, insert on public.gateway_refunds to lww_api;

-- A full refund of one gateway payment (webhook). Remembers the payment as refunded, then:
--  * the payment that paid the order → the order is refunded and the access it bought ends;
--  * another payment of the order (a duplicate), or one whose capture has not arrived yet →
--    only that payment is marked; the order and its access stay as they are.
-- fulfil_order refuses any payment recorded here, so a capture that arrives after its refund
-- never opens access.
create or replace function private.gateway_refund(
  p_provider text,
  p_payment_id text,
  p_order_id text,
  p_refund_id text,
  p_amount_minor bigint,
  p_currency text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  o public.orders;
  v_count integer;
  v_known boolean;
begin
  if p_payment_id is null or p_payment_id = '' then
    return jsonb_build_object('status', 'rejected', 'reason', 'no_payment');
  end if;
  -- the order row first, as in fulfil_order: a capture being settled right now either finishes
  -- before this refund or sees it
  if p_order_id is not null then
    select * into o from public.orders where id = p_order_id for update;
  end if;
  insert into public.gateway_refunds (provider, payment_id, refund_id, order_id, amount_minor, currency)
  values (p_provider, p_payment_id, left(p_refund_id, 255), case when o.method = p_provider then o.id end,
          p_amount_minor, upper(p_currency))
  on conflict (provider, payment_id) do nothing;
  if o.id is null then
    return jsonb_build_object('status', 'recorded', 'reason', 'unknown_order');
  end if;
  if o.method <> p_provider then
    return jsonb_build_object('status', 'rejected', 'reason', 'method_mismatch');
  end if;

  update public.payments set status = 'refunded'
  where order_id = o.id and provider = p_provider and provider_payment_id = p_payment_id;
  v_known := found;

  if o.status = 'paid' and (o.gateway_payment_id is null or o.gateway_payment_id = p_payment_id) then
    update public.orders set status = 'refunded', refunded_at = now(), refunded_by = null where id = o.id;
    update public.entitlements
    set revoked_at = now(), revoked_by = null, revoke_reason = left(coalesce(p_reason, 'refunded'), 200)
    where order_id = o.id and revoked_at is null;
    get diagnostics v_count = row_count;
    return jsonb_build_object('status', 'refunded', 'revoked', v_count);
  end if;
  if o.status = 'refunded' and (o.gateway_payment_id is null or o.gateway_payment_id = p_payment_id) then
    return jsonb_build_object('status', 'already_refunded');
  end if;
  return jsonb_build_object('status', 'payment_refunded', 'order_status', o.status, 'known_payment', v_known);
end;
$$;
revoke all on function private.gateway_refund(text, text, text, text, bigint, text, text) from public;
grant execute on function private.gateway_refund(text, text, text, text, bigint, text, text) to lww_api;

-- ── 3. the one place an order becomes paid ──────────────────────────────────────────────────

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
      values (o.user_id, 'worksheet', it.product_id, 'paid', o.id, it.id, v_now, v_now, v_now + make_interval(days => it.access_days))
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

-- ── 4. print and download copies per sheet ──────────────────────────────────────────────────

-- delivery_counters counted one allowance per access record, so every sheet of a class plan
-- shared it. This table counts per access record and sheet. (delivery_counters is kept as it was.)
create table if not exists public.delivery_counts (
  entitlement_id bigint not null,
  product_id text not null check (char_length(product_id) between 1 and 64),
  kind text not null check (kind in ('print', 'download')),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (entitlement_id, product_id, kind)
);
alter table public.delivery_counts enable row level security;
revoke all on public.delivery_counts from anon, authenticated;
grant select, insert, update on public.delivery_counts to lww_api;

-- copies already handed out: a single sheet's record keeps its count; a class plan's shared count
-- is split by the sheets the access log shows were printed or downloaded
insert into public.delivery_counts (entitlement_id, product_id, kind, used, updated_at)
select d.entitlement_id, e.product_id, d.kind, d.used, d.updated_at
from public.delivery_counters d
join public.entitlements e on e.id = d.entitlement_id
where e.scope = 'worksheet' and e.product_id is not null
on conflict (entitlement_id, product_id, kind) do nothing;

insert into public.delivery_counts (entitlement_id, product_id, kind, used, updated_at)
select a.entitlement_id, a.product_id, a.action, count(*)::int, max(a.at)
from public.access_log a
join public.entitlements e on e.id = a.entitlement_id
where e.scope = 'class' and a.ok and a.action in ('print', 'download') and a.product_id is not null
group by a.entitlement_id, a.product_id, a.action
on conflict (entitlement_id, product_id, kind) do nothing;

-- Takes one copy of this sheet if any are left. Returns how many remain after this one, or -1.
create or replace function private.consume_sheet_delivery(p_entitlement_id bigint, p_product_id text, p_kind text, p_limit integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_used integer;
begin
  if p_limit is null or p_limit <= 0 then return -1; end if;
  insert into public.delivery_counts (entitlement_id, product_id, kind, used)
  values (p_entitlement_id, p_product_id, p_kind, 0)
  on conflict (entitlement_id, product_id, kind) do nothing;
  update public.delivery_counts
  set used = used + 1, updated_at = now()
  where entitlement_id = p_entitlement_id and product_id = p_product_id and kind = p_kind and used < p_limit
  returning used into v_used;
  if v_used is null then return -1; end if;
  return p_limit - v_used;
end;
$$;
revoke all on function private.consume_sheet_delivery(bigint, text, text, integer) from public;
grant execute on function private.consume_sheet_delivery(bigint, text, text, integer) to lww_api;

-- ── 5. page pictures ────────────────────────────────────────────────────────────────────────

-- Page pictures for one sheet, in page order: its numbered pictures <base>-1.jpg, <base>-2.jpg …
-- when it has any; otherwise a single <base>.jpg|png|webp (the one-page sheets imported from the
-- old site). Staff uploads (uploads/<sheet id>) are always numbered, so for them the single name is
-- never used: "uploads/x-2.jpg" is page 2 of sheet "x", never the picture of sheet "x-2".
create or replace function private.worksheet_page_images(p_base text)
returns table (name text, page integer)
language sql
stable
security definer
set search_path = ''
as $$
  with many as (
    select o.name, split_part(substring(o.name from char_length(p_base) + 2), '.', 1)::int as page
    from storage.objects o
    where o.bucket_id = 'worksheets'
      and left(o.name, char_length(p_base) + 1) = p_base || '-'
      and substring(o.name from char_length(p_base) + 2) ~ '^[0-9]{1,3}\.(jpg|png|webp)$'
  ), single as (
    select o.name from storage.objects o
    where o.bucket_id = 'worksheets' and o.name in (p_base || '.jpg', p_base || '.png', p_base || '.webp')
      and left(p_base, 8) <> 'uploads/'
    order by o.name limit 1
  )
  select m.name, m.page from many m
  union all
  select s.name, 1 from single s where not exists (select 1 from many)
  order by 2
$$;

-- ── 6. every access record of one customer ──────────────────────────────────────────────────

create index if not exists entitlements_user on public.entitlements (user_id, starts_at desc, id desc);

-- ── 7. what the sharing rules count ─────────────────────────────────────────────────────────

update public.security_rules set description =
  'The same account opens paid sheets from several devices on different networks within a short time (at least the set number of each). One new device or a changed IP address is never enough on its own.'
where id = 'concurrent_devices';
update public.security_rules set description =
  'The account is used (signed in or sheets opened) on more distinct devices in one day than the set number. Each sign-in counts as one device.'
where id = 'many_devices_day';
update public.security_rules set description =
  'Paid sheets are opened from more different countries within one day than the set number.'
where id = 'many_countries_day';
update public.security_rules set description =
  'More viewer requests in an hour than the set number, far more than a person reading sheets would make (possible copying).'
where id = 'rapid_page_requests';
