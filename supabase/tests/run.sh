#!/usr/bin/env bash
# Runs the API tests. Each test file gets a freshly rebuilt database and its own Deno process,
# one file after another, so files never see each other's rows.
#
#   tests/run.sh                                   # every tests/api/*.test.ts
#   tests/run.sh tests/api/auth.test.ts            # one file (or a directory)
#   tests/run.sh tests/api/auth.test.ts -- --filter "login"   # extra args for `deno test`
#
# Env: LWW_TEST_DB (default lww_sb; use your own, e.g. lww_t_a), TEST_NO_CHECK=1 skips type
# checking (useful while another module is mid-edit), PGHOST/PGPORT (default 127.0.0.1:5433).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DENO="${DENO:-/var/tmp/sb/tools/node_modules/.bin/deno}"
export DENO_DIR="${DENO_DIR:-/var/tmp/sb/deno-cache}"
export NO_COLOR=1
export LWW_TEST_DB="${LWW_TEST_DB:-lww_sb}"

paths=()
deno_args=()
seen_sep=0
for a in "$@"; do
  if [ "$seen_sep" = 1 ]; then deno_args+=("$a"); continue; fi
  if [ "$a" = "--" ]; then seen_sep=1; continue; fi
  paths+=("$a")
done
[ ${#paths[@]} -eq 0 ] && paths=("$ROOT/tests/api")

files=()
for p in "${paths[@]}"; do
  # accept paths relative to the current directory or to the supabase folder
  if [ -e "$p" ]; then abs="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
  elif [ -e "$ROOT/$p" ]; then abs="$ROOT/$p"
  else echo "run.sh: no such file or directory: $p" >&2; exit 2; fi
  if [ -d "$abs" ]; then
    while IFS= read -r f; do files+=("$f"); done < <(find "$abs" -name '*.test.ts' -not -path '*/fakes/*' | sort)
  else
    files+=("$abs")
  fi
done
[ ${#files[@]} -eq 0 ] && { echo "run.sh: no *.test.ts files found" >&2; exit 2; }

check=(--no-check=remote)
[ "${TEST_NO_CHECK:-}" = "1" ] && check=(--no-check)

cd "$ROOT" || exit 2
log="$(mktemp)"; trap 'rm -f "$log"' EXIT
passed=(); failed=()
for f in "${files[@]}"; do
  rel="${f#"$ROOT"/}"
  echo "=== $rel (database $LWW_TEST_DB)"
  if ! "$ROOT/tests/local/reset-db.sh" >/dev/null 2>"$log"; then
    cat "$log" >&2
    echo "run.sh: could not rebuild $LWW_TEST_DB" >&2
    exit 2
  fi
  if "$DENO" test -A "${check[@]}" --config "$ROOT/functions/api/deno.json" ${deno_args[@]+"${deno_args[@]}"} "$f"; then
    passed+=("$rel")
  else
    failed+=("$rel")
  fi
done

echo
echo "=== summary: ${#passed[@]} file(s) passed, ${#failed[@]} failed"
for f in ${failed[@]+"${failed[@]}"}; do echo "FAILED: $f"; done
[ ${#failed[@]} -eq 0 ]
