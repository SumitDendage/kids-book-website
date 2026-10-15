// Stripe Checkout (hosted page) over the REST API, and the webhook signature check.
// Stripe takes form-encoded bodies with bracketed keys: line_items[0][price_data][currency]=usd
import { env, gatewayModes } from '../lib/env.ts';
import { hmacHex, safeEqual } from '../lib/util.ts';
import { callGateway, cleanGatewayText, GatewayError } from './razorpay.ts';

export const STRIPE_SESSION_RE = /^cs_[A-Za-z0-9_]{8,250}$/;
const STRIPE_PI_RE = /^pi_[A-Za-z0-9_]{6,250}$/;
export const STRIPE_TOLERANCE_SECONDS = 300;

export type StripeSession = {
  id: string;
  url: string | null;
  status: string | null;            // open | complete | expired
  paymentStatus: string | null;     // paid | unpaid | no_payment_required
  clientReferenceId: string | null;
  metadataOrderId: string | null;
  amountTotal: number | null;       // minor units
  currency: string | null;          // upper case
  paymentIntent: string | null;
};

export const stripeMode = () => gatewayModes().stripe;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[];
type FormObject = { [k: string]: FormValue };

function form(obj: FormObject, prefix = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (isObj(x) ? form(x as FormObject, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else if (typeof v === 'object') form(v as FormObject, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

const stripeError = (b: unknown) => {
  const err = isObj(b) && isObj(b.error) ? b.error : {};
  return { message: err.message, code: err.code ?? err.type };
};

async function stripe(method: 'GET' | 'POST', path: string, body?: FormObject, idempotencyKey?: string) {
  const key = env().stripe.secretKey;
  if (!key) throw new GatewayError('Stripe is not connected', 0);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return await callGateway('Stripe', `${env().stripe.apiBase}/v1${path}`, { method, headers, body: body ? form(body) : undefined }, stripeError);
}

/** A Checkout Session (from the API or a webhook) in a checked, typed form; null if malformed. */
export function asStripeSession(v: unknown): StripeSession | null {
  if (!isObj(v) || typeof v.id !== 'string' || !STRIPE_SESSION_RE.test(v.id)) return null;
  const meta = isObj(v.metadata) ? v.metadata : {};
  const pi = typeof v.payment_intent === 'string' ? v.payment_intent : isObj(v.payment_intent) && typeof v.payment_intent.id === 'string' ? v.payment_intent.id : null;
  const str = (x: unknown) => (typeof x === 'string' && x ? cleanGatewayText(x) : null);
  return {
    id: v.id,
    url: typeof v.url === 'string' && /^https?:\/\//.test(v.url) ? v.url : null,
    status: str(v.status),
    paymentStatus: str(v.payment_status),
    clientReferenceId: str(v.client_reference_id),
    metadataOrderId: str(meta.order_id) ?? str(meta.order),
    amountTotal: typeof v.amount_total === 'number' && Number.isSafeInteger(v.amount_total) ? v.amount_total : null,
    currency: typeof v.currency === 'string' && /^[A-Za-z]{3}$/.test(v.currency) ? v.currency.toUpperCase() : null,
    paymentIntent: pi && STRIPE_PI_RE.test(pi) ? pi : null,
  };
}

/** POST /v1/checkout/sessions for one order (one line, the order's exact amount). */
export async function stripeCreateSession(o: {
  orderId: string; amountMinor: number; currency: string; description: string; email: string;
  successUrl: string; cancelUrl: string; kind: string; worksheet: string | null;
}): Promise<{ id: string; url: string }> {
  const b = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: o.orderId,
    customer_email: o.email,
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: { currency: o.currency.toLowerCase(), unit_amount: o.amountMinor, product_data: { name: o.description.slice(0, 200) || 'Learn With Why' } },
    }],
    metadata: { order_id: o.orderId, order: o.orderId, kind: o.kind, worksheet: o.worksheet ?? '' },
    payment_intent_data: { metadata: { order_id: o.orderId, order: o.orderId } },
  }, `lww-session-${o.orderId}`);
  const s = asStripeSession(b);
  if (!s || !s.url) throw new GatewayError('Stripe sent a checkout page we could not read', 502);
  if (s.amountTotal !== null && s.amountTotal !== o.amountMinor) throw new GatewayError('Stripe made the checkout page for a different amount', 502);
  return { id: s.id, url: s.url };
}

/** GET /v1/checkout/sessions/:id */
export async function stripeGetSession(id: string): Promise<StripeSession> {
  if (!STRIPE_SESSION_RE.test(id)) throw new GatewayError('Unknown checkout page', 400);
  const s = asStripeSession(await stripe('GET', `/checkout/sessions/${encodeURIComponent(id)}`));
  if (!s || s.id !== id) throw new GatewayError('Stripe sent a checkout page we could not read', 502);
  return s;
}

/** POST /v1/checkout/sessions/:id/expire — closes an unpaid hosted page (best effort). */
export async function stripeExpireSession(id: string): Promise<void> {
  if (!STRIPE_SESSION_RE.test(id)) return;
  await stripe('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
}

/** Checks a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=…]") against the raw body:
 *  HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret, t within 5 minutes of now. */
export async function stripeSignatureCheck(raw: Uint8Array, header: string | null, nowMs = Date.now()): Promise<'ok' | 'bad' | 'stale' | 'off'> {
  const secret = env().stripe.webhookSecret;
  if (!secret) return 'off';
  if (!header || header.length > 2000) return 'bad';
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = v;
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v) && v1.length < 8) v1.push(v.toLowerCase());
  }
  if (!t || !v1.length) return 'bad';
  const prefix = new TextEncoder().encode(`${t}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix, 0);
  signed.set(raw, prefix.length);
  const expected = await hmacHex(secret, signed);
  let match = false;
  for (const s of v1) match = safeEqual(expected, s) || match;
  if (!match) return 'bad';
  return Math.abs(nowMs / 1000 - Number(t)) <= STRIPE_TOLERANCE_SECONDS ? 'ok' : 'stale';
}
