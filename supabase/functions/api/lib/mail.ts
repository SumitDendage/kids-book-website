// Sending email through Brevo or Resend (HTTP APIs, keys kept as Edge Function secrets).
// Normal emails go through the outbox table and are retried with back-off. Emails holding a
// password or a one-time link are sent straight away and their text is never stored.
import { env, mailReady } from './env.ts';
import { tx, type Tx } from './db.ts';
import type { Ctx } from './context.ts';

export type MailContent = { to: string; subject: string; html: string; text: string; replyTo?: string | null };
export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; permanent?: boolean };

let testTransport: ((m: MailContent) => Promise<SendResult>) | null = null;
export function setMailTransportForTests(fn: typeof testTransport) {
  testTransport = fn;
}

function parseFrom(from: string, fallbackName: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || fallbackName, email: m[2] } : { name: fallbackName, email: from.trim() };
}

export async function sendNow(m: MailContent, fromName = 'Learn With Why'): Promise<SendResult> {
  if (testTransport) return testTransport(m);
  const e = env();
  if (!mailReady()) return { ok: false, error: 'Email is not set up yet (add BREVO_API_KEY or RESEND_API_KEY and MAIL_FROM).' };
  const from = parseFrom(e.mail.from!, fromName);
  try {
    let res: Response;
    if (e.mail.provider === 'brevo') {
      res = await fetch(`${e.mail.apiBase ?? 'https://api.brevo.com'}/v3/smtp/email`, {
        method: 'POST',
        headers: { 'api-key': e.mail.brevoKey!, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: from.name, email: from.email },
          to: [{ email: m.to }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
          ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      res = await fetch(`${e.mail.apiBase ?? 'https://api.resend.com'}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.mail.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${from.name} <${from.email}>`,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
    }
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const msg = String((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error ?? res.statusText);
      return { ok: false, error: `${res.status} ${msg}`.slice(0, 500), permanent: res.status >= 400 && res.status < 500 && res.status !== 429 };
    }
    const id = (body as Record<string, unknown>).messageId ?? (body as Record<string, unknown>).id ?? null;
    return { ok: true, id: id ? String(id) : null };
  } catch (err) {
    return { ok: false, error: `could not reach the email service: ${(err as Error).message}`.slice(0, 500) };
  }
}

export type OutboxItem = MailContent & {
  template: string;
  userId?: string | null;
  dedupeKey?: string | null;
  relatedType?: string | null;
  relatedId?: string | number | null;
};

/** Queues an email (inside the caller's transaction). Returns the outbox id, or null if the
 *  dedupe key was already used (the same email was queued before). */
export async function enqueue(q: Tx, m: OutboxItem): Promise<number | null> {
  const rows = await q<{ id: number }[]>`
    insert into email_outbox (template, to_email, to_user_id, reply_to, subject, body_html, body_text, dedupe_key, related_type, related_id)
    values (${m.template}, ${m.to}, ${m.userId ?? null}, ${m.replyTo ?? null}, ${m.subject.slice(0, 200)}, ${m.html}, ${m.text},
            ${m.dedupeKey ?? null}, ${m.relatedType ?? null}, ${m.relatedId == null ? null : String(m.relatedId)})
    on conflict (dedupe_key) do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

/** Sends a sensitive email now (password, links). Records who/when/status but not the text. */
export async function sendSensitive(m: OutboxItem): Promise<SendResult> {
  const r = await sendNow(m);
  await tx((q) => q`
    insert into email_outbox (template, to_email, to_user_id, subject, sensitive, status, attempts, max_attempts,
                              last_error, provider, provider_message_id, related_type, related_id, sent_at)
    values (${m.template}, ${m.to}, ${m.userId ?? null}, ${m.subject.slice(0, 200)}, true,
            ${r.ok ? 'sent' : 'failed'}, 1, 1, ${r.ok ? null : r.error}, ${env().mail.provider},
            ${r.ok ? r.id : null}, ${m.relatedType ?? null}, ${m.relatedId == null ? null : String(m.relatedId)},
            ${r.ok ? new Date() : null})`).catch((e) => console.error('[mail] could not record', (e as Error).message));
  return r;
}

const BACKOFF_MIN = [1, 5, 30, 120, 720, 1440];

type OutboxRow = { id: number; to_email: string; subject: string; body_html: string; body_text: string; reply_to: string | null; attempts: number; max_attempts: number; related_type: string | null; related_id: string | null };

/** Sends due emails. Safe to run from several copies at once (rows are claimed with SKIP LOCKED). */
export async function processOutbox(limit = 8): Promise<{ sent: number; failed: number; waiting: boolean }> {
  if (!mailReady() && !testTransport) return { sent: 0, failed: 0, waiting: true };
  const rows = await tx((q) => q<OutboxRow[]>`
    update email_outbox o set status = 'sending', locked_at = now()
    where o.id in (
      select id from email_outbox
      where not sensitive
        and ((status in ('queued', 'failed') and next_attempt_at <= now() and attempts < max_attempts)
             or (status = 'sending' and locked_at < now() - interval '10 minutes'))
      order by id
      limit ${limit}
      for update skip locked)
    returning o.id, o.to_email, o.subject, o.body_html, o.body_text, o.reply_to, o.attempts, o.max_attempts, o.related_type, o.related_id`);
  let sent = 0, failed = 0;
  for (const r of rows) {
    const res = await sendNow({ to: r.to_email, subject: r.subject, html: r.body_html ?? '', text: r.body_text ?? '', replyTo: r.reply_to });
    const attempts = r.attempts + 1;
    if (res.ok) sent++; else failed++;
    const delay = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
    const giveUp = !res.ok && (res.permanent || attempts >= r.max_attempts);
    await tx(async (q) => {
      await q`
        update email_outbox set
          status = ${res.ok ? 'sent' : 'failed'},
          attempts = ${attempts},
          locked_at = null,
          sent_at = ${res.ok ? new Date() : null},
          provider = ${env().mail.provider},
          provider_message_id = ${res.ok ? res.id : null},
          last_error = ${res.ok ? null : res.error},
          max_attempts = ${giveUp ? attempts : r.max_attempts},
          next_attempt_at = now() + make_interval(mins => ${delay})
        where id = ${r.id}`;
      if (r.related_type === 'contact_message' && r.related_id) {
        await q`update contact_messages set mailed = ${res.ok}, mail_error = ${res.ok ? null : res.error} where id = ${Number(r.related_id)}`;
      }
    });
  }
  return { sent, failed, waiting: false };
}

/** After a response: send what this request queued, and now and then sweep older retries. */
export function kickOutbox(ctx: Ctx) {
  ctx.later(async () => {
    await processOutbox(8);
  });
}

export async function sweepIfDue(ctx: Ctx) {
  ctx.later(async () => {
    const due = await tx((q) => q<{ ok: boolean }[]>`
      insert into private.job_marks (name, ran_at) values ('outbox_sweep', now())
      on conflict (name) do update set ran_at = now()
      where private.job_marks.ran_at < now() - interval '1 minute'
      returning true as ok`);
    if (!due.length) return;
    await processOutbox(15);
    const hk = await tx((q) => q<{ ok: boolean }[]>`
      insert into private.job_marks (name, ran_at) values ('housekeeping', now())
      on conflict (name) do update set ran_at = now()
      where private.job_marks.ran_at < now() - interval '1 hour'
      returning true as ok`);
    if (!hk.length) return;
    // email sign-in codes are only needed for 10 minutes; keep a day of them for support questions
    await tx((q) => q`delete from login_otp_challenges where expires_at < now() - interval '1 day'`)
      .catch((err) => console.error('[sweep] old sign-in codes not removed:', (err as Error)?.message));
    try {
      await tx((q) => q`select private.housekeeping()`);
    } catch (err) {
      // 42883: the owner has not added private.housekeeping() yet (docs/SETUP.md, step 4).
      if ((err as { code?: string })?.code !== '42883') throw err;
    }
  });
}
