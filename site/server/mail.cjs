/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* MAIL — email through SMTP with Nodemailer (any provider: Gmail / Google Workspace,
   Zoho, Brevo, Mailgun, Amazon SES, Hostinger mail, Resend …). Set SMTP_HOST, SMTP_PORT,
   SMTP_USER, SMTP_PASS and MAIL_FROM. RESEND_API_KEY alone also works: it is Resend's
   SMTP password (smtp.resend.com, user "resend").

   Transports (MAIL_TRANSPORT):
     smtp     real delivery
     console  development only: each email is printed in the server log instead
     memory   tests: emails are kept in mail.outbox
     none     nothing can be sent — sign-up and password reset answer 503 until mail is set up
   send() never throws: it resolves { ok, delivered, error }. `delivered` is true only
   when the message really left (smtp) or was captured for a test (memory). */
const nodemailer = require('nodemailer');

function make(cfg) {
  const m = cfg.mail;
  const mode = ['smtp', 'console', 'memory', 'none'].includes(m.transport) ? m.transport : (m.host || m.resendKey ? 'smtp' : (cfg.production ? 'none' : 'console'));
  const outbox = [];
  let transporter = null, problem = '';

  if (mode === 'smtp') {
    const host = m.host || 'smtp.resend.com';
    const port = m.port || (m.host ? 587 : 465);
    const secure = m.secure == null ? port === 465 : m.secure;
    const user = m.user || (m.host ? '' : 'resend'), pass = m.pass || (m.host ? '' : m.resendKey);
    if (!m.from) problem = 'MAIL_FROM is not set';
    transporter = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined, requireTLS: !secure && cfg.production, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
  } else if (mode === 'none') problem = 'no email service configured (set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM)';
  const from = m.from || 'Learn With Why <no-reply@localhost>';
  const ready = !problem;

  async function send({ to, subject, text, html, replyTo }) {
    if (!ready) return { ok: false, delivered: false, error: 'Mail is off: ' + problem };
    const msg = { from, to, subject, text, html, replyTo };
    if (mode === 'memory') { outbox.push(Object.assign({ at: Date.now() }, msg)); return { ok: true, delivered: true }; }
    if (mode === 'console') {
      console.log('\n[mail] ── not sent (MAIL_TRANSPORT=console) ──────────\nTo: ' + to + '\nSubject: ' + subject + '\n\n' + text + '\n[mail] ─────────────────────────────────────────────\n');
      return { ok: true, delivered: false };
    }
    try { const info = await transporter.sendMail(msg); return { ok: true, delivered: true, id: info.messageId }; }
    catch (e) { return { ok: false, delivered: false, error: 'SMTP: ' + e.message }; }
  }
  /* at start: say whether the SMTP server answers (never blocks or stops the server) */
  async function check() {
    if (mode !== 'smtp' || !ready) return { ok: ready, mode, problem };
    try { await transporter.verify(); return { ok: true, mode }; } catch (e) { return { ok: false, mode, problem: e.message }; }
  }

  return { mode, ready, delivers: ready && (mode === 'smtp' || mode === 'memory'), problem, outbox, send, check, from };
}

module.exports = { make };
