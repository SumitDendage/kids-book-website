/* the small brand marks on the payment choices */
const S = { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true };
const line = { fill: 'none', stroke: '#14181c', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const PAY_MARK = {
  card: <svg {...S} {...line}><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>,
  qr: <svg {...S} {...line}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>,
  upi: <svg {...S} {...line}><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 18h4" /><path d="m9.5 10 2.5 2.5 3-4" /></svg>,
  netbanking: <svg {...S} {...line}><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></svg>,
  wallet: <svg {...S} {...line}><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h4v4h-4a2 2 0 0 1 0-4z" /></svg>,
  razorpay: <svg {...S}><path fill="#3395ff" d="M8.7 9.6 7 15.4l4.3-2.8 1.9 8.1h3.5L21 2.7z" /><path fill="#072654" d="M4.6 12.2 3 18.6h3.4l2.9-10.9z" /></svg>,
  paypal: <svg {...S}><path fill="#003087" d="M7 21 9.6 4.5h6.2c3.5 0 5.2 1.9 4.7 4.8-.6 3.4-3 5.1-6.4 5.1h-2.3L10.8 21z" /><path fill="#009cde" d="M9.5 19.5 11.9 5h5.6c2.9 0 4.4 1.6 3.9 4.1-.5 3-2.6 4.5-5.6 4.5h-2.1L12.6 19.5z" opacity=".85" /></svg>,
  stripe: <svg {...S}><rect width="24" height="24" rx="5" fill="#635bff" /><path fill="#fff" d="M11 9.4c0-.6.5-.9 1.4-.9 1.2 0 2.8.4 4 1V6.2c-1.3-.5-2.7-.7-4-.7-3.3 0-5.5 1.7-5.5 4.6 0 4.5 6.2 3.8 6.2 5.7 0 .7-.6 1-1.5 1-1.3 0-3.1-.6-4.4-1.3v3.4c1.5.6 3 .9 4.4.9 3.4 0 5.7-1.7 5.7-4.6-.1-4.9-6.3-4-6.3-5.8z" /></svg>,
};
