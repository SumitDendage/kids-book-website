-- Learn With Why · admin product manager (Oct 17, Sumit's "Dynamic Admin Book & Worksheet
-- Management System"). Additive only: no table, column or row is removed.
--
-- 1. products.publish_at: a sheet that is on sale ('active') with a publish time in the future
--    is "scheduled": the shop lists it from that moment on.
-- 2. public.sections: the site's sections (Kindergarten's Alphabet, Vocabulary, Phonics … topics,
--    the ones the website draws today, marked builtin) plus any section staff create in
--    Admin → Categories. products.section holds a section id, as it always has.
-- 3. The "Best Seller" label: the seven sheets the shop's Bestselling list showed until now get
--    the tag 'bestseller', so that list stays the same now that labels come from the database.
--    Labels are tags: bestseller, featured, new, popular, recommended; 'home' = on the home page.

alter table public.products add column if not exists publish_at timestamptz;
comment on column public.products.publish_at is
  'null = listed as soon as it is active; a future time = scheduled: listed from then on';
create index if not exists products_publish_at on public.products (publish_at) where publish_at is not null;

-- the read-only public view of the catalogue follows the schedule too
alter policy products_public_read on public.products
  using (status = 'active' and (publish_at is null or publish_at <= now()));

create table if not exists public.sections (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  label text not null check (char_length(label) between 1 and 60),
  -- the website group it sits in (alpha, vocab, phon …); null = a section of its own
  group_id text check (group_id ~ '^[a-z0-9-]{1,40}$'),
  group_label text check (char_length(group_label) <= 60),
  class_id text not null default 'kg' references public.classes (id) on update cascade,
  description text not null default '' check (char_length(description) <= 300),
  sort integer not null default 0,
  visible boolean not null default true,
  -- drawn by the website's own boards; builtin sections can be renamed or hidden, not deleted
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index if not exists sections_listing on public.sections (visible, sort, id);
create trigger sections_touch before update on public.sections
  for each row execute function private.touch_updated_at();

alter table public.sections enable row level security;
revoke all on public.sections from anon, authenticated;
grant select, insert, update, delete on public.sections to lww_api;
grant select on public.sections to anon, authenticated;
create policy sections_public_read on public.sections for select to anon, authenticated
  using (visible);

insert into public.sections (id, label, group_id, group_label, class_id, description, sort, builtin) values
  ('picture-matching', 'Picture matching', 'pre', 'Pre-reading skills', 'kg', '', 110, true),
  ('same-different', 'Same and different', 'pre', 'Pre-reading skills', 'kg', '', 120, true),
  ('visual-discrimination', 'Visual discrimination', 'pre', 'Pre-reading skills', 'kg', '', 130, true),
  ('listening', 'Listening activities', 'pre', 'Pre-reading skills', 'kg', '', 140, true),
  ('following-instructions', 'Following instructions', 'pre', 'Pre-reading skills', 'kg', '', 150, true),
  ('story-sequencing', 'Story sequencing', 'pre', 'Pre-reading skills', 'kg', '', 160, true),
  ('rhyming-words', 'Rhyming words', 'pre', 'Pre-reading skills', 'kg', '', 170, true),
  ('odd-one-out', 'Odd one out', 'pre', 'Pre-reading skills', 'kg', '', 180, true),
  ('bme-sounds', 'Beginning, middle and ending sounds', 'pre', 'Pre-reading skills', 'kg', '', 190, true),
  ('syllable-clapping', 'Syllable clapping', 'pre', 'Pre-reading skills', 'kg', '', 200, true),
  ('oral-blending', 'Oral blending and segmenting', 'pre', 'Pre-reading skills', 'kg', '', 210, true),
  ('letter-tracing', 'A-Z Letter Tracing', 'alpha', 'Alphabet', 'kg', 'Children trace uppercase and lowercase letters from A to Z.', 210, true),
  ('letter-recognition', 'A-Z Letter Recognition', 'alpha', 'Alphabet', 'kg', 'Children identify and recognise letters from A to Z.', 220, true),
  ('match-upper-lower', 'Match Uppercase and Lowercase Letters', 'alpha', 'Alphabet', 'kg', 'Children match each capital letter with its corresponding small letter.', 230, true),
  ('before-after-letters', 'Letters Before and After', 'alpha', 'Alphabet', 'kg', 'Children identify the letter that comes before or after the given letter.', 240, true),
  ('beginning-sounds', 'Beginning Sounds', 'alpha', 'Alphabet', 'kg', 'Children identify the first sound heard in a pictured word.', 250, true),
  ('ending-sounds', 'Ending Sounds', 'alpha', 'Alphabet', 'kg', 'Children identify the final sound heard in a pictured word.', 260, true),
  ('missing-letters', 'Find the Missing Letters', 'alpha', 'Alphabet', 'kg', 'Children complete alphabet sequences by writing the missing letters.', 270, true),
  ('short-vowels', 'Short vowels', 'phon', 'Phonics', 'kg', '', 310, true),
  ('cvc-words', 'CVC words', 'phon', 'Phonics', 'kg', '', 320, true),
  ('word-families', 'Word families', 'phon', 'Phonics', 'kg', '', 330, true),
  ('blending-segmenting', 'Blending and segmenting', 'phon', 'Phonics', 'kg', '', 340, true),
  ('ccvc-cvcc', 'CCVC and CVCC words', 'phon', 'Phonics', 'kg', '', 350, true),
  ('blends', 'Beginning and ending blends', 'phon', 'Phonics', 'kg', '', 360, true),
  ('digraphs', 'Digraphs: sh, ch, th, wh, ph, ck, ng, qu', 'phon', 'Phonics', 'kg', '', 370, true),
  ('double-letters', 'Double letters', 'phon', 'Phonics', 'kg', '', 380, true),
  ('magic-e', 'Magic e', 'phon', 'Phonics', 'kg', '', 390, true),
  ('long-vowels', 'Long vowels', 'phon', 'Phonics', 'kg', '', 400, true),
  ('vowel-teams', 'Simple vowel teams', 'phon', 'Phonics', 'kg', '', 410, true),
  ('spelling-rules', 'Simple spelling rules', 'phon', 'Phonics', 'kg', '', 430, true),
  ('vocab-colours', 'Colours', 'vocab', 'Vocabulary', 'kg', '', 410, true),
  ('vocab-shapes', 'Shapes', 'vocab', 'Vocabulary', 'kg', '', 420, true),
  ('vocab-sizes', 'Sizes', 'vocab', 'Vocabulary', 'kg', '', 430, true),
  ('vocab-animals', 'Animals', 'vocab', 'Vocabulary', 'kg', '', 440, true),
  ('vocab-animal-babies', 'Animal Babies', 'vocab', 'Vocabulary', 'kg', '', 450, true),
  ('vocab-transport', 'Transport', 'vocab', 'Vocabulary', 'kg', '', 460, true),
  ('vocab-fruits', 'Fruits', 'vocab', 'Vocabulary', 'kg', '', 470, true),
  ('vocab-vegetables', 'Vegetables', 'vocab', 'Vocabulary', 'kg', '', 480, true),
  ('vocab-body-parts', 'Body Parts', 'vocab', 'Vocabulary', 'kg', '', 490, true),
  ('vocab-clothes', 'Clothes', 'vocab', 'Vocabulary', 'kg', '', 500, true),
  ('vocab-my-family', 'My Family', 'vocab', 'Vocabulary', 'kg', '', 510, true),
  ('vocab-weather', 'Weather', 'vocab', 'Vocabulary', 'kg', '', 520, true),
  ('sight-lists', 'Pre-KG, KG1 and KG2 lists', 'sight', 'Sight words', 'kg', '', 510, true),
  ('read-trace', 'Read and trace', 'sight', 'Sight words', 'kg', '', 520, true),
  ('find-sight-word', 'Find the sight word', 'sight', 'Sight words', 'kg', '', 530, true),
  ('complete-sentence', 'Complete the sentence', 'sight', 'Sight words', 'kg', '', 540, true),
  ('sight-colouring', 'Sight-word colouring', 'sight', 'Sight words', 'kg', '', 550, true),
  ('sight-passages', 'Sight-word passages', 'sight', 'Sight words', 'kg', '', 560, true),
  ('pre-writing', 'Pre-writing strokes', 'gram', 'Grammar & writing', 'kg', '', 610, true),
  ('pencil-control', 'Pencil control', 'gram', 'Grammar & writing', 'kg', '', 620, true),
  ('name-writing', 'Name writing', 'gram', 'Grammar & writing', 'kg', '', 630, true),
  ('word-tracing', 'Word tracing and copying', 'gram', 'Grammar & writing', 'kg', '', 640, true),
  ('label-picture', 'Label the picture', 'gram', 'Grammar & writing', 'kg', '', 650, true),
  ('sentence-formation', 'Sentence formation', 'gram', 'Grammar & writing', 'kg', '', 660, true),
  ('capitals-full-stops', 'Capital letters and full stops', 'gram', 'Grammar & writing', 'kg', '', 670, true),
  ('naming-action', 'Naming and action words', 'gram', 'Grammar & writing', 'kg', '', 680, true),
  ('one-many', 'One and many', 'gram', 'Grammar & writing', 'kg', '', 690, true),
  ('this-that', 'This/that; these/those', 'gram', 'Grammar & writing', 'kg', '', 700, true),
  ('is-am-are', 'Is/am/are', 'gram', 'Grammar & writing', 'kg', '', 710, true),
  ('he-she-it', 'He/she/it', 'gram', 'Grammar & writing', 'kg', '', 720, true),
  ('position-words', 'Position words', 'gram', 'Grammar & writing', 'kg', '', 730, true),
  ('picture-reading', 'Picture reading', 'read', 'Reading', 'kg', '', 710, true),
  ('read-match', 'Read and match', 'read', 'Reading', 'kg', '', 720, true),
  ('read-colour', 'Read and colour', 'read', 'Reading', 'kg', '', 730, true),
  ('decodable-sentences', 'Simple and decodable sentences', 'read', 'Reading', 'kg', '', 740, true),
  ('picture-comprehension', 'Picture comprehension', 'read', 'Reading', 'kg', '', 750, true),
  ('short-passages', 'Short passages', 'read', 'Reading', 'kg', '', 760, true),
  ('yes-no', 'Yes/no questions', 'read', 'Reading', 'kg', '', 770, true),
  ('multiple-choice', 'Multiple choice', 'read', 'Reading', 'kg', '', 780, true),
  ('wh-questions', 'Who, what and where questions', 'read', 'Reading', 'kg', '', 800, true),
  ('numbers-counting', 'Numbers and counting', 'more', 'Maths & the world', 'kg', '', 810, true),
  ('shapes-patterns', 'Shapes and patterns', 'more', 'Maths & the world', 'kg', '', 820, true),
  ('animals-nature', 'Animals and nature', 'more', 'Maths & the world', 'kg', '', 830, true),
  ('my-world', 'My body, family and home', 'more', 'Maths & the world', 'kg', '', 840, true)

on conflict (id) do nothing;

update public.products set tags = array_append(tags, 'bestseller')
where id in ('az-A', 'az-B', 'az-C', 'rc-A', 'cl-A', 'mt-AE', 'sp-AE')
  and not ('bestseller' = any (tags));
