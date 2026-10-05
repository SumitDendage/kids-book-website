/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* CONFIG — every setting the server reads from the environment (site/.env, see
   .env.example), in one place. load() is called once at start; the tests call it
   again after changing process.env. */
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const flag = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

function load(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = int(env.PORT, 4173);
  const host = env.HOST || '127.0.0.1';
  return {
    production,
    port,
    host,
    /* the public address of the site: links in emails point here. It is never taken from the
       request's Host header, so a forged header cannot send a reset link to another site. */
    siteUrl: String(env.SITE_URL || 'http://localhost:' + port).replace(/\/+$/, ''),
    db: {
      url: env.DATABASE_URL || '',
      /* disable | require (verify the server certificate) | no-verify (encrypt, do not verify) */
      ssl: String(env.DATABASE_SSL || (production ? 'require' : 'disable')).toLowerCase(),
      max: int(env.PG_POOL_MAX, 10),
    },
    mail: {
      /* smtp | console (print to the server log) | memory (tests) | none. Empty = smtp when SMTP_HOST
         (or RESEND_API_KEY) is set, otherwise console outside production and none in production. */
      transport: String(env.MAIL_TRANSPORT || '').toLowerCase(),
      host: env.SMTP_HOST || '',
      port: int(env.SMTP_PORT, 0),
      secure: env.SMTP_SECURE === undefined || env.SMTP_SECURE === '' ? null : flag(env.SMTP_SECURE, false),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || '',
      resendKey: env.RESEND_API_KEY || '',
    },
    auth: {
      verifyTtlHours: int(env.EMAIL_VERIFY_TTL_HOURS, 24),
      resetTtlMinutes: int(env.PASSWORD_RESET_TTL_MINUTES, 30),
      sessionDays: int(env.SESSION_DAYS, 30),          /* "Keep me signed in" */
      shortSessionHours: int(env.SESSION_HOURS, 12),   /* without it: a browser-session cookie */
      maxSessionDays: int(env.SESSION_MAX_DAYS, 90),   /* refresh never extends a session past this */
      maxFailedLogins: int(env.LOGIN_MAX_FAILED, 5),
      lockMinutes: int(env.LOGIN_LOCK_MINUTES, 15),
    },
  };
}

module.exports = { load };
