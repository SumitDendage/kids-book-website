-- Learn With Why on Supabase · builder E · staff notes on orders
-- PUT /api/admin/orders {id, note} keeps a short internal note on an order. Staff only: the
-- column is not in the customer read grant (row_security.sql §5), so the Data API never shows it.
-- Additive and safe to run again.

alter table public.orders add column if not exists staff_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_staff_note_length' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_staff_note_length check (char_length(staff_note) <= 2000);
  end if;
end $$;
