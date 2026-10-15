/* CHECKOUT: the price is never worked out in the browser. The page sends what it
   wants (one PDF or a class plan), the coupon and the billing address to POST /api/quote;
   the server prices it, stores the quote and answers with its quoteId (valid for a few
   minutes). POST /api/pay/order turns that stored quote into an order and a Razorpay order;
   Razorpay Checkout takes the payment; POST /api/pay/verify checks it with Razorpay and
   opens the sheet. Only the PUBLIC Razorpay key id reaches the browser, and it comes from
   the server with the order. */
import { fetchConfig, fetchGeo } from './api.js';
import { read } from './storage.js';
import { accessSpan, applyServerPlans } from '../data/content.js';

let coConfig = null, geoCountry = null, geoAsked = false;
export const getCoConfig = () => coConfig;
export const getGeoCountry = () => geoCountry;

export function guessCountry() {
  const lang = (navigator.language || '').toUpperCase(), region = lang.includes('-') ? lang.split('-')[1] : '';
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' || region === 'IN') return 'IN';
  const byTz = { 'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Pacific/Auckland': 'NZ' };
  if (byTz[tz]) return byTz[tz];
  if (tz.startsWith('America/')) return region === 'CA' ? 'CA' : 'US';
  if (tz.startsWith('Australia/')) return 'AU';
  return region && ['US', 'GB', 'AE', 'AU', 'CA', 'SG', 'DE', 'FR', 'NL', 'IE', 'NZ', 'JP'].includes(region) ? region : 'OTHER';
}

/* Outside India the checkout asks only for the street and the city, and the server checks a
   state or postal code only when one is sent. So a state or PIN code kept from another
   country is dropped here, and is never sent for a field the customer cannot see. */
const str = v => (typeof v === 'string' ? v : '');
export function tidyAddress(a) {
  const x = a && typeof a === 'object' ? a : {};
  const country = str(x.country) || 'IN';
  return { country, line1: str(x.line1), city: str(x.city), state: country === 'IN' ? str(x.state) : '', postal: country === 'IN' ? str(x.postal) : '' };
}
/* what the quote is asked with */
export const addressForQuote = a => (a.country === 'IN'
  ? { country: 'IN', line1: a.line1, city: a.city, state: a.state, postal: a.postal }
  : { country: a.country, line1: a.line1, city: a.city });
/* the saved billing address (this browser only), or a guess from the browser and the server's geo answer */
export function initialAddress() {
  const saved = read('lww_address', null);
  if (saved && saved.country) return tidyAddress(saved);
  return { country: geoCountry || guessCountry(), line1: '', city: '', state: '', postal: '' };
}

/* countries, plans, rates, which gateways are connected and how long a bought sheet stays open.
   api.js shares one answer for a minute, so asking again is cheap and picks up a change staff made. */
export async function loadCoConfig() {
  const cfg = await fetchConfig();
  coConfig = cfg;
  applyServerPlans(cfg);
  if (!geoAsked && !read('lww_address', null)) {
    geoAsked = true;
    try { const g = await fetchGeo(); if (g && g.country) geoCountry = g.country; } catch (_) { /* the browser's guess will do */ }
  }
  return cfg;
}

/* The class plans the server sells in this country, in its order, each with its price in rupees
   before tax and fees: the plan's own price after the class discount and then the plan discount
   (the same order the server uses). India has 1, 3 and 6 months; other countries 12 months too. */
export function serverPlans(config, country, cls) {
  if (!config || !config.plans) return [];
  const region = country === 'IN' ? 'IN' : 'INTL';
  const ids = config.plansByRegion && Array.isArray(config.plansByRegion[region])
    ? config.plansByRegion[region]
    : Object.keys(config.plans).filter(id => (config.plans[id].regions || []).includes(region));
  const classPct = Number(config.classDiscounts && config.classDiscounts[cls]) || 0;
  return ids.filter(id => config.plans[id]).map(id => {
    const p = config.plans[id], list = Number(p.price) || 0, planPct = Number(p.discountPct) || 0;
    const price = list * (1 - Math.min(100, classPct) / 100) * (1 - Math.min(100, planPct) / 100);
    return { id, label: p.label, months: p.months, note: p.note || '', list, price, off: price < list };
  });
}
/* "1, 3 or 6 months" */
export function monthsText(plans) {
  const m = Array.from(new Set(plans.map(x => x.months))).sort((a, b) => a - b);
  if (!m.length) return '';
  const list = m.length === 1 ? String(m[0]) : m.slice(0, -1).join(', ') + ' or ' + m[m.length - 1];
  return list + (m.length === 1 && m[0] === 1 ? ' month' : ' months');
}
/* how long a bought sheet stays open: 365 days is "1 year" */
export const spanOfDays = accessSpan;

/* Razorpay Checkout is loaded only when someone pays */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res;
    s.onerror = () => rej(Object.assign(new Error('We could not open the payment window. Please check your internet connection and try again. Nothing was charged.'), { code: 'script' }));
    document.head.appendChild(s);
  });
}

/* Every checkout problem in plain words. step: 'quote' (pricing), 'order' (starting the payment)
   or 'verify' (after Razorpay took the payment: money may have left the bank, so never "nothing was charged"). */
export function payErrorText(err, step) {
  if (!err) return 'Something went wrong. Please try again.';
  if (err.status === 0) return err.message;   /* no connection: api.js already says it kindly */
  const paid = step === 'verify';
  const b = err.body || {};
  switch (err.code) {
    case 'payments_unavailable': case 'gateway_off':
      return 'Online payment is not switched on yet, so nothing was charged. Please try again later, or write to us and we will help.';
    case 'gateway_error':
      return paid
        ? 'We could not confirm your payment with Razorpay just now. If money was taken, your purchase opens by itself as soon as Razorpay tells us, so please do not pay again.'
        : 'We could not reach the payment service just now, so nothing was charged. Please try again in a minute.';
    case 'method_unavailable': case 'unknown_method': case 'wrong_method':
      return 'That way to pay is not available for your country. Please choose another one.';
    case 'rate_limited':
      return 'That was a lot of tries in a row. Please wait a few minutes and try again.';
    case 'not_paid':
      return 'Razorpay did not complete this payment. If no money was taken, please try again. If it was, write to us with your order number and we will sort it out.';
    case 'bad_signature': case 'payment_mismatch': case 'payment_rejected':
      return 'We could not match this payment to your order. If money was taken, please write to us with your order number and we will sort it out.';
    case 'order_refunded': return 'This order was refunded.';
    case 'below_minimum': return 'This total is too small to pay online.';
    case 'coupon_invalid': return ((b.errors && b.errors.coupon) || 'That code cannot be used.') + ' Remove the coupon or try another one.';
    case 'free': return 'This sheet is free. Close the checkout and open it from the sheet.';
    case 'unavailable': return 'This is not ready to buy yet. Please check back soon.';
    case 'unknown_item': return 'We could not find that sheet or plan. Please close the checkout and try again.';
    case 'plan_region': return 'That plan is not offered in the country you chose. Please pick another plan.';
    case 'pricing_unavailable': return 'Prices in your currency are not available right now. Please try again later or choose another country.';
    case 'access_suspended': return 'Paid sheets are paused on this account, so new purchases are not possible right now. If you think this is a mistake, write to us from My Account → Security.';
    case 'account_suspended': return 'This account is blocked, so payments are not possible. If you think this is a mistake, please write to us.';
    case 'session_blocked': return 'This sign-in was stopped. Please sign in again to carry on. Nothing was charged.';
    case 'email_unverified': return 'Please confirm your email address first. The link is in your welcome email.';
    default:
      if (err.status === 401) return paid ? 'Please sign in again. If money was taken, your purchase opens by itself, so please do not pay again.' : 'Please sign in again to carry on. Nothing was charged.';
      if (err.status >= 500) return paid
        ? 'Something went wrong on our side while confirming your payment. If money was taken, your purchase opens by itself, so please do not pay again.'
        : 'Something went wrong on our side, so nothing was charged. Please try again in a minute.';
      return err.message || 'That did not work. Please try again.';
  }
}
