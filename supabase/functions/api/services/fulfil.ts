// OWNER: agent C (payments).
// The only way money turns into access. fulfil() calls private.fulfil_order (which locks the order,
// checks the provider, amount and currency, and grants exactly once) and, in the same transaction,
// queues the Purchase Successful email, the notifications, the analytics row and the audit row.
// It is safe to call many times for one payment (verify, webhook and a reload can all arrive):
// only the call that actually marks the order paid sends anything.
import { tx, type Tx } from '../lib/db.ts';
import type { Ctx } from '../lib/context.ts';
import { analytics, notify } from '../lib/guard.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { fmtDateTime, fmtMoney } from '../lib/util.ts';
import { purchaseSuccessful } from './emails.ts';
import type { EntRow } from './entitlements.ts';
import { orderViews } from '../routes/shop.ts';

export type Provider = 'razorpay' | 'stripe' | 'paypal';

export type FulfilResult = {
  status: 'paid' | 'already_paid' | 'rejected';
  reason?: string;
  orderId: string;
  entitlements: number[];
  /** already_paid, but by a different gateway payment: the customer paid twice (staff are told). */
  duplicatePayment?: boolean;
};

export const ORDER_ID_RE = /^LWO-[A-Z0-9]{6,16}$/;
const PROVIDERS: readonly string[] = ['razorpay', 'stripe', 'paypal'];

type FulfilJson = {
  status: 'paid' | 'already_paid' | 'rejected';
  reason?: string;
  entitlements?: number[];
  previous_status?: string;
  duplicate_payment?: boolean;
  expected?: { amount_minor: number; currency: string };
  /** paid, but the order's coupon had reached this limit meanwhile (no redemption was counted) */
  coupon_over_limit?: 'max_uses' | 'per_user_limit';
  coupon?: string;
  coupon_limit?: number;
};

type FulfilInput = {
  orderId: string; provider: Provider; paymentId: string; amountMinor: number; currency: string; source: string;
  raw?: Record<string, unknown> | null;
};

/** The only way access is granted for money: private.fulfil_order + Purchase Successful email,
 *  customer notification, analytics 'purchase' and audit, all in one transaction. Idempotent. */
export async function fulfil(ctx: Ctx | null, o: FulfilInput): Promise<FulfilResult> {
  // callers pass gateway-verified values; anything malformed here is a bug, never a grant
  if (!PROVIDERS.includes(o.provider)) throw new Error('fulfil: unknown provider');
  if (typeof o.paymentId !== 'string' || !/^[A-Za-z0-9_.:-]{3,200}$/.test(o.paymentId)) throw new Error('fulfil: bad payment id');
  if (!Number.isSafeInteger(o.amountMinor) || o.amountMinor < 0) throw new Error('fulfil: bad amount');
  if (typeof o.currency !== 'string' || !/^[A-Za-z]{3}$/.test(o.currency)) throw new Error('fulfil: bad currency');
  const source = String(o.source ?? 'unknown').slice(0, 60);
  const currency = o.currency.toUpperCase();

  if (!ORDER_ID_RE.test(o.orderId)) {
    await tx((q) => rejected(q, ctx, o, source, { status: 'rejected', reason: 'unknown_order' }, null));
    return { status: 'rejected', reason: 'unknown_order', orderId: String(o.orderId).slice(0, 40), entitlements: [] };
  }

  const out = await tx(async (q) => {
    const rows = await q<{ r: FulfilJson }[]>`
      select private.fulfil_order(${o.orderId}, ${o.provider}, ${o.paymentId}, ${o.amountMinor}::bigint, ${currency},
                                  ${source}, ${o.raw ? q.json(o.raw as never) : null}::jsonb) as r`;
    const r = rows[0].r;
    const ids = Array.isArray(r.entitlements) ? r.entitlements.map(Number) : [];
    if (r.status === 'paid') {
      await afterPaid(q, ctx, o, source, ids, r.previous_status ?? null);
      if (r.coupon_over_limit) await couponOverLimit(q, o, r);
      return { status: 'paid', orderId: o.orderId, entitlements: ids } as FulfilResult;
    }
    if (r.status === 'already_paid') {
      if (r.duplicate_payment) await duplicatePayment(q, o, source);
      return { status: 'already_paid', orderId: o.orderId, entitlements: ids, ...(r.duplicate_payment ? { duplicatePayment: true } : {}) } as FulfilResult;
    }
    const owner = await q<{ user_id: string }[]>`select user_id from orders where id = ${o.orderId}`;
    await rejected(q, ctx, o, source, r, owner[0]?.user_id ?? null);
    return { status: 'rejected', reason: r.reason ?? 'rejected', orderId: o.orderId, entitlements: [] } as FulfilResult;
  });
  if (ctx && out.status === 'paid') kickOutbox(ctx);
  return out;
}

type PaidOrder = {
  id: string; user_id: string; total: number; total_inr: number; currency: string; method: string; kind: string;
  email: string; name: string; time_zone: string | null;
};

type PaidLine = { title: string; kind: 'worksheet' | 'class'; product_id: string | null; starts_at: Date; expires_at: Date | null };

async function afterPaid(q: Tx, ctx: Ctx | null, o: FulfilInput, source: string, ids: number[], previousStatus: string | null) {
  const ord = (await q<PaidOrder[]>`
    select o.id, o.user_id, o.total::float8 as total, o.total_inr::float8 as total_inr, o.currency, o.method, o.kind,
           p.email::text as email, p.name, p.time_zone
    from orders o join profiles p on p.id = o.user_id
    where o.id = ${o.orderId}`)[0];
  if (!ord) return;
  // the sheets of this order leave the customer's cart (same transaction as the grant)
  await q`
    delete from cart_items
    where user_id = ${ord.user_id}
      and product_id in (select it.product_id from order_items it where it.order_id = ${ord.id} and it.product_id is not null)`;
  const lines = await q<PaidLine[]>`
    select it.title, it.kind, it.product_id, e.starts_at, e.expires_at
    from order_items it join entitlements e on e.order_item_id = it.id
    where it.order_id = ${o.orderId}
    order by it.id`;
  const total = fmtMoney(ord.total, ord.currency);
  const titles = lines.map((l) => l.title).join(', ');

  // the customer's email: every line with its end date in their time zone (one per order)
  if (lines.length) {
    const mail = purchaseSuccessful({
      name: ord.name || 'there', orderId: ord.id, total, timeZone: ord.time_zone,
      lines: lines.map((l) => ({ title: l.title, kind: l.kind, startsAt: l.starts_at, expiresAt: l.expires_at })),
    });
    await enqueue(q, {
      ...mail, template: 'purchase_successful', to: ord.email, userId: ord.user_id,
      dedupeKey: `purchase:${ord.id}`, relatedType: 'order', relatedId: ord.id,
    });
  }
  await notify(q, {
    audience: 'customer', userId: ord.user_id, kind: 'purchase.success', title: 'Purchase successful',
    body: lines.map((l) => `${l.title}: ${l.expires_at ? 'open until ' + fmtDateTime(l.expires_at, ord.time_zone) : 'yours to keep'}`).join('\n') || `Order ${ord.id} is paid.`,
    link: '/?account=worksheets',
    data: { orderId: ord.id, entitlements: ids },
  });
  await notify(q, {
    audience: 'staff', kind: 'order.paid', title: `Order ${ord.id} paid — ${total}`,
    body: `${ord.email} paid ${total} by ${o.provider}${titles ? ` for ${titles}` : ''}.`,
    data: { orderId: ord.id, userId: ord.user_id, provider: o.provider, totalInr: ord.total_inr },
  });
  // browser details only when the customer's own request settled it (not a gateway webhook)
  const fromCustomer = ctx?.user?.id === ord.user_id ? ctx : null;
  await analytics(q, fromCustomer, {
    kind: 'purchase', userId: ord.user_id, orderId: ord.id, valueInr: ord.total_inr,
    productId: lines.find((l) => l.kind === 'worksheet')?.product_id ?? null,
    meta: { provider: o.provider, source, currency: ord.currency, total: ord.total, kind: ord.kind, items: lines.length },
  });
  await q`
    insert into audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, ip, detail)
    values (null, null, 'system', 'order.paid', 'order', ${ord.id}, ${ctx?.ip ?? null},
            ${q.json({ provider: o.provider, paymentId: o.paymentId, source, amountMinor: o.amountMinor, currency: ord.currency, userId: ord.user_id, entitlements: ids, previousStatus } as never)})`;
}

async function rejected(q: Tx, ctx: Ctx | null, o: FulfilInput, source: string, r: FulfilJson, ownerId: string | null) {
  const reason = r.reason ?? 'rejected';
  const detail = {
    reason, source, paymentId: o.paymentId, amountMinor: o.amountMinor, currency: String(o.currency).toUpperCase(),
    ...(r.expected ? { expected: r.expected } : {}),
  };
  const orderId = ORDER_ID_RE.test(o.orderId) ? o.orderId : null;
  // the same payment refused again (a retried verify or webhook): log it, but alert only once
  const seen = orderId ? (await q`
    select 1 from payment_events
    where order_id = ${orderId} and provider = ${o.provider} and event_type = 'payment.rejected' and detail ->> 'paymentId' = ${o.paymentId}
    limit 1`).length > 0 : false;
  await q`
    insert into payment_events (provider, event_type, order_id, ok, status, detail)
    values (${o.provider}, 'payment.rejected', ${orderId}, false, 'failed', ${q.json({ ...detail, ...(seen ? { repeat: true } : {}) } as never)})`;
  if (seen) return;
  await q`
    insert into security_events (user_id, event_type, detail, ip, user_agent)
    values (${ownerId}, 'payment.rejected', ${q.json({ orderId, ...detail } as never)}, ${ctx?.ip ?? null}, ${ctx?.ua || null})`;
  // money may have moved without access: someone has to look (a payment the gateway already
  // refunded needs nobody)
  if (reason !== 'unknown_order' && reason !== 'payment_refunded') {
    await notify(q, {
      audience: 'staff', kind: 'payment.rejected', title: `Payment not accepted for ${orderId}`,
      body: `${o.provider} payment ${o.paymentId} was not accepted (${reason}). Check it in the gateway dashboard and refund it if money was taken.`,
      data: { orderId, provider: o.provider, ...detail },
    });
  }
}

async function duplicatePayment(q: Tx, o: FulfilInput, source: string) {
  const seen = await q`
    select 1 from payment_events
    where provider = ${o.provider} and event_type = 'payment.duplicate' and order_id = ${o.orderId}
      and detail ->> 'paymentId' = ${o.paymentId}
    limit 1`;
  if (seen.length) return;
  await q`
    insert into payment_events (provider, event_type, order_id, ok, status, detail)
    values (${o.provider}, 'payment.duplicate', ${o.orderId}, false, 'logged',
            ${q.json({ paymentId: o.paymentId, amountMinor: o.amountMinor, currency: o.currency.toUpperCase(), source } as never)})`;
  await notify(q, {
    audience: 'staff', kind: 'payment.duplicate', title: `Order ${o.orderId} was paid twice`,
    body: `A second ${o.provider} payment (${o.paymentId}) arrived for an order that was already paid. Refund it in the gateway dashboard.`,
    data: { orderId: o.orderId, provider: o.provider, paymentId: o.paymentId },
  });
}

/** The order was paid with a coupon that had reached its limit meanwhile (the order was paid after
 *  it was cancelled or expired, and someone else used the code in between). Access stays — the
 *  money arrived — but no redemption was counted, and staff decide what to do. */
async function couponOverLimit(q: Tx, o: FulfilInput, r: FulfilJson) {
  const what = r.coupon_over_limit === 'max_uses' ? `its limit of ${r.coupon_limit} uses` : `its limit of ${r.coupon_limit} per customer`;
  await q`
    insert into payment_events (provider, event_type, order_id, ok, status, detail)
    values (${o.provider}, 'coupon.over_limit', ${o.orderId}, false, 'logged',
            ${q.json({ paymentId: o.paymentId, coupon: r.coupon ?? null, limit: r.coupon_over_limit, max: r.coupon_limit ?? null } as never)})`;
  await notify(q, {
    audience: 'staff', kind: 'coupon.over_limit', title: `Coupon ${r.coupon ?? ''} went over its limit on ${o.orderId}`,
    body: `Order ${o.orderId} was paid with coupon ${r.coupon ?? ''} after the code had reached ${what}. Access was granted because the money arrived; it was not counted as another use. Refund the difference or end the access from the order page if it should not stand.`,
    data: { orderId: o.orderId, coupon: r.coupon ?? null, limit: r.coupon_over_limit, max: r.coupon_limit ?? null, paymentId: o.paymentId },
  });
}

export type RefundResult = {
  /** refunded: the order's own payment went back and its access ended. payment_refunded: another
   *  payment of the order (a duplicate), or one not seen captured yet — only that payment is marked;
   *  or the order was paid twice and the other payment still pays for it (paidBy names it).
   *  recorded: no matching order; the refund is remembered so a later capture opens nothing. */
  status: 'refunded' | 'payment_refunded' | 'already_refunded' | 'recorded' | 'rejected';
  reason?: string;
  orderId: string | null;
  revoked: number;
  /** The payment that pays for the order now, when the refunded one was the payment it was booked with. */
  paidBy?: string;
};

type RefundJson = { status: RefundResult['status']; reason?: string; revoked?: number; order_status?: string; known_payment?: boolean; now_paid_by?: string };

/** A full refund of one gateway payment, reported by the gateway (webhook). private.gateway_refund
 *  remembers the payment as refunded (so a capture that arrives later never opens access) and ends
 *  the order's access only when the refunded payment is the one that paid it and no other captured
 *  payment of the full amount still pays for the order. Audit, analytics and notifications in the
 *  same transaction. */
export async function refundFromGateway(ctx: Ctx | null, o: {
  orderId: string | null; provider: Provider; paymentId: string; refundId: string; source: string; reason?: string;
  amountMinor?: number | null; currency?: string | null;
}): Promise<RefundResult> {
  const orderId = o.orderId && ORDER_ID_RE.test(o.orderId) ? o.orderId : null;
  const paymentId = String(o.paymentId ?? '').slice(0, 255);
  if (!paymentId) return { status: 'rejected', reason: 'no_payment', orderId, revoked: 0 };
  const source = String(o.source).slice(0, 60);
  const amount = Number.isSafeInteger(o.amountMinor) ? o.amountMinor! : null;
  const currency = typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency) ? o.currency.toUpperCase() : null;
  return await tx(async (q) => {
    const reason = (o.reason ?? `refunded in ${o.provider}`).slice(0, 200);
    const r = (await q<{ r: RefundJson }[]>`
      select private.gateway_refund(${o.provider}, ${paymentId}, ${orderId}, ${o.refundId.slice(0, 255)},
                                    ${amount}::bigint, ${currency}, ${reason}) as r`)[0].r;
    const ord = orderId ? (await q<{ user_id: string; total: number; total_inr: number; currency: string; status: string }[]>`
      select user_id, total::float8 as total, total_inr::float8 as total_inr, currency, status from orders where id = ${orderId}`)[0] : undefined;
    if (r.status === 'rejected' || r.status === 'recorded' || r.status === 'already_refunded' || !ord) {
      return { status: r.status, reason: r.reason, orderId, revoked: 0 } as RefundResult;
    }
    const total = fmtMoney(ord.total, ord.currency);
    if (r.status === 'payment_refunded') {
      // a duplicate payment (or one we never saw captured) went back, or the order was paid twice
      // and the other payment still pays for it: the order and its access stay
      const paidBy = typeof r.now_paid_by === 'string' ? r.now_paid_by : null;
      await q`
        insert into audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, ip, detail)
        values (null, null, 'system', 'payment.refunded', 'order', ${orderId}, ${ctx?.ip ?? null},
                ${q.json({ provider: o.provider, paymentId, refundId: o.refundId, source, orderStatus: ord.status, userId: ord.user_id, ...(paidBy ? { nowPaidBy: paidBy } : {}) } as never)})`;
      await notify(q, {
        audience: 'staff', kind: 'payment.refunded', title: `Payment ${paymentId} on ${orderId} refunded`,
        body: paidBy
          ? `${o.provider} reported a refund (${o.refundId}) of payment ${paymentId}, the payment order ${orderId} was booked with. The order was paid twice and payment ${paidBy} of the full amount is still captured, so the order stays paid (now booked against ${paidBy}) and its access is unchanged.`
          : ord.status === 'paid'
          ? `${o.provider} reported a refund (${o.refundId}) of payment ${paymentId}, which is not the payment that paid order ${orderId}. The order stays paid and its access is unchanged.`
          : `${o.provider} reported a refund (${o.refundId}) of payment ${paymentId} before the payment itself was confirmed. Order ${orderId} stays ${ord.status}; if that payment is reported later it will not open access.`,
        data: { orderId, provider: o.provider, paymentId, refundId: o.refundId, orderStatus: ord.status, ...(paidBy ? { nowPaidBy: paidBy } : {}) },
      });
      return { status: 'payment_refunded', orderId, revoked: 0, ...(paidBy ? { paidBy } : {}) } as RefundResult;
    }
    const revoked = Number(r.revoked ?? 0);
    await q`
      insert into audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, ip, detail)
      values (null, null, 'system', 'order.refunded', 'order', ${orderId}, ${ctx?.ip ?? null},
              ${q.json({ provider: o.provider, paymentId, refundId: o.refundId, source, revoked, userId: ord.user_id } as never)})`;
    await analytics(q, null, { kind: 'refund', userId: ord.user_id, orderId, valueInr: ord.total_inr, meta: { provider: o.provider, source } });
    await notify(q, {
      audience: 'customer', userId: ord.user_id, kind: 'order.refunded', title: 'Order refunded',
      body: `Order ${orderId} (${total}) was refunded. Access bought with this order has ended.`,
      link: '/?account=worksheets', data: { orderId },
    });
    await notify(q, {
      audience: 'staff', kind: 'order.refunded', title: `Order ${orderId} refunded — ${total}`,
      body: `${o.provider} reported a full refund (${o.refundId}). ${revoked} access record(s) ended.`,
      data: { orderId, provider: o.provider, refundId: o.refundId, revoked },
    });
    return { status: 'refunded', orderId, revoked } as RefundResult;
  });
}

/** An order as the website shows it (old /api/me/orders item shape plus lines and entitlements).
 *  Same shape as GET /api/me/orders (routes/shop.ts builds it; one place for the shape). */
export async function orderView(q: Tx, orderId: string): Promise<Record<string, unknown> | null> {
  if (!ORDER_ID_RE.test(orderId)) return null;
  const r = await q<{ user_id: string }[]>`select user_id from orders where id = ${orderId}`;
  if (!r.length) return null;
  const views = await orderViews(q, r[0].user_id, [orderId], 1);
  return (views[0] as Record<string, unknown> | undefined) ?? null;
}

/** The access records an order granted, with the sheet title (for pubEntitlement). */
export async function orderEntitlements(q: Tx, orderId: string): Promise<EntRow[]> {
  return await q<EntRow[]>`
    select e.id, e.user_id, e.scope, e.product_id, e.class_id, e.plan_id, e.kind, e.order_id, e.purchased_at,
           e.starts_at, e.expires_at, e.revoked_at, null::text as revoke_reason,
           pr.title, pr.price_inr, pr.class_id as product_class
    from entitlements e left join products pr on pr.id = e.product_id
    where e.order_id = ${orderId}
    order by e.id`;
}
