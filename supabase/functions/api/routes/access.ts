// OWNER: agent D. Opening sheets: POST /api/access/:id (the server access check) and the
// protected viewer /api/view/*. Every viewer request checks the sign-in, the account, the
// paid-access suspension, the sheet, its PDF and the access record again in the database —
// the view token alone opens nothing. PDFs only leave through these routes (stamped), never as
// a storage link.
import type { Router } from '../lib/router.ts';
import type { AuthedUser, Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { HttpError, intParam, streamResponse } from '../lib/http.ts';
import { hasPermission, requireUser } from '../lib/auth.ts';
import { analytics, rateLimit, securityEvent } from '../lib/guard.ts';
import { getSettings } from '../lib/settings.ts';
import { download, downloadBytes, WORKSHEETS } from '../lib/storage.ts';
import { fmtDateTime } from '../lib/util.ts';
import {
  coveringEntitlements, effectivePrintLimit, entStatus, type EntRow, hasPdf, isLive, isScheduled, loadProduct, pickBest, type ProductRow,
  pubEntitlement,
} from '../services/entitlements.ts';
import { makeViewToken, readViewToken, type ViewClaims, viewTokenFrom } from '../services/viewtoken.ts';
import { StampError, stampPdf } from '../services/watermark.ts';
import { type AccessAction, maybeEvaluateRules, observeAccess } from '../services/sharing.ts';

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** Whole-PDF deliveries per customer for the viewer: one per opened sheet is plenty for reading. */
export const FILE_LIMIT = { count: 60, seconds: 3600 };

const NO_SHEET = 'No such worksheet.';
const PAY = 'Payment required to open this sheet.';
const PAY_AGAIN = 'Your access to this sheet has ended — buy access again to open it.';
const PREPARING = 'This sheet is being prepared — please check back soon.';
const SUSPENDED = 'Access to paid sheets is paused on this account. Free sheets still open. See My Account → Security, or write to us if you think this is a mistake.';
const BAD_LINK = 'This link is not valid — open the sheet again from the site.';
const OLD_LINK = 'This viewer link has expired — open the sheet again from the site.';
const REVOKED = 'This sheet is no longer available on your account.';
const NOT_IN_PLAN = 'This sheet is not in your plan.';
const NO_LONGER_FREE = 'This sheet is not free any more — buy it on the site to open it.';
const NO_PAGE = 'No such page.';
const NO_FILE = 'This sheet has no PDF yet.';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n : min)));

type Denied = { denied: HttpError };

/** A sheet that is free now (and not archived) gets the customer's free pass if they have no live
 *  one yet. The partial unique index keeps this to one live pass even when two tabs race.
 *  True when the caller must re-read the access records (a pass was made, here or by a racing open). */
async function ensureFreePass(q: Tx, userId: string, p: ProductRow, rows: EntRow[]): Promise<boolean> {
  if (p.price_inr !== 0 || p.status === 'archived' || isScheduled(p)) return false;
  if (rows.some((e) => e.kind === 'free' && isLive(e, 0))) return false;
  // a racing open may have made the pass first (do nothing): either way the caller re-reads
  await q`
    insert into entitlements (user_id, scope, product_id, kind)
    values (${userId}, 'worksheet', ${p.id}, 'free')
    on conflict (user_id, product_id) where kind = 'free' and revoked_at is null do nothing`;
  return true;
}

/** Logs the refusal in the same transaction and hands the error back (thrown after commit,
 *  so the access_log row survives). */
async function deny(q: Tx, ctx: Ctx, user: AuthedUser, action: AccessAction, err: HttpError, o: { productId?: string | null; entitlementId?: number | null; detail: string }): Promise<Denied> {
  await observeAccess(ctx, user, { action, productId: o.productId ?? null, entitlementId: o.entitlementId ?? null, ok: false, detail: o.detail }, q);
  return { denied: err };
}

/** A draft opens only for staff who may see the catalogue; active and archived pass here
 *  (archived ones still need live access, checked by the caller). */
function visibleTo(p: ProductRow | null, user: AuthedUser): p is ProductRow {
  if (!p) return false;
  return (p.status !== 'draft' && !isScheduled(p)) || hasPermission(user.staff, 'catalogue.read');
}

const priceFor = (e: EntRow, p: ProductRow) => (e.scope === 'worksheet' ? p.price_inr : null);

/** Copies of this sheet left on this access record (0 when the sheet offers none). Counted per
 *  record and sheet, so every sheet of a class plan has its own allowance. Prints follow the
 *  sheet's print rule: the account type's number (settings.prints) or the sheet's own limit
 *  (services/entitlements.ts effectivePrintLimit, the one place it is worked out). */
async function quotaLeft(q: Tx, ent: EntRow, p: ProductRow, role: string | null) {
  const s = await getSettings(q);
  const printLimit = effectivePrintLimit(p, role, s.prints);
  const rows = await q<{ kind: string; used: number }[]>`
    select kind, used from delivery_counts where entitlement_id = ${ent.id} and product_id = ${p.id}`;
  const used = (k: string) => rows.find((r) => r.kind === k)?.used ?? 0;
  return {
    printsLeft: Math.max(0, printLimit - used('print')),
    downloadsLeft: Math.max(0, p.download_limit - used('download')),
    printLimit,
    downloadLimit: p.download_limit,
    printRule: p.print_rule,
  };
}

async function viewerSettings(q: Tx) {
  const s = await getSettings(q);
  return { tokenHours: clamp(s.viewer.tokenHours, 1, 168), recheckSeconds: clamp(s.viewer.recheckSeconds, 15, 3600) };
}

function laterRules(ctx: Ctx, user: AuthedUser, force = false) {
  if (user.staff) return;
  ctx.later(() => maybeEvaluateRules(ctx, user.id, { force }));
}

// ── POST /api/access/:id ─────────────────────────────────────────────────────────────────

async function openSheet(ctx: Ctx) {
  const user = await requireUser(ctx);
  const id = ctx.params.id ?? '';
  if (!ID_RE.test(id)) throw new HttpError(404, NO_SHEET);
  await rateLimit(ctx, 'access', user.id, 60, 300);

  const out = await tx(async (q) => {
    const fail = (status: number, msg: string, extra: Record<string, unknown>, detail: string, entId: number | null = null) =>
      deny(q, ctx, user, 'access', new HttpError(status, msg, extra), { productId: id, entitlementId: entId, detail });

    const p = await loadProduct(q, id);
    if (!visibleTo(p, user)) return await fail(404, NO_SHEET, {}, 'no such sheet');
    if (!(await hasPdf(q, p))) return await fail(410, PREPARING, { code: 'unavailable', worksheet: p.id }, 'no pdf');
    const suspended = !!user.profile.subscription_suspended_at;
    if (suspended && p.price_inr > 0) {
      return await fail(403, SUSPENDED, { code: 'access_suspended', worksheet: p.id, cls: p.class_id, price: p.price_inr }, 'access suspended');
    }

    // while paid access is suspended only free passes count
    const usable = (rows: EntRow[]) => (suspended ? rows.filter((e) => e.kind === 'free') : rows);
    let rows = await coveringEntitlements(q, user.id, p);
    // a free sheet always opens on its own free pass (never through a class plan, whose end or
    // suspension would close it)
    if (await ensureFreePass(q, user.id, p, rows)) rows = await coveringEntitlements(q, user.id, p);
    const ent = pickBest(usable(rows), p.price_inr);
    if (!ent) {
      if (p.status === 'archived') return await fail(404, NO_SHEET, {}, 'archived, no access');
      const newest = rows.find((e) => !e.revoked_at);
      const ended = newest && entStatus(newest, priceFor(newest, p)) === 'expired' ? newest : null;
      return await fail(402, ended ? PAY_AGAIN : PAY, {
        code: 'payment_required', worksheet: p.id, cls: p.class_id, price: p.price_inr, title: p.title,
        ...(ended ? { expired: true, expiredAt: ms(ended.expires_at), expiredScope: ended.scope } : {}),
      }, ended ? 'expired' : 'payment required');
    }

    const vs = await viewerSettings(q);
    const end = ms(ent.expires_at);
    const exp = Math.min(Date.now() + vs.tokenHours * 3_600_000, end ?? Number.MAX_SAFE_INTEGER);
    const token = await makeViewToken(q, { userId: user.id, productId: p.id, entitlementId: ent.id, sessionId: user.sessionId, exp });
    const quota = await quotaLeft(q, ent, p, user.profile.role);
    await observeAccess(ctx, user, { action: 'access', productId: p.id, entitlementId: ent.id, ok: true, detail: `${ent.kind} · ${ent.scope}` }, q);
    await analytics(q, ctx, { kind: 'viewer_open', userId: user.id, productId: p.id });
    return { p, ent, token, exp, vs, quota };
  });
  if ('denied' in out) throw out.denied;

  const { p, ent, token, exp, vs, quota } = out;
  if (ent.kind !== 'free') laterRules(ctx, user, true);
  return {
    ok: true,
    token,                     // old field name the site reads
    viewToken: token,
    tokenExpiresAt: exp,
    expiresAt: iso(ent.expires_at),
    expiresAtMs: ms(ent.expires_at),
    recheckSeconds: vs.recheckSeconds,
    ...quota,
    worksheet: { id: p.id, title: p.title, pages: p.pages, cls: p.class_id, subject: p.subject, price: p.price_inr, real: true, status: p.status },
    entitlement: pubEntitlement(ent, priceFor(ent, p)),
  };
}

// ── the viewer ───────────────────────────────────────────────────────────────────────────

type ViewOk = {
  user: AuthedUser; p: ProductRow; ent: EntRow; claims: ViewClaims;
  images: { name: string; page: number }[]; vs: { tokenHours: number; recheckSeconds: number };
  quota: Awaited<ReturnType<typeof quotaLeft>>;
};

async function className(q: Tx, id: string): Promise<string> {
  const r = await q<{ name: string }[]>`select name from classes where id = ${id}`;
  return r[0]?.name ?? id;
}

/** Everything a viewer request must pass. `log` writes the success row too (print/download
 *  log their own after the quota check). */
async function viewContext(ctx: Ctx, action: AccessAction, o: { images?: boolean; log?: boolean; detail?: string } = {}): Promise<ViewOk> {
  const user = await requireUser(ctx);
  await rateLimit(ctx, 'view', user.id, 300, 300);
  const raw = viewTokenFrom(ctx.req, ctx.query);

  const out = await tx(async (q): Promise<ViewOk | Denied> => {
    const claims = await readViewToken(q, raw);
    if (!claims || claims.userId !== user.id || claims.sessionId !== user.sessionId) {
      const why = !claims ? 'bad token' : claims.userId !== user.id ? 'token of another account' : 'token of another sign-in';
      // a token of another account names nothing of this customer's
      const worksheet = claims && claims.userId === user.id ? claims.productId : null;
      return await deny(q, ctx, user, 'view', new HttpError(403, BAD_LINK, { code: 'invalid', worksheet, scope: null, cls: null }),
        { productId: claims?.productId, detail: why });
    }
    // every refusal names the sheet, the kind of access record and the class, so the site can
    // offer the right way back (open again, buy again, renew the plan)
    const ref: { worksheet: string; scope: string | null; cls: string | null } = { worksheet: claims.productId, scope: null, cls: null };
    const fail = (status: number, msg: string, extra: Record<string, unknown>, detail: string) =>
      deny(q, ctx, user, 'view', new HttpError(status, msg, { ...ref, ...extra }), { productId: claims.productId, entitlementId: claims.entitlementId, detail });

    const p = await loadProduct(q, claims.productId);
    if (p) ref.cls = p.class_id;
    if (!visibleTo(p, user)) return await fail(404, NO_SHEET, {}, 'no such sheet');

    const er = await q<EntRow[]>`
      select e.*, pr.title, pr.price_inr from entitlements e left join products pr on pr.id = e.product_id
      where e.id = ${claims.entitlementId} and e.user_id = ${user.id}`;
    const tokenEnt = er[0];
    if (tokenEnt) ref.scope = tokenEnt.scope;
    if (!tokenEnt || tokenEnt.revoked_at) return await fail(403, REVOKED, { code: 'revoked' }, tokenEnt ? 'entitlement revoked' : 'no entitlement');
    const covers = tokenEnt.scope === 'worksheet' ? tokenEnt.product_id === p.id : tokenEnt.class_id === p.class_id;
    if (!covers) return await fail(403, NOT_IN_PLAN, { code: 'invalid' }, 'entitlement does not cover sheet');

    const suspended = !!user.profile.subscription_suspended_at;
    const usable = (e: EntRow) => isLive(e, priceFor(e, p)) && (!suspended || e.kind === 'free');
    let ent: EntRow | null = tokenEnt;
    if (!usable(tokenEnt)) {
      // the record this tab was opened with no longer counts: a renewal or another purchase carries
      // on, and a free sheet carries on with its free pass
      let rows = await coveringEntitlements(q, user.id, p);
      if (await ensureFreePass(q, user.id, p, rows)) rows = await coveringEntitlements(q, user.id, p);
      ent = pickBest(rows.filter((e) => !suspended || e.kind === 'free'), p.price_inr);
      if (!ent) {
        if (suspended && (isLive(tokenEnt, priceFor(tokenEnt, p)) || pickBest(rows, p.price_inr))) {
          return await fail(403, SUSPENDED, { code: 'access_suspended' }, 'access suspended');
        }
        const status = entStatus(tokenEnt, priceFor(tokenEnt, p));
        if (status === 'lapsed') return await fail(403, NO_LONGER_FREE, { code: 'expired', expired: true }, 'no longer free');
        const expiredAt = ms(tokenEnt.expires_at);
        if (tokenEnt.scope === 'class') {
          const msg = `Your ${await className(q, p.class_id)} plan has ended — renew it on the site to keep opening these sheets.`;
          return await fail(403, msg, { code: 'expired', expired: true, expiredAt }, 'plan ended');
        }
        const when = tokenEnt.expires_at ? ` on ${fmtDateTime(tokenEnt.expires_at, user.profile.time_zone)}` : '';
        return await fail(403, `Your access to this sheet ended${when} — buy access again on the site to keep opening it.`,
          { code: 'expired', expired: true, expiredAt }, status === 'scheduled' ? 'not started' : 'access ended');
      }
    }
    if (!(await hasPdf(q, p))) return await fail(410, PREPARING, { code: 'unavailable' }, 'no pdf');
    if (claims.exp <= Date.now()) return await fail(403, OLD_LINK, { code: 'invalid', tokenExpired: true }, 'token expired');

    const images = o.images && p.pdf_path
      ? await q<{ name: string; page: number }[]>`select name, page from private.worksheet_page_images(${p.pdf_path.replace(/\.pdf$/i, '')})`
      : [];
    const vs = await viewerSettings(q);
    const quota = await quotaLeft(q, ent, p, user.profile.role);
    if (o.log) {
      await observeAccess(ctx, user, { action, productId: p.id, entitlementId: ent.id, ok: true, detail: o.detail ?? null }, q);
    }
    return { user, p, ent, claims, images, vs, quota };
  });
  if ('denied' in out) throw out.denied;
  laterRules(ctx, user);
  return out;
}

async function meta(ctx: Ctx) {
  const v = await viewContext(ctx, 'meta', { images: true, log: true });
  const { user, p, ent } = v;
  const now = Date.now();
  return {
    // old shape
    title: p.title,
    cls: p.class_id,
    subject: p.subject,
    pages: v.images.length || p.pages,
    kind: ent.kind === 'grant' ? 'paid' : ent.kind,
    scope: ent.scope,
    since: ms(ent.starts_at),
    until: ms(ent.expires_at),
    real: true,
    hasPdf: true,
    hasImages: v.images.length > 0,
    now,
    user: { name: user.profile.name, email: user.profile.email, timeZone: user.profile.time_zone },
    // new
    worksheet: p.id,
    grant: ent.kind === 'grant',
    expiresAt: iso(ent.expires_at),
    tokenExpiresAt: v.claims.exp,
    recheckSeconds: v.vs.recheckSeconds,
    watermark: { name: user.profile.name, email: user.profile.email, orderId: ent.order_id, issuedAt: now },
    ...v.quota,
    entitlement: pubEntitlement(ent, priceFor(ent, p)),
  };
}

/** The PDF stamped for this customer; the original when stamping fails (recorded). */
async function stampedPdf(ctx: Ctx, v: ViewOk, bytes: Uint8Array): Promise<{ bytes: Uint8Array; pages: number | null }> {
  try {
    return await stampPdf(bytes, { name: v.user.profile.name, email: v.user.profile.email, orderId: v.ent.order_id, kind: v.ent.kind, at: new Date() });
  } catch (e) {
    const reason = e instanceof StampError ? e.reason : 'stamp_failed';
    console.error('[view] watermark failed', v.p.id, reason);
    await securityEvent(ctx, v.user.id, 'watermark.failed', { productId: v.p.id, entitlementId: v.ent.id, reason, bytes: bytes.byteLength })
      .catch((err) => console.error('[view] could not record watermark failure', (err as Error)?.message));
    return { bytes, pages: null };
  }
}

/** The stamped PDF the viewer draws the pages from. A sheet with no prints or downloads left (or
 *  none offered) still needs it — most sheets have no page picture for every page (DESIGN.md §5) — so it is
 *  never refused for that; every delivery is authenticated, stamped with the customer's name and
 *  email, logged and held to its own rate limit. */
async function file(ctx: Ctx) {
  const v = await viewContext(ctx, 'pdf', { log: false });
  const meta = { action: 'pdf' as const, productId: v.p.id, entitlementId: v.ent.id };
  try {
    await rateLimit(ctx, 'view_file', v.user.id, FILE_LIMIT.count, FILE_LIMIT.seconds,
      'This account has opened very many sheets in the last hour — please wait a while, then open the sheet again.');
  } catch (e) {
    await observeAccess(ctx, v.user, { ...meta, ok: false, detail: 'file rate limit' });
    throw e;
  }
  await observeAccess(ctx, v.user, { ...meta, ok: true });
  const bytes = await downloadBytes(WORKSHEETS, v.p.pdf_path!);
  if (!bytes) throw new HttpError(404, NO_FILE, { code: 'nofile' });
  const out = await stampedPdf(ctx, v, bytes);
  return streamResponse(out.bytes, 'application/pdf', { 'X-Pages': String(out.pages ?? v.p.pages) });
}

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function page(ctx: Ctx) {
  // 0-based, as the old viewer asks for it
  const n = intParam(ctx.query.get('n'), 0, 0, 999);
  const v = await viewContext(ctx, 'page', { images: true, log: true, detail: `p${n}` });
  const img = v.images[n];
  if (!img) throw new HttpError(404, NO_PAGE);
  const type = IMAGE_TYPES[(img.name.split('.').pop() ?? '').toLowerCase()];
  if (!type) throw new HttpError(404, NO_PAGE);
  const f = await download(WORKSHEETS, img.name);
  if (!f) throw new HttpError(404, NO_PAGE);
  return streamResponse(f.body, type, { 'X-Pages': String(v.images.length) });
}

// ── server-delivered copies (counted per access record) ─────────────────────────────────

const COPY = { print: 'printable', download: 'downloadable' } as const;

async function takeCopy(ctx: Ctx, kind: 'print' | 'download') {
  const v = await viewContext(ctx, kind, { log: false });
  await rateLimit(ctx, 'delivery', v.user.id, 30, 600);
  // prints: the effective allowance worked out in viewContext (print rule + account type)
  const limit = kind === 'print' ? v.quota.printLimit : v.p.download_limit;
  const out = await tx(async (q) => {
    const meta = { productId: v.p.id, entitlementId: v.ent.id };
    if (limit <= 0) {
      const msg = kind === 'print'
        ? 'Printing is not offered for this sheet. It opens in the viewer only.'
        : 'Downloading is not offered for this sheet. It opens in the viewer only.';
      return await deny(q, ctx, v.user, kind, new HttpError(403, msg, { code: 'not_allowed', limit: 0 }), { ...meta, detail: 'not allowed' });
    }
    const r = await q<{ left: number }[]>`select private.consume_sheet_delivery(${v.ent.id}, ${v.p.id}, ${kind}, ${limit}) as left`;
    const left = r[0]?.left ?? -1;
    if (left < 0) {
      // "all 3 prints … that come with your account"; "the 1 print … that comes with …"; a sheet with
      // its own number (print rule 'sheet') names the sheet, not the account type
      const whose = v.p.print_rule === 'sheet' ? 'that come with this sheet' : 'of this sheet that come with your account';
      const used = limit === 1 ? `the 1 print ${whose.replace('come with', 'comes with')}` : `all ${limit} prints ${whose}`;
      const msg = kind === 'print'
        ? `You have used ${used}. You can still open it in the viewer.`
        : `You have used all ${limit} ${COPY[kind]} ${limit === 1 ? 'copy' : 'copies'} of this sheet that come with your access.`;
      return await deny(q, ctx, v.user, kind, new HttpError(429, msg, { code: 'quota_exhausted', limit, used: limit }), { ...meta, detail: 'used up' });
    }
    await observeAccess(ctx, v.user, { action: kind, ...meta, ok: true, detail: `${limit - left}/${limit}` }, q);
    return { left };
  });
  if ('denied' in out) throw out.denied;
  return { v, left: out.left, limit };
}

async function print(ctx: Ctx) {
  const { left, limit } = await takeCopy(ctx, 'print');
  // honest copy: the server counts what it hands out; it cannot see a printer
  return { ok: true, printsLeft: left, printLimit: limit, counts: 'server_deliveries' };
}

async function downloadCopy(ctx: Ctx) {
  const { v, left, limit } = await takeCopy(ctx, 'download');
  let bytes: Uint8Array | null = null;
  try {
    bytes = await downloadBytes(WORKSHEETS, v.p.pdf_path!);
  } catch (e) {
    await giveBack(v.ent.id, v.p.id);
    throw e;
  }
  if (!bytes) {
    await giveBack(v.ent.id, v.p.id);
    throw new HttpError(404, NO_FILE, { code: 'nofile' });
  }
  const out = await stampedPdf(ctx, v, bytes);
  return streamResponse(out.bytes, 'application/pdf', {
    'Content-Disposition': `attachment; filename="learn-with-why-${v.p.id}.pdf"`,
    'X-Pages': String(out.pages ?? v.p.pages),
    'X-Downloads-Left': String(left),
    'X-Downloads-Limit': String(limit),
  });
}

/** The file could not be delivered: the copy is not counted. */
async function giveBack(entitlementId: number, productId: string) {
  await tx((q) => q`
    update delivery_counts set used = greatest(used - 1, 0), updated_at = now()
    where entitlement_id = ${entitlementId} and product_id = ${productId} and kind = 'download'`)
    .catch((e) => console.error('[view] could not return a download copy', (e as Error)?.message));
}

export function register(r: Router) {
  r.post('/api/access/:id', openSheet);
  r.get('/api/view/meta', meta);
  r.get('/api/view/file', file);
  r.get('/api/view/page', page);
  r.post('/api/view/print', print);
  r.post('/api/view/download', downloadCopy);
}
