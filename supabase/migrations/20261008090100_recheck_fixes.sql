-- Learn With Why on Supabase · re-check fixes (October 2026)
--
-- Follow-up to 20261008090000_review_fixes.sql, with a regression test in tests/api. Additive and
-- safe to run again: the function is replaced with "create or replace" (same name and arguments,
-- so every grant stays).
--
--  1. An order paid twice (two captured payments of the full amount on one gateway order) stays
--     paid when the payment it was booked with is refunded while the other one is still captured:
--     the order is booked against the surviving payment and the access it pays for stays open
--     (private.gateway_refund).

-- ── 1. refunding the booked payment of a twice-paid order ──────────────────────────────────

-- A full refund of one gateway payment (webhook). Remembers the payment as refunded, then:
--  * the payment that paid the order, and no other captured payment of the full amount is left
--    on the order → the order is refunded and the access it bought ends;
--  * the payment that paid the order, while another captured payment of the full amount (a
--    duplicate) still pays for it → that payment is marked refunded, the order is booked against
--    the surviving payment and stays paid, and its access is unchanged ('payment_refunded' with
--    'now_paid_by');
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
  v_other text;
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
    -- the order was paid twice: if another payment of the full amount is still captured (and was
    -- never reported refunded), it pays for the order now; the order and its access stay
    select p.provider_payment_id into v_other
    from public.payments p
    where p.order_id = o.id and p.provider = p_provider and p.status = 'captured'
      and p.provider_payment_id <> p_payment_id
      and p.amount_minor >= o.amount_minor and p.currency = o.currency
      and not exists (select 1 from public.gateway_refunds r
                      where r.provider = p.provider and r.payment_id = p.provider_payment_id)
    order by p.id
    limit 1;
    if v_other is not null then
      update public.orders set gateway_payment_id = v_other where id = o.id;
      return jsonb_build_object('status', 'payment_refunded', 'order_status', o.status, 'known_payment', v_known,
                                'now_paid_by', v_other);
    end if;

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
