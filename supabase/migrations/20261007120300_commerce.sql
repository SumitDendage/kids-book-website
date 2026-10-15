-- Learn With Why on Supabase · 4/10 · coupons, quotes, orders, payments and access
-- Access is granted in exactly one place: private.fulfil_order(), called by the API only after
-- a gateway has verified the payment. Staff edits to an order's status never grant access.

create table public.coupons (
  code extensions.citext primary key check (code::text ~ '^[A-Za-z0-9_-]{3,32}$'),
  pct numeric(5, 2) not null check (pct > 0 and pct <= 100),
  max_uses integer not null default 0 check (max_uses >= 0),          -- 0 = no limit
  per_user_limit integer not null default 0 check (per_user_limit >= 0), -- 0 = no limit
  applies_to text not null default 'all' check (applies_to in ('all', 'worksheet', 'class')),
  class_id text references public.classes (id) on update cascade,
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint coupons_window check (valid_until is null or valid_from is null or valid_until > valid_from)
);
create trigger coupons_touch before update on public.coupons
  for each row execute function private.touch_updated_at();

-- A quote is computed and stored by the server; the browser only ever sends back its id.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  kind text not null check (kind in ('worksheet', 'class')),
  product_id text references public.products (id) on update cascade on delete cascade,
  class_id text references public.classes (id) on update cascade,
  plan_id text references public.plans (id) on update cascade,
  coupon_code extensions.citext,
  country text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total numeric(12, 2) not null check (total >= 0),
  total_inr numeric(12, 2) not null check (total_inr >= 0),
  amount_minor bigint not null check (amount_minor >= 0),
  valid boolean not null,
  payload jsonb not null,
  used_at timestamptz,
  used_by_order text
);
create index quotes_expires on public.quotes (expires_at);

create table public.orders (
  id text primary key check (id ~ '^LWO-[A-Z0-9]{6,16}$'),
  user_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('worksheet', 'class')),
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed', 'cancelled', 'refunded', 'expired')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate numeric(14, 6) not null check (rate > 0),
  total numeric(12, 2) not null check (total >= 0),
  total_inr numeric(12, 2) not null check (total_inr >= 0),
  discount_inr numeric(12, 2) not null default 0 check (discount_inr >= 0),
  amount_minor bigint not null check (amount_minor > 0),
  lines jsonb not null,
  coupon_code extensions.citext,
  address jsonb,
  country text,
  method text not null check (method in ('razorpay', 'stripe', 'paypal')),
  gateway_mode text check (gateway_mode in ('live', 'test', 'sandbox')),
  gateway_order_id text,
  gateway_payment_id text,
  quote_id uuid references public.quotes (id) on delete set null,
  failure_reason text check (char_length(failure_reason) <= 500),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  refunded_by uuid references auth.users (id) on delete set null,
  constraint orders_paid_at check ((status in ('paid', 'refunded')) = (paid_at is not null))
);
create unique index orders_gateway_order on public.orders (method, gateway_order_id) where gateway_order_id is not null;
create index orders_user on public.orders (user_id, created_at desc);
create index orders_created on public.orders (created_at desc);
create index orders_status on public.orders (status, created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function private.touch_updated_at();

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('worksheet', 'class')),
  product_id text references public.products (id) on update cascade on delete restrict,
  class_id text references public.classes (id) on update cascade,
  plan_id text references public.plans (id) on update cascade,
  title text not null,
  months integer check (months between 1 and 36),
  access_days integer check (access_days between 1 and 3650),
  unit_price_inr integer not null check (unit_price_inr >= 0),
  discount_inr numeric(12, 2) not null default 0,
  constraint order_items_shape check (
    (kind = 'worksheet' and product_id is not null and access_days is not null and months is null)
    or (kind = 'class' and class_id is not null and plan_id is not null and months is not null and access_days is null))
);
create index order_items_order on public.order_items (order_id);

create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_code extensions.citext not null references public.coupons (code) on update cascade on delete restrict,
  order_id text not null unique references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  discount_inr numeric(12, 2) not null default 0,
  redeemed_at timestamptz not null default now()
);
create index coupon_redemptions_code on public.coupon_redemptions (coupon_code);
create index coupon_redemptions_user on public.coupon_redemptions (user_id, coupon_code);

-- Verified money movements (one row per gateway payment, never duplicated).
create table public.payments (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete restrict,
  provider text not null check (provider in ('razorpay', 'stripe', 'paypal')),
  provider_payment_id text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('captured', 'authorized', 'refunded')),
  source text not null check (char_length(source) <= 60),
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index payments_order on public.payments (order_id);

-- Every gateway call and webhook, kept as a log. Webhook deliveries carry the provider's event
-- id, which is unique, so a repeated delivery is recognised and processed only once.
create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('razorpay', 'stripe', 'paypal')),
  event_id text,
  event_type text not null check (char_length(event_type) <= 80),
  order_id text,
  ok boolean not null,
  status text not null default 'logged' check (status in ('logged', 'received', 'processed', 'ignored', 'failed')),
  signature_ok boolean,
  detail jsonb,
  payload_sha256 text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index payment_events_dedupe on public.payment_events (provider, event_id) where event_id is not null;
create index payment_events_at on public.payment_events (received_at desc);
create index payment_events_order on public.payment_events (order_id);

-- What each customer may open. scope 'worksheet' = one sheet bought (or opened free);
-- scope 'class' = a class plan (the "subscription"). Timestamps are UTC.
create table public.entitlements (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('worksheet', 'class')),
  product_id text references public.products (id) on update cascade on delete restrict,
  class_id text references public.classes (id) on update cascade,
  plan_id text references public.plans (id) on update cascade,
  kind text not null check (kind in ('free', 'paid', 'grant')),
  order_id text references public.orders (id) on delete restrict,
  order_item_id bigint unique references public.order_items (id) on delete restrict,
  purchased_at timestamptz not null default now(),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 200),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint entitlements_shape check (
    (scope = 'worksheet' and product_id is not null and class_id is null)
    or (scope = 'class' and class_id is not null and product_id is null)),
  -- only free passes may be open-ended; everything bought or granted has an end
  constraint entitlements_expiry check (kind = 'free' or expires_at is not null),
  constraint entitlements_range check (expires_at is null or expires_at > starts_at),
  constraint entitlements_paid_order check (kind <> 'paid' or order_id is not null),
  constraint entitlements_free_scope check (kind <> 'free' or scope = 'worksheet')
);
create index entitlements_user_product on public.entitlements (user_id, product_id) where scope = 'worksheet';
create index entitlements_user_class on public.entitlements (user_id, class_id) where scope = 'class';
create index entitlements_expires on public.entitlements (expires_at);
create index entitlements_order on public.entitlements (order_id);
create unique index entitlements_one_free on public.entitlements (user_id, product_id) where kind = 'free' and revoked_at is null;

-- class plans, read as subscriptions
create view public.subscriptions
with (security_invoker = true) as
select
  e.id, e.user_id, e.class_id, e.plan_id, e.order_id, e.kind,
  e.purchased_at, e.starts_at, e.expires_at as ends_at, e.revoked_at,
  case
    when e.revoked_at is not null then 'revoked'
    when now() < e.starts_at then 'scheduled'
    when now() >= e.expires_at then 'expired'
    else 'active'
  end as status
from public.entitlements e
where e.scope = 'class';

-- Server-delivered printable/downloadable copies, counted atomically per purchase.
create table public.delivery_counters (
  entitlement_id bigint not null references public.entitlements (id) on delete cascade,
  kind text not null check (kind in ('print', 'download')),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (entitlement_id, kind)
);

-- Takes one copy if any are left. Returns how many remain after this one, or -1 if none.
create or replace function private.consume_delivery(p_entitlement_id bigint, p_kind text, p_limit integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_used integer;
begin
  if p_limit is null or p_limit <= 0 then return -1; end if;
  insert into public.delivery_counters (entitlement_id, kind, used)
  values (p_entitlement_id, p_kind, 0)
  on conflict (entitlement_id, kind) do nothing;
  update public.delivery_counters
  set used = used + 1, updated_at = now()
  where entitlement_id = p_entitlement_id and kind = p_kind and used < p_limit
  returning used into v_used;
  if v_used is null then return -1; end if;
  return p_limit - v_used;
end;
$$;

-- The one place an order becomes paid and access is granted. Runs inside the caller's
-- transaction. The caller has already verified the payment with the gateway; this function
-- checks it belongs to this order and is for the right amount, then grants access once.
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
  v_start timestamptz;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_now timestamptz := now();
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

  if o.coupon_code is not null and exists (select 1 from public.coupons c where c.code = o.coupon_code) then
    insert into public.coupon_redemptions (coupon_code, order_id, user_id, discount_inr)
    values (o.coupon_code, o.id, o.user_id, o.discount_inr)
    on conflict (order_id) do nothing;
  end if;

  return jsonb_build_object('status', 'paid', 'entitlements', to_jsonb(v_ids), 'previous_status', o.status);
end;
$$;

-- Staff marks an order refunded after refunding it in the gateway: access from it ends now.
create or replace function private.refund_order(p_order_id text, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare o public.orders; v_count integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_order'); end if;
  if o.status <> 'paid' then return jsonb_build_object('status', 'rejected', 'reason', 'not_paid'); end if;
  update public.orders set status = 'refunded', refunded_at = now(), refunded_by = p_actor where id = o.id;
  update public.payments set status = 'refunded' where order_id = o.id;
  update public.entitlements
  set revoked_at = now(), revoked_by = p_actor, revoke_reason = left(coalesce(p_reason, 'refunded'), 200)
  where order_id = o.id and revoked_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'refunded', 'revoked', v_count);
end;
$$;
