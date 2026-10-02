/* CHECKOUT — the price is never computed in the browser. The page sends what it
   wants (one PDF), the coupon and the address to /api/quote; the server answers
   with a signed quote (base + tax + fee = total, in the customer's currency).
   /api/pay/order turns a valid signed quote into an order and a Razorpay order;
   Razorpay Checkout takes the payment; /api/pay/verify checks the signature and
   grants the entitlement. Only the PUBLIC Razorpay key id reaches the browser,
   and it comes from the server with the order. */
import { fetchConfig, fetchGeo } from './api.js';
import { read } from './storage.js';

let coConfig = null, geoCountry = null;
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
/* the saved billing address, or a guess from the browser (and the server's geo answer) */
export function initialAddress() {
  const saved = read('lww_address', null);
  if (saved) return saved;
  return { country: geoCountry || guessCountry(), line1: '', city: '', state: '', postal: '' };
}
/* countries, plans, rates and which gateways are connected — loaded once */
export async function loadCoConfig() {
  if (coConfig) return coConfig;
  coConfig = await fetchConfig();
  try { const g = await fetchGeo(); if (g.country && !read('lww_address', null)) geoCountry = g.country; } catch (_) {}
  return coConfig;
}

/* Razorpay Checkout is loaded only when someone pays */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load Razorpay Checkout — check your connection.')); document.head.appendChild(s); });
}
