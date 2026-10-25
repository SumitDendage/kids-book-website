-- Expenses: the costs the owner types in (hosting, ads, payment fees, ...), so the Admin panel can
-- show profit or loss: money in (paid orders) minus refunds minus these costs.
-- Additive only. Browsers never read it; the API (lww_api) reads and writes it.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null check (category in ('hosting', 'ads', 'fees', 'tools', 'printing', 'salary', 'other')),
  amount_inr numeric(12, 2) not null check (amount_inr > 0 and amount_inr <= 10000000),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index if not exists expenses_spent_on on public.expenses (spent_on desc);
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses
  for each row execute function private.touch_updated_at();

alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to lww_api;
