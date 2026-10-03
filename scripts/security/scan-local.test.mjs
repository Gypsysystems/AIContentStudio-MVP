import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const scanner = path.join(root, 'scripts/security/scan-local.sh')
const fixtureRules = [
  'hardcoded-private-credential',
  'sensitive-logging',
  'dynamic-code-execution',
  'tls-validation-disabled',
  'cleartext-fetch',
  'fetch-user-controlled-url',
  'path-from-request',
  'request-controlled-authorization',
  'url-embedded-credentials',
]

const json = (results, scanned = []) => JSON.stringify({ results, paths: { scanned } })
const semgrepFinding = {
  check_id: 'scripts.security.local-security.hardcoded-private-credential',
  path: 'src/sample.ts',
  start: { line: 7 },
}

const semgrepStub = `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  echo "semgrep 1.0.0-test"
  exit 0
fi
STUB_DIR=$(dirname "$0")
case "$*" in
  *positive.js*) cat "$STUB_DIR/positive.json"; exit 0 ;;
  *negative.js*) cat "$STUB_DIR/negative.json"; exit 0 ;;
esac
mode=$(cat "$STUB_DIR/semgrep-mode")
case "$mode" in
  clean) cat "$STUB_DIR/app.json"; exit 0 ;;
  finding) cat "$STUB_DIR/app-finding.json"; exit 0 ;;
  malformed) printf '{"results":'; exit 0 ;;
  execution-failure) echo "synthetic scanner failure" >&2; exit 23 ;;
  *) exit 24 ;;
esac
`

const osvStub = `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  echo "osv-scanner version: 2.0.0-test"
  exit 0
fi
STUB_DIR=$(dirname "$0")
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    output=$2
    shift 2
  else
    shift
  fi
done
mode=$(cat "$STUB_DIR/osv-mode")
case "$mode" in
  clean) cat "$STUB_DIR/osv-clean.json" > "$output"; exit 0 ;;
  finding) cat "$STUB_DIR/osv-finding.json" > "$output"; exit 1 ;;
  missing-cache) cat "$STUB_DIR/osv-clean.json" > "$output"; echo "No usable cached vulnerability database in offline mode" >&2; exit 127 ;;
  malformed) printf '{broken' > "$output"; exit 0 ;;
  execution-failure) echo "synthetic scanner failure" >&2; exit 23 ;;
  *) exit 24 ;;
esac
`

async function runScenario({ semgrepMode = 'clean', osvMode = 'clean' } = {}) {
  const tempRoot = await mkdtemp('/tmp/local-security-regression.')
  const bin = path.join(tempRoot, 'bin')
  await mkdir(bin)
  const semgrepPath = path.join(bin, 'semgrep')
  const osvPath = path.join(bin, 'osv-scanner')
  const fixtureResults = fixtureRules.map((rule) => ({
    check_id: `scripts.security.local-security.${rule}`,
    path: 'scripts/security/fixtures/positive.js',
    start: { line: 1 },
  }))
  const files = [
    ['semgrep', semgrepStub],
    ['osv-scanner', osvStub],
    ['semgrep-mode', semgrepMode],
    ['osv-mode', osvMode],
    ['positive.json', json(fixtureResults, ['scripts/security/fixtures/positive.js'])],
    ['negative.json', json([], ['scripts/security/fixtures/negative.js'])],
    ['app.json', json([], ['src/sample.ts'])],
    ['app-finding.json', json([semgrepFinding], ['src/sample.ts'])],
    ['osv-clean.json', JSON.stringify({ results: [] })],
    ['osv-finding.json', JSON.stringify({
      results: [{ packages: [{ vulnerabilities: [{ id: 'SYNTHETIC-TEST-ID' }] }] }],
    })],
  ]
  await Promise.all(files.map(([name, contents]) => writeFile(path.join(bin, name), contents)))
  await Promise.all([chmod(semgrepPath, 0o755), chmod(osvPath, 0o755)])
  const safePath = [
    bin,
    path.dirname(process.execPath),
    '/usr/bin',
    '/bin',
  ].join(path.delimiter)
  try {
    const result = spawnSync('/bin/sh', [scanner], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: safePath },
      timeout: 30_000,
    })
    return { result, tempRoot }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}

async function withScenario(options, verify) {
  const { result, tempRoot } = await runScenario(options)
  try {
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    await verify(result)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

test('local security scanner returns 0 for clean completed scans', async () => {
  await withScenario({}, (result) => {
    assert.equal(result.status, 0, result.stdout)
    assert.match(result.stdout, /Fixture checks: 9 positive findings across 9 rules; 0 negative findings\./)
    assert.match(result.stdout, /Application scan: 1 files scanned; 0 findings across 0 rules\./)
    assert.match(result.stdout, /OSV offline lockfile scan: completed; 0 vulnerability records\./)
    assert.match(result.stdout, /Local security status: clean for completed scans \(exit 0\)\./)
  })
})

test('application findings return 1 after the optional OSV scan completes', async () => {
  await withScenario({ semgrepMode: 'finding' }, (result) => {
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stdout, /Finding: src\/sample\.ts:7 local-security\.hardcoded-private-credential/)
    assert.match(result.stdout, /OSV offline lockfile scan: completed; 0 vulnerability records\./)
    assert.match(result.stdout, /Local security status: findings detected \(exit 1\)\./)
  })
})

test('OSV vulnerability reports return 1 even when the scanner exits 1', async () => {
  await withScenario({ osvMode: 'finding' }, (result) => {
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stdout, /OSV offline lockfile scan: completed; 1 vulnerability records\./)
    assert.match(result.stdout, /Local security status: findings detected \(exit 1\)\./)
    assert.doesNotMatch(result.stdout, /SYNTHETIC-TEST-ID/)
  })
})

test('missing offline cache is explicitly unverified without becoming a false clean', async () => {
  await withScenario({ osvMode: 'missing-cache' }, (result) => {
    assert.equal(result.status, 0, result.stdout)
    assert.match(result.stdout, /OSV offline lockfile scan: skipped\/unverified; no usable cached vulnerability database\./)
    assert.match(result.stdout, /Local security status: clean for completed scans \(exit 0\)\./)
  })
})

test('malformed Semgrep reports return 2 without exposing diagnostics', async () => {
  await withScenario({ semgrepMode: 'malformed' }, (result) => {
    assert.equal(result.status, 2, result.stdout)
    assert.match(result.stdout, /Semgrep report invalid; details withheld\./)
    assert.match(result.stdout, /Local security status: tool or report error \(exit 2\)\./)
  })
})

test('Semgrep execution failures return 2 without exposing diagnostics', async () => {
  await withScenario({ semgrepMode: 'execution-failure' }, (result) => {
    assert.equal(result.status, 2, result.stdout)
    assert.match(result.stdout, /Semgrep execution failed; diagnostics withheld\./)
    assert.match(result.stdout, /Local security status: tool or report error \(exit 2\)\./)
  })
})

test('malformed OSV reports return 2 without exposing diagnostics', async () => {
  await withScenario({ osvMode: 'malformed' }, (result) => {
    assert.equal(result.status, 2, result.stdout)
    assert.match(result.stdout, /OSV report invalid; details withheld\./)
    assert.match(result.stdout, /Local security status: tool or report error \(exit 2\)\./)
  })
})

test('OSV execution failures return 2 without exposing diagnostics', async () => {
  await withScenario({ osvMode: 'execution-failure' }, (result) => {
    assert.equal(result.status, 2, result.stdout)
    assert.match(result.stdout, /OSV offline scan failed or produced no report; diagnostics withheld\./)
    assert.match(result.stdout, /Local security status: tool or report error \(exit 2\)\./)
  })
})
