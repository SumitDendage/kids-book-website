-- Learn With Why · full admin panel (Sumit, Oct 22). Additive only: no table, column or row is
-- removed and no existing value changes.
--
-- 1. public.subjects: the subjects staff manage (English, Maths, Science to start). products.subject
--    keeps holding the subject's name and now points at it, so renaming a subject renames it on
--    every product.
-- 2. public.academic_sessions (e.g. 2026-27) and public.product_sessions: which sessions a product
--    belongs to (none, one or several).
-- 3. More product fields: short description, SKU, language, age group, gallery pictures (paths in
--    the public "covers" bucket) and SEO title and description.
-- 4. public.home_sections and public.home_section_items: the lists the website shows ("Picked for
--    you" on the home page; New, Bestselling, Featured, Popular and Recommended in the shop; and any
--    row staff add). A list is manual (staff pick and order the sheets) or automatic (worked out by
--    the API: best sellers from paid orders, newest, discounted, free, or every sheet of a class,
--    subject, session or section). Taking a sheet out of a list never touches the sheet.
--    The six built-in lists keep the product labels (tags) in step both ways, so the old labels
--    and the lists never disagree; today's labels become the lists' first contents.
-- 5. Coupons: a fixed amount in rupees as well as a percentage, a minimum order, a largest discount,
--    and an optional list of products and/or sections the code works on.

-- ── 1. subjects ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.subjects (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null unique check (char_length(name) between 1 and 40),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger subjects_touch before update on public.subjects
  for each row execute function private.touch_updated_at();

insert into public.subjects (id, name, sort) values
  ('english', 'English', 10), ('maths', 'Maths', 20), ('science', 'Science', 30)
on conflict do nothing;
-- any other subject a product already uses joins the list, so the link below always holds
insert into public.subjects (id, name, sort)
select distinct on (slug) slug, p.subject, 100
from (select subject, nullif(regexp_replace(lower(subject), '[^a-z0-9]+', '-', 'g'), '') as slug from public.products) p
where p.slug is not null and not exists (select 1 from public.subjects s where s.name = p.subject)
on conflict do nothing;

alter table public.products
  add constraint products_subject_fkey foreign key (subject) references public.subjects (name) on update cascade;

-- ── 2. academic sessions ─────────────────────────────────────────────────────────────────────

create table if not exists public.academic_sessions (
  id text primary key check (id ~ '^[a-z0-9-]{1,20}$'),
  label text not null check (char_length(label) between 1 and 40),
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint academic_sessions_dates check (ends_on is null or starts_on is null or ends_on > starts_on)
);
create unique index if not exists academic_sessions_one_current on public.academic_sessions (is_current) where is_current;
create trigger academic_sessions_touch before update on public.academic_sessions
  for each row execute function private.touch_updated_at();

insert into public.academic_sessions (id, label, starts_on, ends_on, is_current, sort) values
  ('2026-27', '2026-27', '2026-04-01', '2027-03-31', true, 10)
on conflict do nothing;

create table if not exists public.product_sessions (
  product_id text not null references public.products (id) on update cascade on delete cascade,
  session_id text not null references public.academic_sessions (id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  primary key (product_id, session_id)
);
create index if not exists product_sessions_session on public.product_sessions (session_id);

-- ── 3. more product fields ───────────────────────────────────────────────────────────────────

alter table public.products
  add column if not exists short_description text not null default '' check (char_length(short_description) <= 300),
  add column if not exists sku text check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  add column if not exists language text not null default 'English' check (char_length(language) between 1 and 40),
  add column if not exists age_group text check (char_length(age_group) <= 40),
  add column if not exists gallery text[] not null default '{}' check (cardinality(gallery) <= 8),
  add column if not exists seo_title text check (char_length(seo_title) <= 70),
  add column if not exists seo_description text check (char_length(seo_description) <= 170);
create unique index if not exists products_sku on public.products (lower(sku)) where sku is not null;
comment on column public.products.gallery is 'extra pictures: object names in the public "covers" bucket, in display order';

-- ── 4. home page and shop lists ──────────────────────────────────────────────────────────────

create table if not exists public.home_sections (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  -- curated: staff pick every sheet · bestsellers · new · discounted · free · class · subject ·
  -- session · section: these can also fill themselves (mode 'auto')
  kind text not null check (kind in ('curated', 'bestsellers', 'new', 'discounted', 'free', 'class', 'subject', 'session', 'section')),
  mode text not null default 'manual' check (mode in ('manual', 'auto')),
  -- the class id, subject name, session id or section id for those kinds
  filter_value text check (char_length(filter_value) <= 60),
  title text not null check (char_length(title) between 1 and 60),
  subtitle text not null default '' check (char_length(subtitle) <= 160),
  -- home: a row on the home page · shop: a list in the shop's Browse menu
  placement text not null default 'home' check (placement in ('home', 'shop')),
  max_items integer not null default 12 check (max_items between 1 and 48),
  -- best sellers worked out from paid orders of the last this many days
  auto_days integer not null default 90 check (auto_days between 1 and 3650),
  -- the built-in lists mirror a product label (tag); null for lists staff add
  label_tag text unique check (label_tag in ('home', 'featured', 'bestseller', 'new', 'popular', 'recommended')),
  visible boolean not null default true,
  sort integer not null default 0,
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint home_sections_curated_manual check (kind <> 'curated' or mode = 'manual'),
  constraint home_sections_filter check (kind not in ('class', 'subject', 'session', 'section') or filter_value is not null)
);
create index if not exists home_sections_listing on public.home_sections (visible, placement, sort, id);
create trigger home_sections_touch before update on public.home_sections
  for each row execute function private.touch_updated_at();

create table if not exists public.home_section_items (
  section_id text not null references public.home_sections (id) on update cascade on delete cascade,
  product_id text not null references public.products (id) on update cascade on delete cascade,
  sort integer not null default 0,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,
  primary key (section_id, product_id)
);
create index if not exists home_section_items_product on public.home_section_items (product_id);
create index if not exists home_section_items_order on public.home_section_items (section_id, sort);

insert into public.home_sections (id, kind, mode, title, subtitle, placement, label_tag, sort, builtin) values
  ('picked', 'curated', 'manual', 'Picked for you', '', 'home', 'home', 10, true),
  ('new', 'new', 'manual', 'New', 'just drawn', 'shop', 'new', 20, true),
  ('bestsellers', 'bestsellers', 'manual', 'Bestselling', 'parents love these', 'shop', 'bestseller', 30, true),
  ('featured', 'curated', 'manual', 'Featured', 'our picks', 'shop', 'featured', 40, true),
  ('popular', 'curated', 'manual', 'Popular', '', 'shop', 'popular', 50, true),
  ('recommended', 'curated', 'manual', 'Recommended', '', 'shop', 'recommended', 60, true)
on conflict do nothing;
-- the built-in lists hold every sheet; the API shows as many as max_items says
update public.home_sections set max_items = 48 where builtin and id <> 'picked';

-- today's labels become the lists' contents, in the sheets' display order
insert into public.home_section_items (section_id, product_id, sort)
select h.id, p.id, (row_number() over (partition by h.id order by p.class_id, p.sort, p.id) * 10)::int
from public.home_sections h join public.products p on h.label_tag = any (p.tags)
on conflict do nothing;

-- the labels and the built-in lists stay in step: a sheet added to (or taken out of) a list gets
-- (or loses) its label, and a label ticked on a sheet puts it at the end of its list. Each side
-- skips the change the other side makes (trigger depth), so they never loop.
create or replace function private.home_items_to_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_tag text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select label_tag into v_tag from public.home_sections where id = coalesce(new.section_id, old.section_id);
  if v_tag is null then return null; end if;
  if tg_op = 'INSERT' then
    update public.products set tags = array_append(tags, v_tag) where id = new.product_id and not (v_tag = any (tags));
  elsif tg_op = 'DELETE' then
    update public.products set tags = array_remove(tags, v_tag) where id = old.product_id and v_tag = any (tags);
  end if;
  return null;
end;
$$;
create trigger home_section_items_tags after insert or delete on public.home_section_items
  for each row execute function private.home_items_to_tags();

create or replace function private.product_tags_to_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and new.tags is not distinct from old.tags then return null; end if;
  insert into public.home_section_items (section_id, product_id, sort)
  select h.id, new.id, coalesce((select max(i.sort) from public.home_section_items i where i.section_id = h.id), 0) + 10
  from public.home_sections h
  where h.label_tag is not null and h.label_tag = any (new.tags)
  on conflict do nothing;
  delete from public.home_section_items i
  using public.home_sections h
  where i.section_id = h.id and i.product_id = new.id and h.label_tag is not null and not (h.label_tag = any (new.tags));
  return null;
end;
$$;
create trigger products_tags_home after insert or update of tags on public.products
  for each row execute function private.product_tags_to_home();

-- ── 5. coupons ───────────────────────────────────────────────────────────────────────────────

alter table public.coupons
  add column if not exists kind text not null default 'percent' check (kind in ('percent', 'fixed')),
  add column if not exists amount_inr numeric(12, 2) check (amount_inr > 0 and amount_inr <= 100000),
  add column if not exists min_order_inr numeric(12, 2) not null default 0 check (min_order_inr >= 0 and min_order_inr <= 1000000),
  add column if not exists max_discount_inr numeric(12, 2) check (max_discount_inr > 0 and max_discount_inr <= 1000000),
  add column if not exists product_ids text[] not null default '{}' check (cardinality(product_ids) <= 200),
  add column if not exists section_ids text[] not null default '{}' check (cardinality(section_ids) <= 100);
-- a fixed-amount coupon has no percentage (the old check, pct > 0 and pct <= 100, still holds for
-- every percentage coupon)
alter table public.coupons alter column pct drop not null;
alter table public.coupons add constraint coupons_value check (
  (kind = 'percent' and pct is not null and amount_inr is null)
  or (kind = 'fixed' and amount_inr is not null and pct is null));

-- ── row security: the API (lww_api) reads and writes; browsers may read only what is public ──

alter table public.subjects enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.product_sessions enable row level security;
alter table public.home_sections enable row level security;
alter table public.home_section_items enable row level security;
revoke all on public.subjects, public.academic_sessions, public.product_sessions,
  public.home_sections, public.home_section_items from anon, authenticated;
grant select, insert, update, delete on public.subjects, public.academic_sessions, public.product_sessions,
  public.home_sections, public.home_section_items to lww_api;
grant select on public.subjects, public.academic_sessions, public.product_sessions,
  public.home_sections, public.home_section_items to anon, authenticated;

create policy subjects_public_read on public.subjects for select to anon, authenticated using (active);
create policy academic_sessions_public_read on public.academic_sessions for select to anon, authenticated using (active);
create policy home_sections_public_read on public.home_sections for select to anon, authenticated using (visible);
-- links to sheets the public can see anyway (products_public_read applies inside the subquery)
create policy product_sessions_public_read on public.product_sessions for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy home_section_items_public_read on public.home_section_items for select to anon, authenticated
  using (exists (select 1 from public.home_sections h where h.id = section_id and h.visible)
         and exists (select 1 from public.products p where p.id = product_id));

revoke all on function private.home_items_to_tags(), private.product_tags_to_home() from public;
