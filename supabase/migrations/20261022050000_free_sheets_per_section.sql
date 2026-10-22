-- Free sheets per section (Sumit, Oct 22): Colour A to Z 3, Matching 2, Uppercase & Lowercase 2,
-- Sounds 2, Sounds Exercise 2, Colours 3, Missing letters 2, Shapes 3, Sizes 3, Animals 3.
-- Alphabet A and B tracing stay free (not on his list). Every other sheet stays at its price.
-- Animals (va-*) only exists once supabase/scripts/animals-catalogue.sql has been run; that
-- script now adds va-1..3 as free, and this update makes them free if they are already there.
update public.products set price_inr = 0
where id in ('cl-A', 'cl-B', 'cl-C', 'mt-AE', 'mt-FJ', 'sp-AE', 'sp-FJ', 'sd-A', 'sd-B', 'bx-1', 'ex-1',
             'ms-U1', 'ms-L1', 'vz-1', 'vz-2', 'vz-3', 'va-1', 'va-2', 'va-3')
  and price_inr <> 0;

update public.faq_entries
set answer = 'Free sheets to try in every section: Alphabet A and B tracing, Colour A to Z (A, B and C), Matching (2), Uppercase and Lowercase (2), Sounds (A and B), Sounds Exercise (2), Missing Uppercase and Lowercase (2), and the first three sheets of Colours, Shapes, Sizes and Animals in Vocabulary. Open the shop, pick Free, and tap Open it free. No sign-in is needed. Every other sheet is bought on its own or opens with a class plan.'
where question = 'Which sheets are free?';
