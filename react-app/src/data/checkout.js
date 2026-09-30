/* How the customer pays at checkout — moved from the page script. */
/* How the customer pays. Every option runs through Razorpay Checkout, which is opened
   showing only that method (config.display), so "Card" opens straight on the card form
   and "QR code" straight on a UPI QR to scan. UPI, QR, net banking and wallets are India-only. */
export const PAY_VIA = [
  { id: 'card', label: 'Card', note: 'Visa · Mastercard · RuPay · Amex', india: false },
  { id: 'qr', label: 'QR code', note: 'Scan with any UPI app', india: true },
  { id: 'upi', label: 'UPI ID', note: 'GPay · PhonePe · Paytm', india: true },
  { id: 'wallet', label: 'Wallet', note: 'Paytm · Amazon Pay · more', india: true },
  { id: 'paypal', label: 'PayPal', note: 'PayPal balance or card · worldwide', india: false, gateway: 'paypal' },
  { id: 'stripe', label: 'Stripe', note: 'Cards & wallets, worldwide', india: false, gateway: 'stripe' },
];
export const RZP_DISPLAY = {   /* Razorpay Checkout "display blocks": open on the chosen method only */
  card: { blocks: { pay: { name: 'Pay by card', instruments: [{ method: 'card' }] } }, sequence: ['block.pay'], preferences: { show_default_blocks: false } },
  qr: { blocks: { pay: { name: 'Scan the QR code with any UPI app', instruments: [{ method: 'upi', flows: ['qr'] }] } }, sequence: ['block.pay'], preferences: { show_default_blocks: false } },
  upi: { blocks: { pay: { name: 'Pay with your UPI ID', instruments: [{ method: 'upi', flows: ['collect', 'intent'] }] } }, sequence: ['block.pay'], preferences: { show_default_blocks: false } },
  wallet: { blocks: { pay: { name: 'Wallets', instruments: [{ method: 'wallet' }] } }, sequence: ['block.pay'], preferences: { show_default_blocks: false } },
};
export const payViaOf = id => PAY_VIA.find(m => m.id === id) || PAY_VIA[0];
/* the gateways the checkout knows; a method shows only when the country allows it AND the server has it connected */
export const PAY = ['razorpay', 'paypal', 'stripe'];
