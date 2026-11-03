# Animals vocabulary import

The supplied Animals.zip contains ten two-page worksheets. They map to `va-1` through `va-10`, under Vocabulary → Animals. The default price is ₹19 each, following Sizes; existing free samples are unchanged.

The full PDFs and page images must stay in the private `worksheets` bucket. Do not commit the ZIP or the `backend/` directory to this public repository.

From the repository root:

1. Install the rendering dependency: `python -m pip install pymupdf`.
2. Prepare the original attachment: `python supabase/scripts/prepare-animals.py /path/to/Animals.zip`.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in your terminal as documented in `scripts/upload-files.mjs`.
4. Upload with `node supabase/scripts/upload-files.mjs backend/protected`. This produces ten PDFs and twenty page images in `vocab-animals/`.
5. After successful upload, run `supabase/scripts/animals-catalogue.sql` in the project's SQL editor. The insert preserves existing product records.
6. Deploy the frontend. Check Vocabulary → Animals, Store → Vocabulary → Animals, and open a purchased worksheet with a test account, including its second page.

The SQL file is an additive data import, not a schema migration. The existing Animals section already exists in the section catalogue. No storage policies or payment rules change.
