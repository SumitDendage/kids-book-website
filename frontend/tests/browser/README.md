# Isolated Admin and Developer UI checks

Run from `frontend/`:

```sh
node node_modules/vite/bin/vite.js --config tests/browser/vite.config.mjs
```

Open `http://127.0.0.1:5180/tests/browser/index.html`.

This separate Vite configuration replaces the API module with local fixtures.
It does not change production authentication or connect a fake account to Supabase.
Writes throw an error and health reads return a local simulated 404. Its public
directory is disabled, and it is not an entry point in the production build.

Use the page selector to inspect all 12 Admin pages, 13 Developer pages, and the
customer sign-in controls component. Test loading, valid empty lists/reports, and
missing-backend errors. The last two choices render the complete real dashboard
shell with a clearly labeled fixture identity so sidebar navigation can be tested.

Fixture results verify rendering and error handling only. They do not establish
working authentication, database writes, emails, exports, payments or staff roles.
