/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* PRICING — the only place a price is computed. The browser sends what it
   wants (a class plan, or one worksheet), a coupon and the billing address;
   the server looks the base price up in the database, works out currency,
   tax and fees, and returns a quote signed with an HMAC. Only a quote whose
   signature still verifies and has not expired can become an order. */
const crypto = require('node:crypto');

const COUNTRIES = {
  IN: { name: 'India', currency: 'INR', tax: { label: 'GST 18%', pct: 18 }, postal: { label: 'PIN code', re: /^[1-9][0-9]{5}$/, hint: '6 digits, e.g. 411001' }, state: 'State', states: ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'], methods: ['razorpay', 'paypal', 'stripe'] },
  US: { name: 'United States', currency: 'USD', tax: { label: 'Sales tax', pct: 0 }, postal: { label: 'ZIP code', re: /^\d{5}(-\d{4})?$/, hint: '5 digits, e.g. 94107' }, state: 'State', states: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'], methods: ['razorpay', 'stripe', 'paypal'] },
  GB: { name: 'United Kingdom', currency: 'GBP', tax: { label: 'VAT 20%', pct: 20 }, postal: { label: 'Postcode', re: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, hint: 'e.g. SW1A 1AA' }, state: 'County', methods: ['razorpay', 'stripe', 'paypal'] },
  AE: { name: 'United Arab Emirates', currency: 'AED', tax: { label: 'VAT 5%', pct: 5 }, postal: { label: 'P.O. Box / postal code', re: /^.{0,12}$/, hint: 'optional' }, state: 'Emirate', states: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'], methods: ['razorpay', 'stripe', 'paypal'] },
  AU: { name: 'Australia', currency: 'AUD', tax: { label: 'GST 10%', pct: 10 }, postal: { label: 'Postcode', re: /^\d{4}$/, hint: '4 digits, e.g. 2000' }, state: 'State / territory', states: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'], methods: ['razorpay', 'stripe', 'paypal'] },
  CA: { name: 'Canada', currency: 'CAD', tax: { label: 'GST 5%', pct: 5 }, postal: { label: 'Postal code', re: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i, hint: 'e.g. M5V 3L9' }, state: 'Province', states: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'], methods: ['razorpay', 'stripe', 'paypal'] },
  SG: { name: 'Singapore', currency: 'SGD', tax: { label: 'GST 9%', pct: 9 }, postal: { label: 'Postal code', re: /^\d{6}$/, hint: '6 digits' }, state: 'District', methods: ['razorpay', 'stripe', 'paypal'] },
  DE: { name: 'Germany', currency: 'EUR', tax: { label: 'VAT 19%', pct: 19 }, postal: { label: 'PLZ', re: /^\d{5}$/, hint: '5 digits' }, state: 'State', methods: ['razorpay', 'stripe', 'paypal'] },
  FR: { name: 'France', currency: 'EUR', tax: { label: 'VAT 20%', pct: 20 }, postal: { label: 'Code postal', re: /^\d{5}$/, hint: '5 digits' }, state: 'Region', methods: ['razorpay', 'stripe', 'paypal'] },
  NL: { name: 'Netherlands', currency: 'EUR', tax: { label: 'VAT 21%', pct: 21 }, postal: { label: 'Postcode', re: /^\d{4} ?[A-Z]{2}$/i, hint: 'e.g. 1012 AB' }, state: 'Province', methods: ['razorpay', 'stripe', 'paypal'] },
  IE: { name: 'Ireland', currency: 'EUR', tax: { label: 'VAT 23%', pct: 23 }, postal: { label: 'Eircode', re: /^[A-Z\d]{3} ?[A-Z\d]{4}$/i, hint: 'e.g. D02 X285' }, state: 'County', methods: ['razorpay', 'stripe', 'paypal'] },
  NZ: { name: 'New Zealand', currency: 'NZD', tax: { label: 'GST 15%', pct: 15 }, postal: { label: 'Postcode', re: /^\d{4}$/, hint: '4 digits' }, state: 'Region', methods: ['razorpay', 'stripe', 'paypal'] },
  JP: { name: 'Japan', currency: 'JPY', tax: { label: 'Consumption tax 10%', pct: 10 }, postal: { label: 'Postal code', re: /^\d{3}-?\d{4}$/, hint: 'e.g. 100-0001' }, state: 'Prefecture', methods: ['razorpay', 'stripe', 'paypal'] },
  OTHER: { name: 'Other country', currency: 'USD', tax: { label: 'Tax', pct: 0 }, postal: { label: 'Postal / ZIP code', re: /^[A-Z\d \-]{3,10}$/i, hint: '3–10 characters' }, state: 'State / region', methods: ['razorpay', 'stripe', 'paypal'] },
};
const CURRENCY_DECIMALS = { JPY: 0 };
const QUOTE_TTL = 15 * 60e3;

const round = (n, c) => { const d = CURRENCY_DECIMALS[c] == null ? 2 : CURRENCY_DECIMALS[c]; const f = Math.pow(10, d); return Math.round(n * f) / f; };
/* the gateway wants the amount in the smallest unit (paise, cents, yen) */
const minorUnits = (n, c) => Math.round(n * Math.pow(10, CURRENCY_DECIMALS[c] == null ? 2 : CURRENCY_DECIMALS[c]));
function fmtMoney(n, c) { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c, maximumFractionDigits: CURRENCY_DECIMALS[c] == null ? 2 : 0 }).format(n); } catch (_) { return c + ' ' + n; } }
const publicCountries = () => Object.keys(COUNTRIES).map(k => ({ code: k, name: COUNTRIES[k].name, currency: COUNTRIES[k].currency, tax: COUNTRIES[k].tax.label, postal: { label: COUNTRIES[k].postal.label, hint: COUNTRIES[k].postal.hint, pattern: COUNTRIES[k].postal.re.source, flags: COUNTRIES[k].postal.re.flags }, state: COUNTRIES[k].state, states: COUNTRIES[k].states || null, methods: COUNTRIES[k].methods }));

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

function make(db) {
  const wsById = db.q('SELECT * FROM worksheets WHERE id = ? AND active = 1');
  const canon = q => { const { sig, ...rest } = q; return JSON.stringify(rest, Object.keys(rest).sort()); };
  const sign = q => { q.sig = crypto.createHmac('sha256', db.secret()).update(canon(q)).digest('hex'); return q; };
  function verify(q) {
    if (!q || typeof q !== 'object' || typeof q.sig !== 'string') return false;
    const expect = crypto.createHmac('sha256', db.secret()).update(canon(q)).digest('hex');
    return expect.length === q.sig.length && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(q.sig)) && q.exp > Date.now() && q.valid === true;
  }
  /* body: { cls, plan } for a class plan, or { worksheet } for one PDF; plus coupon and address */
  function quote(body) {
    const plans = db.get('plans'), classes = db.get('classes'), rates = db.get('rates'), fees = db.get('fees'), coupons = db.get('coupons'), discounts = db.get('discounts');
    let item;
    if (body.worksheet) {
      const w = wsById.get(String(body.worksheet)); if (!w) return { error: 'Unknown worksheet.' };
      if (!w.price) return { error: 'That sheet is free — just open it.' };
      item = { kind: 'worksheet', worksheet: w.id, title: w.title, cls: w.cls, className: classes[w.cls] || w.cls, priceInr: w.price, discountCls: w.cls };
    } else {
      const plan = plans[body.plan], cls = classes[body.cls];
      if (!plan || !cls) return { error: 'Unknown plan or class.' };
      if (!plansFor((body.address || {}).country).includes(body.plan)) return { error: 'The ' + plan.label + ' plan is not offered in India — choose 1, 3 or 6 months.' };
      item = { kind: 'class', cls: body.cls, className: cls, plan: body.plan, planLabel: plan.label, months: plan.months, priceInr: plan.price, discountCls: body.cls };
    }
    const a = body.address || {}; const cc = COUNTRIES[a.country] ? a.country : 'OTHER';
    const errors = validateAddress(Object.assign({}, a, { country: cc }));
    const C = COUNTRIES[cc], india = cc === 'IN', currency = C.currency, rate = rates[currency] || 1;
    /* everything below is worked out in INR, then converted */
    let discount = 0, coupon = null;
    const d = discounts[item.discountCls]; if (d) discount += item.priceInr * d / 100;
    const code = String(body.coupon || '').trim().toUpperCase();
    if (code) { const cp = coupons[code]; if (cp && cp.active !== false && (!cp.max || (cp.uses || 0) < cp.max)) { coupon = code; discount += (item.priceInr - discount) * cp.pct / 100; } }
    const netInr = Math.max(0, item.priceInr - discount);
    const base = round(netInr * rate, currency);
    const tax = round(base * C.tax.pct / 100, currency);
    const intlFixed = fees.INTL.fixed * (currency === 'USD' ? 1 : rate / (rates.USD || 0.012));
    const fee = india ? round(base * fees.IN.pct / 100 + fees.IN.fixed, currency) : round(base * fees.INTL.pct / 100 + intlFixed, currency);
    const total = round(base + tax + fee, currency);
    const q = {
      kind: item.kind, cls: item.cls, className: item.className, plan: item.plan || null, planLabel: item.planLabel || null, months: item.months || null,
      worksheet: item.worksheet || null, title: item.title || null,
      country: cc, countryName: C.name, region: india ? 'IN' : 'INTL', currency, rate,
      lines: [
        { label: 'Base price' + (discount ? ' (after discount)' : ''), amount: base, note: discount ? 'List ' + fmtMoney(round(item.priceInr * rate, currency), currency) : (currency !== 'INR' ? 'converted from ₹' + item.priceInr : '') },
        { label: C.tax.label, amount: tax, note: C.tax.pct ? C.tax.pct + '% of the base price' : 'No tax collected for this region' },
        { label: 'Platform & payment fee', amount: fee, note: india ? fees.IN.pct + '% + ₹' + fees.IN.fixed : fees.INTL.pct + '% + ' + fmtMoney(round(intlFixed, currency), currency) },
      ],
      total, amountMinor: minorUnits(total, currency), coupon, discountInr: round(discount, 'INR'),
      methods: C.methods, address: { country: cc, line1: String(a.line1 || '').trim().slice(0, 200), city: String(a.city || '').trim().slice(0, 80), state: String(a.state || '').trim().slice(0, 80), postal: String(a.postal || '').trim().toUpperCase().slice(0, 12) },
      valid: Object.keys(errors).length === 0, errors, exp: Date.now() + QUOTE_TTL,
    };
    return sign(q);
  }
  return { quote, verify, sign, round };
}

/* the subscription plans each region may buy: India 1, 3 and 6 months; every other country also 12 months */
const PLANS_BY_REGION = { IN: ['m1', 'm3', 'm6'], INTL: ['m1', 'm3', 'm6', 'y1'] };
function plansFor(country) { return country === 'IN' ? PLANS_BY_REGION.IN : PLANS_BY_REGION.INTL; }

module.exports = { make, plansFor, PLANS_BY_REGION, COUNTRIES, publicCountries, fmtMoney, minorUnits, round };
