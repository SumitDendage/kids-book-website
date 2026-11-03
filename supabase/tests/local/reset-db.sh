#!/usr/bin/env bash
# Rebuilds the local test database: Supabase stand-ins (as superuser), then every migration
# in order as sb_postgres, which has the same limited powers as the hosted "postgres" role.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; DB="${LWW_TEST_DB:-lww_sb}"
SUPER="postgres://postgres@$PGHOST:$PGPORT"
# Supabase records a migration by the number before its first "_", so two files with one number
# can't both be applied there: stop here instead.
dup="$(for f in "$ROOT"/migrations/*.sql; do basename "$f" | cut -d_ -f1; done | sort | uniq -d)"
[ -z "$dup" ] || { echo "FAILED: more than one migration is numbered $dup" >&2; exit 1; }
psql "$SUPER/postgres" -qX -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
psql "$SUPER/$DB" -qX -v ON_ERROR_STOP=1 -v DBNAME="$DB" -f "$HERE/bootstrap.sql" >/dev/null
for f in "$ROOT"/migrations/*.sql; do
  psql "postgres://sb_postgres:sb_postgres@$PGHOST:$PGPORT/$DB" -qX -v ON_ERROR_STOP=1 -1 -f "$f" >/dev/null \
    || { echo "FAILED: $(basename "$f")" >&2; exit 1; }
done
echo "ok: $DB rebuilt with $(ls "$ROOT"/migrations/*.sql | wc -l) migrations"
