-- Sumit, Nov 7 2026: in Phonics, Beginning Sounds and Ending Sounds each have 3 free sheets and the rest paid.
--  * free:  Beginning Sound 1-3 (bx-*) and Ending Sound 1-3 (ex-*)
--  * ₹19:   the Sound A to E charts (sd-*), which show in both sections
-- Nothing is deleted.

update public.products set price_inr = 19, was_price_inr = null, updated_at = now()
 where id in ('sd-A','sd-B','sd-C','sd-D','sd-E');

update public.products set price_inr = 0, was_price_inr = null, updated_at = now()
 where id in ('bx-1','bx-2','bx-3','ex-1','ex-2','ex-3');

-- check: 11 rows, the six bx/ex at 0 and the five sd at 19
select id, title, price_inr, status from public.products
 where id in ('sd-A','sd-B','sd-C','sd-D','sd-E','bx-1','bx-2','bx-3','ex-1','ex-2','ex-3') order by id;
