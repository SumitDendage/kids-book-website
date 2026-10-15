// Test stand-in for the email provider. Everything the API "sends" lands in `sent`; failNext()
// makes the next sends fail so retry and error paths can be tested. The same capture serves the
// test transport (lib/mail.ts setMailTransportForTests) and the fake Brevo/Resend HTTP routes
// that fakes/supabase.ts can host (used when a test detaches the transport with mail.off()).
import type { MailContent, SendResult } from '../../../functions/api/lib/mail.ts';

export type SentMail = { to: string; subject: string; html: string; text: string; replyTo?: string | null; via: 'transport' | 'brevo' | 'resend'; at: number };
export type FailedMail = SentMail & { error: string; permanent: boolean };

export type MailCapture = {
  /** Mails that were delivered, oldest first. */
  sent: SentMail[];
  /** Mails whose send was made to fail by failNext(). */
  failed: FailedMail[];
  /** The next `n` sends fail (permanent = a 4xx-style failure that is not retried). */
  failNext(n?: number, permanent?: boolean): void;
  /** Forget captured mail and pending failures. */
  clear(): void;
  /** Newest delivered mail, optionally only to this address (case-insensitive). */
  last(to?: string): SentMail | undefined;
  /** Every delivered mail to this address, oldest first. */
  to(address: string): SentMail[];
  /** The first URL in the newest mail to `to` (optionally whose query has `param`), or null. */
  link(to: string, param?: string): string | null;
  /** Value of query parameter `param` of the first matching link in the newest mail to `to`. */
  linkParam(to: string, param: string): string | null;
  /** Used by the fake server and the test transport: record one send attempt. */
  deliver(m: MailContent, via: SentMail['via']): SendResult;
  /** The function handed to setMailTransportForTests. */
  transport: (m: MailContent) => Promise<SendResult>;
};

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

export function createMailCapture(): MailCapture {
  let failures: { permanent: boolean }[] = [];
  let seq = 0;
  const cap: MailCapture = {
    sent: [],
    failed: [],
    failNext(n = 1, permanent = false) {
      for (let i = 0; i < n; i++) failures.push({ permanent });
    },
    clear() {
      cap.sent.length = 0;
      cap.failed.length = 0;
      failures = [];
    },
    last(to?: string) {
      const want = to?.toLowerCase();
      for (let i = cap.sent.length - 1; i >= 0; i--) {
        if (!want || cap.sent[i].to.toLowerCase() === want) return cap.sent[i];
      }
      return undefined;
    },
    to(address: string) {
      const want = address.toLowerCase();
      return cap.sent.filter((m) => m.to.toLowerCase() === want);
    },
    link(to: string, param?: string) {
      const m = cap.last(to);
      if (!m) return null;
      const urls = [...(m.text.match(URL_RE) ?? []), ...(m.html.match(URL_RE) ?? [])]
        .map((u) => u.replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
      for (const u of urls) {
        if (!param) return u;
        try { if (new URL(u).searchParams.has(param)) return u; } catch { /* not a URL */ }
      }
      return null;
    },
    linkParam(to: string, param: string) {
      const u = cap.link(to, param);
      return u ? new URL(u).searchParams.get(param) : null;
    },
    deliver(m: MailContent, via: SentMail['via']): SendResult {
      const item: SentMail = { to: m.to, subject: m.subject, html: m.html ?? '', text: m.text ?? '', replyTo: m.replyTo ?? null, via, at: Date.now() };
      const f = failures.shift();
      if (f) {
        const error = f.permanent ? '400 test: permanent failure' : '503 test: temporary failure';
        cap.failed.push({ ...item, error, permanent: f.permanent });
        return { ok: false, error, permanent: f.permanent };
      }
      cap.sent.push(item);
      return { ok: true, id: `test-${++seq}` };
    },
    transport: (m: MailContent) => Promise.resolve(cap.deliver(m, 'transport')),
  };
  return cap;
}

/** Fake Brevo (POST /v3/smtp/email) and Resend (POST /emails) handlers for the fake server. */
export function mailProviderRoutes(cap: MailCapture) {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return {
    async brevo(req: Request): Promise<Response> {
      if (!req.headers.get('api-key')) return reply(401, { code: 'unauthorized', message: 'Key not found' });
      // deno-lint-ignore no-explicit-any
      const b = await req.json().catch(() => null) as any;
      const to = b?.to?.[0]?.email;
      if (!to || !b?.subject) return reply(400, { code: 'missing_parameter', message: 'to and subject are required' });
      const r = cap.deliver({ to, subject: b.subject, html: b.htmlContent ?? '', text: b.textContent ?? '', replyTo: b.replyTo?.email ?? null }, 'brevo');
      if (!r.ok) return reply(r.permanent ? 400 : 503, { code: 'test_failure', message: r.error });
      return reply(201, { messageId: `<${r.id}@brevo.test>` });
    },
    async resend(req: Request): Promise<Response> {
      if (!/^Bearer\s+\S+/.test(req.headers.get('authorization') ?? '')) return reply(401, { name: 'missing_api_key', message: 'Missing API key' });
      // deno-lint-ignore no-explicit-any
      const b = await req.json().catch(() => null) as any;
      const to = Array.isArray(b?.to) ? b.to[0] : b?.to;
      if (!to || !b?.subject) return reply(422, { name: 'validation_error', message: 'to and subject are required' });
      const r = cap.deliver({ to, subject: b.subject, html: b.html ?? '', text: b.text ?? '', replyTo: b.reply_to ?? null }, 'resend');
      if (!r.ok) return reply(r.permanent ? 422 : 503, { name: 'test_failure', message: r.error });
      return reply(200, { id: r.id });
    },
  };
}
