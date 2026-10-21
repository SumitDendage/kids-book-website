import { Webhook } from 'npm:standardwebhooks@1.0.0';
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { HttpError } from '../lib/http.ts';
import { sendNow } from '../lib/mail.ts';
import { env } from '../lib/env.ts';
import { tx } from '../lib/db.ts';
import { brandedEmail } from '../services/otp_email.ts';

type Payload = { user: { email: string }; email_data: { token: string; token_hash: string; email_action_type: string } };
export function verifyEmailHook(raw: string, headers: Record<string,string>, secret: string): Payload {
  return new Webhook(secret.replace(/^v1,whsec_/, '')).verify(raw, headers) as Payload;
}
async function sendEmail(ctx: Ctx) {
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  if (!secret || env().mail.provider !== 'brevo') throw new HttpError(503, 'Brevo email hook is not configured.');
  const raw = await ctx.req.text();
  if (raw.length > 65536) throw new HttpError(413, 'Request too large.');
  let p: Payload;
  try { p = verifyEmailHook(raw, Object.fromEntries(ctx.req.headers), secret); }
  catch { throw new HttpError(401, 'Invalid email hook signature.'); }
  const { user, email_data: d } = p;
  if (!user?.email || !d?.token) throw new HttpError(400, 'Invalid email request.');
  const id = 'auth-hook:' + ctx.req.headers.get('webhook-id');
  const outcome = await tx(async q => {
    await q`select pg_advisory_xact_lock(hashtext(${id}))`;
    if ((await q`select 1 from email_outbox where dedupe_key = ${id} and status = 'sent'`).length) return true;
    let text: string;
    if (['signup','magiclink'].includes(d.email_action_type)) {
      if (!/^\d{6}$/.test(d.token)) throw new HttpError(400, 'Configure a six-digit email OTP in Supabase.');
      text = `Your sign-in code is ${d.token}. It expires shortly and works only once. If you did not request it, ignore this email.`;
    } else if (['recovery','invite'].includes(d.email_action_type)) {
      const link = new URL('/auth/v1/verify', env().supabaseUrl);
      link.searchParams.set('token', d.token_hash); link.searchParams.set('type', d.email_action_type); link.searchParams.set('redirect_to', env().siteUrl);
      text = `Open this one-time account link: ${link.href}`;
    } else throw new HttpError(400, 'Unsupported auth email action.');
    const subject = 'Your Learn With Why account';
    const result = await sendNow({ to: user.email, subject, text, html: brandedEmail(subject,text) });
    // Do not store the OTP/body or depend on an uncommitted signup profile foreign key.
    await q`insert into email_outbox (template,to_email,subject,sensitive,status,provider,provider_message_id,dedupe_key,sent_at,last_error)
      values ('auth_email',${user.email},${subject},true,${result.ok ? 'sent' : 'failed'},'brevo',${result.ok ? result.id : null},${id},${result.ok ? new Date() : null},${result.ok ? null : 'Brevo delivery failed'})
      on conflict (dedupe_key) do update set status = excluded.status, provider_message_id = excluded.provider_message_id, sent_at = excluded.sent_at, last_error = excluded.last_error`;
    return result.ok;
  });
  if (!outcome) throw new HttpError(503, 'Email delivery failed. Please request a new code shortly.');
  return {};
}
export function register(r: Router) { r.post('/api/auth/send-email', sendEmail); }
