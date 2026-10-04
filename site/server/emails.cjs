/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* EMAILS — the account emails, each as plain text and as simple inline-styled HTML
   (what email clients render reliably). Every value put into the HTML is escaped. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,Helvetica,sans-serif;color:#1d2a24;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3efe6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;padding:32px 28px;">
<tr><td style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1f6b47;font-weight:bold;padding-bottom:18px;">Learn With Why</td></tr>
<tr><td style="font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:#6b7570;padding-top:26px;border-top:1px solid #e6e1d6;">Learn With Why — printable worksheets for Kindergarten to Class 3.<br>This is an automatic message about your account; replies are not read.</td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href, label) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td style="border-radius:999px;background:#1f6b47;">
<a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a></td></tr></table>
<p style="font-size:12px;color:#6b7570;margin:0 0 8px;">If the button does not work, copy this link into your browser:<br><a href="${esc(href)}" style="color:#1f6b47;word-break:break-all;">${esc(href)}</a></p>`;
const passwordBox = (email, password) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#f6f4ee;border-radius:10px;width:100%;"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.8;">
Email: <b>${esc(email)}</b><br>Password: <b style="font-family:'Courier New',monospace;font-size:18px;letter-spacing:1px;">${esc(password)}</b></td></tr></table>`;

const PASSWORD_LINE = 'Your password has been automatically generated for your account. Please do not share this password with anyone.';

/* sign-up: the generated password and the Accept & Continue (email confirmation) link */
function welcome({ name, email, password, link, hours, again }) {
  const subject = again ? 'Your new Learn With Why password — confirm your email' : 'Welcome to Learn With Why — your password inside';
  const intro = again ? 'Here is a new password and a fresh confirmation link for your Learn With Why account. The earlier email no longer works.' : 'Welcome to Learn With Why! Your account is ready — one step to go.';
  const text = `Hello ${name},

${intro}

${PASSWORD_LINE}

  Email:     ${email}
  Password:  ${password}

Accept & Continue — confirm that this email address is yours and go to sign in:
${link}

The link works for ${hours} hours. Then sign in with the password above. You can choose your own password any time with "Forgot password?" on the sign-in form.

If you did not create this account, ignore this email: without confirmation the account stays inactive.

— Learn With Why`;
  const html = layout(subject, `<p style="margin:0 0 14px;">Hello ${esc(name)},</p><p style="margin:0 0 14px;">${esc(intro)}</p>
<p style="margin:0 0 6px;"><b>${esc(PASSWORD_LINE)}</b></p>${passwordBox(email, password)}
<p style="margin:0;">Press <b>Accept &amp; Continue</b> to confirm that this email address is yours. You will land on the sign-in page — sign in with the password above.</p>
${button(link, 'Accept & Continue')}
<p style="margin:0 0 10px;font-size:13px;color:#4a5550;">The link works for ${esc(hours)} hours. You can choose your own password any time with “Forgot password?” on the sign-in form.</p>
<p style="margin:0;font-size:13px;color:#4a5550;">Did not create this account? Ignore this email — without confirmation the account stays inactive.</p>`);
  return { to: email, subject, text, html };
}

function passwordReset({ name, email, link, minutes }) {
  const subject = 'Reset your Learn With Why password';
  const text = `Hello ${name},

Someone (hopefully you) asked to reset the password of your Learn With Why account. Open this link to choose a new password:
${link}

The link works once, for ${minutes} minutes. If you did not ask for it, ignore this email — your password stays the same.

— Learn With Why`;
  const html = layout(subject, `<p style="margin:0 0 14px;">Hello ${esc(name)},</p>
<p style="margin:0;">Someone (hopefully you) asked to reset the password of your Learn With Why account. Press the button to choose a new one.</p>
${button(link, 'Reset password')}
<p style="margin:0;font-size:13px;color:#4a5550;">The link works once, for ${esc(minutes)} minutes. If you did not ask for it, ignore this email — your password stays the same.</p>`);
  return { to: email, subject, text, html };
}

function passwordChanged({ name, email, siteUrl }) {
  const subject = 'Your Learn With Why password was changed';
  const text = `Hello ${name},

The password of your Learn With Why account was just changed, and every device was signed out.

If this was you, there is nothing to do. If it was not, reset your password straight away with "Forgot password?" at ${siteUrl} and write to us.

— Learn With Why`;
  const html = layout(subject, `<p style="margin:0 0 14px;">Hello ${esc(name)},</p>
<p style="margin:0 0 14px;">The password of your Learn With Why account was just changed, and every device was signed out.</p>
<p style="margin:0;">If this was you, there is nothing to do. If it was not, reset your password straight away with “Forgot password?” at <a href="${esc(siteUrl)}" style="color:#1f6b47;">${esc(siteUrl)}</a> and write to us.</p>`);
  return { to: email, subject, text, html };
}

module.exports = { welcome, passwordReset, passwordChanged, PASSWORD_LINE, esc };
