#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
if [[ $# -gt 0 ]]; then
  shift
fi
if [[ "${1:-}" == "--" ]]; then
  shift
fi
full_cli_args=("$@")

full_suite=0
case "$mode" in
  ai-catalog)
    sql_specs=(tests/e2e/ai-catalog-cloud.spec.ts)
    sql_grep='PostgreSQL integration runs in an isolated disposable local database'
    ai_catalog_sql_tests=1
    topic_jobs_sql_tests=0
    ;;
  topic-jobs)
    sql_specs=(tests/e2e/generate-topic-jobs-sql.spec.ts)
    sql_grep='topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing'
    ai_catalog_sql_tests=0
    topic_jobs_sql_tests=1
    ;;
  all)
    sql_specs=(
      tests/e2e/ai-catalog-cloud.spec.ts
      tests/e2e/generate-topic-jobs-sql.spec.ts
    )
    sql_grep='PostgreSQL integration runs in an isolated disposable local database|topic generation job RPCs enforce authorization, idempotency, leases, and completion fencing'
    ai_catalog_sql_tests=1
    topic_jobs_sql_tests=1
    ;;
  full)
    full_suite=1
    ai_catalog_sql_tests=1
    topic_jobs_sql_tests=1
    ;;
  *)
    echo "Usage: $0 {ai-catalog|topic-jobs|all|full} [Playwright options...]" >&2
    exit 2
    ;;
esac

if [[ "$full_suite" -eq 1 ]]; then
  for ((option_index = 0; option_index < ${#full_cli_args[@]}; option_index++)); do
    case "${full_cli_args[$option_index]}" in
      --reporter=*|--output=*)
        ;;
      --reporter|--output)
        if ((option_index + 1 >= ${#full_cli_args[@]})); then
          echo "${full_cli_args[$option_index]} requires a value." >&2
          exit 2
        fi
        option_index=$((option_index + 1))
        ;;
      *)
        echo "Full mode accepts only --reporter and --output options; it always runs every spec without grep." >&2
        exit 2
        ;;
    esac
  done
fi

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Disposable PostgreSQL tests must run as a non-root user." >&2
  exit 2
fi

if [[ -n "${PG_BIN_DIR:-}" ]]; then
  pg_bin_dir="$PG_BIN_DIR"
elif command -v pg_config >/dev/null 2>&1; then
  pg_bin_dir="$(pg_config --bindir)"
elif command -v initdb >/dev/null 2>&1; then
  pg_bin_dir="$(dirname "$(command -v initdb)")"
else
  echo "PostgreSQL tools not found; set PG_BIN_DIR to the PostgreSQL bin directory." >&2
  exit 2
fi

for tool in initdb postgres pg_isready psql; do
  if [[ ! -x "$pg_bin_dir/$tool" ]]; then
    echo "Required PostgreSQL tool not found: $pg_bin_dir/$tool" >&2
    exit 2
  fi
done
export PATH="$pg_bin_dir:$PATH"

work_dir="$(mktemp -d /tmp/figma-pgtest.XXXXXX)"
data_dir="$work_dir/data"
socket_dir="$work_dir/socket"
server_log="$work_dir/postgres.log"
server_pid=""
mkdir "$socket_dir"
chmod 700 "$work_dir" "$socket_dir"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill -INT "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 && -f "$server_log" ]]; then
    echo "Disposable PostgreSQL log (startup/test failure):" >&2
    tail -n 80 "$server_log" >&2 || true
  fi
  rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Ignore ambient libpq routing/authentication settings so every SQL client
# connects only to this temporary Unix socket.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGDATABASE PGOPTIONS
export PGHOST="$socket_dir"
export PGPORT=5432
export PGUSER=postgres
export PGSSLMODE=disable

"$pg_bin_dir/initdb" \
  --pgdata="$data_dir" \
  --username=postgres \
  --auth-local=trust \
  --auth-host=reject \
  --no-instructions

"$pg_bin_dir/postgres" \
  -D "$data_dir" \
  -k "$socket_dir" \
  -p "$PGPORT" \
  -c listen_addresses='' \
  -c unix_socket_permissions=0700 \
  >"$server_log" 2>&1 &
server_pid=$!

ready=0
for ((attempt = 0; attempt < 150; attempt++)); do
  if "$pg_bin_dir/pg_isready" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [[ "$ready" -ne 1 ]]; then
  echo "Disposable PostgreSQL did not become ready on its Unix socket." >&2
  exit 1
fi

if [[ "$full_suite" -eq 1 ]]; then
  env \
    AI_CATALOG_SQL_TESTS="$ai_catalog_sql_tests" \
    GENERATE_TOPIC_JOBS_SQL_TESTS="$topic_jobs_sql_tests" \
    pnpm exec playwright test \
    "${full_cli_args[@]}" \
    --config=playwright.config.ts \
    --workers=1 \
    --retries=0
else
  env \
    AI_CATALOG_SQL_TESTS="$ai_catalog_sql_tests" \
    GENERATE_TOPIC_JOBS_SQL_TESTS="$topic_jobs_sql_tests" \
    pnpm exec playwright test \
    --config=playwright.sql.config.ts \
    --workers=1 \
    --grep="$sql_grep" \
    "${sql_specs[@]}" \
    "$@"
fi