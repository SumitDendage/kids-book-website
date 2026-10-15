// A local stand-in for the live API, for trying the website and for browser tests.
//
// It runs the real `api` function (functions/api) against a local database, with the same fakes
// the API tests use: Supabase Auth and Storage, Razorpay/Stripe/PayPal and a mail capture.
// Nothing here reaches the internet, and none of it is deployed.
//
//   LWW_TEST_DB=lww_dev tests/local/reset-db.sh            # fresh database (once, or to start over)
//   LWW_TEST_DB=lww_dev deno run -A tests/dev-server.ts --port 54321 \
//       --origin http://127.0.0.1:5173 --files ../backend/protected
//
// Then run the website with VITE_API_BASE_URL=http://127.0.0.1:54321/functions/v1
//
// Extra routes for people and browser tests (dev server only, never in the real API):
//   GET  /__dev/users                  the seeded owner and customer, with their passwords
//   GET  /__dev/mail?to=a@b.c          captured emails, newest first (text only)
//   GET  /__dev/razorpay/checkout.js   a stand-in for Razorpay Checkout: open() "pays" at once
//   POST /__dev/razorpay/pay           {order_id} → the handler response Razorpay would give
//   POST /__dev/expire                 {email} → that customer's paid access ends now
//   POST /__dev/reset-limits           forget rate-limit counters
import { startHarness } from './api/harness.ts';
import { installGatewayFakes } from './api/fakes/gateways.ts';
import { handle } from '../functions/api/lib/app.ts';

function arg(name: string, fallback: string | null = null): string | null {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && Deno.args[i + 1] ? Deno.args[i + 1] : fallback;
}

const port = Number(arg('port', '54321'));
const origins = (arg('origin', 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const filesDir = arg('files');
const devIp = arg('ip', '10.20.30.40')!;

const h = await startHarness();
const gw = await installGatewayFakes(h);
h.setEnv({ SITE_URL: origins[0], ALLOWED_ORIGINS: origins.join(','), LWW_VERSION: 'dev' });

// ── seed: an owner and a customer, and the worksheet files ──────────────────────────────────
const owner = await h.staff('owner', undefined, { email: 'owner@dev.local', name: 'Dev Owner' });
const customer = await h.customer({ email: 'parent@dev.local', name: 'Dev Parent' });

const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
let uploaded = 0;
async function uploadDir(root: string, rel = '') {
  for await (const e of Deno.readDir(`${root}/${rel}`)) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) await uploadDir(root, path);
    else if (e.isFile) {
      const type = TYPES[e.name.split('.').pop()?.toLowerCase() ?? ''];
      if (!type) continue;
      await h.storage.put('worksheets', path, await Deno.readFile(`${root}/${path}`), type);
      uploaded++;
    }
  }
}
if (filesDir) await uploadDir(filesDir.replace(/\/+$/, ''));
// Without real files, give the free sheets a small sample PDF so the viewer has something to show.
if (!uploaded) {
  const free = await h.sql<{ id: string }[]>`select id from products where price_inr = 0 and status = 'active'`;
  for (const p of free) await h.uploadPdfFor(p.id, 2);
}
const missing = await h.sql<{ n: number }[]>`select count(*)::int as n from products where status = 'active' and pdf_path is not null`;

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────
const devHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' };
const devJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...devHeaders, 'Content-Type': 'application/json' } });

const CHECKOUT_JS = `// dev stand-in for https://checkout.razorpay.com/v1/checkout.js
(function () {
  var base = ${JSON.stringify(`http://127.0.0.1:${port}`)};
  function Razorpay(options) { this.options = options || {}; this.handlers = {}; }
  Razorpay.prototype.on = function (name, fn) { this.handlers[name] = fn; };
  Razorpay.prototype.open = function () {
    var o = this.options, self = this;
    fetch(base + '/__dev/razorpay/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: o.order_id }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) { if (self.handlers['payment.failed']) self.handlers['payment.failed']({ error: { description: res.error } }); return; }
        if (o.handler) o.handler(res);
      })
      .catch(function (e) { if (o.modal && o.modal.ondismiss) o.modal.ondismiss(); console.error(e); });
  };
  Razorpay.prototype.close = function () {};
  window.Razorpay = Razorpay;
})();
`;

async function devRoute(req: Request, url: URL): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...devHeaders, 'Access-Control-Allow-Methods': 'GET, POST' } });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /__dev/users':
      return devJson(200, {
        owner: { email: owner.email, password: owner.password },
        customer: { email: customer.email, password: customer.password },
      });
    case 'GET /__dev/mail': {
      const to = url.searchParams.get('to');
      const list = (to ? h.mail.to(to) : h.mail.sent).slice().reverse()
        .map((m) => ({ to: m.to, subject: m.subject, text: m.text, at: new Date(m.at).toISOString() }));
      return devJson(200, { mail: list });
    }
    case 'GET /__dev/razorpay/checkout.js':
      return new Response(CHECKOUT_JS, { headers: { ...devHeaders, 'Content-Type': 'text/javascript' } });
    case 'POST /__dev/razorpay/pay': {
      const orderId = String(body.order_id ?? '');
      if (!gw.razorpay.orders.has(orderId)) return devJson(404, { error: 'No such Razorpay order in the fake.' });
      const p = await gw.razorpay.pay(orderId);
      return devJson(200, { razorpay_order_id: orderId, razorpay_payment_id: p.paymentId, razorpay_signature: p.signature });
    }
    case 'POST /__dev/expire': {
      const email = String(body.email ?? '').toLowerCase();
      const r = await h.sql`
        update entitlements e set
          purchased_at = least(e.purchased_at, now() - interval '2 minutes'),
          starts_at = least(e.starts_at, now() - interval '2 minutes'),
          expires_at = now() - interval '1 minute'
        from profiles p
        where p.id = e.user_id and lower(p.email) = ${email} and e.kind <> 'free' and e.revoked_at is null`;
      return devJson(200, { expired: r.count });
    }
    case 'POST /__dev/reset-limits': {
      const r = await h.sql`delete from private.rate_limits`;
      return devJson(200, { cleared: r.count });
    }
  }
  return devJson(404, { error: 'Unknown dev route.' });
}

Deno.serve({ port, hostname: '127.0.0.1', onListen() {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/__dev/')) return devRoute(req, url);
  if (!url.pathname.startsWith('/functions/v1/')) return new Response('Learn With Why dev API: use /functions/v1/api/…', { status: 404 });
  // The browser sends no forwarding header locally; the live platform always does.
  const headers = new Headers(req.headers);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', devIp);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  return handle(new Request(req.url, { method: req.method, headers, body }), { awaitBackground: true });
});

console.log(`Learn With Why dev API on http://127.0.0.1:${port}/functions/v1/api (database ${h.db})`);
console.log(`  website: VITE_API_BASE_URL=http://127.0.0.1:${port}/functions/v1   allowed origins: ${origins.join(', ')}`);
console.log(`  owner    ${owner.email} / ${owner.password}`);
console.log(`  customer ${customer.email} / ${customer.password}`);
console.log(`  files    ${uploaded ? `${uploaded} uploaded from ${filesDir}` : 'sample PDFs for the free sheets only'}; ${missing[0].n} active sheets have a file path`);
console.log(`  Razorpay stand-in: http://127.0.0.1:${port}/__dev/razorpay/checkout.js   mail: http://127.0.0.1:${port}/__dev/mail`);
