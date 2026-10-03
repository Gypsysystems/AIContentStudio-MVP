#!/bin/sh
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RULES="$ROOT/scripts/security/local-rules.yml"
FIXTURES="$ROOT/scripts/security/fixtures"
TMP=$(mktemp -d "/tmp/local-security.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

cd "$ROOT" || exit 2
TOOL_ERROR=0
FINDINGS=0

run_semgrep() {
  OUTPUT=$1
  shift
  if semgrep scan \
    --metrics=off \
    --disable-version-check \
    --quiet \
    --json \
    --config "$RULES" \
    --exclude node_modules \
    --exclude dist \
    --exclude test-results \
    --exclude .cache \
    --exclude scripts/security/fixtures \
    "$@" >"$OUTPUT" 2>"$TMP/semgrep.stderr"; then
    return 0
  fi
  echo "Semgrep execution failed; diagnostics withheld."
  return 1
}

if command -v semgrep >/dev/null 2>&1; then
  if SEMGREP_VERSION=$(semgrep --version 2>/dev/null); then
    printf 'Semgrep version: %s\n' "$SEMGREP_VERSION"
    if run_semgrep "$TMP/positive.json" "$FIXTURES/positive.js" \
      && run_semgrep "$TMP/negative.json" "$FIXTURES/negative.js"; then
      if node - "$TMP/positive.json" "$TMP/negative.json" >"$TMP/fixture-summary" 2>"$TMP/node.stderr" <<'NODE'
const fs = require('node:fs')
try {
  const [positivePath, negativePath] = process.argv.slice(2)
  const positive = JSON.parse(fs.readFileSync(positivePath, 'utf8'))
  const negative = JSON.parse(fs.readFileSync(negativePath, 'utf8'))
  if (!Array.isArray(positive.results) || !Array.isArray(negative.results)
    || positive.errors?.length || negative.errors?.length) throw new Error()
  const ruleId = (checkId) => checkId.replace(/^.*?(local-security\.)/, '$1')
  const detected = new Set(positive.results.map((result) => ruleId(result.check_id)))
  const expected = [
    'local-security.hardcoded-private-credential',
    'local-security.sensitive-logging',
    'local-security.dynamic-code-execution',
    'local-security.tls-validation-disabled',
    'local-security.cleartext-fetch',
    'local-security.fetch-user-controlled-url',
    'local-security.path-from-request',
    'local-security.request-controlled-authorization',
    'local-security.url-embedded-credentials',
  ]
  if (expected.some((rule) => !detected.has(rule)) || negative.results.length !== 0) throw new Error()
  console.log(`Fixture checks: ${positive.results.length} positive findings across ${detected.size} rules; 0 negative findings.`)
  console.log(`Fixture rules detected: ${expected.join(', ')}`)
} catch {
  console.error('Fixture report invalid or expected detections missing; details withheld.')
  process.exit(2)
}
NODE
      then
        cat "$TMP/fixture-summary"
      else
        echo "Fixture report invalid or expected detections missing; details withheld."
        TOOL_ERROR=1
      fi
    else
      TOOL_ERROR=1
    fi

    if run_semgrep "$TMP/application.json" \
      "$ROOT/src" \
      "$ROOT/server" \
      "$ROOT/scripts" \
      "$ROOT/vite.config.ts" \
      "$ROOT/playwright.config.ts" \
      "$ROOT/playwright.server.config.ts" \
      "$ROOT/playwright.sql.config.ts" \
      "$ROOT/vite.acceptance.config.ts"; then
      if node - "$TMP/application.json" >"$TMP/application-summary" 2>"$TMP/node.stderr" <<'NODE'
const fs = require('node:fs')
try {
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (!Array.isArray(report.results) || !Array.isArray(report.paths?.scanned)
    || report.errors?.length) throw new Error()
  const counts = new Map()
  const findings = report.results.map((result) => {
    const rule = result.check_id.replace(/^.*?(local-security\.)/, '$1')
    const line = result.start.line
    counts.set(rule, (counts.get(rule) || 0) + 1)
    return { path: result.path, rule, line }
  })
  console.log(`Application scan: ${report.paths.scanned.length} files scanned; ${findings.length} findings across ${counts.size} rules.`)
  for (const [rule, count] of [...counts].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`Rule count: ${rule} ${count}`)
  for (const finding of findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule)))
    console.log(`Finding: ${finding.path}:${finding.line} ${finding.rule}`)
  console.log(`__FINDING_COUNT__=${findings.length}`)
} catch {
  console.error('Semgrep report invalid; details withheld.')
  process.exit(2)
}
NODE
      then
        sed '/^__FINDING_COUNT__=/d' "$TMP/application-summary"
        APP_FINDINGS=$(sed -n 's/^__FINDING_COUNT__=//p' "$TMP/application-summary")
        if [ -z "$APP_FINDINGS" ]; then
          echo "Semgrep summary incomplete; details withheld."
          TOOL_ERROR=1
        elif [ "$APP_FINDINGS" -gt 0 ]; then
          FINDINGS=1
        fi
      else
        echo "Semgrep report invalid; details withheld."
        TOOL_ERROR=1
      fi
    else
        echo "Semgrep report invalid; details withheld."
      TOOL_ERROR=1
    fi
  else
    echo "Semgrep version check failed; diagnostics withheld."
    TOOL_ERROR=1
  fi
else
  echo "Semgrep unavailable; local SAST was not run."
  TOOL_ERROR=1
fi

if command -v osv-scanner >/dev/null 2>&1; then
  if OSV_VERSION=$(osv-scanner --version 2>/dev/null | sed -n '1p'); then
    printf 'OSV scanner: %s\n' "$OSV_VERSION"
  else
    echo "OSV scanner version check failed; diagnostics withheld."
    TOOL_ERROR=1
  fi
  OSV_STATUS=0
  if osv-scanner scan source \
    --lockfile "$ROOT/pnpm-lock.yaml" \
    --offline \
    --offline-vulnerabilities \
    --format json \
    --output "$TMP/osv.json" \
    --verbosity error >"$TMP/osv.stdout" 2>"$TMP/osv.stderr"; then
    OSV_STATUS=0
  else
    OSV_STATUS=$?
  fi

  if [ -f "$TMP/osv.json" ]; then
    if node - "$TMP/osv.json" >"$TMP/osv-summary" 2>"$TMP/node.stderr" <<'NODE'
const fs = require('node:fs')
try {
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (!Array.isArray(report.results)) throw new Error()
  let total = 0
  for (const result of report.results) {
    if (!Array.isArray(result.packages)) throw new Error()
    for (const item of result.packages) {
      if (item.vulnerabilities !== undefined && !Array.isArray(item.vulnerabilities)) throw new Error()
      total += item.vulnerabilities?.length ?? 0
    }
  }
  console.log(`__OSV_VULNERABILITIES__=${total}`)
} catch {
  console.error('OSV report invalid; details withheld.')
  process.exit(2)
}
NODE
    then
      OSV_FINDINGS=$(sed -n 's/^__OSV_VULNERABILITIES__=//p' "$TMP/osv-summary")
      if [ -z "$OSV_FINDINGS" ]; then
        echo "OSV summary incomplete; details withheld."
        TOOL_ERROR=1
      elif [ "$OSV_STATUS" -ne 0 ] \
        && grep -Eiq '(offline.*(database|cache)|(database|cache).*(not found|unavailable|missing|empty|not populated)|no usable cached|no cached (database|vulnerability))' "$TMP/osv.stderr"; then
        echo "OSV offline lockfile scan: skipped/unverified; no usable cached vulnerability database."
        if [ "$OSV_FINDINGS" -gt 0 ]; then
          echo "OSV report contains findings but the offline database was unavailable."
          FINDINGS=1
          TOOL_ERROR=1
        fi
      else
        printf 'OSV offline lockfile scan: completed; %s vulnerability records.\n' "$OSV_FINDINGS"
        if [ "$OSV_FINDINGS" -gt 0 ]; then FINDINGS=1; fi
        if [ "$OSV_STATUS" -ne 0 ] && ! { [ "$OSV_STATUS" -eq 1 ] && [ "$OSV_FINDINGS" -gt 0 ]; }; then
          echo "OSV offline scan failed; diagnostics withheld."
          TOOL_ERROR=1
        fi
      fi
    else
      echo "OSV report invalid; details withheld."
      TOOL_ERROR=1
    fi
  elif [ "$OSV_STATUS" -ne 0 ] \
    && grep -Eiq '(offline.*(database|cache)|(database|cache).*(not found|unavailable|missing|empty|not populated)|no usable cached|no cached (database|vulnerability))' "$TMP/osv.stderr"; then
    echo "OSV offline lockfile scan: skipped/unverified; no usable cached vulnerability database."
  else
    echo "OSV offline scan failed or produced no report; diagnostics withheld."
    TOOL_ERROR=1
  fi
else
  echo "OSV offline lockfile scan: skipped/unverified; osv-scanner is unavailable."
fi

if [ "$TOOL_ERROR" -ne 0 ]; then
  echo "Local security status: tool or report error (exit 2)."
  exit 2
elif [ "$FINDINGS" -ne 0 ]; then
  echo "Local security status: findings detected (exit 1)."
  exit 1
fi
echo "Local security status: clean for completed scans (exit 0)."
exit 0