# Fruits vocabulary import

The supplied Fruits.zip contains ten worksheets. They map to `vf-1` through `vf-10`, under Vocabulary → Fruits. Sheets 1 and 2 are one-page read-aloud charts; sheets 3 to 10 have two pages, the sheet and then its answers. The first three sheets (`vf-1`, `vf-2`, `vf-3`) are free, like the other Vocabulary sections. The rest are ₹19 each.

The full PDFs and page images must stay in the private `worksheets` bucket. Do not commit the ZIP or the `backend/` directory to this public repository. The public thumbnails are already in `frontend/public/sheets/vocab-fruits/thumb/`.

From the repository root:

1. Install the rendering dependency: `python -m pip install pymupdf`.
2. Prepare the original attachment: `python supabase/scripts/prepare-vocab-set.py /path/to/Fruits.zip vocab-fruits fruits`. This writes ten PDFs and eighteen page images to `backend/protected/vocab-fruits/` and refreshes the thumbnails.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in your terminal as documented in `scripts/upload-files.mjs`.
4. Upload with `node supabase/scripts/upload-files.mjs backend/protected`.
5. After a successful upload, run `supabase/scripts/fruits-catalogue.sql` in the project's SQL editor. The insert preserves existing product records.
6. Check Vocabulary → Fruits and Store → Vocabulary → Fruits. Open Fruits 1, 2 and 3 without signing in, and open a paid sheet with a test account, including its answers page.

The SQL file is an additive data import, not a schema migration. The Fruits section already exists in the section catalogue. No storage policies or payment rules change. Until step 5 has run, the website keeps the Fruits sheets hidden, because the server does not list them yet.
