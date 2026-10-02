/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* MAIL — optional. With RESEND_API_KEY and MAIL_FROM set, mail goes out through
   Resend's HTTPS API (https://resend.com — a plain fetch, no npm package). Without
   them nothing is sent and the caller is told so: a contact note is still saved in
   the database and shows in the admin Messages panel as "in the panel only", and a
   password-reset code is printed on the server console as before. */
const API = 'https://api.resend.com/emails';

function make() {
  const KEY = process.env.RESEND_API_KEY || '', FROM = process.env.MAIL_FROM || '';
  const configured = !!(KEY && FROM);
  /* resolves { ok: true } or { ok: false, error } — never throws, mail must not break a request */
  async function send({ to, subject, text, replyTo }) {
    if (!configured) return { ok: false, error: 'No email service configured (RESEND_API_KEY / MAIL_FROM)' };
    try {
      const r = await fetch(API, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ from: FROM, to: [].concat(to), subject, text }, replyTo ? { reply_to: replyTo } : {})), signal: AbortSignal.timeout(15000) });
      if (r.ok) return { ok: true };
      const out = await r.json().catch(() => ({}));
      return { ok: false, error: 'Mail service said ' + r.status + (out.message ? ': ' + out.message : '') };
    } catch (e) { return { ok: false, error: 'Mail service unreachable: ' + e.message }; }
  }
  return { configured, send };
}

module.exports = { make };
