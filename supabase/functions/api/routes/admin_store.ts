// Staff: subjects, academic sessions and the website's lists (home page rows and the shop's Browse
// lists). Reading needs catalogue.read; every change needs catalogue.write and is audited (before/after)
// in the same transaction.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { isUnique, tx, type Tx } from '../lib/db.ts';
import { HttpError, json, readJson } from '../lib/http.ts';
import { requireStaff } from '../lib/auth.ts';
import { audit } from '../lib/guard.ts';
import { cleanName, cleanText } from '../lib/util.ts';
import { FILTER_KINDS, HOME_KINDS, type HomeSectionRow, loadHomeSections, resolveSection } from '../services/home.ts';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const invalid = (errors: Record<string, string>) => new HttpError(400, Object.values(errors)[0], { errors });
const notFound = (message: string) => new HttpError(404, message, { code: 'not_found' });
const slug = (s: string, max: number) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const SESSION_RE = /^[a-z0-9-]{1,20}$/;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d{1,9}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Changed keys of two flat objects, for the audit row. */
function changes(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const k of Object.keys(next)) if (!same(prev[k], next[k])) { before[k] = prev[k] ?? null; after[k] = next[k] ?? null; }
  return { before, after };
}

// ── subjects ─────────────────────────────────────────────────────────────────────────────────

type SubjectRow = { id: string; name: string; sort: number; active: boolean; updated_at: Date; products: number; active_products: number };

async function loadSubjects(q: Tx): Promise<SubjectRow[]> {
  return await q<SubjectRow[]>`
    select s.id, s.name, s.sort, s.active, s.updated_at,
           count(p.id)::int as products, count(p.id) filter (where p.status = 'active')::int as active_products
    from subjects s left join products p on p.subject = s.name
    group by s.id order by s.sort, s.name`;
}
const subjectView = (r: SubjectRow) => ({
  id: r.id, name: r.name, label: r.name, sort: r.sort, active: r.active, products: r.products, activeProducts: r.active_products, updated: ms(r.updated_at),
});

type SubjectIn = { name?: string; sort?: number; active?: boolean };
function parseSubject(b: Record<string, unknown>): SubjectIn {
  const set: SubjectIn = {}, errors: Record<string, string> = {};
  if (b.name !== undefined) {
    const n = cleanName(b.name);
    if (!n || n.length > 40) errors.name = 'A subject name is 1 to 40 characters.'; else set.name = n;
  }
  if (b.sort !== undefined) { const n = intIn(b.sort, -100000, 100000); if (n === null) errors.sort = 'Order is a whole number.'; else set.sort = n; }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') errors.active = 'active is true or false.'; else set.active = b.active; }
  if (Object.keys(errors).length) throw invalid(errors);
  return set;
}

async function listSubjects(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  return { subjects: (await tx(loadSubjects)).map(subjectView) };
}

async function postSubject(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const set = parseSubject(await readJson(ctx.req, 8 * 1024));
  if (!set.name) throw invalid({ name: 'Give the subject a name.' });
  const rows = await tx(async (q) => {
    let id = slug(set.name!, 30) || 'subject';
    const taken = new Set((await q<{ id: string }[]>`select id from subjects where id like ${id + '%'}`).map((r) => r.id));
    for (let n = 2, base = id; taken.has(id); n++) id = `${base}-${n}`;
    const v = { name: set.name!, sort: set.sort ?? 1000, active: set.active ?? true };
    try {
      await q`insert into subjects (id, name, sort, active, updated_by) values (${id}, ${v.name}, ${v.sort}, ${v.active}, ${ctx.user!.id})`;
    } catch (e) {
      if (isUnique(e, 'subjects_name_key')) throw new HttpError(409, 'There is already a subject with that name.', { code: 'exists', errors: { name: 'That name is taken.' } });
      throw e;
    }
    await audit(ctx, { action: 'subject.create', targetType: 'subject', targetId: id, detail: { before: null, after: v } }, q);
    return { all: await loadSubjects(q), id };
  });
  return json(201, { subject: subjectView(rows.all.find((r) => r.id === rows.id)!), subjects: rows.all.map(subjectView) });
}

async function putSubject(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SLUG_RE.test(id)) throw notFound('No such subject.');
  const set = parseSubject(await readJson(ctx.req, 8 * 1024));
  const all = await tx(async (q) => {
    const cur = (await q<SubjectRow[]>`select *, 0 as products, 0 as active_products from subjects where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such subject.');
    const prev = { name: cur.name, sort: cur.sort, active: cur.active };
    const next = { name: set.name ?? cur.name, sort: set.sort ?? cur.sort, active: set.active ?? cur.active };
    const d = changes(prev, next);
    if (Object.keys(d.after).length) {
      try {
        // a new name follows to every product (foreign key, on update cascade) and to subject lists
        await q`update subjects set name = ${next.name}, sort = ${next.sort}, active = ${next.active}, updated_by = ${ctx.user!.id} where id = ${id}`;
      } catch (e) {
        if (isUnique(e, 'subjects_name_key')) throw new HttpError(409, 'There is already a subject with that name.', { code: 'exists', errors: { name: 'That name is taken.' } });
        throw e;
      }
      if (next.name !== prev.name) await q`update home_sections set filter_value = ${next.name} where kind = 'subject' and filter_value = ${prev.name}`;
      await audit(ctx, { action: 'subject.update', targetType: 'subject', targetId: id, detail: d }, q);
    }
    return await loadSubjects(q);
  });
  return { subject: subjectView(all.find((r) => r.id === id)!), subjects: all.map(subjectView) };
}

async function deleteSubject(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SLUG_RE.test(id)) throw notFound('No such subject.');
  const all = await tx(async (q) => {
    const cur = (await q<{ name: string }[]>`select name from subjects where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such subject.');
    const used = (await q<{ n: number }[]>`select count(*)::int as n from products where subject = ${cur.name}`)[0].n;
    if (used) throw new HttpError(409, `${used} ${used === 1 ? 'product uses' : 'products use'} this subject. Switch it off instead, or move them first.`, { code: 'in_use', products: used });
    const lists = (await q<{ n: number }[]>`select count(*)::int as n from home_sections where kind = 'subject' and filter_value = ${cur.name}`)[0].n;
    if (lists) throw new HttpError(409, 'A website list shows this subject. Change or delete that list first.', { code: 'in_use' });
    await q`delete from subjects where id = ${id}`;
    await audit(ctx, { action: 'subject.delete', targetType: 'subject', targetId: id, detail: { before: { name: cur.name }, after: null } }, q);
    return await loadSubjects(q);
  });
  return { ok: true, deleted: true, subjects: all.map(subjectView) };
}

// ── academic sessions ────────────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string; label: string; starts_on: string | null; ends_on: string | null; is_current: boolean; active: boolean;
  sort: number; updated_at: Date; products: number;
};

async function loadSessions(q: Tx): Promise<SessionRow[]> {
  return await q<SessionRow[]>`
    select s.id, s.label, s.starts_on::text as starts_on, s.ends_on::text as ends_on, s.is_current, s.active, s.sort, s.updated_at,
           (select count(*) from product_sessions ps where ps.session_id = s.id)::int as products
    from academic_sessions s order by s.sort, s.id`;
}
const sessionView = (r: SessionRow) => ({
  id: r.id, label: r.label, startsOn: r.starts_on, endsOn: r.ends_on, current: r.is_current, active: r.active,
  sort: r.sort, products: r.products, updated: ms(r.updated_at),
});

type SessionIn = { label?: string; starts_on?: string | null; ends_on?: string | null; is_current?: boolean; active?: boolean; sort?: number };
function parseSession(b: Record<string, unknown>): SessionIn {
  const set: SessionIn = {}, errors: Record<string, string> = {};
  if (b.label !== undefined) { const l = cleanName(b.label); if (!l || l.length > 40) errors.label = 'A session name is 1 to 40 characters.'; else set.label = l; }
  for (const [key, col] of [['startsOn', 'starts_on'], ['endsOn', 'ends_on']] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (v === null || v === '') set[col] = null;
    else if (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(new Date(v + 'T00:00:00Z').getTime())) set[col] = v;
    else errors[key] = 'Use a date like 2026-04-01.';
  }
  if (b.current !== undefined) { if (typeof b.current !== 'boolean') errors.current = 'current is true or false.'; else set.is_current = b.current; }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') errors.active = 'active is true or false.'; else set.active = b.active; }
  if (b.sort !== undefined) { const n = intIn(b.sort, -100000, 100000); if (n === null) errors.sort = 'Order is a whole number.'; else set.sort = n; }
  if (Object.keys(errors).length) throw invalid(errors);
  return set;
}
function checkDates(starts: string | null, ends: string | null) {
  if (starts && ends && ends <= starts) throw invalid({ endsOn: 'The end date must be after the start date.' });
}

async function listSessions(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  return { sessions: (await tx(loadSessions)).map(sessionView) };
}

async function postSession(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const b = await readJson(ctx.req, 8 * 1024);
  const set = parseSession(b);
  if (!set.label) throw invalid({ label: 'Give the session a name, e.g. 2027-28.' });
  const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().toLowerCase() : slug(set.label, 20);
  if (!SESSION_RE.test(id)) throw invalid({ id: 'Session ids are up to 20 lower-case letters, digits and dashes, e.g. 2027-28.' });
  checkDates(set.starts_on ?? null, set.ends_on ?? null);
  const rows = await tx(async (q) => {
    const v = { label: set.label!, starts_on: set.starts_on ?? null, ends_on: set.ends_on ?? null, is_current: set.is_current ?? false, active: set.active ?? true, sort: set.sort ?? 1000 };
    if (v.is_current) await q`update academic_sessions set is_current = false where is_current`;
    try {
      await q`
        insert into academic_sessions (id, label, starts_on, ends_on, is_current, active, sort, updated_by)
        values (${id}, ${v.label}, ${v.starts_on}, ${v.ends_on}, ${v.is_current}, ${v.active}, ${v.sort}, ${ctx.user!.id})`;
    } catch (e) {
      if (isUnique(e, 'academic_sessions_pkey')) throw new HttpError(409, 'A session with that id already exists.', { code: 'exists', errors: { id: 'That id is taken.' } });
      throw e;
    }
    await audit(ctx, { action: 'session.create', targetType: 'session', targetId: id, detail: { before: null, after: v } }, q);
    return await loadSessions(q);
  });
  return json(201, { session: sessionView(rows.find((r) => r.id === id)!), sessions: rows.map(sessionView) });
}

async function putSession(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SESSION_RE.test(id)) throw notFound('No such session.');
  const set = parseSession(await readJson(ctx.req, 8 * 1024));
  const rows = await tx(async (q) => {
    const cur = (await q<SessionRow[]>`
      select id, label, starts_on::text as starts_on, ends_on::text as ends_on, is_current, active, sort, updated_at, 0 as products
      from academic_sessions where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such session.');
    const prev = { label: cur.label, starts_on: cur.starts_on, ends_on: cur.ends_on, is_current: cur.is_current, active: cur.active, sort: cur.sort };
    const next = {
      label: set.label ?? cur.label, starts_on: set.starts_on !== undefined ? set.starts_on : cur.starts_on,
      ends_on: set.ends_on !== undefined ? set.ends_on : cur.ends_on, is_current: set.is_current ?? cur.is_current,
      active: set.active ?? cur.active, sort: set.sort ?? cur.sort,
    };
    checkDates(next.starts_on, next.ends_on);
    const d = changes(prev, next);
    if (Object.keys(d.after).length) {
      if (next.is_current && !cur.is_current) await q`update academic_sessions set is_current = false where is_current and id <> ${id}`;
      await q`
        update academic_sessions set label = ${next.label}, starts_on = ${next.starts_on}, ends_on = ${next.ends_on},
          is_current = ${next.is_current}, active = ${next.active}, sort = ${next.sort}, updated_by = ${ctx.user!.id}
        where id = ${id}`;
      await audit(ctx, { action: 'session.update', targetType: 'session', targetId: id, detail: d }, q);
    }
    return await loadSessions(q);
  });
  return { session: sessionView(rows.find((r) => r.id === id)!), sessions: rows.map(sessionView) };
}

async function deleteSession(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SESSION_RE.test(id)) throw notFound('No such session.');
  const rows = await tx(async (q) => {
    const cur = (await q<{ label: string }[]>`select label from academic_sessions where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such session.');
    const used = (await q<{ n: number }[]>`select count(*)::int as n from product_sessions where session_id = ${id}`)[0].n;
    if (used) throw new HttpError(409, `${used} ${used === 1 ? 'product is' : 'products are'} in this session. Switch it off instead, or take them out first.`, { code: 'in_use', products: used });
    const lists = (await q<{ n: number }[]>`select count(*)::int as n from home_sections where kind = 'session' and filter_value = ${id}`)[0].n;
    if (lists) throw new HttpError(409, 'A website list shows this session. Change or delete that list first.', { code: 'in_use' });
    await q`delete from academic_sessions where id = ${id}`;
    await audit(ctx, { action: 'session.delete', targetType: 'session', targetId: id, detail: { before: { label: cur.label }, after: null } }, q);
    return await loadSessions(q);
  });
  return { ok: true, deleted: true, sessions: rows.map(sessionView) };
}

// ── website lists (home page rows and shop lists) ────────────────────────────────────────────

const homeView = (h: HomeSectionRow, items: string[], shown: string[]) => ({
  id: h.id, kind: h.kind, mode: h.mode, filter: h.filter_value, title: h.title, subtitle: h.subtitle, placement: h.placement,
  maxItems: h.max_items, autoDays: h.auto_days, label: h.label_tag, visible: h.visible, sort: h.sort, builtin: h.builtin,
  updated: ms(h.updated_at),
  // the sheets staff picked, in order (manual lists; kept when a list is switched to automatic)
  items,
  // what the website shows right now (only sheets customers can see)
  shown,
});

async function loadHomeViews(q: Tx) {
  const rows = await loadHomeSections(q, false);
  const items = await q<{ section_id: string; product_id: string }[]>`
    select section_id, product_id from home_section_items order by section_id, sort, added_at, product_id`;
  const by = new Map<string, string[]>();
  for (const it of items) by.set(it.section_id, [...(by.get(it.section_id) ?? []), it.product_id]);
  const out = [];
  for (const h of rows) out.push(homeView(h, by.get(h.id) ?? [], await resolveSection(q, h)));
  return out;
}

type HomeIn = {
  kind?: string; mode?: 'manual' | 'auto'; filter_value?: string | null; title?: string; subtitle?: string;
  placement?: 'home' | 'shop'; max_items?: number; auto_days?: number; visible?: boolean; sort?: number;
};
function parseHome(b: Record<string, unknown>): HomeIn {
  const set: HomeIn = {}, errors: Record<string, string> = {};
  if (b.kind !== undefined) { if ((HOME_KINDS as readonly unknown[]).includes(b.kind)) set.kind = b.kind as string; else errors.kind = 'Pick what the list shows.'; }
  if (b.mode !== undefined) { if (b.mode === 'manual' || b.mode === 'auto') set.mode = b.mode; else errors.mode = 'A list is manual or automatic.'; }
  if (b.filter !== undefined) {
    const f = b.filter === null || b.filter === '' ? null : typeof b.filter === 'string' ? cleanName(b.filter) : undefined;
    if (f === undefined || (f && f.length > 60)) errors.filter = 'Pick the class, subject, session or section.'; else set.filter_value = f;
  }
  if (b.title !== undefined) { const t = cleanName(b.title); if (!t || t.length > 60) errors.title = 'A heading is 1 to 60 characters.'; else set.title = t; }
  if (b.subtitle !== undefined) {
    if (b.subtitle !== null && typeof b.subtitle !== 'string') errors.subtitle = 'The line under the heading must be text.';
    else { const t = cleanText(b.subtitle ?? '', 161); if (t.length > 160) errors.subtitle = 'Keep the line under the heading under 160 characters.'; else set.subtitle = t; }
  }
  if (b.placement !== undefined) { if (b.placement === 'home' || b.placement === 'shop') set.placement = b.placement; else errors.placement = 'A list shows on the home page or in the shop.'; }
  if (b.maxItems !== undefined) { const n = intIn(b.maxItems, 1, 48); if (n === null) errors.maxItems = 'Show from 1 to 48 sheets.'; else set.max_items = n; }
  if (b.autoDays !== undefined) { const n = intIn(b.autoDays, 1, 3650); if (n === null) errors.autoDays = 'Count sales from 1 to 3650 days back.'; else set.auto_days = n; }
  if (b.visible !== undefined) { if (typeof b.visible !== 'boolean') errors.visible = 'visible is true or false.'; else set.visible = b.visible; }
  if (b.sort !== undefined) { const n = intIn(b.sort, -100000, 100000); if (n === null) errors.sort = 'Order is a whole number.'; else set.sort = n; }
  if (Object.keys(errors).length) throw invalid(errors);
  return set;
}

/** The class, subject, session or section a filtered list names must exist. */
async function checkFilter(q: Tx, kind: string, filter: string | null) {
  if (!FILTER_KINDS.includes(kind)) return null;
  if (!filter) throw invalid({ filter: 'Pick the class, subject, session or section this list shows.' });
  const r = kind === 'class' ? await q`select 1 from classes where id = ${filter}`
    : kind === 'subject' ? await q`select 1 from subjects where name = ${filter}`
      : kind === 'session' ? await q`select 1 from academic_sessions where id = ${filter}`
        : await q`select 1 from sections where id = ${filter}`;
  if (!r.length) throw invalid({ filter: `That ${kind} does not exist.` });
  return filter;
}

async function listHome(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.read');
  return { sections: await tx(loadHomeViews) };
}

async function postHome(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const set = parseHome(await readJson(ctx.req, 8 * 1024));
  if (!set.title) throw invalid({ title: 'Give the list a heading.' });
  const kind = set.kind ?? 'curated';
  const mode = kind === 'curated' ? 'manual' : set.mode ?? 'auto';
  if (kind === 'curated' && set.mode === 'auto') throw invalid({ mode: 'A hand-picked list is always manual.' });
  const out = await tx(async (q) => {
    const filter = await checkFilter(q, kind, set.filter_value ?? null);
    let id = slug(set.title!, 30) || 'list';
    if (id.length < 2) id = 'list-' + id;
    const taken = new Set((await q<{ id: string }[]>`select id from home_sections where id like ${id + '%'}`).map((r) => r.id));
    for (let n = 2, base = id; taken.has(id); n++) id = `${base}-${n}`;
    const v = {
      kind, mode, filter_value: filter, title: set.title!, subtitle: set.subtitle ?? '', placement: set.placement ?? 'home',
      max_items: set.max_items ?? 12, auto_days: set.auto_days ?? 90, visible: set.visible ?? true, sort: set.sort ?? 1000,
    };
    await q`
      insert into home_sections (id, kind, mode, filter_value, title, subtitle, placement, max_items, auto_days, visible, sort, builtin, updated_by)
      values (${id}, ${v.kind}, ${v.mode}, ${v.filter_value}, ${v.title}, ${v.subtitle}, ${v.placement}, ${v.max_items}, ${v.auto_days},
              ${v.visible}, ${v.sort}, false, ${ctx.user!.id})`;
    await audit(ctx, { action: 'home_section.create', targetType: 'home_section', targetId: id, detail: { before: null, after: v } }, q);
    return { all: await loadHomeViews(q), id };
  });
  return json(201, { section: out.all.find((s) => s.id === out.id), sections: out.all });
}

async function putHome(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SLUG_RE.test(id)) throw notFound('No such list.');
  const set = parseHome(await readJson(ctx.req, 8 * 1024));
  const all = await tx(async (q) => {
    const cur = (await q<HomeSectionRow[]>`select * from home_sections where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such list.');
    // a built-in list keeps what it is and where it shows (the website draws it in its own place)
    if (cur.builtin && ((set.kind && set.kind !== cur.kind) || (set.placement && set.placement !== cur.placement))) {
      throw new HttpError(409, 'This list is part of the website: you can change its heading, order, visibility and sheets.', { code: 'builtin' });
    }
    const prev = {
      kind: cur.kind, mode: cur.mode, filter_value: cur.filter_value, title: cur.title, subtitle: cur.subtitle, placement: cur.placement,
      max_items: cur.max_items, auto_days: cur.auto_days, visible: cur.visible, sort: cur.sort,
    };
    const next = { ...prev, ...Object.fromEntries(Object.entries(set).filter(([, x]) => x !== undefined)) } as typeof prev;
    if (next.kind === 'curated' && next.mode === 'auto') throw invalid({ mode: 'A hand-picked list is always manual.' });
    if (!FILTER_KINDS.includes(next.kind)) next.filter_value = null;
    else if (next.kind !== cur.kind || next.filter_value !== cur.filter_value) next.filter_value = await checkFilter(q, next.kind, next.filter_value);
    const d = changes(prev, next);
    if (Object.keys(d.after).length) {
      await q`
        update home_sections set kind = ${next.kind}, mode = ${next.mode}, filter_value = ${next.filter_value}, title = ${next.title},
          subtitle = ${next.subtitle}, placement = ${next.placement}, max_items = ${next.max_items}, auto_days = ${next.auto_days},
          visible = ${next.visible}, sort = ${next.sort}, updated_by = ${ctx.user!.id}
        where id = ${id}`;
      await audit(ctx, { action: 'home_section.update', targetType: 'home_section', targetId: id, detail: d }, q);
    }
    return await loadHomeViews(q);
  });
  return { section: all.find((s) => s.id === id), sections: all };
}

/** PUT /api/admin/home-sections/:id/items {products:[id, …]}: the list's sheets, in this order.
 *  A sheet left out is only taken off the list; the sheet itself is not touched. */
async function putHomeItems(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SLUG_RE.test(id)) throw notFound('No such list.');
  const b = await readJson(ctx.req, 16 * 1024);
  const raw = isObj(b) && Array.isArray(b.products) ? b.products : null;
  if (!raw || raw.length > 100 || !raw.every((x) => typeof x === 'string' && PRODUCT_RE.test(x))) {
    throw invalid({ products: 'Send the sheets as a list of up to 100 ids.' });
  }
  const want = [...new Set(raw as string[])];
  const all = await tx(async (q) => {
    const cur = (await q<{ id: string }[]>`select id from home_sections where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such list.');
    if (want.length) {
      const known = await q<{ id: string }[]>`select id from products where id = any(${want}::text[])`;
      if (known.length !== want.length) throw invalid({ products: 'Some of those sheets do not exist.' });
    }
    const before = (await q<{ product_id: string }[]>`select product_id from home_section_items where section_id = ${id} order by sort, added_at, product_id`).map((r) => r.product_id);
    if (!same(before, want)) {
      await q`delete from home_section_items where section_id = ${id} and not (product_id = any(${want}::text[]))`;
      for (let i = 0; i < want.length; i++) {
        await q`
          insert into home_section_items (section_id, product_id, sort, added_by) values (${id}, ${want[i]}, ${(i + 1) * 10}, ${ctx.user!.id})
          on conflict (section_id, product_id) do update set sort = excluded.sort`;
      }
      await audit(ctx, { action: 'home_section.items', targetType: 'home_section', targetId: id, detail: { before: { products: before }, after: { products: want } } }, q);
    }
    return await loadHomeViews(q);
  });
  return { section: all.find((s) => s.id === id), sections: all };
}

async function deleteHome(ctx: Ctx) {
  await requireStaff(ctx, 'catalogue.write');
  const id = ctx.params.id ?? '';
  if (!SLUG_RE.test(id)) throw notFound('No such list.');
  const all = await tx(async (q) => {
    const cur = (await q<{ builtin: boolean; title: string }[]>`select builtin, title from home_sections where id = ${id} for update`)[0];
    if (!cur) throw notFound('No such list.');
    if (cur.builtin) throw new HttpError(409, 'This list is part of the website. You can hide it instead.', { code: 'builtin' });
    await q`delete from home_sections where id = ${id}`;
    await audit(ctx, { action: 'home_section.delete', targetType: 'home_section', targetId: id, detail: { before: { title: cur.title }, after: null } }, q);
    return await loadHomeViews(q);
  });
  return { ok: true, deleted: true, sections: all };
}

export function register(r: Router) {
  r.get('/api/admin/subjects', listSubjects);
  r.post('/api/admin/subjects', postSubject);
  r.put('/api/admin/subjects/:id', putSubject);
  r.delete('/api/admin/subjects/:id', deleteSubject);
  r.get('/api/admin/sessions', listSessions);
  r.post('/api/admin/sessions', postSession);
  r.put('/api/admin/sessions/:id', putSession);
  r.delete('/api/admin/sessions/:id', deleteSession);
  r.get('/api/admin/home-sections', listHome);
  r.post('/api/admin/home-sections', postHome);
  r.put('/api/admin/home-sections/:id/items', putHomeItems);
  r.put('/api/admin/home-sections/:id', putHome);
  r.delete('/api/admin/home-sections/:id', deleteHome);
}
