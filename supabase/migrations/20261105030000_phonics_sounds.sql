-- Sumit, Nov 5 2026: the Beginning and Ending Sounds sheets come back, now under Phonics.
--  * Sound A to E charts (sd-*): A, B and C free, D and E ₹19 (their pictures stay blurred until bought)
--  * Beginning Sound 1-3 (bx-*) and Ending Sound 1-3 (ex-*) exercises: all free
-- The PDFs from his Sound.zip and Sound Exercise.zip are the same files already in storage
-- (sound/ and sound-exercise/), so nothing needs uploading. Nothing is deleted.

update public.products set status = 'active', group_id = 'phon', updated_at = now(),
  section = case when id like 'ex-%' then 'ending-sounds' else 'beginning-sounds' end,
  section_label = case when id like 'ex-%' then 'Ending Sounds' else 'Beginning Sounds' end,
  price_inr = case when id in ('sd-D', 'sd-E') then 19 else 0 end,
  was_price_inr = null
 where id in ('sd-A','sd-B','sd-C','sd-D','sd-E','bx-1','bx-2','bx-3','ex-1','ex-2','ex-3');

-- the two Phonics sections show (already true since the Phonics board, kept here to be safe)
update public.sections set visible = true, group_id = 'phon', group_label = 'Phonics', updated_at = now()
 where id in ('beginning-sounds', 'ending-sounds');

-- check: should list 11 rows, 9 at price 0 and sd-D, sd-E at 19
select id, title, section, price_inr, status from public.products
 where id in ('sd-A','sd-B','sd-C','sd-D','sd-E','bx-1','bx-2','bx-3','ex-1','ex-2','ex-3') order by id;
