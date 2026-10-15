// Email texts. Each function returns { subject, html, text } ready for mail.ts.
// Dates are shown in the customer's time zone with the zone named (IST when unknown), plus UTC.
import { escapeHtml, fmtDateTime, fmtUtc } from '../lib/util.ts';
import { env } from '../lib/env.ts';

export type Email = { subject: string; html: string; text: string };

const BRAND = 'Learn With Why';
const SUPPORT = 'learnwithwhy6@gmail.com';

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ea;font-family:Arial,Helvetica,sans-serif;color:#24312a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1f6b47;font-weight:bold">${BRAND}</td></tr>
<tr><td style="padding-top:10px;font-size:22px;font-weight:bold">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:14px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding-top:22px;font-size:12px;color:#6b776f">Questions? Write to <a href="mailto:${SUPPORT}" style="color:#1f6b47">${SUPPORT}</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${escapeHtml(href)}" style="background:#1f6b47;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;
const site = () => env().siteUrl;
const when = (d: Date | string | number, tz?: string | null) => `${fmtDateTime(d, tz)} (${fmtUtc(d)})`;

export function welcome(o: { name: string; email: string; password: string; verifyUrl: string; hours: number }): Email {
  const subject = `Welcome to ${BRAND} — your password inside`;
  const html = layout('Welcome!', [
    p(`Hello ${escapeHtml(o.name)},`),
    p('Your account is ready. Here is your password — keep it private, it is only for you:'),
    `<p style="font-size:20px;font-family:Consolas,Menlo,monospace;background:#f1efe6;padding:12px 16px;border-radius:10px;letter-spacing:.06em">${escapeHtml(o.password)}</p>`,
    p('First, confirm this email address:'),
    btn(o.verifyUrl, 'Accept & Continue'),
    p(`The button works for ${o.hours} hours. Then sign in with your email and this password. You can keep using it, or choose a new one any time with “Forgot password”.`),
    p('Your account is personal: please do not share your password with anyone.'),
  ].join(''));
  const text = `Hello ${o.name},\n\nYour ${BRAND} account is ready. Your password (keep it private): ${o.password}\n\nConfirm your email (works for ${o.hours} hours): ${o.verifyUrl}\n\nThen sign in with your email and this password. Your account is personal: please do not share your password.\n`;
  return { subject, html, text };
}

export function resendVerification(o: { name: string; password: string; verifyUrl: string; hours: number }): Email {
  const subject = `${BRAND}: confirm your email (new password inside)`;
  const html = layout('Confirm your email', [
    p(`Hello ${escapeHtml(o.name)},`),
    p('Here is a fresh password and a new confirmation link. The old password no longer works.'),
    `<p style="font-size:20px;font-family:Consolas,Menlo,monospace;background:#f1efe6;padding:12px 16px;border-radius:10px">${escapeHtml(o.password)}</p>`,
    btn(o.verifyUrl, 'Accept & Continue'),
    p(`The button works for ${o.hours} hours.`),
  ].join(''));
  const text = `Hello ${o.name},\n\nYour new password: ${o.password}\nConfirm your email (works for ${o.hours} hours): ${o.verifyUrl}\n`;
  return { subject, html, text };
}

export function passwordReset(o: { name: string; resetUrl: string; minutes: number }): Email {
  const subject = `${BRAND}: choose a new password`;
  const html = layout('Choose a new password', [
    p(`Hello ${escapeHtml(o.name)},`),
    p('Someone (hopefully you) asked to reset the password for this account.'),
    btn(o.resetUrl, 'Choose a new password'),
    p(`The link works once, for ${o.minutes} minutes. If you did not ask for this, ignore this email — your password stays the same.`),
  ].join(''));
  const text = `Hello ${o.name},\n\nChoose a new password (works once, for ${o.minutes} minutes): ${o.resetUrl}\nIf you did not ask for this, ignore this email.\n`;
  return { subject, html, text };
}

export function passwordChanged(o: { name: string; at: Date; timeZone?: string | null }): Email {
  const subject = `${BRAND}: your password was changed`;
  const html = layout('Password changed', [
    p(`Hello ${escapeHtml(o.name)},`),
    p(`Your password was changed on ${escapeHtml(when(o.at, o.timeZone))}. Every device was signed out.`),
    p(`If this was not you, use “Forgot password” on <a href="${escapeHtml(site())}">${escapeHtml(site())}</a> now and write to us.`),
  ].join(''));
  const text = `Hello ${o.name},\n\nYour password was changed on ${when(o.at, o.timeZone)}. Every device was signed out.\nIf this was not you, use Forgot password on ${site()} and write to us.\n`;
  return { subject, html, text };
}

export type PurchaseLine = { title: string; expiresAt: Date | string; startsAt?: Date | string | null; kind: 'worksheet' | 'class' };

export function purchaseSuccessful(o: { name: string; orderId: string; total: string; lines: PurchaseLine[]; timeZone?: string | null }): Email {
  const subject = `Purchase Successful — ${o.lines.map((l) => l.title).join(', ').slice(0, 120)}`;
  const items = o.lines.map((l) => {
    const starts = l.startsAt && new Date(l.startsAt).getTime() > Date.now() + 60_000 ? `<br>Starts: ${escapeHtml(when(l.startsAt, o.timeZone))}` : '';
    return `<li style="margin-bottom:10px"><strong>${escapeHtml(l.title)}</strong>${starts}<br>Open until: <strong>${escapeHtml(when(l.expiresAt, o.timeZone))}</strong></li>`;
  }).join('');
  const html = layout('Purchase Successful', [
    p(`Hello ${escapeHtml(o.name)}, thank you! Order ${escapeHtml(o.orderId)} (${escapeHtml(o.total)}) is paid.`),
    `<ul style="padding-left:18px;margin:0 0 12px">${items}</ul>`,
    p('Open your sheets any time before that date in <strong>My Account → My Worksheets</strong>.'),
    btn(`${site()}/?account=worksheets`, 'Open My Worksheets'),
    p('After the date, the sheet moves to your purchase history and you can choose “Buy Access Again”.'),
  ].join(''));
  const text = `Purchase Successful\n\nHello ${o.name}, order ${o.orderId} (${o.total}) is paid.\n\n` +
    o.lines.map((l) => `- ${l.title}: open until ${when(l.expiresAt, o.timeZone)}`).join('\n') +
    `\n\nFind them in My Account → My Worksheets: ${site()}/?account=worksheets\n`;
  return { subject, html, text };
}

export function orderRefunded(o: { name: string; orderId: string; total: string; method: string; titles: string[] }): Email {
  const subject = `${BRAND}: order ${o.orderId} refunded`;
  const items = o.titles.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  const html = layout('Your order was refunded', [
    p(`Hello ${escapeHtml(o.name)},`),
    p(`Order <strong>${escapeHtml(o.orderId)}</strong> (${escapeHtml(o.total)}) was refunded through ${escapeHtml(o.method)}. The money goes back the way you paid; your bank may take a few days to show it.`),
    items ? p('Access bought with this order has ended:') + `<ul style="padding-left:18px;margin:0 0 12px">${items}</ul>` : '',
  ].join(''));
  const text = `Hello ${o.name},\n\nOrder ${o.orderId} (${o.total}) was refunded through ${o.method}. The money goes back the way you paid; your bank may take a few days to show it.\n` +
    (o.titles.length ? `\nAccess bought with this order has ended:\n${o.titles.map((t) => `- ${t}`).join('\n')}\n` : '') + `\nQuestions? Write to ${SUPPORT}.\n`;
  return { subject, html, text };
}

/** pausedNow: this warning reached the limit and paused paid access. alreadyPaused: access was
 *  already paused before it (by staff or earlier warnings). */
export function securityWarning(o: { name: string; level: number; max: number; reason: string; pausedNow: boolean; alreadyPaused: boolean }): Email {
  const subject = `${BRAND}: security warning ${o.level} of ${o.max}`;
  const pausedHtml = o.pausedNow
    ? p(`<strong>This is warning ${o.level} of ${o.max}, so access to your paid sheets and plans is now paused.</strong> You can still sign in, see your orders and open free sheets. If you think this is a mistake, send us a note from My Account → Security, or reply to this email.`)
    : o.alreadyPaused
      ? p('Access to your paid sheets and plans is already paused on this account. You can still sign in, see your orders and open free sheets. If you think this is a mistake, send us a note from My Account → Security, or reply to this email.')
      : p(`After ${o.max} warnings, access to paid sheets is paused. If you think this is a mistake, send us a note from My Account → Security.`);
  const pausedText = o.pausedNow
    ? `This is warning ${o.level} of ${o.max}, so access to your paid sheets is now paused. You can still sign in. Write to us from My Account → Security if this is a mistake.\n`
    : o.alreadyPaused
      ? 'Access to your paid sheets is already paused on this account. You can still sign in. Write to us from My Account → Security if this is a mistake.\n'
      : `After ${o.max} warnings, access to paid sheets is paused.\n`;
  const html = layout(`Security Warning — ${o.level} of ${o.max}`, [
    p(`Hello ${escapeHtml(o.name)},`),
    p('Suspicious account access has been reported. Your credentials are personal. Please do not share your password.'),
    p(`What we noticed: ${escapeHtml(o.reason)}`),
    pausedHtml,
    p('If you shared your password, choose a new one with “Forgot password”.'),
  ].join(''));
  const text = `Security Warning — ${o.level} of ${o.max}\n\nHello ${o.name},\nSuspicious account access has been reported. Your credentials are personal. Please do not share your password.\nWhat we noticed: ${o.reason}\n` +
    pausedText;
  return { subject, html, text };
}

export function accessRestored(o: { name: string }): Email {
  const subject = `${BRAND}: your access is back`;
  const html = layout('Your access is back', [p(`Hello ${escapeHtml(o.name)},`), p('Your paid sheets and plans open again. Thank you for your patience.')].join(''));
  return { subject, html, text: `Hello ${o.name},\n\nYour paid sheets and plans open again.\n` };
}

export function appealDecision(o: { name: string; accepted: boolean; response: string }): Email {
  const subject = `${BRAND}: your note about account security`;
  const html = layout(o.accepted ? 'We agreed with you' : 'We looked at your note', [
    p(`Hello ${escapeHtml(o.name)},`),
    p(o.accepted ? 'Thank you — we accepted your note and removed the warning.' : 'Thank you — we looked at your note and kept the warning.'),
    o.response ? p(escapeHtml(o.response)) : '',
  ].join(''));
  return { subject, html, text: `Hello ${o.name},\n\n${o.accepted ? 'We accepted your note and removed the warning.' : 'We kept the warning.'}\n${o.response}\n` };
}

export function staffWelcome(o: { name: string; email: string; password: string; role: string; adminUrl: string }): Email {
  const subject = `${BRAND}: your staff account`;
  const html = layout('Your staff account', [
    p(`Hello ${escapeHtml(o.name)}, you were added to the ${BRAND} team as <strong>${escapeHtml(o.role)}</strong>.`),
    p('Sign in with this email and password:'),
    `<p style="font-size:20px;font-family:Consolas,Menlo,monospace;background:#f1efe6;padding:12px 16px;border-radius:10px">${escapeHtml(o.password)}</p>`,
    btn(o.adminUrl, 'Open the staff panel'),
    p('Keep it private. You can choose a new password any time with “Forgot password”.'),
  ].join(''));
  return { subject, html, text: `Hello ${o.name},\nYou were added as ${o.role}. Password: ${o.password}\nStaff panel: ${o.adminUrl}\n` };
}

export function contactToInbox(o: { name: string; email: string; body: string; at: Date; signedInAs?: string | null }): Email {
  const subject = `New note from ${o.name} (${o.email})`;
  const html = layout('New note from the website', [
    p(`<strong>${escapeHtml(o.name)}</strong> &lt;${escapeHtml(o.email)}&gt;${o.signedInAs ? ' · signed in' : ''}`),
    `<blockquote style="margin:0 0 12px;padding:12px 16px;background:#f1efe6;border-radius:10px;white-space:pre-wrap">${escapeHtml(o.body)}</blockquote>`,
    p(`Sent ${escapeHtml(when(o.at))}. Reply to this email to answer.`),
  ].join(''));
  return { subject, html, text: `From: ${o.name} <${o.email}>\nSent: ${when(o.at)}\n\n${o.body}\n` };
}

export function staffAlert(o: { title: string; lines: string[]; link?: string }): Email {
  const subject = `${BRAND} staff: ${o.title}`;
  const html = layout(o.title, o.lines.map((l) => p(escapeHtml(l))).join('') + (o.link ? btn(o.link, 'Open the staff panel') : ''));
  return { subject, html, text: `${o.title}\n\n${o.lines.join('\n')}\n${o.link ?? ''}\n` };
}
