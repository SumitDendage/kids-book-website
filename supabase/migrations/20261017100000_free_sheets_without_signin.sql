-- Learn With Why · free sheets open without signing in (Sumit, Oct 17: "the free can access easily,
-- not required for again sign in"). The API now gives a visitor with no sign-in a guest view token for
-- a free sheet; only the FAQ answer that said "sign in to open them" changes here.
update public.faq_entries
set answer = 'Eight sheets are free to try: Alphabet A and B tracing, and the first three Colours and first three Shapes sheets in Vocabulary. Open the shop, pick Free, and tap Open it free. No sign-in is needed. Every other sheet is bought on its own or opens with a class plan.'
where question = 'Which sheets are free?';
