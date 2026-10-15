-- Learn With Why on Supabase · 8/10 · file storage
-- "worksheets" is PRIVATE: the PDFs and full-size page pictures. No storage policy gives the
-- browser roles any access, so files are only ever read by the API (with the service key) after
-- it has checked who is asking. "covers" is PUBLIC: small cover pictures for new products.
-- Object names mirror the old backend/protected folder, e.g. a-to-z/A.pdf, a-to-z/A.jpg,
-- vocab-colours/colours-1-1.jpg; staff uploads go to uploads/<sheet id>.pdf.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('worksheets', 'worksheets', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Which of these PDFs/pictures are actually uploaded? (read by the API; the API role cannot read
-- storage.objects directly)
create or replace function private.worksheet_objects(p_names text[])
returns table (name text, size bigint, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, coalesce((o.metadata ->> 'size')::bigint, 0), o.updated_at
  from storage.objects o
  where o.bucket_id = 'worksheets' and o.name = any (p_names)
$$;

-- Page pictures for one sheet: <base>.jpg|png|webp is a one-page sheet; otherwise
-- <base>-1.jpg, <base>-2.jpg … in page order (every page, not just the first).
create or replace function private.worksheet_page_images(p_base text)
returns table (name text, page integer)
language sql
stable
security definer
set search_path = ''
as $$
  with single as (
    select o.name from storage.objects o
    where o.bucket_id = 'worksheets' and o.name in (p_base || '.jpg', p_base || '.png', p_base || '.webp')
    order by o.name limit 1
  ), many as (
    select o.name, split_part(substring(o.name from char_length(p_base) + 2), '.', 1)::int as page
    from storage.objects o
    where o.bucket_id = 'worksheets'
      and left(o.name, char_length(p_base) + 1) = p_base || '-'
      and substring(o.name from char_length(p_base) + 2) ~ '^[0-9]{1,3}\.(jpg|png|webp)$'
  )
  select s.name, 1 from single s
  union all
  select m.name, m.page from many m where not exists (select 1 from single)
  order by 2
$$;

-- PDF status for every sheet in one query (for the catalogue and the staff list)
create or replace function private.product_file_status()
returns table (product_id text, has_pdf boolean, pdf_bytes bigint, pdf_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, o.name is not null, coalesce((o.metadata ->> 'size')::bigint, 0), o.updated_at
  from public.products p
  left join storage.objects o on o.bucket_id = 'worksheets' and o.name = p.pdf_path
$$;

revoke all on function private.worksheet_objects(text[]) from public;
revoke all on function private.worksheet_page_images(text) from public;
revoke all on function private.product_file_status() from public;
grant execute on function private.worksheet_objects(text[]) to lww_api;
grant execute on function private.worksheet_page_images(text) to lww_api;
grant execute on function private.product_file_status() to lww_api;
