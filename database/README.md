# `database/` — where the Learn With Why data lives

This folder holds the databases themselves. There is no JavaScript in here: the code that reads and writes them is in [`backend/src/database/`](../backend/src/database/).

The site uses **two databases**:

- **PostgreSQL** for **customer accounts**: who can sign in.
- **SQLite** for **the shop**: the sheets, what was bought and who may open what.

| Path | What it is |
|---|---|
| `postgresql/migrations/` | The PostgreSQL schema (the account tables) as numbered `.sql` files. These are on GitHub. Today there is one: `001_auth_schema.sql`. |
| `data/lww.sqlite` | The shop database. The server makes it on its first start. It is **never on GitHub** (it is in `.gitignore`), so back it up yourself (see [Backups](#backups)). While the server runs you may also see `lww.sqlite-wal` and `lww.sqlite-shm` next to it; they are part of the same database. |

The full list of tables and columns is in [`backend/README.md`](../backend/README.md#database).

## PostgreSQL — customer accounts

**What it holds:** the accounts (`users`), sign-in sessions (`user_sessions`), the email tokens for confirming an account and resetting a password (`email_verification_tokens`, `password_reset_tokens`), every sign-in attempt (`login_activity`) and each account's security trail (`security_events`). Passwords are stored only as Argon2id hashes and tokens only as SHA-256 hashes, so a copy of this database cannot be used to sign in.

**Where it lives:** the data is inside your PostgreSQL server (on your computer, or at a provider such as Neon or Supabase). `DATABASE_URL` in `backend\.env` says which one. This folder only holds the schema. How to get a database: [Set up PostgreSQL](../backend/README.md#set-up-postgresql).

**How the tables get there:** the server applies the files in `postgresql/migrations/` **automatically at every start** (`npm start` in `backend`). You can also do it on its own, for example to prepare a new database:

```bat
cd backend
npm run migrate
```

- Each file runs once, in number order, in its own transaction. The table `schema_migrations` remembers which files ran, with a checksum of each.
- **Never edit a file that has already run.** The server notices that the checksum changed and refuses to start: "Migration … was edited after it was applied. Put the change in a new migration file instead."
- To change the schema, add a **new** file with the next number, for example `002_add_something.sql` (a number of three or more digits, an underscore, a name, `.sql`).

**Customers from before PostgreSQL:** at start (and with `npm run migrate`), any account still only in the SQLite shop is copied into PostgreSQL once, with the same id, so their orders and sheets stay theirs.

## SQLite — the shop

**What it holds:** the worksheet catalogue, orders, payments (every event from the payment gateway), entitlements (who may open which sheet or class, and for how long), the access log, the notes sent through the contact form, and the store settings (plans, classes, coupons, discounts, rates, fees). It also keeps a copy of each customer's name and email, with the same id as in PostgreSQL, so an order knows whose it is. Passwords are only in PostgreSQL.

**Where it lives:** `database\data\lww.sqlite`, or the file that `DB_PATH` in `backend\.env` points to. It is made on the first start and is never on GitHub.

**How the tables get there:** there are no migration files for the shop. Its tables are written out inline in [`backend/src/database/db.cjs`](../backend/src/database/db.cjs) and made when the file is first opened. The starting catalogue is in [`backend/src/database/seed.cjs`](../backend/src/database/seed.cjs): at every start, new sheets from it are added, and a field the admin has changed (a price, for example) is never overwritten.

**Older checkouts:** before October 2026 the shop lived in `site\data`. If it is still there (and `database\data` has none), the server keeps using it **where it is**, so no order is lost, and prints a `!!` line with the command to move it. The `shop` line in the server window shows which file is used. How to move everything once: [Moving to the new folders](../README.md#moving-to-the-new-folders-october-2026) in the main README.

## The code that talks to them (`backend/src/database/`)

| File | What it does |
|---|---|
| `pg.cjs` | The PostgreSQL connection pool (uses `DATABASE_URL`). |
| `migrate.cjs` | Applies the files in `database/postgresql/migrations/` and checks their checksums. |
| `legacy.cjs` | Carries old customer accounts from the SQLite shop into PostgreSQL. |
| `db.cjs` | The SQLite shop store, with its tables written out inline. |
| `seed.cjs` | The catalogue the shop starts with. |

`npm run migrate` runs [`backend/scripts/migrate.cjs`](../backend/scripts/migrate.cjs), which uses `migrate.cjs` and `legacy.cjs`.

## Not a database: the private PDFs

The 79 sheet PDFs and their preview JPGs are plain files in `backend\protected\` (folders `a-to-z`, `colour`, `matching`, `reading`, `sound`, `sound-exercise`, `spot`). The shop only stores each sheet's path inside that folder. PDFs uploaded in the admin panel go to `backend\protected\uploads\`, which is not on GitHub either.

## Backups

Three things are not on GitHub, so nothing else keeps a copy of them: the shop (`database\data`), the accounts (PostgreSQL) and the PDFs uploaded in the admin panel (`backend\protected\uploads`). Back them up regularly, and always before an update.

### On Windows (cmd)

1. **Stop the server first**: press Ctrl+C in its black window. A copy of the shop made while the server runs can be half-written.
2. Open cmd in the `kids-book-website` folder (in File Explorer: click the address bar, type `cmd`, press Enter) and run these lines. Put today's date in the folder name, so an older backup is not overwritten:

   ```bat
   mkdir ..\lww-backup\2026-10-05
   xcopy database\data ..\lww-backup\2026-10-05\data\ /E /I /Y
   if exist backend\protected\uploads xcopy backend\protected\uploads ..\lww-backup\2026-10-05\uploads\ /E /I /Y
   ```

3. **PostgreSQL**: `pg_dump` writes all the accounts into one file. Between the quotes, put your own `DATABASE_URL` from `backend\.env` (everything after `DATABASE_URL=`):

   ```bat
   pg_dump "postgres://lww:YOUR-PASSWORD@127.0.0.1:5432/lww" > ..\lww-backup\2026-10-05\accounts.sql
   ```

   `pg_dump` comes with PostgreSQL. If cmd says it "is not recognized", type its full path instead, for example `"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"` (16 is your PostgreSQL version). With a managed database (Neon, Supabase, …) the provider's own backups work too.

4. Start the server again: in the server window, `npm start` (in the `backend` folder).
5. Copy the `lww-backup` folder somewhere safe, such as a USB stick or a cloud drive. A backup on the same disk does not help if the computer breaks.

If the `shop` line in the server window ends in `site\data\lww.sqlite`, your shop is still in the old place: in step 2 use `site\data` instead of `database\data` (or move it first, see [Older checkouts](#sqlite--the-shop)).

To put the shop back from a backup: stop the server, copy the saved `data` folder back to `database\data`, start the server.

### On a Linux server

```bash
# in the kids-book-website folder, with the server stopped (Ctrl+C, or: pm2 stop lww)
B=~/lww-backup/$(date +%F)
mkdir -p "$B"
cp -a database/data "$B/"
[ -d backend/protected/uploads ] && cp -a backend/protected/uploads "$B/"
pg_dump "$DATABASE_URL" > "$B/accounts.sql"
# then start the server again (npm start in backend, or: pm2 restart lww)
```

`$DATABASE_URL` has to be set in that shell; otherwise paste the value from `backend/.env` between the quotes. Then copy `~/lww-backup` off the server, or use your provider's backups as well.
