/* Prices are held in INR and shown in the customer's own currency — the same one
   the checkout will charge — so a page never mixes ₹ and $. The rate table comes
   from the server (GET /api/config). */
let curCode = 'INR', curRate = 1, curCountry = 'IN';
/* the shop shows India's plans (1, 3, 6 months) until the customer picks another country */
export const isIndia = () => curCountry === 'IN';

export const fmtCur = (n, c) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c, maximumFractionDigits: c === 'JPY' ? 0 : 2 }).format(n); } catch (_) { return c + ' ' + n; } };
export const money = n => curCode === 'INR' ? '₹' + Math.round(n * curRate) : fmtCur(Math.round(n * curRate * 100) / 100, curCode);

/* returns true when the currency changed (the caller re-renders) */
export function setCurrencyFromCountry(config, code) {
  const C = config && config.countries.find(c => c.code === code);
  curCountry = code || 'IN';
  const cur = (C && C.currency) || 'INR', rate = (config && config.rates && config.rates[cur]) || 1;
  if (cur === curCode && rate === curRate) return false;
  curCode = cur; curRate = rate; return true;
}
