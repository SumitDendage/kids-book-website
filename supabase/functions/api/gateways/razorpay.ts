// Razorpay over its REST API: orders, payments, capture, and the two signature checks.
// Keys are Edge Function secrets (env()). The API base can be pointed at a fake for tests.
// This file also holds GatewayError and callGateway(), which stripe.ts and paypal.ts use too,
// so every gateway fails in the same way.
import { env, gatewayModes } from '../lib/env.ts';
import { hmacHex, safeEqual } from '../lib/util.ts';

export const GATEWAY_TIMEOUT_MS = 15_000;

/** A gateway refused a request or could not be reached. `message` is safe to show to a customer
 *  (the gateway's own short description, never a URL or a key); `body` is for logs only. */
export class GatewayError extends Error {
  status: number;          // the gateway's HTTP status; 0 = not reached or timed out
  code: string | null;     // the gateway's own error code / issue, when it sent one
  body: unknown;
  constructor(message: string, status: number, code: string | null = null, body: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Short, printable text from a gateway (no control characters, at most 200 characters). */
export function cleanGatewayText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/** One HTTP call to a gateway with a timeout. Returns the parsed JSON object or throws
 *  GatewayError. `errorOf` picks the gateway's own message and code out of an error body. */
export async function callGateway(
  label: string,
  url: string,
  init: RequestInit,
  errorOf: (body: unknown) => { message?: unknown; code?: unknown },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
    throw new GatewayError(timedOut ? `${label} did not answer in time` : `${label} could not be reached`, 0);
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const e = errorOf(body);
    const code = cleanGatewayText(e.code) || null;
    throw new GatewayError(cleanGatewayText(e.message) || `${label} answered ${res.status}`, res.status, code, body);
  }
  if (!isObj(body)) throw new GatewayError(`${label} sent an answer we could not read`, res.status);
  return body;
}

// ── Razorpay ─────────────────────────────────────────────────────────────────────────────

export const RZP_ORDER_RE = /^order_[A-Za-z0-9]{6,40}$/;
export const RZP_PAYMENT_RE = /^pay_[A-Za-z0-9]{6,40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export type RzpOrder = { id: string; amount: number; currency: string; receipt: string | null; status: string };

export type RzpPayment = {
  id: string;
  orderId: string | null;
  amount: number;            // minor units (paise)
  currency: string;          // upper case
  status: string;            // created | authorized | captured | refunded | failed
  amountRefunded: number;
  refundStatus: string | null;  // null | partial | full
  errorDescription: string | null;
  method: string | null;
};

export const razorpayMode = () => gatewayModes().razorpay;

function rzpAuth(): string {
  const e = env().razorpay;
  if (!e.keyId || !e.keySecret) throw new GatewayError('Razorpay is not connected', 0);
  return 'Basic ' + btoa(`${e.keyId}:${e.keySecret}`);
}

const rzpError = (b: unknown) => {
  const err = isObj(b) && isObj(b.error) ? b.error : {};
  return { message: err.description, code: err.code };
};

async function rzp(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) {
  return await callGateway('Razorpay', `${env().razorpay.apiBase}/v1${path}`, {
    method,
    headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, rzpError);
}

/** A payment entity (from the API or a webhook) in a checked, typed form; null if malformed. */
export function asRzpPayment(v: unknown): RzpPayment | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === 'string' && RZP_PAYMENT_RE.test(v.id) ? v.id : null;
  const amount = typeof v.amount === 'number' && Number.isSafeInteger(v.amount) && v.amount >= 0 ? v.amount : null;
  const currency = typeof v.currency === 'string' && /^[A-Za-z]{3}$/.test(v.currency) ? v.currency.toUpperCase() : null;
  if (!id || amount === null || !currency || typeof v.status !== 'string') return null;
  const refunded = typeof v.amount_refunded === 'number' && Number.isSafeInteger(v.amount_refunded) ? v.amount_refunded : 0;
  return {
    id,
    orderId: typeof v.order_id === 'string' && RZP_ORDER_RE.test(v.order_id) ? v.order_id : null,
    amount,
    currency,
    status: cleanGatewayText(v.status).toLowerCase(),
    amountRefunded: refunded,
    refundStatus: typeof v.refund_status === 'string' ? cleanGatewayText(v.refund_status).toLowerCase() : null,
    errorDescription: cleanGatewayText(v.error_description) || null,
    method: typeof v.method === 'string' ? cleanGatewayText(v.method).slice(0, 30) : null,
  };
}

/** POST /v1/orders. The amount is in minor units; receipt = our order id. */
export async function rzpCreateOrder(o: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RzpOrder> {
  const b = await rzp('POST', '/orders', { amount: o.amountMinor, currency: o.currency, receipt: o.receipt, notes: o.notes });
  const id = typeof b.id === 'string' && RZP_ORDER_RE.test(b.id) ? b.id : null;
  if (!id) throw new GatewayError('Razorpay sent an order we could not read', 502);
  const amount = Number(b.amount);
  const currency = String(b.currency ?? '').toUpperCase();
  // belt and braces: the order Razorpay made must be for exactly what we asked
  if (amount !== o.amountMinor || currency !== o.currency) throw new GatewayError('Razorpay made the order for a different amount', 502);
  return { id, amount, currency, receipt: typeof b.receipt === 'string' ? b.receipt : null, status: String(b.status ?? '') };
}

/** GET /v1/payments/:id */
export async function rzpFetchPayment(paymentId: string): Promise<RzpPayment> {
  if (!RZP_PAYMENT_RE.test(paymentId)) throw new GatewayError('Unknown payment', 400);
  const p = asRzpPayment(await rzp('GET', `/payments/${encodeURIComponent(paymentId)}`));
  if (!p || p.id !== paymentId) throw new GatewayError('Razorpay sent a payment we could not read', 502);
  return p;
}

/** POST /v1/payments/:id/capture — only for an authorized payment of the right amount. */
export async function rzpCapturePayment(paymentId: string, amountMinor: number, currency: string): Promise<RzpPayment> {
  if (!RZP_PAYMENT_RE.test(paymentId)) throw new GatewayError('Unknown payment', 400);
  const p = asRzpPayment(await rzp('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountMinor, currency }));
  if (!p || p.id !== paymentId) throw new GatewayError('Razorpay sent a payment we could not read', 502);
  return p;
}

/** Checkout's handler signature: hex HMAC-SHA256("<order_id>|<payment_id>", key secret). */
export async function rzpCheckoutSignatureOk(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const secret = env().razorpay.keySecret;
  if (!secret) return false;
  const sig = String(signature ?? '').trim().toLowerCase();
  const expected = await hmacHex(secret, `${orderId}|${paymentId}`);
  // compare even when the format is wrong, so timing says nothing about which check failed
  return safeEqual(expected, sig) && HEX64.test(sig);
}

/** X-Razorpay-Signature: hex HMAC-SHA256 of the raw request body with the webhook secret. */
export async function rzpWebhookSignatureOk(raw: Uint8Array, signature: string | null): Promise<boolean> {
  const secret = env().razorpay.webhookSecret;
  if (!secret) return false;
  const sig = String(signature ?? '').trim().toLowerCase();
  const expected = await hmacHex(secret, raw);
  return safeEqual(expected, sig) && HEX64.test(sig);
}
