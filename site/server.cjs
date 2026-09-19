/* Learn With Why — static server + pricing/checkout API.
   node server.cjs   → http://127.0.0.1:4173

   The API is the only place prices are computed. The browser sends the
   class, plan, coupon and address; the server looks the prices up in its
   own database (data/db.json), works out currency, tax and fees, and returns
   a quote signed with an HMAC. The order endpoint accepts only a quote whose
   signature still verifies and has not expired — so nothing the customer
   edits in the page can change what they pay. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');
const PORT = +(process.env.PORT || 4173);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

/* ---------------- database (a JSON file; swap for Postgres later) ---------------- */
const DEFAULT_DB = {
  secret: crypto.randomBytes(32).toString('hex'),
  /* base prices in INR — the source of truth */
  plans: { m1: { label: '1 month', months: 1, price: 199 }, m3: { label: '3 months', months: 3, price: 499 }, y1: { label: '1 year', months: 12, price: 1499 } },
  classes: { nursery: 'Nursery', kg: 'Kindergarten', c1: 'Class 1', c2: 'Class 2', c3: 'Class 3' },
  coupons: {},          /* CODE: { pct, max, uses, active } */
  discounts: {},        /* classId: pct */
  /* INR → currency, refreshed by an admin or a cron in production */
  rates: { INR: 1, USD: 0.012, EUR: 0.011, GBP: 0.0094, AED: 0.044, AUD: 0.018, CAD: 0.016, SGD: 0.016, NZD: 0.02, JPY: 1.8 },
  /* platform / payment fee */
  fees: { IN: { pct: 2, fixed: 3 }, INTL: { pct: 3.9, fixed: 0.3 } },
  orders: [],
};
/* Countries: currency, tax, postal format, address vocabulary */
const COUNTRIES = {
  IN: { name: 'India', currency: 'INR', tax: { label: 'GST 18%', pct: 18 }, postal: { label: 'PIN code', re: /^[1-9][0-9]{5}$/, hint: '6 digits, e.g. 411001' }, state: 'State', states: ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'], methods: ['razorpay', 'paypal', 'stripe'] },
  US: { name: 'United States', currency: 'USD', tax: { label: 'Sales tax', pct: 0 }, postal: { label: 'ZIP code', re: /^\d{5}(-\d{4})?$/, hint: '5 digits, e.g. 94107' }, state: 'State', states: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'], methods: ['stripe', 'paypal'] },
  GB: { name: 'United Kingdom', currency: 'GBP', tax: { label: 'VAT 20%', pct: 20 }, postal: { label: 'Postcode', re: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, hint: 'e.g. SW1A 1AA' }, state: 'County', methods: ['stripe', 'paypal'] },
  AE: { name: 'United Arab Emirates', currency: 'AED', tax: { label: 'VAT 5%', pct: 5 }, postal: { label: 'P.O. Box / postal code', re: /^.{0,12}$/, hint: 'optional' }, state: 'Emirate', states: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'], methods: ['stripe', 'paypal'] },
  AU: { name: 'Australia', currency: 'AUD', tax: { label: 'GST 10%', pct: 10 }, postal: { label: 'Postcode', re: /^\d{4}$/, hint: '4 digits, e.g. 2000' }, state: 'State / territory', states: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'], methods: ['stripe', 'paypal'] },
  CA: { name: 'Canada', currency: 'CAD', tax: { label: 'GST 5%', pct: 5 }, postal: { label: 'Postal code', re: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i, hint: 'e.g. M5V 3L9' }, state: 'Province', states: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'], methods: ['stripe', 'paypal'] },
  SG: { name: 'Singapore', currency: 'SGD', tax: { label: 'GST 9%', pct: 9 }, postal: { label: 'Postal code', re: /^\d{6}$/, hint: '6 digits' }, state: 'District', methods: ['stripe', 'paypal'] },
  DE: { name: 'Germany', currency: 'EUR', tax: { label: 'VAT 19%', pct: 19 }, postal: { label: 'PLZ', re: /^\d{5}$/, hint: '5 digits' }, state: 'State', methods: ['stripe', 'paypal'] },
  FR: { name: 'France', currency: 'EUR', tax: { label: 'VAT 20%', pct: 20 }, postal: { label: 'Code postal', re: /^\d{5}$/, hint: '5 digits' }, state: 'Region', methods: ['stripe', 'paypal'] },
  NL: { name: 'Netherlands', currency: 'EUR', tax: { label: 'VAT 21%', pct: 21 }, postal: { label: 'Postcode', re: /^\d{4} ?[A-Z]{2}$/i, hint: 'e.g. 1012 AB' }, state: 'Province', methods: ['stripe', 'paypal'] },
  IE: { name: 'Ireland', currency: 'EUR', tax: { label: 'VAT 23%', pct: 23 }, postal: { label: 'Eircode', re: /^[A-Z\d]{3} ?[A-Z\d]{4}$/i, hint: 'e.g. D02 X285' }, state: 'County', methods: ['stripe', 'paypal'] },
  NZ: { name: 'New Zealand', currency: 'NZD', tax: { label: 'GST 15%', pct: 15 }, postal: { label: 'Postcode', re: /^\d{4}$/, hint: '4 digits' }, state: 'Region', methods: ['stripe', 'paypal'] },
  JP: { name: 'Japan', currency: 'JPY', tax: { label: 'Consumption tax 10%', pct: 10 }, postal: { label: 'Postal code', re: /^\d{3}-?\d{4}$/, hint: 'e.g. 100-0001' }, state: 'Prefecture', methods: ['stripe', 'paypal'] },
  OTHER: { name: 'Other country', currency: 'USD', tax: { label: 'Tax', pct: 0 }, postal: { label: 'Postal / ZIP code', re: /^[A-Z\d \-]{3,10}$/i, hint: '3–10 characters' }, state: 'State / region', methods: ['stripe', 'paypal'] },
};
const CURRENCY_DECIMALS = { JPY: 0 };

function loadDb() {
  try { const d = JSON.parse(fs.readFileSync(dbFile, 'utf8')); return Object.assign({}, DEFAULT_DB, d, { plans: Object.assign({}, DEFAULT_DB.plans, d.plans || {}) }); }
  catch (_) { saveDb(DEFAULT_DB); return JSON.parse(JSON.stringify(DEFAULT_DB)); }
}
function saveDb(db) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); }
let db = loadDb();

/* ---------------- pricing ---------------- */
const round = (n, c) => { const d = CURRENCY_DECIMALS[c] == null ? 2 : CURRENCY_DECIMALS[c]; const f = Math.pow(10, d); return Math.round(n * f) / f; };
function validateAddress(a) {
  const errors = {};
  const cc = COUNTRIES[a.country] ? a.country : null;
  if (!cc) errors.country = 'Choose a country.';
  if (!a.line1 || String(a.line1).trim().length < 4) errors.line1 = 'Enter your street address.';
  if (!a.city || String(a.city).trim().length < 2) errors.city = 'Enter your city.';
  if (cc && COUNTRIES[cc].states && !COUNTRIES[cc].states.includes(String(a.state || ''))) errors.state = 'Choose your ' + COUNTRIES[cc].state.toLowerCase() + '.';
  if (cc && !COUNTRIES[cc].states && !String(a.state || '').trim()) errors.state = 'Enter your ' + COUNTRIES[cc].state.toLowerCase() + '.';
  if (cc && !COUNTRIES[cc].postal.re.test(String(a.postal || '').trim())) errors.postal = COUNTRIES[cc].postal.label + ' — ' + COUNTRIES[cc].postal.hint + '.';
  return errors;
}
function quote(body) {
  const plan = db.plans[body.plan], cls = db.classes[body.cls];
  if (!plan || !cls) return { error: 'Unknown plan or class.' };
  const a = body.address || {}; const cc = COUNTRIES[a.country] ? a.country : 'OTHER';
  const errors = validateAddress(Object.assign({}, a, { country: cc }));
  const C = COUNTRIES[cc], india = cc === 'IN', currency = C.currency, rate = db.rates[currency] || 1;
  /* everything below is worked out in INR, then converted */
  let baseInr = plan.price, discount = 0, coupon = null;
  const d = db.discounts[body.cls]; if (d) discount += plan.price * d / 100;
  const code = String(body.coupon || '').trim().toUpperCase();
  if (code) { const cp = db.coupons[code]; if (cp && cp.active !== false && (!cp.max || (cp.uses || 0) < cp.max)) { coupon = code; discount += (plan.price - discount) * cp.pct / 100; } }
  const netInr = Math.max(0, baseInr - discount);
  const base = round(netInr * rate, currency);
  const tax = round(base * C.tax.pct / 100, currency);
  const fee = india ? round(base * db.fees.IN.pct / 100 + db.fees.IN.fixed, currency) : round(base * db.fees.INTL.pct / 100 + db.fees.INTL.fixed * (currency === 'USD' ? 1 : rate / (db.rates.USD || 0.012)), currency);
  const total = round(base + tax + fee, currency);
  const q = {
    cls: body.cls, className: cls, plan: body.plan, planLabel: plan.label, months: plan.months,
    country: cc, countryName: C.name, region: india ? 'IN' : 'INTL', currency, rate,
    lines: [
      { label: 'Base price' + (discount ? ' (after discount)' : ''), amount: base, note: discount ? 'List ' + fmtMoney(round(plan.price * rate, currency), currency) : (currency !== 'INR' ? 'converted from ₹' + plan.price : '') },
      { label: C.tax.label, amount: tax, note: C.tax.pct ? C.tax.pct + '% of the base price' : 'No tax collected for this region' },
      { label: 'Platform & payment fee', amount: fee, note: india ? db.fees.IN.pct + '% + ₹' + db.fees.IN.fixed : db.fees.INTL.pct + '% + ' + fmtMoney(round(db.fees.INTL.fixed * (currency === 'USD' ? 1 : rate / (db.rates.USD || 0.012)), currency), currency) },
    ],
    total, coupon, discountInr: round(discount, 'INR'),
    methods: C.methods, address: { country: cc, line1: String(a.line1 || '').trim(), city: String(a.city || '').trim(), state: String(a.state || '').trim(), postal: String(a.postal || '').trim().toUpperCase() },
    valid: Object.keys(errors).length === 0, errors, exp: Date.now() + 15 * 60 * 1000,
  };
  return sign(q);
}
function fmtMoney(n, c) { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c, maximumFractionDigits: CURRENCY_DECIMALS[c] == null ? 2 : 0 }).format(n); } catch (_) { return c + ' ' + n; } }
function canon(q) { const { sig, ...rest } = q; return JSON.stringify(rest, Object.keys(rest).sort()); }
function sign(q) { q.sig = crypto.createHmac('sha256', db.secret).update(canon(q)).digest('hex'); return q; }
function verify(q) { if (!q || typeof q !== 'object' || !q.sig) return false; const expect = crypto.createHmac('sha256', db.secret).update(canon(q)).digest('hex'); return expect.length === q.sig.length && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(q.sig)) && q.exp > Date.now() && q.valid; }

/* ---------------- http ---------------- */
function json(res, code, body) { const s = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' }); res.end(s); }
function readBody(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c; if (b.length > 64 * 1024) { reject(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }
const publicCountries = () => Object.keys(COUNTRIES).map(k => ({ code: k, name: COUNTRIES[k].name, currency: COUNTRIES[k].currency, tax: COUNTRIES[k].tax.label, postal: { label: COUNTRIES[k].postal.label, hint: COUNTRIES[k].postal.hint, pattern: COUNTRIES[k].postal.re.source, flags: COUNTRIES[k].postal.re.flags }, state: COUNTRIES[k].state, states: COUNTRIES[k].states || null, methods: COUNTRIES[k].methods }));

async function api(req, res, pathname) {
  const method = req.method;
  if (method === 'GET' && pathname === '/api/config') return json(res, 200, { countries: publicCountries(), plans: db.plans, classes: db.classes, currencies: Object.keys(db.rates), server: 'learn-with-why', version: '1' });
  if (method === 'GET' && pathname === '/api/geo') {
    /* behind a real host use the CDN's country header; locally we can only guess */
    const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
    return json(res, 200, { country: hdr && COUNTRIES[String(hdr).toUpperCase()] ? String(hdr).toUpperCase() : null });
  }
  if (method === 'POST' && pathname === '/api/quote') { const body = await readBody(req); const q = quote(body); return json(res, q.error ? 400 : 200, q); }
  if (method === 'POST' && pathname === '/api/order') {
    const body = await readBody(req); const q = body.quote;
    if (!verify(q)) return json(res, 400, { error: 'This quote is not valid any more — refresh the price and try again.' });
    if (!q.methods.includes(body.method)) return json(res, 400, { error: 'That payment method is not available in ' + q.countryName + '.' });
    const email = String(body.email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Sign in before paying.' });
    const id = 'LWO-' + Math.floor(100000 + Math.random() * 900000);
    const order = { id, at: Date.now(), email, name: String(body.name || '').slice(0, 80), cls: q.cls, plan: q.plan, months: q.months, currency: q.currency, region: q.region, lines: q.lines, total: q.total, totalInr: round(q.total / q.rate, 'INR'), coupon: q.coupon, address: q.address, method: body.method, status: 'paid', demo: true };
    db.orders.push(order); if (q.coupon && db.coupons[q.coupon]) db.coupons[q.coupon].uses = (db.coupons[q.coupon].uses || 0) + 1; saveDb(db);
    /* here the real gateway is called; the subscription is granted from its webhook */
    return json(res, 200, { ok: true, order });
  }
  if (pathname.startsWith('/api/admin/')) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 401, { error: 'Admin key required.' });
    if (method === 'GET' && pathname === '/api/admin/orders') return json(res, 200, { orders: db.orders });
    if (method === 'PUT' && pathname === '/api/admin/plans') { const b = await readBody(req); Object.keys(b).forEach(k => { if (db.plans[k] && +b[k] >= 0) db.plans[k].price = +b[k]; }); saveDb(db); return json(res, 200, { plans: db.plans }); }
    if (method === 'PUT' && pathname === '/api/admin/coupons') { const b = await readBody(req); db.coupons = {}; (b.coupons || []).forEach(c => { if (c && c.code) db.coupons[String(c.code).toUpperCase()] = { pct: +c.pct || 0, max: +c.max || 0, uses: +c.uses || 0, active: c.active !== false }; }); db.discounts = {}; Object.keys(b.discounts || {}).forEach(k => { if (db.classes[k]) db.discounts[k] = Math.max(0, Math.min(90, +b.discounts[k] || 0)); }); saveDb(db); return json(res, 200, { ok: true }); }
    if (method === 'PUT' && pathname === '/api/admin/orders') { const b = await readBody(req); const o = db.orders.find(x => x.id === b.id); if (!o) return json(res, 404, { error: 'No such order.' }); o.status = String(b.status || o.status); saveDb(db); return json(res, 200, { order: o }); }
  }
  json(res, 404, { error: 'Not found' });
}

http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) return api(req, res, pathname).catch(err => json(res, 400, { error: err.message || 'Bad request' }));
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Learn With Why: http://127.0.0.1:' + PORT + '  (API at /api/*, db at data/db.json)'));
