# Contributing

Learn With Why is a proprietary project (see [LICENSE](LICENSE)). The repository is public so the work can be seen, but the code, design and worksheets may not be reused.

- **Issues and suggestions** are welcome through GitHub Issues.
- **Code contributions** need the owner's agreement first. Open an issue describing the change before writing code.
- **Security problems** go by email, not in an issue; see [SECURITY.md](SECURITY.md).

## Working on the code

### Branches and pull requests

- `main` is what runs in production. A merge that changes `frontend/` publishes the website automatically.
- Work on a branch and open a pull request. The owner reviews and merges.
- Describe what a visitor or staff member would notice, and how you tested it.

### Before opening a pull request

Website changes:

```bash
cd frontend
npm test
npm run build
```

API or database changes:

```bash
cd supabase/functions/api
deno check --config deno.json index.ts lib/*.ts services/*.ts routes/*.ts gateways/*.ts
cd ../..
LWW_TEST_DB=lww_t_a tests/run.sh
```

See [supabase/tests/README.md](supabase/tests/README.md) for the local database the API tests need.

### Conventions

- **Database:** add a new migration file in `supabase/migrations` with a later timestamp. Never edit one that has been applied. Prefer additive changes (`if not exists`, `create or replace`, `alter ... add`).
- **Business rules belong on the server.** Prices, access, prints and permissions are decided in the Edge Function; values in `frontend/src/data` are display fallbacks only.
- **Secrets never go in the repository.** Server keys belong in Supabase Edge Function secrets. Anything starting with `VITE_` is public.
- **Worksheet PDFs never go in the repository.** They live in the private `worksheets` storage bucket.
- **Styles:** add rules to the numbered files in `frontend/src/styles`; later files load last.
- Match the style of the code around your change.
