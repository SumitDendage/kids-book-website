// PayPal Orders v2 (hosted approval page), capture, and webhook verification through PayPal's
// own verify-webhook-signature API. The OAuth token is cached in memory and renewed early.
import { env, gatewayModes } from '../lib/env.ts';
import { minorExponent } from '../lib/util.ts';
import { callGateway, cleanGatewayText, GatewayError } from './razorpay.ts';

export const PAYPAL_ORDER_RE = /^[A-Z0-9]{8,40}$/;

export type PpCapture = {
  id: string; status: string; currency: string | null; value: string | null; customId: string | null; invoiceId: string | null;
  relatedOrderId: string | null;
};

export type PpOrder = {
  id: string;
  status: string;                   // CREATED | APPROVED | COMPLETED | VOIDED | PAYER_ACTION_REQUIRED
  referenceId: string | null;
  customId: string | null;
  currency: string | null;
  value: string | null;
  capture: PpCapture | null;        // the first capture, when there is one
  approveUrl: string | null;
};

export const paypalMode = () => gatewayModes().paypal;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (x: unknown, max = 200) => (typeof x === 'string' && x ? cleanGatewayText(x).slice(0, max) : null);

/** PayPal amounts are decimal strings with the currency's own decimals ("25.80", "45"). */
export function ppValue(amountMinor: number, currency: string): string {
  const d = minorExponent(currency);
  const s = String(Math.trunc(amountMinor)).padStart(d + 1, '0');
  return d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
}

/** "25.80" → 2580 (exact, no floating point); null when it is not a plain amount. */
export function ppMinor(value: string | null, currency: string): number | null {
  if (!value) return null;
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) return null;
  const d = minorExponent(currency);
  const frac = m[2] ?? '';
  if (frac.length > d && /[1-9]/.test(frac.slice(d))) return null;
  const n = Number(m[1] + frac.slice(0, d).padEnd(d, '0'));
  return Number.isSafeInteger(n) ? n : null;
}

let token: { value: string; exp: number; key: string } | null = null;

export function resetPaypalTokenForTests() {
  token = null;
}

const ppError = (b: unknown) => {
  if (!isObj(b)) return {};
  const d = Array.isArray(b.details) && isObj(b.details[0]) ? b.details[0] : {};
  return { message: d.description ?? d.issue ?? b.error_description ?? b.message, code: d.issue ?? b.name ?? b.error };
};

async function accessToken(): Promise<string> {
  const e = env().paypal;
  if (!e.clientId || !e.secret) throw new GatewayError('PayPal is not connected', 0);
  const key = `${e.apiBase}|${e.clientId}`;
  if (token && token.key === key && token.exp > Date.now() + 60_000) return token.value;
  const b = await callGateway('PayPal', `${e.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${e.clientId}:${e.secret}`), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  }, ppError);
  if (typeof b.access_token !== 'string' || !b.access_token) throw new GatewayError('PayPal sign-in failed', 502);
  const life = Number(b.expires_in);
  token = { value: b.access_token, exp: Date.now() + (Number.isFinite(life) && life > 0 ? life : 3000) * 1000, key };
  return token.value;
}

/** One PayPal API call. `o.raw` sends a body that is already JSON text (used for webhooks). */
async function paypal(method: 'GET' | 'POST', path: string, body?: unknown, o: { requestId?: string; raw?: string } = {}): Promise<Record<string, unknown>> {
  const payload = o.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation',
    };
    if (o.requestId) headers['PayPal-Request-Id'] = o.requestId;
    try {
      return await callGateway('PayPal', `${env().paypal.apiBase}${path}`, { method, headers, body: payload }, ppError);
    } catch (e) {
      // an expired or revoked token: sign in again once
      if (e instanceof GatewayError && e.status === 401 && attempt === 0) { token = null; continue; }
      throw e;
    }
  }
}

function asCapture(v: unknown): PpCapture | null {
  if (!isObj(v) || typeof v.id !== 'string' || !/^[A-Z0-9]{6,40}$/.test(v.id)) return null;
  const amount = isObj(v.amount) ? v.amount : {};
  const related = isObj(v.supplementary_data) && isObj(v.supplementary_data.related_ids) ? v.supplementary_data.related_ids : {};
  return {
    id: v.id,
    status: str(v.status, 40) ?? '',
    currency: str(amount.currency_code, 3)?.toUpperCase() ?? null,
    value: str(amount.value, 20),
    customId: str(v.custom_id, 127),
    invoiceId: str(v.invoice_id, 127),
    relatedOrderId: str(related.order_id, 40),
  };
}

/** A PayPal order in a checked, typed form; null if malformed. */
export function asPpOrder(v: unknown): PpOrder | null {
  if (!isObj(v) || typeof v.id !== 'string' || !PAYPAL_ORDER_RE.test(v.id)) return null;
  const unit = Array.isArray(v.purchase_units) && isObj(v.purchase_units[0]) ? v.purchase_units[0] : {};
  const amount = isObj(unit.amount) ? unit.amount : {};
  const payments = isObj(unit.payments) ? unit.payments : {};
  const capture = Array.isArray(payments.captures) ? asCapture(payments.captures[0]) : null;
  const links = Array.isArray(v.links) ? v.links.filter(isObj) : [];
  const approve = links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  return {
    id: v.id,
    status: str(v.status, 40) ?? '',
    referenceId: str(unit.reference_id, 127),
    customId: str(unit.custom_id, 127) ?? capture?.customId ?? null,
    currency: str(amount.currency_code, 3)?.toUpperCase() ?? null,
    value: str(amount.value, 20),
    capture,
    approveUrl: approve && typeof approve.href === 'string' && /^https?:\/\//.test(approve.href) ? approve.href : null,
  };
}

/** POST /v2/checkout/orders: one purchase unit for our order, PayPal's hosted approval page. */
export async function ppCreateOrder(o: {
  orderId: string; amountMinor: number; currency: string; description: string; returnUrl: string; cancelUrl: string;
}): Promise<{ id: string; approveUrl: string }> {
  const b = await paypal('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: o.orderId, custom_id: o.orderId, invoice_id: o.orderId,
      description: o.description.slice(0, 127) || 'Learn With Why',
      amount: { currency_code: o.currency, value: ppValue(o.amountMinor, o.currency) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Learn With Why', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
          return_url: o.returnUrl, cancel_url: o.cancelUrl,
        },
      },
    },
  }, { requestId: `lww-create-${o.orderId}` });
  const p = asPpOrder(b);
  if (!p) throw new GatewayError('PayPal sent an order we could not read', 502);
  if (!p.approveUrl) throw new GatewayError('PayPal did not return an approval link.', 502);
  return { id: p.id, approveUrl: p.approveUrl };
}

/** GET /v2/checkout/orders/:id */
export async function ppGetOrder(id: string): Promise<PpOrder> {
  if (!PAYPAL_ORDER_RE.test(id)) throw new GatewayError('Unknown PayPal order', 400);
  const p = asPpOrder(await paypal('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`));
  if (!p || p.id !== id) throw new GatewayError('PayPal sent an order we could not read', 502);
  return p;
}

/** POST /v2/checkout/orders/:id/capture. A second capture (a reload of the return page) reads
 *  the order instead, so the caller always gets the order's current state. */
export async function ppCaptureOrder(id: string): Promise<PpOrder> {
  if (!PAYPAL_ORDER_RE.test(id)) throw new GatewayError('Unknown PayPal order', 400);
  try {
    const p = asPpOrder(await paypal('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}));
    if (!p || p.id !== id) throw new GatewayError('PayPal sent an order we could not read', 502);
    return p;
  } catch (e) {
    if (e instanceof GatewayError && e.code === 'ORDER_ALREADY_CAPTURED') return await ppGetOrder(id);
    throw e;
  }
}

/** A capture or refund resource from a webhook (typed; null if malformed). */
export const asPpCapture = asCapture;

/** Asks PayPal whether a webhook delivery is genuine. The event is passed on as the exact raw
 *  text PayPal sent (re-serialising it can change bytes and fail the check). Returns false for a
 *  forged or incomplete delivery; throws GatewayError when PayPal cannot be asked. */
export async function ppWebhookGenuine(headers: Headers, rawText: string): Promise<boolean> {
  const webhookId = env().paypal.webhookId;
  if (!webhookId) return false;
  const h = (n: string, max: number) => {
    const v = (headers.get(n) ?? '').trim();
    return v && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : null;
  };
  const algo = h('paypal-auth-algo', 40), certUrl = h('paypal-cert-url', 500), tid = h('paypal-transmission-id', 100);
  const sig = h('paypal-transmission-sig', 1000), time = h('paypal-transmission-time', 64);
  if (!algo || !certUrl || !tid || !sig || !time || !/^https:\/\//.test(certUrl)) return false;
  // rawText has already been parsed as one JSON object by the caller, so it is safe to embed
  const body = `{"auth_algo":${JSON.stringify(algo)},"cert_url":${JSON.stringify(certUrl)},"transmission_id":${JSON.stringify(tid)},` +
    `"transmission_sig":${JSON.stringify(sig)},"transmission_time":${JSON.stringify(time)},"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${rawText}}`;
  const b = await paypal('POST', '/v1/notifications/verify-webhook-signature', undefined, { raw: body });
  return b.verification_status === 'SUCCESS';
}
