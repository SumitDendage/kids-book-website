// Configuration, read from Edge Function secrets (Deno.env). Values are never logged or returned;
// only "is it set?" flags leave this module (see envReport()).

export type Env = {
  supabaseUrl: string;
  dbUrl: string;
  secretKey: string;            // sb_secret_… or the legacy service_role key (server only)
  publishableKey: string;       // sb_publishable_… or the legacy anon key
  jwks: string | null;          // SUPABASE_JWKS (JSON), when the project signs with asymmetric keys
  jwtSecret: string | null;     // legacy HS256 secret, only if the owner adds it as a secret
  loginOtpEncryptionKey: string | null;
  adminSecurityEmail: string | null;
  siteUrl: string;              // where links in emails point, e.g. https://learnwithwhy.in
  allowedOrigins: string[];     // browser origins allowed to call the API (empty = any)
  mail: {
    provider: 'brevo' | 'resend' | 'none';
    brevoKey: string | null;
    resendKey: string | null;
    from: string | null;        // "Learn With Why <hello@yourdomain>"
    apiBase: string | null;     // test override for the provider's API
  };
  razorpay: { keyId: string | null; keySecret: string | null; webhookSecret: string | null; apiBase: string };
  stripe: { secretKey: string | null; webhookSecret: string | null; apiBase: string };
  paypal: { clientId: string | null; secret: string | null; mode: 'live' | 'sandbox'; webhookId: string | null; apiBase: string };
  forwardIpToAuth: boolean;     // send Sb-Forwarded-For to Supabase Auth (needs a sb_secret key)
  trustProxyCountryHeader: boolean;
  version: string;
};

let cached: Env | null = null;
let overrides: Record<string, string | undefined> | null = null;

/** Tests replace the environment with a plain object. */
export function setEnvForTests(vars: Record<string, string | undefined> | null) {
  overrides = vars;
  cached = null;
}

function get(name: string): string | null {
  const v = overrides ? overrides[name] : Deno.env.get(name);
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function firstKey(jsonName: string): string | null {
  const raw = get(jsonName);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') return (o.default ?? Object.values(o)[0] ?? null) as string | null;
  } catch { /* not JSON */ }
  return null;
}

export function env(): Env {
  if (cached) return cached;
  const supabaseUrl = (get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const brevoKey = get('BREVO_API_KEY');
  const resendKey = get('RESEND_API_KEY');
  const chosen = (get('MAIL_PROVIDER') ?? '').toLowerCase();
  const provider: Env['mail']['provider'] =
    chosen === 'brevo' && brevoKey ? 'brevo'
    : chosen === 'resend' && resendKey ? 'resend'
    : chosen === 'none' ? 'none'
    : brevoKey ? 'brevo' : resendKey ? 'resend' : 'none';
  const paypalMode = (get('PAYPAL_MODE') ?? 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
  cached = {
    supabaseUrl,
    dbUrl: get('SUPABASE_DB_URL') ?? '',
    secretKey: firstKey('SUPABASE_SECRET_KEYS') ?? get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    publishableKey: firstKey('SUPABASE_PUBLISHABLE_KEYS') ?? get('SUPABASE_ANON_KEY') ?? '',
    jwks: get('SUPABASE_JWKS'),
    jwtSecret: get('LWW_JWT_SECRET'),
    loginOtpEncryptionKey: get('LOGIN_OTP_ENCRYPTION_KEY'),
    adminSecurityEmail: get('ADMIN_SECURITY_EMAIL'),
    siteUrl: (get('SITE_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    mail: {
      provider,
      brevoKey,
      resendKey,
      from: get('MAIL_FROM'),
      apiBase: get('MAIL_API_BASE'),
    },
    razorpay: {
      keyId: get('RAZORPAY_KEY_ID'),
      keySecret: get('RAZORPAY_KEY_SECRET'),
      webhookSecret: get('RAZORPAY_WEBHOOK_SECRET'),
      apiBase: (get('RAZORPAY_API_BASE') ?? 'https://api.razorpay.com').replace(/\/+$/, ''),
    },
    stripe: {
      secretKey: get('STRIPE_SECRET_KEY'),
      webhookSecret: get('STRIPE_WEBHOOK_SECRET'),
      apiBase: (get('STRIPE_API_BASE') ?? 'https://api.stripe.com').replace(/\/+$/, ''),
    },
    paypal: {
      clientId: get('PAYPAL_CLIENT_ID'),
      secret: get('PAYPAL_SECRET'),
      mode: paypalMode,
      webhookId: get('PAYPAL_WEBHOOK_ID'),
      apiBase: (get('PAYPAL_API_BASE') ?? (paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')).replace(/\/+$/, ''),
    },
    forwardIpToAuth: get('AUTH_FORWARD_IP') === 'true',
    trustProxyCountryHeader: get('TRUST_COUNTRY_HEADER') !== 'false',
    version: get('LWW_VERSION') ?? 'supabase-1',
  };
  return cached;
}

export const mailReady = () => env().mail.provider !== 'none' && !!env().mail.from;

export function gatewayModes() {
  const e = env();
  const rz = e.razorpay.keyId && e.razorpay.keySecret ? (e.razorpay.keyId.startsWith('rzp_live_') ? 'live' : 'test') : false;
  const st = e.stripe.secretKey ? (/^(sk|rk)_live_/.test(e.stripe.secretKey) ? 'live' : 'test') : false;
  const pp = e.paypal.clientId && e.paypal.secret ? e.paypal.mode : false;
  return { razorpay: rz, stripe: st, paypal: pp } as Record<'razorpay' | 'stripe' | 'paypal', string | false>;
}

/** Names of settings and whether each is present. Never the values. */
export function envReport() {
  const names = [
    'SITE_URL', 'ALLOWED_ORIGINS', 'MAIL_PROVIDER', 'MAIL_FROM', 'BREVO_API_KEY', 'RESEND_API_KEY',
    'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_MODE', 'PAYPAL_WEBHOOK_ID',
    'AUTH_FORWARD_IP', 'LWW_JWT_SECRET', 'SUPABASE_JWKS', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL',
  ];
  return Object.fromEntries(names.map((n) => [n, get(n) !== null]));
}
