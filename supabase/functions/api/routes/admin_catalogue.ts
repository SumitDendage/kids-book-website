// Staff catalogue: worksheets (products), their files (PDF, page pictures, cover) and classes.
// The old admin worksheet shape (backend/src/routes/admin.cjs: id, title, cls, subject, pages,
// price, file, thumb, active, real, updated) is kept and new fields are added.
// Rules: a new sheet starts as a draft and can only go live once its PDF is uploaded; price
// changes need pricing.write on top of catalogue.write; every write is audited (before/after) in
// the same transaction. Files go to Storage outside any transaction: check → upload → record.
import { PDFDocument } from 'pdf-lib';
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { isUnique, tx, type Tx } from '../lib/db.ts';
import { HttpError, json, readJson, readRaw } from '../lib/http.ts';
import { hasPermission, requireStaff } from '../lib/auth.ts';
import { audit, rateLimit } from '../lib/guard.ts';
import { getSettings, type Settings } from '../lib/settings.ts';
import { COVERS, publicUrl, remove, upload, WORKSHEETS } from '../lib/storage.ts';
import { cleanName, cleanText, randomBytes, sha256Hex } from '../lib/util.ts';
import { accessDaysFor } from '../services/pricing.ts';
import { PRINT_RULES, type PrintRule, sheetPrints } from '../services/entitlements.ts';
import { MAX_STAMP_BYTES, StampError, stampPdf } from '../services/watermark.ts';

const PDF_LIMIT = 40 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
// pdf-lib parses the whole file; above this size the page count comes from a quick scan instead
const PDFLIB_MAX = 5 * 1024 * 1024;
const MAX_PAGES = 500;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const OLD_ID_MESSAGE = 'Worksheet ids are letters, digits and dashes.';
const REQUIRED_MESSAGE = 'Title, subject and a known class are required.';
const NO_SHEET = 'Create the worksheet first (PUT /api/admin/worksheets/:id).';
const PDF_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}\.pdf$/;
const CLASS_RE = /^[a-z0-9]{1,12}$/;
const SECTION_RE = /^[a-z0-9-]{1,60}$/;
const GROUP_RE = /^[a-z0-9-]{1,40}$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const STATUSES = ['draft', 'active', 'archived'] as const;
const AUDIENCES = ['parent', 'teacher', 'both'] as const;
const CLASS_STATUSES = ['available', 'coming_soon', 'hidden'] as const;

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (b: Record<string, unknown>, ...keys: string[]) => keys.find((k) => b[k] !== undefined);

function forbidden(permission: string, message = 'Your staff role does not allow this.'): HttpError {
  return new HttpError(403, message, { code: 'forbidden', permission });
}
function invalid(errors: Record<string, string>, message?: string): HttpError {
  return new HttpError(400, message ?? Object.values(errors)[0], { errors });
}
const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'not_found' });

function sheetId(ctx: Ctx): string {
  const id = ctx.params.id ?? '';
  if (!ID_RE.test(id)) throw new HttpError(400, OLD_ID_MESSAGE, { errors: { id: OLD_ID_MESSAGE } });
  return id;
}

// ── value parsing (numbers may arrive as strings from forms) ─────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function intIn(v: unknown, min: number, max: number, label: string, nullable = false): Parsed<number | null> {
  if (v === null || v === '') return nullable ? { ok: true, value: null } : { ok: false, error: `${label} is required.` };
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d{1,9}\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number.` };
  if (n < min || n > max) return { ok: false, error: `${label} must be from ${min} to ${max}.` };
  return { ok: true, value: n };
}

function pctIn(v: unknown, max: number, label: string): Parsed<number> {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,3}(\.\d{1,2})?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, error: `${label} must be a number from 0 to ${max}.` };
  if (Math.round(n * 100) !== n * 100) return { ok: false, error: `${label} can have at most 2 decimals.` };
  return { ok: true, value: n };
}

/** A site path (/sheets/...) or an https URL; never javascript:, data: or a bare host. */
function thumbIn(v: unknown): Parsed<string | null> {
  if (v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: 'The picture must be a link.' };
  const s = v.trim();
  if (s.length > 300) return { ok: false, error: 'The picture link is too long (300 characters at most).' };
  if (/^\/(?!\/)[A-Za-z0-9/_.~%-]+$/.test(s) && !s.includes('..')) return { ok: true, value: s };
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && !u.username && !u.password) return { ok: true, value: u.toString() };
  } catch { /* not a URL */ }
  return { ok: false, error: 'Use a site path like /sheets/a.jpg or an https link.' };
}

// ── worksheet rows and the admin shape ───────────────────────────────────────────────────

type SheetRow = {
  id: string; title: string; description: string; class_id: string; subject: string; group_id: string | null;
  section: string | null; section_label: string | null; pages: number; price_inr: number; was_price_inr: number | null;
  status: 'draft' | 'active' | 'archived'; pdf_path: string | null; thumb_url: string | null; cover_path: string | null;
  audience: string | null; rating: number | null; rating_count: number; review_avg: number | null; review_count: number;
  print_limit: number; download_limit: number; stock: number | null; access_days: number | null; landscape: boolean;
  print_rule: PrintRule;
  tags: string[]; sort: number; created_at: Date; updated_at: Date; updated_by: string | null;
  has_pdf: boolean; pdf_bytes: number; pdf_updated_at: Date | null; ordered: boolean;
};

const SHEET_COLUMNS = (q: Tx) => q`
  p.id, p.title, p.description, p.class_id, p.subject, p.group_id, p.section, p.section_label, p.pages,
  p.price_inr, p.was_price_inr, p.status, p.pdf_path, p.thumb_url, p.cover_path, p.audience,
  p.rating::float8 as rating, p.rating_count, p.review_avg::float8 as review_avg, p.review_count,
  p.print_limit, p.print_rule, p.download_limit, p.stock, p.access_days, p.landscape, p.tags, p.sort,
  p.created_at, p.updated_at, p.updated_by,
  exists (select 1 from order_items it where it.product_id = p.id) as ordered`;

async function loadSheets(q: Tx): Promise<SheetRow[]> {
  return await q<SheetRow[]>`
    select ${SHEET_COLUMNS(q)},
           coalesce(f.has_pdf, false) as has_pdf, coalesce(f.pdf_bytes, 0) as pdf_bytes, f.pdf_updated_at
    from products p
    left join private.product_file_status() f on f.product_id = p.id
    order by p.class_id, p.sort, p.id`;
}

async function loadSheet(q: Tx, id: string, lock = false): Promise<SheetRow | null> {
  // lock first (FOR UPDATE cannot sit next to the lateral function call)
  if (lock) await q`select 1 from products where id = ${id} for update`;
  const r = await q<SheetRow[]>`
    select ${SHEET_COLUMNS(q)},
           (f.name is not null) as has_pdf, coalesce(f.size, 0) as pdf_bytes, f.updated_at as pdf_updated_at
    from products p
    left join lateral (select o.name, o.size, o.updated_at from private.worksheet_objects(array[p.pdf_path]) o limit 1) f on true
    where p.id = ${id}`;
  return r[0] ?? null;
}

export function adminWorksheet(r: SheetRow, s: Settings) {
  return {
    // the old admin shape
    id: r.id,
    title: r.title,
    cls: r.class_id,
    subject: r.subject,
    pages: r.pages,
    price: r.price_inr,
    file: r.pdf_path,
    thumb: r.thumb_url,
    active: r.status === 'active',
    real: r.has_pdf,
    updated: ms(r.updated_at),
    // new
    status: r.status,
    available: r.has_pdf,
    pdfBytes: r.has_pdf ? r.pdf_bytes : null,
    pdfUpdatedAt: ms(r.pdf_updated_at),
    free: r.price_inr === 0,
    description: r.description,
    group: r.group_id,
    section: r.section,
    sectionLabel: r.section_label,
    wasPrice: r.was_price_inr,
    audience: r.audience,
    printLimit: r.print_limit,
    // 'account': prints per sheet come from the customer's account type (settings.prints);
    // 'sheet': printLimit above (0 = no printing)
    printRule: r.print_rule,
    prints: sheetPrints(r, s.prints),
    downloadLimit: r.download_limit,
    stock: r.stock,
    accessDays: r.access_days,
    effectiveAccessDays: accessDaysFor(s, r.access_days),
    tags: r.tags,
    sort: r.sort,
    landscape: r.landscape,
    coverPath: r.cover_path,
    rating: r.rating,
    ratingCount: r.rating_count,
    reviewAvg: r.review_avg,
    reviewCount: r.review_count,
    ordered: r.ordered,
    created: ms(r.created_at),
    updatedBy: r.updated_by,
  };
}

// ── worksheet input ──────────────────────────────────────────────────────────────────────

/** Editable product columns (what POST/PUT may set). */
type SheetFields = {
  title: string; description: string; class_id: string; subject: string; group_id: string | null; section: string | null;
  section_label: string | null; pages: number; price_inr: number; was_price_inr: number | null;
  status: 'draft' | 'active' | 'archived'; audience: string | null; print_limit: number; download_limit: number;
  stock: number | null; access_days: number | null; tags: string[]; sort: number; thumb_url: string | null; landscape: boolean;
  print_rule: PrintRule;
};

/** Reads the fields present in a body (old and new names). Missing fields are left out. */
function parseSheetFields(b: Record<string, unknown>): { set: Partial<SheetFields>; errors: Record<string, string> } {
  const set: Partial<SheetFields> = {};
  const errors: Record<string, string> = {};
  const put = <K extends keyof SheetFields>(field: string, key: K, p: Parsed<unknown>) => {
    if (p.ok) set[key] = p.value as SheetFields[K]; else errors[field] = p.error;
  };

  if (b.title !== undefined) {
    const t = cleanName(b.title);
    if (!t) errors.title = 'Give the sheet a title.';
    else if (t.length > 160) errors.title = 'Keep the title under 160 characters.';
    else set.title = t;
  }
  const descKey = has(b, 'description', 'blurb');
  if (descKey) {
    const raw = b[descKey];
    if (raw !== null && typeof raw !== 'string') errors.description = 'The description must be text.';
    else if (String(raw ?? '').length > 2000) errors.description = 'Keep the description under 2000 characters.';
    else set.description = cleanText(raw, 2000);
  }
  const clsKey = has(b, 'cls', 'classId', 'class');
  if (clsKey) {
    const c = typeof b[clsKey] === 'string' ? (b[clsKey] as string).trim() : '';
    if (!CLASS_RE.test(c)) errors.cls = 'Pick a known class.'; else set.class_id = c;
  }
  if (b.subject !== undefined) {
    const sj = cleanName(b.subject);
    if (!sj) errors.subject = 'Give the sheet a subject.';
    else if (sj.length > 40) errors.subject = 'Keep the subject under 40 characters.';
    else set.subject = sj;
  }
  const groupKey = has(b, 'group', 'groupId');
  if (groupKey) {
    const g = b[groupKey];
    if (g === null || g === '') set.group_id = null;
    else if (typeof g === 'string' && GROUP_RE.test(g.trim())) set.group_id = g.trim();
    else errors.group = 'Groups are lower-case letters, digits and dashes.';
  }
  if (b.section !== undefined) {
    const sc = b.section;
    if (sc === null || sc === '') set.section = null;
    else if (typeof sc === 'string' && SECTION_RE.test(sc.trim())) set.section = sc.trim();
    else errors.section = 'Sections are lower-case letters, digits and dashes.';
  }
  if (b.sectionLabel !== undefined) {
    const l = b.sectionLabel === null ? '' : cleanName(b.sectionLabel);
    if (l.length > 60) errors.sectionLabel = 'Keep the section name under 60 characters.';
    else set.section_label = l || null;
  }
  if (b.pages !== undefined) put('pages', 'pages', intIn(b.pages, 1, MAX_PAGES, 'Pages'));
  const priceKey = has(b, 'price', 'priceInr');
  if (priceKey) put('price', 'price_inr', intIn(b[priceKey], 0, 100000, 'Price (whole rupees)'));
  const wasKey = has(b, 'wasPrice', 'was', 'wasPriceInr');
  if (wasKey) put('wasPrice', 'was_price_inr', intIn(b[wasKey], 0, 100000, 'Old price (whole rupees)', true));
  if (b.status !== undefined) {
    if ((STATUSES as readonly unknown[]).includes(b.status)) set.status = b.status as SheetFields['status'];
    else errors.status = 'Status is draft, active or archived.';
  } else if (b.active !== undefined) {
    // old field: active false = take it off the shelf
    if (typeof b.active !== 'boolean') errors.active = 'active is true or false.';
    else set.status = b.active ? 'active' : 'archived';
  }
  if (b.audience !== undefined) {
    if (b.audience === null || b.audience === '') set.audience = null;
    else if ((AUDIENCES as readonly unknown[]).includes(b.audience)) set.audience = b.audience as string;
    else errors.audience = 'Audience is parent, teacher or both.';
  }
  const printKey = has(b, 'printLimit', 'print_limit');
  if (printKey) put('printLimit', 'print_limit', intIn(b[printKey], 0, 100, 'Print limit (0 = no printing)'));
  const ruleKey = has(b, 'printRule', 'print_rule');
  if (ruleKey) {
    const v = b[ruleKey];
    if ((PRINT_RULES as readonly unknown[]).includes(v)) set.print_rule = v as PrintRule;
    else errors.printRule = 'Print rule is account (prints from the account type) or sheet (this sheet\'s own print limit).';
  }
  const dlKey = has(b, 'downloadLimit', 'download_limit');
  if (dlKey) put('downloadLimit', 'download_limit', intIn(b[dlKey], 0, 100, 'Download limit (0 = view only)'));
  if (b.stock !== undefined) put('stock', 'stock', intIn(b.stock, 0, 1_000_000, 'Stock', true));
  const daysKey = has(b, 'accessDays', 'access_days');
  if (daysKey) put('accessDays', 'access_days', intIn(b[daysKey], 1, 3650, 'Access days', true));
  if (b.tags !== undefined) {
    const raw = b.tags;
    const list = Array.isArray(raw) ? raw : raw === null ? [] : null;
    if (!list || list.length > 20 || !list.every((t) => typeof t === 'string' && TAG_RE.test(t.trim().toLowerCase()))) {
      errors.tags = 'Tags are up to 20 short words (letters, digits, dashes).';
    } else {
      set.tags = [...new Set(list.map((t) => (t as string).trim().toLowerCase()))];
    }
  }
  if (b.sort !== undefined) put('sort', 'sort', intIn(b.sort, -1_000_000, 1_000_000, 'Sort'));
  const thumbKey = has(b, 'thumb', 'thumbUrl');
  if (thumbKey) put('thumb', 'thumb_url', thumbIn(b[thumbKey]));
  if (b.landscape !== undefined) {
    if (typeof b.landscape !== 'boolean') errors.landscape = 'landscape is true or false.';
    else set.landscape = b.landscape;
  }
  return { set, errors };
}

const FIELD_NAMES: Record<keyof SheetFields, string> = {
  title: 'title', description: 'description', class_id: 'cls', subject: 'subject', group_id: 'group', section: 'section',
  section_label: 'sectionLabel', pages: 'pages', price_inr: 'price', was_price_inr: 'wasPrice', status: 'status',
  audience: 'audience', print_limit: 'printLimit', download_limit: 'downloadLimit', stock: 'stock', access_days: 'accessDays',
  tags: 'tags', sort: 'sort', thumb_url: 'thumb', landscape: 'landscape', print_rule: 'printRule',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Changed fields as { before, after } for the audit row (API names). */
function diff(before: Partial<SheetFields>, after: Partial<SheetFields>) {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof SheetFields)[]) {
    if (same(before[k], after[k])) continue;
    b[FIELD_NAMES[k]] = before[k] ?? null;
    a[FIELD_NAMES[k]] = after[k] ?? null;
  }
  return { before: b, after: a };
}

async function classExists(q: Tx, id: string): Promise<boolean> {
  return (await q`select 1 from classes where id = ${id}`).length > 0;
}

/** Price fields need pricing.write; content editors may still send them unchanged. */
function checkPricePermission(ctx: Ctx, cur: Pick<SheetFields, 'price_inr' | 'was_price_inr'>, set: Partial<SheetFields>) {
  const changes = (set.price_inr !== undefined && set.price_inr !== cur.price_inr)
    || (set.was_price_inr !== undefined && set.was_price_inr !== cur.was_price_inr);
  if (changes && !hasPermission(ctx.user!.staff, 'pricing.write')) {
    throw forbidden('pricing.write', 'Your staff role does not allow price changes.');
  }
}

function newSheetId(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  const tail = Array.from(randomBytes(3), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 5);
  return `${slug.length >= 2 ? slug : 'p'}-${tail}`;
}

// ── GET /api/admin/worksheets ────────────────────────────────────────────────────────────

async function listSheets(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  const s = await getSettings();
  const rows = await tx((q) => loadSheets(q));
  const status = ctx.query.get('status');
  const list = status && (STATUSES as readonly string[]).includes(status) ? rows.filter((r) => r.status === status) : rows;
  return { worksheets: list.map((r) => adminWorksheet(r, s)) };
}

async function getSheet(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  const id = sheetId(ctx);
  const s = await getSettings();
  const row = await tx((q) => loadSheet(q, id));
  if (!row) throw notFound('No such worksheet.');
  return { worksheet: adminWorksheet(row, s) };
}

// ── POST /api/admin/worksheets (and PUT on an unknown id, as the old upsert did) ─────────

async function createSheet(ctx: Ctx, id: string | null, b: Record<string, unknown>): Promise<Response> {
  const { set, errors } = parseSheetFields(b);
  if (!set.title && !errors.title) errors.title = 'Give the sheet a title.';
  if (!set.subject && !errors.subject) errors.subject = 'Give the sheet a subject.';
  if (!set.class_id && !errors.cls) errors.cls = 'Pick a known class.';
  if (id === null && b.id !== undefined && b.id !== null && b.id !== '') {
    if (typeof b.id === 'string' && ID_RE.test(b.id.trim())) id = b.id.trim();
    else errors.id = OLD_ID_MESSAGE;
  }
  if (Object.keys(errors).length) {
    throw invalid(errors, errors.title || errors.subject || errors.cls ? REQUIRED_MESSAGE : errors.id ?? undefined);
  }
  const finalId = id ?? newSheetId(set.title!);
  const s = await getSettings();
  const row = await tx(async (q) => {
    if (!(await classExists(q, set.class_id!))) throw invalid({ cls: 'Pick a known class.' }, REQUIRED_MESSAGE);
    // the column defaults are the "current" values a content editor may leave unchanged
    checkPricePermission(ctx, { price_inr: 19, was_price_inr: null }, set);
    const v: SheetFields = {
      title: set.title!, description: set.description ?? '', class_id: set.class_id!, subject: set.subject!,
      group_id: set.group_id ?? null, section: set.section ?? null, section_label: set.section_label ?? null,
      pages: set.pages ?? 1, price_inr: set.price_inr ?? 19, was_price_inr: set.was_price_inr ?? null,
      // a new sheet is a draft until its PDF is uploaded (then publish it with status: 'active')
      status: 'draft',
      audience: set.audience ?? null, print_limit: set.print_limit ?? 0, download_limit: set.download_limit ?? 0,
      stock: set.stock ?? null, access_days: set.access_days ?? null, tags: set.tags ?? [], sort: set.sort ?? 0,
      thumb_url: set.thumb_url ?? null, landscape: set.landscape ?? false,
      print_rule: set.print_rule ?? 'account',
    };
    try {
      await q`
        insert into products (id, title, description, class_id, subject, group_id, section, section_label, pages,
                              price_inr, was_price_inr, status, audience, print_limit, download_limit, stock,
                              access_days, tags, sort, thumb_url, landscape, print_rule, updated_by)
        values (${finalId}, ${v.title}, ${v.description}, ${v.class_id}, ${v.subject}, ${v.group_id}, ${v.section},
                ${v.section_label}, ${v.pages}, ${v.price_inr}, ${v.was_price_inr}, ${v.status}, ${v.audience},
                ${v.print_limit}, ${v.download_limit}, ${v.stock}, ${v.access_days}, ${v.tags}::text[], ${v.sort},
                ${v.thumb_url}, ${v.landscape}, ${v.print_rule}, ${ctx.user!.id})`;
    } catch (e) {
      if (isUnique(e, 'products_pkey')) throw new HttpError(409, 'A worksheet with that id already exists.', { code: 'exists', errors: { id: 'That id is taken.' } });
      throw e;
    }
    await audit(ctx, {
      action: 'worksheet.create', targetType: 'product', targetId: finalId,
      detail: { before: null, after: diff({}, v).after, requestedStatus: set.status ?? null },
    }, q);
    return (await loadSheet(q, finalId))!;
  });
  return json(201, { worksheet: adminWorksheet(row, s), created: true });
}

async function postSheet(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const b = await readJson(ctx.req, 32 * 1024);
  return await createSheet(ctx, null, b);
}

// ── PUT /api/admin/worksheets/:id ────────────────────────────────────────────────────────

async function putSheet(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = sheetId(ctx);
  const b = await readJson(ctx.req, 32 * 1024);
  const exists = await tx((q) => q`select 1 from products where id = ${id}`);
  if (!exists.length) return await createSheet(ctx, id, b);

  const { set, errors } = parseSheetFields(b);
  if (Object.keys(errors).length) throw invalid(errors);
  const s = await getSettings();
  const row = await tx(async (q) => {
    const cur = await loadSheet(q, id, true);
    if (!cur) throw notFound('No such worksheet.');
    checkPricePermission(ctx, cur, set);
    if (set.class_id && set.class_id !== cur.class_id && !(await classExists(q, set.class_id))) {
      throw invalid({ cls: 'Pick a known class.' }, REQUIRED_MESSAGE);
    }
    if (set.status === 'active' && cur.status !== 'active' && !cur.has_pdf) {
      throw new HttpError(400, 'Upload the PDF before putting this sheet on sale.', { code: 'pdf_missing', errors: { status: 'Upload the PDF first.' } });
    }
    const next: SheetFields = {
      title: set.title ?? cur.title, description: set.description ?? cur.description, class_id: set.class_id ?? cur.class_id,
      subject: set.subject ?? cur.subject,
      group_id: set.group_id !== undefined ? set.group_id : cur.group_id,
      section: set.section !== undefined ? set.section : cur.section,
      section_label: set.section_label !== undefined ? set.section_label : cur.section_label,
      pages: set.pages ?? cur.pages, price_inr: set.price_inr ?? cur.price_inr,
      was_price_inr: set.was_price_inr !== undefined ? set.was_price_inr : cur.was_price_inr,
      status: set.status ?? cur.status,
      audience: set.audience !== undefined ? set.audience : cur.audience,
      print_limit: set.print_limit ?? cur.print_limit, download_limit: set.download_limit ?? cur.download_limit,
      stock: set.stock !== undefined ? set.stock : cur.stock,
      access_days: set.access_days !== undefined ? set.access_days : cur.access_days,
      tags: set.tags ?? cur.tags, sort: set.sort ?? cur.sort,
      thumb_url: set.thumb_url !== undefined ? set.thumb_url : cur.thumb_url,
      landscape: set.landscape ?? cur.landscape,
      print_rule: set.print_rule ?? cur.print_rule,
    };
    const d = diff(cur, next);
    if (!Object.keys(d.after).length) return cur;   // nothing changed: no write, no audit row
    await q`
      update products set
        title = ${next.title}, description = ${next.description}, class_id = ${next.class_id}, subject = ${next.subject},
        group_id = ${next.group_id}, section = ${next.section}, section_label = ${next.section_label}, pages = ${next.pages},
        price_inr = ${next.price_inr}, was_price_inr = ${next.was_price_inr}, status = ${next.status},
        audience = ${next.audience}, print_limit = ${next.print_limit}, download_limit = ${next.download_limit},
        stock = ${next.stock}, access_days = ${next.access_days}, tags = ${next.tags}::text[], sort = ${next.sort},
        thumb_url = ${next.thumb_url}, landscape = ${next.landscape}, print_rule = ${next.print_rule}, updated_by = ${ctx.user!.id}
      where id = ${id}`;
    await audit(ctx, { action: 'worksheet.update', targetType: 'product', targetId: id, detail: d }, q);
    return (await loadSheet(q, id))!;
  });
  return { worksheet: adminWorksheet(row, s) };
}

// ── DELETE /api/admin/worksheets/:id (archive; ?hard=1 deletes a sheet nobody ordered) ──

async function deleteSheet(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = sheetId(ctx);
  const hard = ['1', 'true', 'yes'].includes(ctx.query.get('hard') ?? '');
  const s = await getSettings();
  if (!hard) {
    const row = await tx(async (q) => {
      const cur = await loadSheet(q, id, true);
      if (!cur) throw notFound('No such worksheet.');
      if (cur.status === 'archived') return cur;
      await q`update products set status = 'archived', updated_by = ${ctx.user!.id} where id = ${id}`;
      await audit(ctx, { action: 'worksheet.archive', targetType: 'product', targetId: id, detail: { before: { status: cur.status }, after: { status: 'archived' } } }, q);
      return (await loadSheet(q, id))!;
    });
    // archived sheets leave the shop; customers who bought them keep access until it expires
    return { ok: true, archived: true, deleted: false, worksheet: adminWorksheet(row, s) };
  }

  const gone = await tx(async (q) => {
    const cur = await loadSheet(q, id, true);
    if (!cur) throw notFound('No such worksheet.');
    const used = await q`
      select 1 from order_items where product_id = ${id}
      union all select 1 from entitlements where product_id = ${id}
      limit 1`;
    if (used.length) {
      throw new HttpError(409, 'This sheet has been ordered or opened by customers, so it can only be archived.', { code: 'in_use' });
    }
    await q`delete from products where id = ${id}`;
    await audit(ctx, { action: 'worksheet.delete', targetType: 'product', targetId: id, detail: { before: { ...diff({}, cur).after, file: cur.pdf_path, coverPath: cur.cover_path }, after: null } }, q);
    return cur;
  });
  // files a staff member uploaded for this sheet go too (original catalogue files are left alone)
  const stale = gone.pdf_path === `uploads/${id}.pdf` ? [gone.pdf_path] : [];
  await removeQuietly(WORKSHEETS, stale);
  if (gone.cover_path) await removeQuietly(COVERS, [gone.cover_path]);
  return { ok: true, archived: false, deleted: true };
}

async function removeQuietly(bucket: string, paths: string[]) {
  if (!paths.length) return;
  try {
    await remove(bucket, paths);
  } catch (e) {
    console.error('[admin] could not remove old files', bucket, (e as Error)?.message ?? e);
  }
}

// ── POST /api/admin/worksheets/:id/restore ───────────────────────────────────────────────

async function restoreSheet(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = sheetId(ctx);
  const s = await getSettings();
  const { row, restored } = await tx(async (q) => {
    const cur = await loadSheet(q, id, true);
    if (!cur) throw notFound('No such worksheet.');
    if (cur.status !== 'archived') return { row: cur, restored: false };
    // back on the shelf only when its PDF is there; otherwise it waits as a draft
    const status = cur.has_pdf ? 'active' : 'draft';
    await q`update products set status = ${status}, updated_by = ${ctx.user!.id} where id = ${id}`;
    await audit(ctx, { action: 'worksheet.restore', targetType: 'product', targetId: id, detail: { before: { status: cur.status }, after: { status } } }, q);
    return { row: (await loadSheet(q, id))!, restored: true };
  });
  return { ok: true, restored, worksheet: adminWorksheet(row, s) };
}

// ── POST /api/admin/worksheets/:id/file (raw PDF body) ───────────────────────────────────

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

function looksLikePdf(b: Uint8Array): boolean {
  return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
}

/** A complete PDF ends with %%EOF (allowing some trailing bytes); a cut-off upload does not. */
function endsLikePdf(b: Uint8Array): boolean {
  const tail = new TextDecoder('latin1').decode(b.subarray(Math.max(0, b.length - 8192)));
  return tail.includes('%%EOF');
}

/** Page count: pdf-lib for normal sizes, else a scan for page objects. null = unknown. */
async function countPages(b: Uint8Array): Promise<{ pages: number | null; method: 'pdf-lib' | 'scan' | null }> {
  if (b.length <= PDFLIB_MAX) {
    try {
      const doc = await PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
      const n = doc.getPageCount();
      if (n >= 1) return { pages: n, method: 'pdf-lib' };
    } catch {
      // unusual or damaged structure: fall back to the scan
    }
  }
  const text = new TextDecoder('latin1').decode(b);
  const n = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  return n >= 1 && n <= MAX_PAGES ? { pages: n, method: 'scan' } : { pages: null, method: null };
}

/** Every copy a customer gets is stamped with their name and email (services/watermark.ts). A file
 *  the stamp cannot handle would go out unstamped on every view, so it is refused here instead:
 *  larger than the stamping limit, password-protected, or unreadable to pdf-lib. */
async function checkStampable(bytes: Uint8Array) {
  const mb = (n: number) => Math.round((n / (1024 * 1024)) * 10) / 10;
  if (bytes.length > MAX_STAMP_BYTES) {
    throw new HttpError(400,
      `That PDF is ${mb(bytes.length)} MB. Each copy is stamped with the customer's name before it is sent, which works up to ${mb(MAX_STAMP_BYTES)} MB — please make the file smaller (for example by compressing its pictures) and upload it again.`,
      { code: 'pdf_too_large', limit: MAX_STAMP_BYTES });
  }
  try {
    await stampPdf(bytes, { name: 'Upload check', email: 'check@learnwithwhy.invalid', orderId: null, kind: 'paid', at: new Date() });
  } catch (e) {
    if (!(e instanceof StampError)) throw e;
    if (e.reason === 'encrypted') {
      throw new HttpError(400,
        'This PDF is password-protected (it has an owner or permissions password), so the customer\'s name cannot be stamped on it. Save it again without a password and upload that copy.',
        { code: 'pdf_encrypted' });
    }
    throw new HttpError(400,
      'The customer\'s name could not be stamped on this PDF. Save it again (for example with Print → Save as PDF) and upload that copy.',
      { code: 'pdf_unstampable', reason: e.reason });
  }
}

async function uploadPdf(ctx: Ctx) {
  const u = await requireStaff(ctx, 'files.upload');
  const id = sheetId(ctx);
  const publish = ['1', 'true', 'yes'].includes(ctx.query.get('publish') ?? '');
  if (publish && !hasPermission(u.staff, 'catalogue.write')) throw forbidden('catalogue.write');
  await rateLimit(ctx, 'admin_upload', u.id, 120, 3600);

  const cur = (await tx((q) => q<{ pdf_path: string | null }[]>`select pdf_path from products where id = ${id}`))[0];
  if (!cur) throw new HttpError(404, NO_SHEET, { code: 'not_found' });
  const bytes = await readRaw(ctx.req, PDF_LIMIT);
  if (!looksLikePdf(bytes)) throw new HttpError(400, 'That is not a PDF.', { code: 'not_pdf' });
  if (!endsLikePdf(bytes)) throw new HttpError(400, 'The PDF looks incomplete — please upload it again.', { code: 'pdf_incomplete' });
  await checkStampable(bytes);
  const counted = await countPages(bytes);
  if (counted.pages !== null && counted.pages > MAX_PAGES) {
    throw new HttpError(400, `That PDF has ${counted.pages} pages; a sheet can have ${MAX_PAGES} at most.`, { code: 'too_many_pages' });
  }
  const path = cur.pdf_path ?? `uploads/${id}.pdf`;
  if (!PDF_PATH_RE.test(path) || path.includes('..')) throw new HttpError(409, 'This sheet has an unusual file name — ask a developer.', { code: 'bad_path' });
  const sha256 = await sha256Hex(bytes);

  await upload(WORKSHEETS, path, bytes, 'application/pdf');

  const s = await getSettings();
  const row = await tx(async (q) => {
    const before = await loadSheet(q, id, true);
    if (!before) throw new HttpError(404, NO_SHEET, { code: 'not_found' });
    if (before.pdf_path && before.pdf_path !== path) {
      throw new HttpError(409, 'The sheet changed while the file was uploading — please try again.', { code: 'conflict' });
    }
    const pages = counted.pages ?? before.pages;
    const status = publish && before.status === 'draft' ? 'active' : before.status;
    await q`
      update products set pdf_path = ${path}, pages = ${pages}, status = ${status}, updated_by = ${ctx.user!.id}
      where id = ${id}`;
    await audit(ctx, {
      action: 'worksheet.file_upload', targetType: 'product', targetId: id,
      detail: {
        before: { file: before.pdf_path, pages: before.pages, status: before.status, hadPdf: before.has_pdf, bytes: before.has_pdf ? before.pdf_bytes : null },
        after: { file: path, pages, status, bytes: bytes.length, sha256 },
        pageCount: counted.method,
      },
    }, q);
    return (await loadSheet(q, id))!;
  });
  return { worksheet: adminWorksheet(row, s), pagesCounted: counted.method !== null };
}

// ── page pictures and the cover ──────────────────────────────────────────────────────────

type ImageKind = { ext: 'jpg' | 'png' | 'webp'; type: string };

function imageKind(b: Uint8Array): ImageKind | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { ext: 'webp', type: 'image/webp' };
  return null;
}

async function readImage(ctx: Ctx): Promise<{ bytes: Uint8Array; kind: ImageKind }> {
  const bytes = await readRaw(ctx.req, IMAGE_LIMIT);
  const kind = imageKind(bytes);
  if (!kind || bytes.length < 32) throw new HttpError(400, 'Use a JPG, PNG or WebP picture (5 MB at most).', { code: 'bad_image' });
  return { bytes, kind };
}

/** POST /api/admin/worksheets/:id/pages/:n — a full-size page picture next to the PDF
 *  (<base>-<n>.jpg|png|webp in the private bucket; the viewer's /api/view/page reads these). */
async function uploadPage(ctx: Ctx) {
  const u = await requireStaff(ctx, 'files.upload');
  const id = sheetId(ctx);
  const nRaw = ctx.params.n ?? '';
  const n = /^\d{1,3}$/.test(nRaw) ? Number(nRaw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES) {
    throw new HttpError(400, `The page number must be from 1 to ${MAX_PAGES}.`, { errors: { n: 'Unknown page.' } });
  }
  await rateLimit(ctx, 'admin_upload', u.id, 120, 3600);
  const cur = (await tx((q) => q<{ pdf_path: string | null }[]>`select pdf_path from products where id = ${id}`))[0];
  if (!cur) throw new HttpError(404, NO_SHEET, { code: 'not_found' });
  const { bytes, kind } = await readImage(ctx);
  const base = (cur.pdf_path ?? `uploads/${id}.pdf`).replace(/\.pdf$/, '');
  const path = `${base}-${n}.${kind.ext}`;

  const names = (['jpg', 'png', 'webp'] as const).map((e) => `${base}-${n}.${e}`);
  const before = await tx((q) => q<{ name: string; size: number }[]>`select name, size from private.worksheet_objects(${names}::text[])`);

  await upload(WORKSHEETS, path, bytes, kind.type);
  // one picture per page: drop the same page in another format
  const replaced = before.map((r) => r.name).filter((name) => name !== path);
  await removeQuietly(WORKSHEETS, replaced);

  const pages = await tx(async (q) => {
    await audit(ctx, {
      action: 'worksheet.page_upload', targetType: 'product', targetId: id,
      detail: {
        page: n,
        before: before.length ? { files: before.map((r) => r.name) } : null,
        after: { file: path, type: kind.type, bytes: bytes.length },
        replaced,
      },
    }, q);
    return await q<{ name: string; page: number }[]>`select name, page from private.worksheet_page_images(${base})`;
  });
  return { ok: true, page: n, type: kind.type, bytes: bytes.length, pages: pages.map((p) => p.page) };
}

/** POST /api/admin/worksheets/:id/cover — a small public picture in the "covers" bucket. */
async function uploadCover(ctx: Ctx) {
  const u = await requireStaff(ctx, 'files.upload');
  const id = sheetId(ctx);
  await rateLimit(ctx, 'admin_upload', u.id, 120, 3600);
  const exists = await tx((q) => q`select 1 from products where id = ${id}`);
  if (!exists.length) throw new HttpError(404, NO_SHEET, { code: 'not_found' });
  const { bytes, kind } = await readImage(ctx);
  // a new name each time, so browsers and the CDN never show the old picture
  const stamp = Date.now().toString(36) + Array.from(randomBytes(3), (x) => x.toString(16).padStart(2, '0')).join('');
  const path = `${id}/${stamp}.${kind.ext}`;
  const url = publicUrl(COVERS, path);
  if (url.length > 300) throw new HttpError(400, 'The sheet id is too long for a cover picture.', { code: 'bad_path' });

  await upload(COVERS, path, bytes, kind.type);

  const s = await getSettings();
  const { row, old } = await tx(async (q) => {
    const before = await loadSheet(q, id, true);
    if (!before) throw new HttpError(404, NO_SHEET, { code: 'not_found' });
    await q`update products set cover_path = ${path}, thumb_url = ${url}, updated_by = ${ctx.user!.id} where id = ${id}`;
    await audit(ctx, {
      action: 'worksheet.cover_upload', targetType: 'product', targetId: id,
      detail: { before: { coverPath: before.cover_path, thumb: before.thumb_url }, after: { coverPath: path, thumb: url, type: kind.type, bytes: bytes.length } },
    }, q);
    return { row: (await loadSheet(q, id))!, old: before.cover_path };
  });
  if (old && old !== path) await removeQuietly(COVERS, [old]);
  return { worksheet: adminWorksheet(row, s) };
}

// ── GET /api/admin/files ─────────────────────────────────────────────────────────────────

async function files(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  const rows = await tx((q) => q<{
    id: string; title: string; status: string; class_id: string; pdf_path: string | null; pages: number;
    has_pdf: boolean; pdf_bytes: number; pdf_updated_at: Date | null;
  }[]>`
    select p.id, p.title, p.status, p.class_id, p.pdf_path, p.pages,
           coalesce(f.has_pdf, false) as has_pdf, coalesce(f.pdf_bytes, 0) as pdf_bytes, f.pdf_updated_at
    from products p left join private.product_file_status() f on f.product_id = p.id
    order by coalesce(f.has_pdf, false), p.class_id, p.sort, p.id`);
  const list = rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, cls: r.class_id, file: r.pdf_path, pages: r.pages,
    hasPdf: r.has_pdf, pdfBytes: r.has_pdf ? r.pdf_bytes : null, pdfUpdatedAt: ms(r.pdf_updated_at),
  }));
  // archived sheets without a file do not need attention
  const missing = list.filter((f) => !f.hasPdf && f.status !== 'archived').map((f) => f.id);
  return { files: list, missing, counts: { total: list.length, withPdf: list.filter((f) => f.hasPdf).length, missing: missing.length } };
}

// ── classes ──────────────────────────────────────────────────────────────────────────────

type ClassRow = { id: string; name: string; status: string; discount_pct: number; sort: number; updated_at: Date; products: number; active_products: number };

async function loadClasses(q: Tx): Promise<ClassRow[]> {
  return await q<ClassRow[]>`
    select c.id, c.name, c.status, c.discount_pct::float8 as discount_pct, c.sort, c.updated_at,
           (select count(*) from products p where p.class_id = c.id)::int as products,
           (select count(*) from products p where p.class_id = c.id and p.status = 'active')::int as active_products
    from classes c order by c.sort, c.id`;
}

const classView = (c: ClassRow) => ({
  id: c.id, name: c.name, label: c.name, status: c.status, discountPct: c.discount_pct, sort: c.sort,
  available: c.status === 'available', comingSoon: c.status === 'coming_soon', updatedAt: ms(c.updated_at),
  products: c.products, activeProducts: c.active_products,
});

async function listClasses(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  const rows = await tx((q) => loadClasses(q));
  return { classes: rows.map(classView) };
}

type ClassIn = { id: string; name?: string; status?: string; discount_pct?: number; sort?: number };

/** PUT /api/admin/classes {classes:[{id, name?, status?, discountPct?, sort?}]} or one {id, ...}.
 *  An unknown id with a name adds a class. Discounts need pricing.write. */
async function putClasses(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const b = await readJson(ctx.req, 32 * 1024);
  const raw = Array.isArray(b.classes) ? b.classes : (b.id !== undefined ? [b] : null);
  if (!raw || !raw.length || raw.length > 50) throw invalid({ classes: 'Send the classes to change.' });
  const items: ClassIn[] = [];
  const errors: Record<string, string> = {};
  raw.forEach((c, i) => {
    const key = isObj(c) && typeof c.id === 'string' ? c.id : `#${i + 1}`;
    if (!isObj(c) || typeof c.id !== 'string' || !CLASS_RE.test(c.id)) { errors[key] = 'Class ids are lower-case letters and digits (12 at most).'; return; }
    const it: ClassIn = { id: c.id };
    const nameKey = has(c, 'name', 'label');
    if (nameKey) {
      const n = cleanName(c[nameKey]);
      if (!n || n.length > 40) { errors[key] = 'A class name is 1 to 40 characters.'; return; }
      it.name = n;
    }
    if (c.status !== undefined) {
      if (!(CLASS_STATUSES as readonly unknown[]).includes(c.status)) { errors[key] = 'Status is available, coming_soon or hidden.'; return; }
      it.status = c.status as string;
    }
    const pctKey = has(c, 'discountPct', 'discount_pct', 'discount');
    if (pctKey) {
      const p = pctIn(c[pctKey], 90, 'The class discount');
      if (!p.ok) { errors[key] = p.error; return; }
      it.discount_pct = p.value;
    }
    if (c.sort !== undefined) {
      const p = intIn(c.sort, -1000, 1000, 'Sort');
      if (!p.ok) { errors[key] = p.error; return; }
      it.sort = p.value!;
    }
    items.push(it);
  });
  if (Object.keys(errors).length) throw invalid(errors);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw invalid({ classes: 'Each class only once, please.' });

  const rows = await tx(async (q) => {
    for (const it of items) {
      const cur = (await q<ClassRow[]>`
        select id, name, status, discount_pct::float8 as discount_pct, sort, updated_at, 0 as products, 0 as active_products
        from classes where id = ${it.id} for update`)[0];
      if (!cur) {
        if (!it.name) throw invalid({ [it.id]: 'Unknown class — give it a name to add it.' });
        if ((it.discount_pct ?? 0) > 0 && !hasPermission(ctx.user!.staff, 'pricing.write')) throw forbidden('pricing.write', 'Your staff role does not allow price changes.');
        const v = { name: it.name, status: it.status ?? 'coming_soon', discountPct: it.discount_pct ?? 0, sort: it.sort ?? 0 };
        await q`insert into classes (id, name, status, discount_pct, sort) values (${it.id}, ${v.name}, ${v.status}, ${v.discountPct}, ${v.sort})`;
        await audit(ctx, { action: 'class.create', targetType: 'class', targetId: it.id, detail: { before: null, after: v } }, q);
        continue;
      }
      if (it.discount_pct !== undefined && it.discount_pct !== cur.discount_pct && !hasPermission(ctx.user!.staff, 'pricing.write')) {
        throw forbidden('pricing.write', 'Your staff role does not allow price changes.');
      }
      const next = { name: it.name ?? cur.name, status: it.status ?? cur.status, discountPct: it.discount_pct ?? cur.discount_pct, sort: it.sort ?? cur.sort };
      const prev = { name: cur.name, status: cur.status, discountPct: cur.discount_pct, sort: cur.sort };
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] !== prev[k]) { before[k] = prev[k]; after[k] = next[k]; }
      if (!Object.keys(after).length) continue;
      await q`
        update classes set name = ${next.name}, status = ${next.status}, discount_pct = ${next.discountPct}, sort = ${next.sort}
        where id = ${it.id}`;
      await audit(ctx, { action: 'class.update', targetType: 'class', targetId: it.id, detail: { before, after } }, q);
    }
    return await loadClasses(q);
  });
  return { classes: rows.map(classView) };
}

export function register(r: Router) {
  r.get('/api/admin/worksheets', listSheets);
  r.post('/api/admin/worksheets', postSheet);
  r.post('/api/admin/worksheets/:id/restore', restoreSheet);
  r.post('/api/admin/worksheets/:id/file', uploadPdf);
  r.post('/api/admin/worksheets/:id/pages/:n', uploadPage);
  r.post('/api/admin/worksheets/:id/cover', uploadCover);
  r.get('/api/admin/worksheets/:id', getSheet);
  r.put('/api/admin/worksheets/:id', putSheet);
  r.delete('/api/admin/worksheets/:id', deleteSheet);
  r.get('/api/admin/files', files);
  r.get('/api/admin/classes', listClasses);
  r.put('/api/admin/classes', putClasses);
}
