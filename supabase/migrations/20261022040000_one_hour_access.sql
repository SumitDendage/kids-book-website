-- One-hour access to a bought sheet (Sumit, Oct 22: "one-hour digital book access expiration").
-- The 24-hour system from 20261017030000_access_hours.sql stays as it is: fulfil_order writes each
-- bought sheet's entitlement with expires_at = the database's payment time + the line's hours, and
-- every viewer request re-checks it. This only changes how many hours:
--  1. the shop-wide setting becomes 1 hour (staff can still change it in Admin → Settings);
--  2. per-sheet "Access days" overrides are cleared, so no sheet opens for longer than the setting.
-- Sheets bought before this keep the end they were sold with. Orders, payments and entitlements
-- are not deleted.

insert into public.settings (key, value, description)
values ('worksheet_access', '{"days":1,"hours":1}'::jsonb, 'How long a bought sheet stays open, in hours (a class plan lasts its own number of months).')
on conflict (key) do update
set value = '{"days":1,"hours":1}'::jsonb,
    description = 'How long a bought sheet stays open, in hours (a class plan lasts its own number of months).';

update public.products set access_days = null where access_days is not null;
