// Payments: stored quote → order → gateway → verified payment → fulfil().
// Razorpay (modal checkout on the site), Stripe Checkout and PayPal (hosted pages), and their
// webhooks. Access is never granted from what the browser says: every path asks the gateway (or
// checks its signed webhook) first, and private.fulfil_order checks the amount against the order.
// Gateway calls never happen inside a database transaction: read → call out → write.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { env, gatewayModes } from '../lib/env.ts';
import { HttpError, json, readJson, readRaw } from '../lib/http.ts';
import { requireUser } from '../lib/auth.ts';
import { analytics, notify, overLimit, rateLimit, securityEvent } from '../lib/guard.ts';
import { getSettings, type Settings } from '../lib/settings.ts';
import { newOrderId, sha256Hex } from '../lib/util.ts';
import { countryFor, loadQuote, methodsFor, PAYMENT_METHODS, revalidateQuote, STALE_QUOTE, type StoredQuote } from '../services/pricing.ts';
import { pubEntitlement } from '../services/entitlements.ts';
import { fulfil, ORDER_ID_RE, orderEntitlements, orderView, refundFromGateway, type FulfilResult, type Provider } from '../services/fulfil.ts';
import {
  asRzpPayment, GatewayError, RZP_ORDER_RE, RZP_PAYMENT_RE, rzpCapturePayment, rzpCheckoutSignatureOk, rzpCreateOrder,
  rzpFetchPayment, rzpWebhookSignatureOk, type RzpPayment,
} from '../gateways/razorpay.ts';
import { asStripeSession, STRIPE_SESSION_RE, stripeCreateSession, stripeExpireSession, stripeGetSession, stripeMode, stripeSignatureCheck } from '../gateways/stripe.ts';
import { asPpCapture, PAYPAL_ORDER_RE, paypalMode, ppCaptureOrder, ppCreateOrder, ppMinor, ppWebhookGenuine, type PpOrder } from '../gateways/paypal.ts';

const NO_ORDER = 'No such order.';
const NOT_THIS_ORDER = 'This payment does not belong to that order.';
const REJECTED = 'This payment does not match the order, so it was not accepted. If money was taken, write to us and we will sort it out.';
const SUSPENDED = 'Access to paid sheets is paused on this account, so new purchases are not possible right now. If you think this is a mistake, write to us from My Account → Security.';
const LABEL: Record<Provider, string> = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };
const OFF_FOR_ORDER: Record<Provider, string> = {
  razorpay: 'Razorpay is not connected on this server yet — online payment is not available.',
  stripe: 'Stripe is not connected on this server yet — pick another way to pay.',
  paypal: 'PayPal is not connected on this server yet — pick another way to pay.',
};
const WEBHOOK_LIMIT = 256 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A string field from a body (trimmed), or '' when missing, not a string or too long. */
const field = (v: unknown, max = 300): string => (typeof v === 'string' && v.length <= max ? v.trim() : '');
const unavailable = (message: string) => new HttpError(503, message, { code: 'payments_unavailable' });
const notFound = () => new HttpError(404, NO_ORDER, { code: 'not_found' });
const rejectedError = (r: FulfilResult) => new HttpError(400, REJECTED, { code: 'payment_rejected', reason: r.reason ?? 'rejected' });

// ── the payment log (payment_events) ─────────────────────────────────────────────────────

type EventStatus = 'logged' | 'received' | 'processed' | 'ignored' | 'failed';
type EventIn = {
  provider: Provider; type: string; orderId?: string | null; ok: boolean; status?: EventStatus;
  signatureOk?: boolean | null; detail?: Record<string, unknown> | null; sha?: string | null;
};

const eventType = (v: unknown) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) : '') || 'unknown';

async function logEvent(e: EventIn, q?: Tx) {
  const status = e.status ?? 'logged';
  const run = (t: Tx) => t`
    insert into payment_events (provider, event_type, order_id, ok, status, signature_ok, detail, payload_sha256, processed_at)
    values (${e.provider}, ${eventType(e.type)}, ${e.orderId ?? null}, ${e.ok}, ${status}, ${e.signatureOk ?? null},
            ${e.detail ? t.json(e.detail as never) : null}, ${e.sha ?? null},
            ${status === 'processed' || status === 'ignored' ? new Date() : null})`;
  if (q) await run(q); else await tx(run);
}

// ── orders ───────────────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string; user_id: string; status: string; method: Provider; currency: string; amount_minor: number;
  gateway_order_id: string | null; gateway_payment_id: string | null;
};

async function orderById(q: Tx, id: string, lock = false): Promise<OrderRow | null> {
  if (!ORDER_ID_RE.test(id)) return null;
  const rows = lock
    ? await q<OrderRow[]>`select id, user_id, status, method, currency, amount_minor, gateway_order_id, gateway_payment_id from orders where id = ${id} for update`
    : await q<OrderRow[]>`select id, user_id, status, method, currency, amount_minor, gateway_order_id, gateway_payment_id from orders where id = ${id}`;
  return rows[0] ?? null;
}

async function orderByGateway(q: Tx, method: Provider, gatewayOrderId: string): Promise<OrderRow | null> {
  if (!gatewayOrderId || gatewayOrderId.length > 255) return null;
  const rows = await q<OrderRow[]>`
    select id, user_id, status, method, currency, amount_minor, gateway_order_id, gateway_payment_id
    from orders where method = ${method} and gateway_order_id = ${gatewayOrderId}`;
  return rows[0] ?? null;
}

/** The order a gateway payment (or capture / payment intent) settled. */
async function orderByPayment(q: Tx, method: Provider, paymentId: string): Promise<OrderRow | null> {
  if (!paymentId || paymentId.length > 255) return null;
  const rows = await q<OrderRow[]>`
    select o.id, o.user_id, o.status, o.method, o.currency, o.amount_minor, o.gateway_order_id, o.gateway_payment_id
    from orders o
    where o.method = ${method}
      and (o.gateway_payment_id = ${paymentId}
           or exists (select 1 from payments p where p.order_id = o.id and p.provider = ${method} and p.provider_payment_id = ${paymentId}))
    order by o.created_at desc
    limit 1`;
  return rows[0] ?? null;
}

/** The caller's own order, by our id or by the gateway's id. Someone else's order looks exactly
 *  like a missing one (404), so ids cannot be probed. */
async function ownOrder(q: Tx, userId: string, by: { id?: string; method?: Provider; gatewayOrderId?: string }): Promise<OrderRow | null> {
  const o = by.id ? await orderById(q, by.id) : by.method && by.gatewayOrderId ? await orderByGateway(q, by.method, by.gatewayOrderId) : null;
  return o && o.user_id === userId ? o : null;
}

/** The answer after a payment: the old { ok, order, entitlement } plus every access record. */
async function paidBody(orderId: string, status: string) {
  const { order, ents } = await tx(async (q) => ({ order: await orderView(q, orderId), ents: await orderEntitlements(q, orderId) }));
  const list = ents.map((e) => pubEntitlement(e, e.scope === 'worksheet' ? e.price_inr : null));
  return { ok: true, status, order, entitlement: list[0] ?? null, entitlements: list };
}

// ── POST /api/pay/order ──────────────────────────────────────────────────────────────────

/** Fields the browser sent must describe the stored quote; the stored quote always wins. */
function checkQuoteMatches(quote: StoredQuote, b: Record<string, unknown>, sent: Record<string, unknown>, s: Settings) {
  const mismatch = () => new HttpError(400, STALE_QUOTE, { code: 'quote_mismatch' });
  const val = (k: string): string | null => {
    const v = b[k] !== undefined && b[k] !== null && b[k] !== '' ? b[k] : sent[k];
    if (v === undefined || v === null || v === '') return null;
    return typeof v === 'string' ? v.trim() : '\u0000'; // anything but a string never matches
  };
  const line = quote.lines[0];
  const kind = val('kind');
  if (kind && kind !== quote.kind) throw mismatch();
  const ws = val('worksheet');
  if (ws && ws !== line.productId) throw mismatch();
  const cls = val('cls');
  if (cls && quote.kind === 'class' && cls !== line.classId) throw mismatch();
  const plan = val('plan');
  if (plan && plan !== line.planId) throw mismatch();
  const coupon = val('coupon');
  if (coupon !== null && coupon.toUpperCase() !== (quote.couponCode ?? '').toUpperCase()) throw mismatch();
  const addr = isObj(b.address) ? b.address : isObj(sent.address) ? sent.address : null;
  const country = val('country') ?? (addr && typeof addr.country === 'string' && addr.country ? addr.country : null);
  if (country && countryFor(s, country).code !== quote.country) throw mismatch();
}

async function createOrder(ctx: Ctx) {
  const u = await requireUser(ctx);
  if (u.profile.subscription_suspended_at) throw new HttpError(403, SUSPENDED, { code: 'access_suspended' });
  await rateLimit(ctx, 'pay_order_ip', ctx.ip, 60, 600);
  await rateLimit(ctx, 'pay_order', u.id, 20, 600);
  const b = await readJson(ctx.req, 32 * 1024);
  const sent = isObj(b.quote) ? b.quote : {};   // the old site posts the whole quote object

  const method = (b.method === undefined || b.method === null || b.method === '' ? 'razorpay' : b.method) as Provider;
  if (typeof method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new HttpError(400, 'Unknown payment method.', { code: 'unknown_method' });
  }
  const mode = gatewayModes()[method];
  if (!mode) throw unavailable(OFF_FOR_ORDER[method]);
  const quoteId = field(b.quoteId) || field(b.sig) || field(sent.quoteId) || field(sent.sig);
  if (!quoteId) throw new HttpError(400, STALE_QUOTE, { code: 'quote_invalid' });

  // 1. one short transaction: the stored quote, re-checked, becomes an order
  const { id, quote } = await tx(async (q) => {
    const s = await getSettings(q);
    const quote = await loadQuote(q, quoteId);
    checkQuoteMatches(quote, b, sent, s);
    await revalidateQuote(q, quote, u.id);
    if (!methodsFor(countryFor(s, quote.country)).includes(method)) {
      throw new HttpError(400, `That payment method is not available in ${quote.countryName || quote.country}.`, { code: 'method_unavailable' });
    }
    let id = '';
    for (let i = 0; i < 5 && !id; i++) {
      const candidate = newOrderId();
      const r = await q`
        insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, discount_inr, amount_minor, lines,
                            coupon_code, address, country, method, gateway_mode, quote_id, ip, user_agent)
        values (${candidate}, ${u.id}, ${quote.kind}, 'created', ${quote.currency}, ${quote.rate}, ${quote.total}, ${quote.totalInr},
                ${quote.discountInr}, ${quote.amountMinor}, ${q.json(quote.lines as never)}, ${quote.couponCode},
                ${quote.address ? q.json(quote.address as never) : null}, ${quote.country}, ${method}, ${mode}, ${quote.id},
                ${ctx.ip}, ${ctx.ua || null})
        on conflict (id) do nothing
        returning id`;
      if (r.length) id = candidate;
    }
    if (!id) throw new Error('could not allocate an order id');
    for (const l of quote.lines) {
      await q`
        insert into order_items (order_id, kind, product_id, class_id, plan_id, title, months, access_days, unit_price_inr, discount_inr)
        values (${id}, ${l.kind}, ${l.productId}, ${l.kind === 'class' ? l.classId : null}, ${l.planId}, ${l.title || 'Learn With Why'},
                ${l.kind === 'class' ? l.months : null}, ${l.kind === 'worksheet' ? l.accessDays : null}, ${l.unitPriceInr}, ${l.discountInr})`;
    }
    await q`
      update quotes set used_at = coalesce(used_at, now()), used_by_order = coalesce(used_by_order, ${id})
      where id = ${quote.id}`;
    await analytics(q, ctx, {
      kind: 'order_created', userId: u.id, orderId: id, valueInr: quote.totalInr,
      productId: quote.lines.find((l) => l.kind === 'worksheet')?.productId ?? null,
      meta: { method, currency: quote.currency, total: quote.total, kind: quote.kind },
    });
    return { id, quote };
  });

  // 2. the gateway's order / hosted page (outside any transaction)
  const line = quote.lines[0];
  const description = (quote.title || line.title || 'Learn With Why').slice(0, 200);
  const site = env().siteUrl;
  const enc = encodeURIComponent(id);
  const cancelUrl = `${site}/?pay=cancel&order=${enc}`;
  let gatewayOrderId: string;
  let gateway: Record<string, unknown>;
  try {
    if (method === 'razorpay') {
      const rz = await rzpCreateOrder({
        amountMinor: quote.amountMinor, currency: quote.currency, receipt: id,
        notes: { order: id, kind: quote.kind, cls: line.classId ?? '', worksheet: line.productId ?? '' },
      });
      gatewayOrderId = rz.id;
      gateway = {
        provider: 'razorpay', mode, key: env().razorpay.keyId, razorpay_order_id: rz.id, amount: rz.amount, currency: rz.currency,
        name: 'Learn With Why', description, prefill: { name: u.profile.name, email: u.profile.email }, theme: { color: '#1f6b47' },
      };
    } else if (method === 'stripe') {
      const st = await stripeCreateSession({
        orderId: id, amountMinor: quote.amountMinor, currency: quote.currency, description, email: u.profile.email,
        successUrl: `${site}/?pay=stripe&order=${enc}&session={CHECKOUT_SESSION_ID}`, cancelUrl, kind: quote.kind, worksheet: line.productId,
      });
      gatewayOrderId = st.id;
      gateway = { provider: 'stripe', mode, url: st.url, session: st.id, description };
    } else {
      const pp = await ppCreateOrder({
        orderId: id, amountMinor: quote.amountMinor, currency: quote.currency, description,
        returnUrl: `${site}/?pay=paypal&order=${enc}`, cancelUrl,
      });
      gatewayOrderId = pp.id;
      gateway = { provider: 'paypal', mode, url: pp.approveUrl, paypal_order_id: pp.id, description };
    }
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    await tx(async (q) => {
      await q`update orders set status = 'failed', failure_reason = ${`gateway: ${e.message}`.slice(0, 500)} where id = ${id} and status = 'created'`;
      await logEvent({ provider: method, type: 'order.create_failed', orderId: id, ok: false, status: 'failed', detail: { error: e.message, status: e.status, code: e.code } }, q);
    });
    console.error('[pay] gateway order failed', method, e.status, e.code ?? '');
    const message = method === 'razorpay' ? `Could not reach the payment gateway: ${e.message}` : `Could not start the ${LABEL[method]} payment: ${e.message}`;
    throw new HttpError(502, message, { code: 'gateway_error' });
  }

  // 3. remember the gateway's id, answer with the order
  const order = await tx(async (q) => {
    await q`update orders set gateway_order_id = ${gatewayOrderId}, gateway_mode = ${mode} where id = ${id} and gateway_order_id is null`;
    await logEvent({ provider: method, type: method === 'stripe' ? 'session.created' : 'order.created', orderId: id, ok: true, status: 'processed', detail: { gatewayOrderId, mode } }, q);
    return await orderView(q, id);
  });
  return { order, gateway, orderId: id };
}

// ── POST /api/pay/verify (Razorpay Checkout's success handler) ───────────────────────────

async function verify(ctx: Ctx) {
  if (!gatewayModes().razorpay) throw unavailable('Razorpay is not connected on this server.');
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'pay_verify', u.id, 30, 600);
  const b = await readJson(ctx.req, 8 * 1024);
  const rzOrder = field(b.razorpay_order_id, 64), payId = field(b.razorpay_payment_id, 64), sig = field(b.razorpay_signature, 200);
  const orderId = field(b.order_id, 40);

  const order = await tx((q) => ownOrder(q, u.id, orderId ? { id: orderId } : { method: 'razorpay', gatewayOrderId: rzOrder }));
  if (!order) throw notFound();
  if (order.method !== 'razorpay') throw new HttpError(400, 'This order does not use Razorpay.', { code: 'wrong_method' });
  if (!RZP_ORDER_RE.test(rzOrder) || rzOrder !== order.gateway_order_id) {
    await logEvent({ provider: 'razorpay', type: 'verify.mismatch', orderId: order.id, ok: false, detail: { sent: rzOrder.slice(0, 64) } });
    throw new HttpError(400, 'Payment does not belong to this order.', { code: 'payment_mismatch' });
  }
  const sigOk = await rzpCheckoutSignatureOk(rzOrder, payId, sig);
  if (!sigOk || !RZP_PAYMENT_RE.test(payId)) {
    await tx(async (q) => {
      await logEvent({ provider: 'razorpay', type: 'verify.bad_signature', orderId: order.id, ok: false, status: 'failed', signatureOk: false, detail: { paymentId: payId.slice(0, 64) } }, q);
      await securityEvent(ctx, u.id, 'payment.bad_signature', { orderId: order.id, provider: 'razorpay' }, q);
    });
    throw new HttpError(400, 'Payment signature did not verify.', { code: 'bad_signature' });
  }
  // a reload of the success handler: nothing to ask Razorpay
  if (order.status === 'paid' && order.gateway_payment_id === payId) return await paidBody(order.id, 'already_paid');

  // never trust the browser: ask Razorpay what this payment really is
  let p: RzpPayment;
  try {
    p = await rzpFetchPayment(payId);
    if (p.orderId !== rzOrder) {
      await logEvent({ provider: 'razorpay', type: 'verify.payment_check', orderId: order.id, ok: false, detail: { paymentId: p.id, paymentOrder: p.orderId, status: p.status } });
      throw new HttpError(400, 'Payment does not belong to this order.', { code: 'payment_mismatch' });
    }
    // authorized but not captured (auto-capture off): capture it, only for this order's exact amount
    // and only while the order is still unpaid, so nobody is ever charged twice
    if (p.status === 'authorized' && p.amount === order.amount_minor && p.currency === order.currency) {
      if (order.status === 'paid') return await paidBody(order.id, 'already_paid');
      if (order.status === 'refunded') throw new HttpError(409, 'This order was refunded.', { code: 'order_refunded' });
      try {
        p = await rzpCapturePayment(p.id, order.amount_minor, order.currency);
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        p = await rzpFetchPayment(payId); // captured meanwhile (webhook, retry)? read it again
      }
    }
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    await logEvent({ provider: 'razorpay', type: 'verify.lookup_failed', orderId: order.id, ok: false, status: 'failed', detail: { paymentId: payId, error: e.message, status: e.status } });
    throw new HttpError(502, 'Could not reach Razorpay to confirm the payment. If money was taken, your access opens by itself as soon as Razorpay tells us — no need to pay again.', { code: 'gateway_error' });
  }
  if (p.status !== 'captured' && !(p.status === 'authorized' && (p.amount !== order.amount_minor || p.currency !== order.currency))) {
    await logEvent({ provider: 'razorpay', type: 'verify.payment_check', orderId: order.id, ok: false, detail: { paymentId: p.id, status: p.status } });
    throw new HttpError(400, `Payment is ${p.status || 'unknown'} — not accepted.`, { code: 'not_paid' });
  }
  // fulfil_order checks amount and currency against the order (a wrong amount is rejected there)
  const r = await fulfil(ctx, {
    orderId: order.id, provider: 'razorpay', paymentId: p.id, amountMinor: p.amount, currency: p.currency, source: 'verify',
    raw: { status: p.status, method: p.method, order: p.orderId },
  });
  if (r.status === 'rejected') throw rejectedError(r);
  await logEvent({ provider: 'razorpay', type: r.status === 'paid' ? 'verify' : 'verify.already_paid', orderId: order.id, ok: true, status: 'processed', detail: { paymentId: p.id } });
  return await paidBody(order.id, r.status);
}

// ── POST /api/pay/cancel ─────────────────────────────────────────────────────────────────

async function cancel(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'pay_cancel', u.id, 30, 600);
  const b = await readJson(ctx.req, 8 * 1024);
  const orderId = field(b.order_id, 40);
  const res = await tx(async (q) => {
    const o = await orderById(q, orderId, true);
    if (!o || o.user_id !== u.id) throw notFound();
    if (o.status === 'paid') return { cancelled: false, note: 'This order is already paid.', expire: null };
    if (o.status === 'refunded') return { cancelled: false, note: 'This order was refunded.', expire: null };
    if (o.status === 'created') {
      await q`update orders set status = 'cancelled', cancelled_at = now() where id = ${o.id} and status = 'created'`;
      await logEvent({ provider: o.method, type: 'order.cancelled', orderId: o.id, ok: true, detail: { by: 'customer' } }, q);
      return { cancelled: true, note: null, expire: o.method === 'stripe' ? o.gateway_order_id : null };
    }
    return { cancelled: true, note: null, expire: null };
  });
  // close the hosted Stripe page too, so it cannot be paid later by accident (best effort)
  const sid = res.expire;
  if (sid && stripeMode()) {
    ctx.later(() => stripeExpireSession(sid).catch((e) => console.error('[pay] stripe expire failed', (e as Error).message)));
  }
  const order = await tx((q) => orderView(q, orderId));
  return { ok: true, cancelled: res.cancelled, order, ...(res.note ? { note: res.note } : {}) };
}

// ── POST /api/pay/stripe/confirm (back from Stripe Checkout) ─────────────────────────────

async function stripeConfirm(ctx: Ctx) {
  if (!stripeMode()) throw unavailable('Stripe is not connected on this server.');
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'pay_confirm', u.id, 30, 600);
  const b = await readJson(ctx.req, 8 * 1024);
  const sessionId = field(b.session_id, 300), orderId = field(b.order_id, 40);
  const order = await tx((q) => ownOrder(q, u.id, orderId ? { id: orderId } : { method: 'stripe', gatewayOrderId: sessionId }));
  if (!order) throw notFound();
  if (order.method !== 'stripe') throw new HttpError(400, 'This order does not use Stripe.', { code: 'wrong_method' });
  const sid = sessionId || order.gateway_order_id || '';
  if (!sid || sid !== order.gateway_order_id || !STRIPE_SESSION_RE.test(sid)) {
    await logEvent({ provider: 'stripe', type: 'confirm.mismatch', orderId: order.id, ok: false, detail: { sent: sid.slice(0, 80) } });
    throw new HttpError(400, NOT_THIS_ORDER, { code: 'payment_mismatch' });
  }
  if (order.status === 'paid') return await paidBody(order.id, 'already_paid');

  let s;
  try {
    s = await stripeGetSession(sid);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    await logEvent({ provider: 'stripe', type: 'confirm.lookup_failed', orderId: order.id, ok: false, status: 'failed', detail: { error: e.message, status: e.status } });
    throw new HttpError(502, `Could not reach Stripe to confirm the payment: ${e.message}`, { code: 'gateway_error' });
  }
  const refs = [s.clientReferenceId, s.metadataOrderId].filter((x): x is string => !!x);
  if (s.id !== sid || !refs.length || refs.some((x) => x !== order.id)) {
    await logEvent({ provider: 'stripe', type: 'confirm.mismatch', orderId: order.id, ok: false, detail: { session: s.id } });
    throw new HttpError(400, NOT_THIS_ORDER, { code: 'payment_mismatch' });
  }
  if (s.paymentStatus !== 'paid' || s.amountTotal === null || !s.currency) {
    await logEvent({ provider: 'stripe', type: 'confirm.not_paid', orderId: order.id, ok: false, detail: { status: s.status, paymentStatus: s.paymentStatus } });
    throw new HttpError(402, s.paymentStatus === 'unpaid' ? 'Stripe has not received this payment yet — nothing was charged.' : 'Stripe did not confirm this payment.', { code: 'not_paid' });
  }
  const r = await fulfil(ctx, {
    orderId: order.id, provider: 'stripe', paymentId: s.paymentIntent ?? s.id, amountMinor: s.amountTotal, currency: s.currency,
    source: 'stripe.confirm', raw: { session: s.id, status: s.status, paymentStatus: s.paymentStatus },
  });
  if (r.status === 'rejected') throw rejectedError(r);
  await logEvent({ provider: 'stripe', type: 'stripe.confirm', orderId: order.id, ok: true, status: 'processed', detail: { session: s.id, result: r.status } });
  return await paidBody(order.id, r.status);
}

// ── POST /api/pay/paypal/capture (back from PayPal) ──────────────────────────────────────

async function paypalCapture(ctx: Ctx) {
  if (!paypalMode()) throw unavailable('PayPal is not connected on this server.');
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'pay_confirm', u.id, 30, 600);
  const b = await readJson(ctx.req, 8 * 1024);
  const token = field(b.token, 64), orderId = field(b.order_id, 40);
  const order = await tx((q) => ownOrder(q, u.id, orderId ? { id: orderId } : { method: 'paypal', gatewayOrderId: token }));
  if (!order) throw notFound();
  if (order.method !== 'paypal') throw new HttpError(400, 'This order does not use PayPal.', { code: 'wrong_method' });
  const ppId = token || order.gateway_order_id || '';
  if (!ppId || ppId !== order.gateway_order_id || !PAYPAL_ORDER_RE.test(ppId)) {
    await logEvent({ provider: 'paypal', type: 'capture.mismatch', orderId: order.id, ok: false, detail: { sent: ppId.slice(0, 64) } });
    throw new HttpError(400, NOT_THIS_ORDER, { code: 'payment_mismatch' });
  }
  if (order.status === 'paid') return await paidBody(order.id, 'already_paid');
  if (order.status === 'refunded') throw new HttpError(409, 'This order was refunded.', { code: 'order_refunded' });

  let p: PpOrder;
  try {
    p = await ppCaptureOrder(ppId);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    await logEvent({ provider: 'paypal', type: 'capture.failed', orderId: order.id, ok: false, status: 'failed', detail: { error: e.message, status: e.status, code: e.code } });
    throw new HttpError(e.status === 422 ? 402 : 502, `PayPal did not complete the payment: ${e.message}`, { code: 'not_paid' });
  }
  const cap = p.capture;
  const ours = p.id === ppId && [p.referenceId, p.customId, cap?.customId].some((x) => x === order.id)
    && [p.referenceId, p.customId, cap?.customId].every((x) => !x || x === order.id);
  if (!ours) {
    await logEvent({ provider: 'paypal', type: 'capture.mismatch', orderId: order.id, ok: false, detail: { paypalOrder: p.id } });
    throw new HttpError(400, NOT_THIS_ORDER, { code: 'payment_mismatch' });
  }
  if (p.status !== 'COMPLETED' || !cap || cap.status !== 'COMPLETED') {
    await logEvent({ provider: 'paypal', type: 'capture.not_completed', orderId: order.id, ok: false, detail: { status: p.status, capture: cap?.status ?? null } });
    throw new HttpError(402, `PayPal has not completed this payment (${cap?.status || p.status || 'unknown'}).`, { code: 'not_paid' });
  }
  const currency = cap.currency ?? p.currency ?? '';
  const minor = /^[A-Z]{3}$/.test(currency) ? ppMinor(cap.value ?? p.value, currency) : null;
  if (minor === null) {
    await logEvent({ provider: 'paypal', type: 'capture.unreadable_amount', orderId: order.id, ok: false, detail: { capture: cap.id } });
    throw new HttpError(400, REJECTED, { code: 'payment_rejected', reason: 'amount_unreadable' });
  }
  const r = await fulfil(ctx, {
    orderId: order.id, provider: 'paypal', paymentId: cap.id, amountMinor: minor, currency, source: 'paypal.capture',
    raw: { paypalOrder: p.id, status: p.status, capture: cap.status },
  });
  if (r.status === 'rejected') throw rejectedError(r);
  await logEvent({ provider: 'paypal', type: 'paypal.capture', orderId: order.id, ok: true, status: 'processed', detail: { capture: cap.id, result: r.status } });
  return await paidBody(order.id, r.status);
}

// ── webhooks ─────────────────────────────────────────────────────────────────────────────

type Outcome = { status: 'processed' | 'ignored'; ok: boolean; orderId?: string | null; detail?: Record<string, unknown> };
const ignored = (why: string, extra: Record<string, unknown> = {}, ok = true): Outcome => ({ status: 'ignored', ok, detail: { why, ...extra } });

/** A delivery we cannot use (forged, broken, or no secret set): a log row, at most 30 per address
 *  per 10 minutes so a flood of junk cannot fill the log. The event id is kept out of the dedupe
 *  column, so a genuine delivery of the same event is still handled. */
async function badDelivery(ctx: Ctx, provider: Provider, type: string, sha: string, detail: Record<string, unknown>, signatureOk: boolean | null) {
  const key = `${provider}:${ctx.ip ?? '-'}`;
  if (await overLimit('pay_badsig', key, 30, 600)) return;
  await tx(async (q) => {
    await q`select private.rate_limit_hit(${`pay_badsig:${key}`}, 30, 600)`;
    await logEvent({ provider, type, ok: false, status: type === 'webhook.ignored' ? 'ignored' : 'failed', signatureOk, detail, sha }, q);
  });
}

/** Records the delivery once per (provider, event id) and runs the handler. A repeat of an event
 *  that was handled answers { duplicate: true } without work; one whose handling failed (or
 *  stalled for 2 minutes) is handled again — fulfil and refund are idempotent anyway. */
async function processWebhook(ctx: Ctx, provider: Provider, eventId: string | null, type: string, sha: string, handler: () => Promise<Outcome>) {
  const claim = await tx((q) => q<{ id: number }[]>`
    insert into payment_events (provider, event_id, event_type, ok, status, signature_ok, payload_sha256)
    values (${provider}, ${eventId}, ${eventType(type)}, false, 'received', true, ${sha})
    on conflict (provider, event_id) where event_id is not null do update
      set status = 'received', detail = coalesce(payment_events.detail, '{}'::jsonb) || '{"retried":true}'::jsonb
      where payment_events.status = 'failed'
         or (payment_events.status = 'received' and payment_events.received_at < now() - interval '2 minutes')
    returning id`);
  if (!claim.length) return { ok: true, duplicate: true };
  const rowId = claim[0].id;
  let out: Outcome;
  try {
    out = await handler();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await tx((q) => q`
      update payment_events set status = 'failed', ok = false, processed_at = now(),
        detail = coalesce(detail, '{}'::jsonb) || ${q.json({ error: msg } as never)}
      where id = ${rowId}`).catch(() => {});
    throw e; // non-2xx: the gateway delivers it again later
  }
  await tx((q) => q`
    update payment_events set status = ${out.status}, ok = ${out.ok}, order_id = coalesce(${out.orderId ?? null}, order_id),
      processed_at = now(), detail = coalesce(detail, '{}'::jsonb) || ${q.json((out.detail ?? {}) as never)}
    where id = ${rowId}`);
  return { ok: true };
}

/** The order a gateway says failed: created → failed (a paid order is never touched). */
async function markFailed(orderId: string, provider: Provider, reason: string): Promise<boolean> {
  const r = await tx((q) => q`
    update orders set status = 'failed', failure_reason = ${reason.slice(0, 500)}
    where id = ${orderId} and method = ${provider} and status = 'created'
    returning id`);
  return r.length > 0;
}

/** A partial refund does not end access on its own: staff decide (and can refund in the panel). */
async function partialRefund(orderId: string, provider: Provider, refundId: string, detail: Record<string, unknown>): Promise<Outcome> {
  await tx((q) => notify(q, {
    audience: 'staff', kind: 'order.partial_refund', title: `Partial refund on ${orderId}`,
    body: `${LABEL[provider]} reported a partial refund (${refundId}). Access was not changed; end it from the order page if it should end.`,
    data: { orderId, provider, refundId, ...detail },
  }));
  return { status: 'processed', ok: true, orderId, detail: { partial: true, refundId, ...detail } };
}

/** A full refund of one gateway payment. Remembered by payment id even when no order matches yet
 *  (its capture may still be on its way), and the order's access ends only when the refunded
 *  payment is the one that paid it — refunding a duplicate payment leaves the order alone. */
async function refundOutcome(ctx: Ctx, orderId: string | null, provider: Provider, paymentId: string, refundId: string, source: string,
  money: { amountMinor?: number | null; currency?: string | null } = {}): Promise<Outcome> {
  const r = await refundFromGateway(ctx, { orderId, provider, paymentId, refundId, source, ...money });
  return {
    status: 'processed', ok: r.status !== 'rejected', orderId,
    detail: { refund: r.status, reason: r.reason ?? null, revoked: r.revoked, refundId, paymentId, ...(r.paidBy ? { nowPaidBy: r.paidBy } : {}) },
  };
}

async function settleOutcome(ctx: Ctx, orderId: string, f: Parameters<typeof fulfil>[1]): Promise<Outcome> {
  const r = await fulfil(ctx, f);
  return { status: 'processed', ok: r.status !== 'rejected', orderId, detail: { result: r.status, reason: r.reason ?? null, paymentId: f.paymentId } };
}

// Razorpay: POST /api/pay/webhook — HMAC of the raw body with the webhook secret.
async function razorpayWebhook(ctx: Ctx) {
  await rateLimit(ctx, 'pay_webhook', ctx.ip, 600, 60);
  const raw = await readRaw(ctx.req, WEBHOOK_LIMIT);
  const sha = await sha256Hex(raw);
  const hdr = ctx.req.headers.get('x-razorpay-event-id') ?? '';
  const eventId = /^[A-Za-z0-9_-]{1,100}$/.test(hdr) ? hdr : null;
  if (!env().razorpay.webhookSecret) {
    await badDelivery(ctx, 'razorpay', 'webhook.ignored', sha, { why: 'RAZORPAY_WEBHOOK_SECRET is not set', eventId }, null);
    return { ok: true, ignored: true };
  }
  if (!(await rzpWebhookSignatureOk(raw, ctx.req.headers.get('x-razorpay-signature')))) {
    await badDelivery(ctx, 'razorpay', 'webhook.bad_signature', sha, { eventId }, false);
    return json(400, { error: 'bad signature' });
  }
  let ev: unknown = null;
  try { ev = JSON.parse(new TextDecoder().decode(raw)); } catch { ev = null; }
  if (!isObj(ev)) {
    await badDelivery(ctx, 'razorpay', 'webhook.bad_json', sha, { eventId }, true);
    return json(400, { error: 'bad json' });
  }
  const type = eventType(ev.event);
  return await processWebhook(ctx, 'razorpay', eventId, type, sha, () => razorpayEvent(ctx, type, ev as Record<string, unknown>));
}

async function razorpayEvent(ctx: Ctx, type: string, ev: Record<string, unknown>): Promise<Outcome> {
  const payload = isObj(ev.payload) ? ev.payload : {};
  const pay = isObj(payload.payment) ? asRzpPayment(payload.payment.entity) : null;
  if (type === 'payment.captured' || type === 'order.paid') {
    if (!pay || !pay.orderId) return ignored('no payment in the event', {}, false);
    if (pay.status !== 'captured') return ignored('payment not captured', { paymentId: pay.id, status: pay.status });
    const order = await tx((q) => orderByGateway(q, 'razorpay', pay.orderId!));
    if (!order) return ignored('unknown order', { gatewayOrderId: pay.orderId, paymentId: pay.id }, false);
    return await settleOutcome(ctx, order.id, {
      orderId: order.id, provider: 'razorpay', paymentId: pay.id, amountMinor: pay.amount, currency: pay.currency,
      source: `webhook:${type}`, raw: { status: pay.status, method: pay.method, order: pay.orderId },
    });
  }
  if (type === 'payment.failed') {
    if (!pay || !pay.orderId) return ignored('no payment in the event', {}, false);
    const order = await tx((q) => orderByGateway(q, 'razorpay', pay.orderId!));
    if (!order) return ignored('unknown order', { gatewayOrderId: pay.orderId }, false);
    const changed = await markFailed(order.id, 'razorpay', pay.errorDescription ?? 'payment failed');
    return { status: 'processed', ok: true, orderId: order.id, detail: { paymentId: pay.id, markedFailed: changed, error: pay.errorDescription } };
  }
  if (type === 'refund.processed') {
    const refund = isObj(payload.refund) && isObj(payload.refund.entity) ? payload.refund.entity : {};
    const refundId = typeof refund.id === 'string' ? refund.id.slice(0, 64) : 'refund';
    const paymentId = pay?.id ?? (typeof refund.payment_id === 'string' && RZP_PAYMENT_RE.test(refund.payment_id) ? refund.payment_id : '');
    const order = await tx(async (q) => (pay?.orderId ? await orderByGateway(q, 'razorpay', pay.orderId) : null) ?? await orderByPayment(q, 'razorpay', paymentId));
    const full = !!pay && (pay.refundStatus === 'full' || pay.amountRefunded >= pay.amount);
    if (!full) {
      if (!order) return ignored('unknown order', { paymentId, refundId }, false);
      return await partialRefund(order.id, 'razorpay', refundId, { paymentId, refunded: pay?.amountRefunded ?? null });
    }
    return await refundOutcome(ctx, order?.id ?? null, 'razorpay', paymentId, refundId, 'webhook:refund.processed',
      { amountMinor: pay.amount, currency: pay.currency });
  }
  return ignored('event not used');
}

// Stripe: POST /api/pay/stripe/webhook — Stripe-Signature over "<t>.<raw body>".
async function stripeWebhook(ctx: Ctx) {
  await rateLimit(ctx, 'pay_webhook', ctx.ip, 600, 60);
  const raw = await readRaw(ctx.req, WEBHOOK_LIMIT);
  const sha = await sha256Hex(raw);
  const check = await stripeSignatureCheck(raw, ctx.req.headers.get('stripe-signature'));
  if (check === 'off') {
    await badDelivery(ctx, 'stripe', 'webhook.ignored', sha, { why: 'STRIPE_WEBHOOK_SECRET is not set' }, null);
    return { ok: true, ignored: true };
  }
  if (check !== 'ok') {
    await badDelivery(ctx, 'stripe', 'webhook.bad_signature', sha, { why: check }, false);
    return json(400, { error: 'bad signature' });
  }
  let ev: unknown = null;
  try { ev = JSON.parse(new TextDecoder().decode(raw)); } catch { ev = null; }
  if (!isObj(ev)) {
    await badDelivery(ctx, 'stripe', 'webhook.bad_json', sha, {}, true);
    return json(400, { error: 'bad json' });
  }
  const eventId = typeof ev.id === 'string' && /^evt_[A-Za-z0-9_]{4,250}$/.test(ev.id) ? ev.id : null;
  const type = eventType(ev.type);
  const obj = isObj(ev.data) && isObj(ev.data.object) ? ev.data.object : {};
  return await processWebhook(ctx, 'stripe', eventId, type, sha, () => stripeEvent(ctx, type, obj));
}

async function stripeEvent(ctx: Ctx, type: string, obj: Record<string, unknown>): Promise<Outcome> {
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded' || type === 'checkout.session.async_payment_failed') {
    const s = asStripeSession(obj);
    if (!s) return ignored('no checkout session in the event', {}, false);
    const ref = s.metadataOrderId ?? s.clientReferenceId ?? '';
    const order = await tx((q) => orderById(q, ref));
    if (!order || order.method !== 'stripe' || order.gateway_order_id !== s.id) return ignored('unknown order', { session: s.id }, false);
    if (type === 'checkout.session.async_payment_failed') {
      const changed = await markFailed(order.id, 'stripe', 'Stripe: the payment did not go through');
      return { status: 'processed', ok: true, orderId: order.id, detail: { session: s.id, markedFailed: changed } };
    }
    // with a delayed payment method the session completes first and is paid later
    if (s.paymentStatus !== 'paid' || s.amountTotal === null || !s.currency) return ignored('not paid yet', { session: s.id, paymentStatus: s.paymentStatus });
    return await settleOutcome(ctx, order.id, {
      orderId: order.id, provider: 'stripe', paymentId: s.paymentIntent ?? s.id, amountMinor: s.amountTotal, currency: s.currency,
      source: `webhook:${type}`, raw: { session: s.id, status: s.status, paymentStatus: s.paymentStatus },
    });
  }
  if (type === 'charge.refunded') {
    const charge = typeof obj.id === 'string' ? obj.id.slice(0, 100) : 'charge';
    const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : isObj(obj.payment_intent) && typeof obj.payment_intent.id === 'string' ? obj.payment_intent.id : '';
    const meta = isObj(obj.metadata) ? obj.metadata : {};
    const metaOrder = typeof meta.order_id === 'string' ? meta.order_id : '';
    const order = await tx(async (q) => {
      const byPayment = await orderByPayment(q, 'stripe', pi);
      if (byPayment) return byPayment;
      const byMeta = metaOrder ? await orderById(q, metaOrder) : null;
      return byMeta && byMeta.method === 'stripe' ? byMeta : null;
    });
    const amount = Number(obj.amount), refunded = Number(obj.amount_refunded);
    const full = obj.refunded === true || (Number.isFinite(amount) && amount > 0 && refunded >= amount);
    if (!full) {
      if (!order) return ignored('unknown order', { charge }, false);
      return await partialRefund(order.id, 'stripe', charge, { refunded: Number.isFinite(refunded) ? refunded : null });
    }
    if (!pi) return ignored('no payment intent in the event', { charge }, false);
    return await refundOutcome(ctx, order?.id ?? null, 'stripe', pi, charge, 'webhook:charge.refunded',
      { amountMinor: Number.isSafeInteger(amount) ? amount : null, currency: typeof obj.currency === 'string' ? obj.currency : null });
  }
  return ignored('event not used');
}

// PayPal: POST /api/pay/paypal/webhook — checked by PayPal's verify-webhook-signature API.
async function paypalWebhook(ctx: Ctx) {
  await rateLimit(ctx, 'pay_webhook', ctx.ip, 600, 60);
  const raw = await readRaw(ctx.req, WEBHOOK_LIMIT);
  const sha = await sha256Hex(raw);
  if (!paypalMode() || !env().paypal.webhookId) {
    await badDelivery(ctx, 'paypal', 'webhook.ignored', sha, { why: 'PayPal or PAYPAL_WEBHOOK_ID is not set' }, null);
    return { ok: true, ignored: true };
  }
  const text = new TextDecoder().decode(raw);
  let ev: unknown = null;
  try { ev = JSON.parse(text); } catch { ev = null; }
  if (!isObj(ev)) {
    await badDelivery(ctx, 'paypal', 'webhook.bad_json', sha, {}, null);
    return json(400, { error: 'bad json' });
  }
  let genuine: boolean;
  try {
    genuine = await ppWebhookGenuine(ctx.req.headers, text);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    await logEvent({ provider: 'paypal', type: 'webhook.verify_failed', ok: false, status: 'failed', detail: { error: e.message, status: e.status }, sha });
    throw new HttpError(503, 'Could not check this delivery with PayPal — try again later.', { code: 'payments_unavailable' });
  }
  if (!genuine) {
    await badDelivery(ctx, 'paypal', 'webhook.bad_signature', sha, {}, false);
    return json(400, { error: 'bad signature' });
  }
  const eventId = typeof ev.id === 'string' && /^[A-Za-z0-9_-]{3,100}$/.test(ev.id) ? ev.id : null;
  const type = eventType(ev.event_type);
  const resource = isObj(ev.resource) ? ev.resource : {};
  return await processWebhook(ctx, 'paypal', eventId, type, sha, () => paypalEvent(ctx, type, resource));
}

async function paypalEvent(ctx: Ctx, type: string, resource: Record<string, unknown>): Promise<Outcome> {
  if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'PAYMENT.CAPTURE.DENIED') {
    const cap = asPpCapture(resource);
    if (!cap) return ignored('no capture in the event', {}, false);
    const order = await tx((q) => orderById(q, cap.customId ?? cap.invoiceId ?? ''));
    if (!order || order.method !== 'paypal' || (cap.relatedOrderId && cap.relatedOrderId !== order.gateway_order_id)) {
      return ignored('unknown order', { capture: cap.id }, false);
    }
    if (type === 'PAYMENT.CAPTURE.DENIED') {
      const changed = await markFailed(order.id, 'paypal', 'PayPal: the payment was denied');
      return { status: 'processed', ok: true, orderId: order.id, detail: { capture: cap.id, markedFailed: changed } };
    }
    const currency = cap.currency ?? '';
    const minor = /^[A-Z]{3}$/.test(currency) ? ppMinor(cap.value, currency) : null;
    if (cap.status !== 'COMPLETED' || minor === null) return ignored('capture not completed', { capture: cap.id, status: cap.status }, false);
    return await settleOutcome(ctx, order.id, {
      orderId: order.id, provider: 'paypal', paymentId: cap.id, amountMinor: minor, currency, source: `webhook:${type}`,
      raw: { capture: cap.id, status: cap.status, paypalOrder: cap.relatedOrderId },
    });
  }
  if (type === 'PAYMENT.CAPTURE.REFUNDED') {
    const refund = asPpCapture(resource);
    if (!refund) return ignored('no refund in the event', {}, false);
    const links = Array.isArray(resource.links) ? resource.links.filter(isObj) : [];
    const up = links.find((l) => l.rel === 'up' && typeof l.href === 'string');
    const captureId = up ? (/\/captures\/([A-Z0-9]{6,40})/.exec(String(up.href))?.[1] ?? '') : '';
    const order = await tx(async (q) => (await orderById(q, refund.customId ?? refund.invoiceId ?? '')) ?? await orderByPayment(q, 'paypal', captureId));
    if (!order || order.method !== 'paypal') return ignored('unknown order', { refund: refund.id }, false);
    const breakdown = isObj(resource.seller_payable_breakdown) && isObj(resource.seller_payable_breakdown.total_refunded_amount)
      ? resource.seller_payable_breakdown.total_refunded_amount : null;
    const totalValue = breakdown && typeof breakdown.value === 'string' ? breakdown.value : refund.value;
    const totalCurrency = breakdown && typeof breakdown.currency_code === 'string' ? breakdown.currency_code.toUpperCase() : refund.currency;
    const refundedMinor = totalCurrency === order.currency ? ppMinor(totalValue, order.currency) : null;
    if (refundedMinor === null || refundedMinor < order.amount_minor) {
      return await partialRefund(order.id, 'paypal', refund.id, { refunded: refundedMinor });
    }
    const paidCapture = captureId || order.gateway_payment_id || '';
    if (!paidCapture) return ignored('no capture in the event', { refund: refund.id }, false);
    return await refundOutcome(ctx, order.id, 'paypal', paidCapture, refund.id, 'webhook:PAYMENT.CAPTURE.REFUNDED',
      { amountMinor: refundedMinor, currency: order.currency });
  }
  return ignored('event not used');
}

export function register(r: Router) {
  r.post('/api/pay/order', createOrder);
  r.post('/api/pay/verify', verify);
  r.post('/api/pay/webhook', razorpayWebhook);
  r.post('/api/pay/razorpay/webhook', razorpayWebhook);
  r.post('/api/pay/cancel', cancel);
  r.post('/api/pay/stripe/confirm', stripeConfirm);
  r.post('/api/pay/stripe/webhook', stripeWebhook);
  r.post('/api/pay/paypal/capture', paypalCapture);
  r.post('/api/pay/paypal/webhook', paypalWebhook);
}
