-- Learn With Why on Supabase · account types, print allowance and the cart (October 2026)
--
-- Additive and safe to run again: columns, tables and rows are added only when missing, and the
-- text updates set the same words each time. No row is removed and nothing is dropped.
--
--  1. Account types. profiles.role already holds 'parent', 'teacher', 'tutor' or 'school' (or
--     nothing yet). The website offers Parent, Teacher and Organization; Organization is stored
--     as 'school' and 'tutor' counts as Teacher, so the existing check needs no change. The API
--     lets a customer choose once; staff can change it later (Admin -> Customers).
--  2. Prints per sheet, by account type: the new settings row 'prints'
--     ({"parent": 3, "teacher": 30, "organization": 300}). Staff change the numbers in
--     Admin -> Settings; the API checks each is a whole number from 0 to 1000.
--  3. products.print_rule: 'account' (the default, every existing sheet) means the account
--     type's number from 'prints'; 'sheet' means the sheet's own print_limit (0 = no printing).
--     Prints are still counted per access record and sheet in delivery_counts.
--  4. The cart of a signed-in customer (public.cart_items). Only the API (lww_api) reads or
--     changes it; the browser roles get nothing.
--  5. Customer text: the FAQ answers about how long a sheet stays open and about printing.

-- ── 2. prints per sheet ─────────────────────────────────────────────────────────────────────

insert into public.settings (key, value, description) values
  ('prints', '{"parent":3,"teacher":30,"organization":300}'::jsonb,
   'How many times each sheet can be printed, by account type: Parent, Teacher, Organization (a school, tuition centre or other group). Used by every sheet whose print rule is "account".')
on conflict (key) do nothing;

-- ── 3. the print rule of each sheet ─────────────────────────────────────────────────────────

alter table public.products
  add column if not exists print_rule text not null default 'account'
    constraint products_print_rule check (print_rule in ('account', 'sheet'));

comment on column public.products.print_rule is
  'account = prints per sheet come from the account type (settings.prints); sheet = this sheet''s own print_limit (0 = no printing).';
comment on column public.products.print_limit is
  'Prints per access record when print_rule = ''sheet'' (0 = no printing). Not used when print_rule = ''account''.';

-- ── 4. the cart ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cart_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null check (char_length(product_id) between 1 and 64),
  added_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.cart_items enable row level security;
revoke all on public.cart_items from anon, authenticated;
grant select, insert, delete on public.cart_items to lww_api;

-- ── 5. customer text ────────────────────────────────────────────────────────────────────────

-- {accessDays} is filled in from the 'worksheet_access' setting (365 days unless staff change it)
update public.faq_entries
set answer = 'Each sheet you buy stays open for the time shown on the sheet ({accessDays} days unless it says otherwise), counted from your verified payment.'
where question = 'How long can I open a sheet I bought?';

-- printing has its own answer now, so this one no longer answers "print" (it still answers "download")
update public.faq_entries
set answer = 'Your sheets open in our protected viewer after you sign in. Find them in My Account → My Worksheets. Press Print in the viewer to print a sheet.',
    keywords = '{"download","pdf","open","view","my worksheets"}'::text[]
where question = 'How do I open my sheets?';

-- {printsParent}, {printsTeacher} and {printsOrganization} are filled in from the 'prints'
-- setting when the answer is shown, so the numbers stay right when staff change them.
insert into public.faq_entries (question, answer, keywords, audience, status, sort)
select v.question, v.answer, v.keywords, 'public', 'published', v.sort
from (values
  ('How many times can I print a sheet?',
   'Every sheet you can open comes with prints of its own: {printsParent} with a Parent account, {printsTeacher} with a Teacher account and {printsOrganization} with an Organization account (a school, tuition centre or other group). A few sheets show their own number instead. Press Print in the viewer, and the viewer shows how many prints are left. When they are used up you can still open the sheet to read it.',
   '{"print","prints","printing","printer","copies","copy","how many times","paper"}'::text[], 8),
  ('Which account type should I choose?',
   'Choose Parent if you teach your own children, Teacher if you teach a class or tutor, and Organization for a school, tuition centre or other group. Your account type sets how many times you can print each sheet: {printsParent}, {printsTeacher} or {printsOrganization}. You choose it once after you sign up. If it needs changing later, write to us.',
   '{"account type","parent","teacher","tutor","organization","organisation","school","tuition","group","role"}'::text[], 11)
) as v (question, answer, keywords, sort)
where not exists (select 1 from public.faq_entries f where f.question = v.question);
