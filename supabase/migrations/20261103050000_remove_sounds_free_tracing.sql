-- Sumit, Nov 3 2026 (three photos of the live site):
--  1. take Beginning Sounds and Ending Sounds off the website
--  2. every A-Z Letter Tracing sheet is free (no lock, no blur)
--  3. the Letter A, I, N, P, S and T picture-reading charts leave A-Z Letter Tracing
-- Nothing is deleted: the sheets are archived (hidden) and the two sections hidden, so
-- each can be brought back from Admin -> Products or with the "undo" lines at the bottom.
-- No customer had bought any of the archived sheets when this was written.

update public.products set status = 'archived', updated_at = now()
 where id in ('bx-1','bx-2','bx-3','sd-A','sd-B','sd-C','sd-D','sd-E','ex-1','ex-2','ex-3',
              'rc-A','rc-I','rc-N','rc-P','rc-S','rc-T');

update public.sections set visible = false, updated_at = now()
 where id in ('beginning-sounds','ending-sounds');

update public.products set price_inr = 0, was_price_inr = null, updated_at = now()
 where id like 'az-%';

-- undo (not run):
-- update public.products set status = 'active' where id in ('bx-1','bx-2','bx-3','sd-A','sd-B','sd-C','sd-D','sd-E','ex-1','ex-2','ex-3','rc-A','rc-I','rc-N','rc-P','rc-S','rc-T');
-- update public.sections set visible = true where id in ('beginning-sounds','ending-sounds');
-- update public.products set price_inr = 19 where id like 'az-%' and id not in ('az-A','az-B');
