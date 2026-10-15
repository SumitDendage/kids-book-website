-- Learn With Why on Supabase · 3/10 · catalogue, plans and settings

create table public.classes (
  id text primary key check (id ~ '^[a-z0-9]{1,12}$'),
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'coming_soon' check (status in ('available', 'coming_soon', 'hidden')),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct <= 90),
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
create trigger classes_touch before update on public.classes
  for each row execute function private.touch_updated_at();

create table public.products (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{1,63}$'),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  class_id text not null references public.classes (id) on update cascade,
  subject text not null check (char_length(subject) between 1 and 40),
  group_id text check (group_id ~ '^[a-z0-9-]{1,40}$'),
  section text check (section ~ '^[a-z0-9-]{1,60}$'),
  section_label text check (char_length(section_label) <= 60),
  pages integer not null default 1 check (pages between 1 and 500),
  price_inr integer not null default 19 check (price_inr between 0 and 100000),
  was_price_inr integer check (was_price_inr between 0 and 100000),
  -- draft: staff only · active: listed and sellable when its PDF is uploaded · archived: hidden,
  -- but customers who bought it keep access until their purchase expires
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  -- private object name in the "worksheets" bucket, e.g. a-to-z/A.pdf or uploads/az-A.pdf
  pdf_path text unique check (pdf_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}\.pdf$' and pdf_path !~ '\.\.'),
  -- public small picture: a site path (/sheets/...) or a URL in the public "covers" bucket
  thumb_url text check (char_length(thumb_url) <= 300),
  cover_path text check (cover_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$' and cover_path !~ '\.\.'),
  audience text check (audience in ('parent', 'teacher', 'both')),
  rating numeric(2, 1) check (rating between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  review_avg numeric(3, 2) check (review_avg between 1 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  -- server-delivered copies per purchase; 0 = view in the protected viewer only
  print_limit integer not null default 0 check (print_limit between 0 and 100),
  download_limit integer not null default 0 check (download_limit between 0 and 100),
  -- null = unlimited; otherwise how many more can be sold
  stock integer check (stock >= 0),
  -- days a purchase of this sheet stays open; null = the site-wide setting
  access_days integer check (access_days between 1 and 3650),
  landscape boolean not null default false,
  tags text[] not null default '{}',
  sort integer not null default 0,
  seed jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index products_listing on public.products (status, class_id, sort, id);
create index products_section on public.products (section);
create index products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

create table public.plans (
  id text primary key check (id ~ '^[a-z0-9]{1,8}$'),
  label text not null check (char_length(label) between 1 and 40),
  months integer not null check (months between 1 and 36),
  price_inr integer not null check (price_inr between 0 and 1000000),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct <= 90),
  -- IN = India, INTL = everywhere else
  regions text[] not null default '{IN,INTL}' check (regions <@ array['IN', 'INTL'] and cardinality(regions) > 0),
  note text check (char_length(note) <= 60),
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
create trigger plans_touch before update on public.plans
  for each row execute function private.touch_updated_at();

-- Site-wide settings, one JSON value per key. The API validates the shape of each key.
create table public.settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- Public home-page and site text that staff can edit (falls back to the built-in text).
create table public.site_content (
  key text primary key check (key ~ '^[a-z0-9_.-]{1,64}$'),
  value jsonb not null,
  published boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger site_content_touch before update on public.site_content
  for each row execute function private.touch_updated_at();

-- Questions and answers for the FAQ chatbot. Only published public rows are ever searched
-- for customers; staff and planned answers stay out of public retrieval.
create table public.faq_entries (
  id bigint generated always as identity primary key,
  question text not null check (char_length(question) between 3 and 300),
  answer text not null check (char_length(answer) between 1 and 2000),
  keywords text[] not null default '{}',
  audience text not null default 'public' check (audience in ('public', 'staff')),
  status text not null default 'published' check (status in ('published', 'draft', 'planned')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index faq_entries_public on public.faq_entries (sort) where audience = 'public' and status = 'published';
create trigger faq_entries_touch before update on public.faq_entries
  for each row execute function private.touch_updated_at();

-- Customer reviews (one per customer per sheet, only after buying or opening it).
create table public.reviews (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on update cascade on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text check (char_length(title) <= 120),
  body text check (char_length(body) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
  moderated_by uuid references auth.users (id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create index reviews_product on public.reviews (product_id, status);
create trigger reviews_touch before update on public.reviews
  for each row execute function private.touch_updated_at();

create or replace function private.refresh_review_stats()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_product text := coalesce(new.product_id, old.product_id);
begin
  update public.products p
  set review_avg = s.avg, review_count = s.n
  from (
    select round(avg(r.rating)::numeric, 2) as avg, count(*)::int as n
    from public.reviews r where r.product_id = v_product and r.status = 'published'
  ) s
  where p.id = v_product;
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    update public.products p
    set review_avg = s.avg, review_count = s.n
    from (
      select round(avg(r.rating)::numeric, 2) as avg, count(*)::int as n
      from public.reviews r where r.product_id = old.product_id and r.status = 'published'
    ) s
    where p.id = old.product_id;
  end if;
  return null;
end;
$$;
create trigger reviews_stats after insert or update or delete on public.reviews
  for each row execute function private.refresh_review_stats();
