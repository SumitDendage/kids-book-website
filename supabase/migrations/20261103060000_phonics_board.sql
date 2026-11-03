-- Sumit, Nov 3 2026: a Phonics board in Kindergarten, built like the Alphabet board, with seven
-- numbered sections in this order: Consonants, Vowels, Beginning Sounds, Ending Sounds, Blending,
-- Segmenting, CVC Words. Sections with no sheets say "Coming soon" on the website until staff add
-- sheets to them in Admin -> Products. Nothing is deleted.

-- 1. the four new sections
insert into public.sections (id, label, group_id, group_label, class_id, description, sort, visible, builtin) values
  ('consonants', 'Consonants', 'phon', 'Phonics', 'kg', 'Children learn the consonant letters and the sound each one makes.', 301, true, true),
  ('vowels',     'Vowels',     'phon', 'Phonics', 'kg', 'Children learn the five vowels a, e, i, o and u and their short sounds.', 302, true, true),
  ('blending',   'Blending',   'phon', 'Phonics', 'kg', 'Children join sounds together to read a word: c-a-t makes cat.', 305, true, true),
  ('segmenting', 'Segmenting', 'phon', 'Phonics', 'kg', 'Children break a word into its sounds: cat is c-a-t.', 306, true, true)
on conflict (id) do update set label = excluded.label, group_id = excluded.group_id, group_label = excluded.group_label,
  class_id = excluded.class_id, description = excluded.description, sort = excluded.sort, visible = true, updated_at = now();

-- 2. Beginning Sounds and Ending Sounds move from Alphabet to Phonics and show again; CVC words joins them
update public.sections set group_id = 'phon', group_label = 'Phonics', visible = true, updated_at = now(),
  label = case id when 'beginning-sounds' then 'Beginning Sounds' when 'ending-sounds' then 'Ending Sounds' else 'CVC Words' end,
  sort  = case id when 'beginning-sounds' then 303 when 'ending-sounds' then 304 else 307 end,
  description = case id when 'beginning-sounds' then 'Children hear and name the first sound in a word.'
                        when 'ending-sounds' then 'Children hear and name the last sound in a word.'
                        else 'Children read and write three-letter words like cat, pen and sun.' end
 where id in ('beginning-sounds', 'ending-sounds', 'cvc-words');

-- 3. the older Phonics sections the board does not show are hidden (none has a sheet)
update public.sections set visible = false, updated_at = now()
 where group_id = 'phon'
   and id not in ('consonants', 'vowels', 'beginning-sounds', 'ending-sounds', 'blending', 'segmenting', 'cvc-words')
   and not exists (select 1 from public.products p where p.section = sections.id);

-- Optional, only if Sumit says yes: bring the old Beginning and Ending Sounds sheets back, now under Phonics
-- update public.products set status = 'active', updated_at = now()
--  where id in ('bx-1','bx-2','bx-3','sd-A','sd-B','sd-C','sd-D','sd-E','ex-1','ex-2','ex-3');
