// Fake Razorpay, Stripe and PayPal APIs, hosted on the harness's fake server (DESIGN.md §4.C).
//
//   const gw = await installGatewayFakes(h);     // registers the routes and points the API at them
//   const { paymentId, signature } = await gw.razorpay.pay(rzOrderId);   // "the customer paid"
//
// Each gateway keeps its state in plain Maps, so tests can make a payment fail, be authorized
// only, be for another amount, and so on. Webhook helpers build signed deliveries the way each
// gateway does. Nothing here reaches the internet.
import type { Harness } from '../harness.ts';
import { hmacHex } from '../../../functions/api/lib/util.ts';
import { resetPaypalTokenForTests } from '../../../functions/api/gateways/paypal.ts';

export type Gateway = 'razorpay' | 'stripe' | 'paypal';

export type FakeRzpOrder = { id: string; entity: 'order'; amount: number; amount_paid: number; currency: string; receipt: string | null; notes: Record<string, unknown>; status: 'created' | 'attempted' | 'paid'; created_at: number };
export type FakeRzpPayment = {
  id: string; entity: 'payment'; order_id: string; amount: number; currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'; method: string; captured: boolean;
  amount_refunded: number; refund_status: null | 'partial' | 'full'; error_description: string | null; created_at: number;
};
export type FakeStripeSession = {
  id: string; object: 'checkout.session'; url: string; mode: string; status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid'; client_reference_id: string | null; customer_email: string | null;
  metadata: Record<string, string>; amount_total: number; currency: string; payment_intent: string | null;
  success_url: string; cancel_url: string; idempotency_key: string | null;
};
// deno-lint-ignore no-explicit-any
export type FakePaypalOrder = { id: string; status: string; intent: string; purchase_units: any[]; links: { href: string; rel: string; method: string }[]; request_id: string | null };
export type FakeCaptureSetup = { status?: string; value?: string; currency?: string };
export type Delivery = { raw: Uint8Array; text: string; headers: Record<string, string> };

export type GatewayFakes = {
  keys: {
    razorpayKeyId: string; razorpayKeySecret: string; razorpayWebhookSecret: string;
    stripeSecretKey: string; stripeWebhookSecret: string;
    paypalClientId: string; paypalSecret: string; paypalWebhookId: string;
  };
  /** The env names installGatewayFakes sets (keys + API bases). */
  env: Record<string, string>;
  /** Connects the gateways (all by default) — sets their env names again. */
  configure(which?: Gateway[]): void;
  /** Disconnects gateways (all by default): removes their keys from the env. */
  unconfigure(which?: Gateway[]): void;
  /** The next request to this gateway (whose path contains `path`, if given) answers with this
   *  status and body instead. PayPal's OAuth token call is never failed unless `path` names it. */
  failNext(gateway: Gateway, o?: { status?: number; body?: unknown; path?: string }): void;
  /** Requests each fake received: method, path, parsed body. */
  log: { gateway: Gateway; method: string; path: string; body: unknown; headers: Record<string, string> }[];
  razorpay: {
    orders: Map<string, FakeRzpOrder>;
    payments: Map<string, FakeRzpPayment>;
    /** The customer pays an order in Razorpay Checkout. Returns the handler's payment id and
     *  signature (signed with the key secret, as Checkout does). */
    pay(orderId: string, o?: { amount?: number; currency?: string; status?: FakeRzpPayment['status']; method?: string }): Promise<{ paymentId: string; signature: string; payment: FakeRzpPayment }>;
    signature(orderId: string, paymentId: string, secret?: string): Promise<string>;
    /** Marks a payment refunded (full by default) and returns the refund entity. */
    refund(paymentId: string, amount?: number): { id: string; entity: 'refund'; amount: number; currency: string; payment_id: string; status: 'processed' };
    /** A webhook delivery as Razorpay sends it, signed with the webhook secret (or `secret`). */
    webhook(event: string, payload: Record<string, unknown>, o?: { eventId?: string | null; secret?: string }): Promise<Delivery>;
  };
  stripe: {
    sessions: Map<string, FakeStripeSession>;
    /** The customer pays on the hosted page. */
    pay(sessionId: string, o?: { amountTotal?: number; currency?: string; paymentStatus?: 'paid' | 'unpaid' }): FakeStripeSession;
    /** A charge object for this session's payment (refunded in full unless `amountRefunded`). */
    charge(sessionId: string, o?: { amountRefunded?: number }): Record<string, unknown>;
    /** A signed webhook delivery (Stripe-Signature t=…,v1=…). */
    event(type: string, object: Record<string, unknown>, o?: { id?: string; secret?: string; timestamp?: number }): Promise<Delivery & { id: string }>;
  };
  paypal: {
    orders: Map<string, FakePaypalOrder>;
    /** The customer approves the order on PayPal's page. */
    approve(id: string): void;
    /** What the next capture of this order returns (status, value, currency). */
    setCapture(id: string, c: FakeCaptureSetup): void;
    /** Captures in the fake directly (as if PayPal settled it without our capture call). */
    captureNow(id: string): Record<string, unknown>;
    /** A refund resource for this order's capture. */
    refundResource(id: string, o?: { value?: string }): Record<string, unknown>;
    /** A webhook delivery. valid=false makes PayPal's verify API answer FAILURE. */
    webhook(type: string, resource: Record<string, unknown>, o?: { id?: string; valid?: boolean }): Delivery & { id: string };
    /** The last body the verify-webhook-signature API received (parsed, and as raw text). */
    lastVerify: Record<string, unknown> | null;
    lastVerifyText: string | null;
    /** When true, the verify API answers 503. */
    verifyDown: boolean;
  };
  uninstall(): void;
};

const enc = new TextEncoder();
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function rid(n: number, alphabet = ALNUM): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYPAL_SIG = 'fake-paypal-signature-ok';

export async function installGatewayFakes(h: Harness): Promise<GatewayFakes> {
  const keys = {
    razorpayKeyId: `rzp_test_${rid(14)}`,
    razorpayKeySecret: `rzpsecret${rid(20)}`,
    razorpayWebhookSecret: `rzpwebhook${rid(20)}`,
    stripeSecretKey: `sk_test_${rid(24)}`,
    stripeWebhookSecret: `whsec_${rid(24)}`,
    paypalClientId: `ppclient${rid(16)}`,
    paypalSecret: `ppsecret${rid(16)}`,
    paypalWebhookId: `WH${rid(16, UPPER)}`,
  };
  const envByGateway: Record<Gateway, Record<string, string>> = {
    razorpay: { RAZORPAY_KEY_ID: keys.razorpayKeyId, RAZORPAY_KEY_SECRET: keys.razorpayKeySecret, RAZORPAY_WEBHOOK_SECRET: keys.razorpayWebhookSecret, RAZORPAY_API_BASE: h.fake.url },
    stripe: { STRIPE_SECRET_KEY: keys.stripeSecretKey, STRIPE_WEBHOOK_SECRET: keys.stripeWebhookSecret, STRIPE_API_BASE: h.fake.url },
    paypal: { PAYPAL_CLIENT_ID: keys.paypalClientId, PAYPAL_SECRET: keys.paypalSecret, PAYPAL_MODE: 'sandbox', PAYPAL_WEBHOOK_ID: keys.paypalWebhookId, PAYPAL_API_BASE: h.fake.url },
  };
  const allEnv = { ...envByGateway.razorpay, ...envByGateway.stripe, ...envByGateway.paypal };

  const failures: { gateway: Gateway; status: number; body: unknown; path?: string }[] = [];
  const log: GatewayFakes['log'] = [];
  function takeFailure(gateway: Gateway, path: string): Response | null {
    const i = failures.findIndex((f) => f.gateway === gateway && (f.path ? path.includes(f.path) : !path.includes('/oauth2/')));
    if (i < 0) return null;
    const [f] = failures.splice(i, 1);
    return json(f.status, f.body ?? {});
  }
  let lastText = '';
  async function record(gateway: Gateway, req: Request, url: URL, kind: 'json' | 'form' | 'none'): Promise<unknown> {
    const text = req.method === 'GET' ? '' : await req.text();
    lastText = text;
    let body: unknown = null;
    if (kind === 'json' && text) { try { body = JSON.parse(text); } catch { body = text; } }
    if (kind === 'form') body = Object.fromEntries(new URLSearchParams(text));
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { if (k !== 'authorization') headers[k] = v; });
    log.push({ gateway, method: req.method, path: url.pathname, body, headers });
    return body;
  }

  // ── Razorpay ───────────────────────────────────────────────────────────────────────────
  const rzOrders = new Map<string, FakeRzpOrder>();
  const rzPayments = new Map<string, FakeRzpPayment>();
  const rzErr = (status: number, description: string) => json(status, { error: { code: 'BAD_REQUEST_ERROR', description, source: 'business', reason: 'input_validation_failed' } });
  const rzAuthOk = (req: Request) => req.headers.get('authorization') === 'Basic ' + btoa(`${keys.razorpayKeyId}:${keys.razorpayKeySecret}`);

  const removeRz = h.fake.route('*', '/v1/orders', async (req, url) => {
    const body = await record('razorpay', req, url, 'json') as Record<string, unknown> | null;
    const fail = takeFailure('razorpay', url.pathname);
    if (fail) return fail;
    if (!rzAuthOk(req)) return json(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    if (req.method !== 'POST' || url.pathname !== '/v1/orders') return rzErr(400, 'The requested URL was not found on the server.');
    const amount = Number(body?.amount), currency = String(body?.currency ?? '');
    if (!Number.isSafeInteger(amount) || amount < 100) return rzErr(400, 'The amount must be atleast INR 1.00');
    if (!/^[A-Z]{3}$/.test(currency)) return rzErr(400, 'The currency is invalid.');
    const o: FakeRzpOrder = {
      id: `order_${rid(14)}`, entity: 'order', amount, amount_paid: 0, currency, receipt: typeof body?.receipt === 'string' ? body.receipt : null,
      notes: (body?.notes ?? {}) as Record<string, unknown>, status: 'created', created_at: Math.floor(Date.now() / 1000),
    };
    rzOrders.set(o.id, o);
    return json(200, o);
  });
  const removeRzPay = h.fake.route('*', '/v1/payments/', async (req, url) => {
    const body = await record('razorpay', req, url, 'json') as Record<string, unknown> | null;
    const fail = takeFailure('razorpay', url.pathname);
    if (fail) return fail;
    if (!rzAuthOk(req)) return json(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    const m = /^\/v1\/payments\/([^/]+)(\/capture)?$/.exec(url.pathname);
    const p = m ? rzPayments.get(decodeURIComponent(m[1])) : undefined;
    if (!m || !p) return rzErr(400, 'The id provided does not exist');
    if (!m[2] && req.method === 'GET') return json(200, p);
    if (m[2] && req.method === 'POST') {
      if (p.status === 'captured') return rzErr(400, 'This payment has already been captured');
      if (p.status !== 'authorized') return rzErr(400, 'Only payments which have been authorized and not yet captured can be captured');
      if (Number(body?.amount) !== p.amount || String(body?.currency) !== p.currency) return rzErr(400, 'Capture amount must be equal to the amount authorized');
      p.status = 'captured';
      p.captured = true;
      const o = rzOrders.get(p.order_id);
      if (o) { o.status = 'paid'; o.amount_paid = p.amount; }
      return json(200, p);
    }
    return rzErr(400, 'The requested URL was not found on the server.');
  });

  // ── Stripe ─────────────────────────────────────────────────────────────────────────────
  const sessions = new Map<string, FakeStripeSession>();
  const stErr = (status: number, message: string, type = 'invalid_request_error') => json(status, { error: { type, message } });
  const removeSt = h.fake.route('*', '/v1/checkout/sessions', async (req, url) => {
    const body = await record('stripe', req, url, req.method === 'POST' ? 'form' : 'none') as Record<string, string> | null;
    const fail = takeFailure('stripe', url.pathname);
    if (fail) return fail;
    if (req.headers.get('authorization') !== `Bearer ${keys.stripeSecretKey}`) return stErr(401, 'Invalid API Key provided', 'authentication_error');
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const b = body ?? {};
      const unit = Number(b['line_items[0][price_data][unit_amount]']);
      const qty = Number(b['line_items[0][quantity]'] ?? 1);
      if (!Number.isSafeInteger(unit) || unit <= 0) return stErr(400, 'Invalid integer: line_items[0][price_data][unit_amount]');
      const id = `cs_test_${rid(40)}`;
      const s: FakeStripeSession = {
        id, object: 'checkout.session', url: `https://checkout.stripe.test/c/pay/${id}`, mode: b.mode ?? 'payment', status: 'open', payment_status: 'unpaid',
        client_reference_id: b.client_reference_id ?? null, customer_email: b.customer_email ?? null,
        metadata: Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])),
        amount_total: unit * qty, currency: String(b['line_items[0][price_data][currency]'] ?? ''), payment_intent: null,
        success_url: b.success_url ?? '', cancel_url: b.cancel_url ?? '', idempotency_key: req.headers.get('idempotency-key'),
      };
      sessions.set(id, s);
      return json(200, s);
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(url.pathname);
    const s = m ? sessions.get(decodeURIComponent(m[1])) : undefined;
    if (!m || !s) return stErr(404, 'No such checkout.session');
    if (!m[2] && req.method === 'GET') return json(200, s);
    if (m[2] && req.method === 'POST') {
      if (s.status !== 'open') return stErr(400, 'Only Checkout Sessions with a status of open can be expired.');
      s.status = 'expired';
      return json(200, s);
    }
    return stErr(404, 'Unrecognized request URL');
  });

  // ── PayPal ─────────────────────────────────────────────────────────────────────────────
  const ppOrders = new Map<string, FakePaypalOrder>();
  const captureSetup = new Map<string, FakeCaptureSetup>();
  const ppTokens = new Set<string>();
  const ppErr = (status: number, issue: string, description: string) => json(status, { name: status === 422 ? 'UNPROCESSABLE_ENTITY' : 'INVALID_REQUEST', message: description, details: [{ issue, description }] });
  const ppAuthOk = (req: Request) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '');
    return !!m && ppTokens.has(m[1]);
  };
  const removePpToken = h.fake.route('*', '/v1/oauth2/token', async (req, url) => {
    await record('paypal', req, url, 'none');
    const fail = takeFailure('paypal', url.pathname);
    if (fail) return fail;
    if (req.headers.get('authorization') !== 'Basic ' + btoa(`${keys.paypalClientId}:${keys.paypalSecret}`)) {
      return json(401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
    }
    const t = `A21AA${rid(40)}`;
    ppTokens.add(t);
    return json(200, { scope: 'https://uri.paypal.com/services/payments/payment', access_token: t, token_type: 'Bearer', app_id: 'APP-TEST', expires_in: 32400, nonce: rid(10) });
  });

  function doCapture(o: FakePaypalOrder): Record<string, unknown> {
    const unit = o.purchase_units[0];
    const setup = captureSetup.get(o.id) ?? {};
    const capture = {
      id: rid(17, UPPER), status: setup.status ?? 'COMPLETED',
      amount: { currency_code: setup.currency ?? unit.amount.currency_code, value: setup.value ?? unit.amount.value },
      final_capture: true, custom_id: unit.custom_id, invoice_id: unit.invoice_id,
      supplementary_data: { related_ids: { order_id: o.id } },
      links: [{ href: `${h.fake.url}/v2/payments/captures/CAPTURE`, rel: 'self', method: 'GET' }],
    };
    capture.links[0].href = `${h.fake.url}/v2/payments/captures/${capture.id}`;
    unit.payments = { captures: [capture] };
    o.status = 'COMPLETED';
    return capture;
  }

  const removePpOrders = h.fake.route('*', '/v2/checkout/orders', async (req, url) => {
    const body = await record('paypal', req, url, 'json') as Record<string, unknown> | null;
    const fail = takeFailure('paypal', url.pathname);
    if (fail) return fail;
    if (!ppAuthOk(req)) return json(401, { error: 'invalid_token', error_description: 'Token signature verification failed' });
    if (req.method === 'POST' && url.pathname === '/v2/checkout/orders') {
      // deno-lint-ignore no-explicit-any
      const units = Array.isArray(body?.purchase_units) ? body!.purchase_units as any[] : [];
      const u = units[0];
      if (!u?.amount?.value || !u?.amount?.currency_code) return ppErr(400, 'MISSING_REQUIRED_PARAMETER', 'A required field / parameter is missing.');
      const id = rid(17, UPPER);
      const o: FakePaypalOrder = {
        id, status: 'CREATED', intent: String(body?.intent ?? ''), purchase_units: [{ ...u }], request_id: req.headers.get('paypal-request-id'),
        links: [
          { href: `${h.fake.url}/v2/checkout/orders/${id}`, rel: 'self', method: 'GET' },
          { href: `https://www.sandbox.paypal.test/checkoutnow?token=${id}`, rel: 'payer-action', method: 'GET' },
        ],
      };
      ppOrders.set(id, o);
      return json(200, o);
    }
    const m = /^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/.exec(url.pathname);
    const o = m ? ppOrders.get(decodeURIComponent(m[1])) : undefined;
    if (!m || !o) return ppErr(404, 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist. Please check the resource ID and try again.');
    if (!m[2] && req.method === 'GET') return json(200, o);
    if (m[2] && req.method === 'POST') {
      if (o.status === 'COMPLETED') return ppErr(422, 'ORDER_ALREADY_CAPTURED', 'Order already captured.If \'intent=CAPTURE\' only one capture per order is allowed.');
      if (o.status !== 'APPROVED') return ppErr(422, 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.');
      doCapture(o);
      return json(201, o);
    }
    return ppErr(404, 'NOT_FOUND', 'Not found');
  });

  const pp: GatewayFakes['paypal'] = {
    orders: ppOrders,
    approve(id) {
      const o = ppOrders.get(id);
      if (!o) throw new Error(`fake paypal: no order ${id}`);
      o.status = 'APPROVED';
    },
    setCapture(id, c) { captureSetup.set(id, c); },
    captureNow(id) {
      const o = ppOrders.get(id);
      if (!o) throw new Error(`fake paypal: no order ${id}`);
      return doCapture(o);
    },
    refundResource(id, o = {}) {
      const order = ppOrders.get(id);
      const cap = order?.purchase_units[0]?.payments?.captures?.[0];
      if (!order || !cap) throw new Error(`fake paypal: order ${id} has no capture`);
      const value = o.value ?? cap.amount.value;
      return {
        id: rid(17, UPPER), status: 'COMPLETED', amount: { currency_code: cap.amount.currency_code, value },
        custom_id: cap.custom_id, invoice_id: cap.invoice_id,
        seller_payable_breakdown: { total_refunded_amount: { currency_code: cap.amount.currency_code, value } },
        links: [
          { href: `${h.fake.url}/v2/payments/refunds/R`, rel: 'self', method: 'GET' },
          { href: `${h.fake.url}/v2/payments/captures/${cap.id}`, rel: 'up', method: 'GET' },
        ],
      };
    },
    webhook(type, resource, o = {}) {
      const id = o.id ?? `WH-${rid(17, UPPER)}-${rid(17, UPPER)}`;
      const event = { id, event_version: '1.0', create_time: new Date().toISOString(), resource_type: 'capture', event_type: type, summary: type, resource };
      // PayPal's own spacing, so a re-serialised copy would differ from the raw bytes
      const text = JSON.stringify(event, null, 1);
      return {
        id, text, raw: enc.encode(text),
        headers: {
          'content-type': 'application/json',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-test',
          'paypal-transmission-id': crypto.randomUUID(),
          'paypal-transmission-sig': o.valid === false ? 'forged-signature' : VALID_PAYPAL_SIG,
          'paypal-transmission-time': new Date().toISOString(),
        },
      };
    },
    lastVerify: null,
    lastVerifyText: null,
    verifyDown: false,
  };

  const removePpVerify = h.fake.route('*', '/v1/notifications/verify-webhook-signature', async (req, url) => {
    const body = await record('paypal', req, url, 'json') as Record<string, unknown> | null;
    pp.lastVerifyText = lastText;
    const fail = takeFailure('paypal', url.pathname);
    if (fail) return fail;
    if (!ppAuthOk(req)) return json(401, { error: 'invalid_token', error_description: 'Token signature verification failed' });
    if (pp.verifyDown) return json(503, { name: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' });
    pp.lastVerify = body;
    const ok = !!body && body.webhook_id === keys.paypalWebhookId && body.transmission_sig === VALID_PAYPAL_SIG
      && !!body.webhook_event && typeof body.webhook_event === 'object';
    return json(200, { verification_status: ok ? 'SUCCESS' : 'FAILURE' });
  });

  const fakes: GatewayFakes = {
    keys,
    env: allEnv,
    configure(which = ['razorpay', 'stripe', 'paypal']) {
      const vars: Record<string, string> = {};
      for (const g of which) Object.assign(vars, envByGateway[g]);
      h.setEnv(vars);
      resetPaypalTokenForTests();
    },
    unconfigure(which = ['razorpay', 'stripe', 'paypal']) {
      const vars: Record<string, undefined> = {};
      for (const g of which) for (const k of Object.keys(envByGateway[g])) if (!k.endsWith('_API_BASE')) vars[k] = undefined;
      h.setEnv(vars);
      resetPaypalTokenForTests();
    },
    failNext(gateway, o = {}) {
      failures.push({ gateway, status: o.status ?? 500, body: o.body ?? null, path: o.path });
    },
    log,
    razorpay: {
      orders: rzOrders,
      payments: rzPayments,
      async pay(orderId, o = {}) {
        const order = rzOrders.get(orderId);
        if (!order) throw new Error(`fake razorpay: no order ${orderId}`);
        const status = o.status ?? 'captured';
        const p: FakeRzpPayment = {
          id: `pay_${rid(14)}`, entity: 'payment', order_id: orderId, amount: o.amount ?? order.amount, currency: o.currency ?? order.currency,
          status, method: o.method ?? 'upi', captured: status === 'captured', amount_refunded: 0, refund_status: null,
          error_description: status === 'failed' ? 'Payment failed because the card was declined.' : null, created_at: Math.floor(Date.now() / 1000),
        };
        rzPayments.set(p.id, p);
        order.status = status === 'captured' ? 'paid' : 'attempted';
        if (status === 'captured') order.amount_paid = p.amount;
        return { paymentId: p.id, signature: await hmacHex(keys.razorpayKeySecret, `${orderId}|${p.id}`), payment: p };
      },
      signature: (orderId, paymentId, secret) => hmacHex(secret ?? keys.razorpayKeySecret, `${orderId}|${paymentId}`),
      refund(paymentId, amount) {
        const p = rzPayments.get(paymentId);
        if (!p) throw new Error(`fake razorpay: no payment ${paymentId}`);
        const a = amount ?? p.amount - p.amount_refunded;
        p.amount_refunded += a;
        p.refund_status = p.amount_refunded >= p.amount ? 'full' : 'partial';
        if (p.refund_status === 'full') p.status = 'refunded';
        return { id: `rfnd_${rid(14)}`, entity: 'refund', amount: a, currency: p.currency, payment_id: p.id, status: 'processed' };
      },
      async webhook(event, payload, o = {}) {
        const body = { entity: 'event', account_id: 'acc_TEST12345678', event, contains: Object.keys(payload), payload, created_at: Math.floor(Date.now() / 1000) };
        const text = JSON.stringify(body);
        const raw = enc.encode(text);
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-razorpay-signature': await hmacHex(o.secret ?? keys.razorpayWebhookSecret, raw),
        };
        const eventId = o.eventId === undefined ? `evt_${rid(14)}` : o.eventId;
        if (eventId) headers['x-razorpay-event-id'] = eventId;
        return { raw, text, headers };
      },
    },
    stripe: {
      sessions,
      pay(sessionId, o = {}) {
        const s = sessions.get(sessionId);
        if (!s) throw new Error(`fake stripe: no session ${sessionId}`);
        s.payment_status = o.paymentStatus ?? 'paid';
        s.status = 'complete';
        if (o.amountTotal !== undefined) s.amount_total = o.amountTotal;
        if (o.currency !== undefined) s.currency = o.currency;
        s.payment_intent = s.payment_intent ?? `pi_${rid(24)}`;
        return s;
      },
      charge(sessionId, o = {}) {
        const s = sessions.get(sessionId);
        if (!s || !s.payment_intent) throw new Error(`fake stripe: session ${sessionId} is not paid`);
        const refunded = o.amountRefunded ?? s.amount_total;
        return {
          id: `ch_${rid(24)}`, object: 'charge', amount: s.amount_total, amount_captured: s.amount_total, amount_refunded: refunded,
          currency: s.currency, payment_intent: s.payment_intent, refunded: refunded >= s.amount_total, status: 'succeeded', metadata: {},
        };
      },
      async event(type, object, o = {}) {
        const id = o.id ?? `evt_${rid(24)}`;
        const text = JSON.stringify({ id, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), type, livemode: false, data: { object } });
        const raw = enc.encode(text);
        const t = o.timestamp ?? Math.floor(Date.now() / 1000);
        const sig = await hmacHex(o.secret ?? keys.stripeWebhookSecret, `${t}.${text}`);
        return { id, raw, text, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig},v0=${'0'.repeat(64)}` } };
      },
    },
    paypal: pp,
    uninstall() {
      for (const f of [removeRz, removeRzPay, removeSt, removePpToken, removePpOrders, removePpVerify]) f();
      fakes.unconfigure();
    },
  };
  fakes.configure();
  return fakes;
}
