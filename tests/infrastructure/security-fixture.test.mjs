import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import test from "node:test"

const positivePath = "scripts/security/fixtures/positive.js"
const negativePath = "scripts/security/fixtures/negative.js"
const expected = [
  "hardcoded-private-credential", "sensitive-logging", "dynamic-code-execution",
  "tls-validation-disabled", "cleartext-fetch", "fetch-user-controlled-url",
  "path-from-request", "request-controlled-authorization", "url-embedded-credentials",
]

test("positive credential example is explicitly synthetic and not a provider credential", () => {
  const source = readFileSync(positivePath, "utf8")
  assert.match(source, /Synthetic-only fixtures/)
  assert.match(source, /const supabaseServiceRoleKey = "SyntheticFixtureNotAProviderCredential"/)
})

test("tracked fixtures contain no contiguous common provider-secret token", () => {
  const patterns = [
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/,
    /\bxox[baprs]-[A-Za-z0-9-]{15,}/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bAIza[A-Za-z0-9_-]{30,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
    /\bsk-ant-[A-Za-z0-9_-]{20,}/,
    /\bsb_secret_[A-Za-z0-9_-]{20,}/,
  ]
  for (const path of [positivePath, negativePath]) {
    const source = readFileSync(path, "utf8")
    for (const pattern of patterns) {
      assert.equal(pattern.test(source), false, `${path}: provider-secret shape detected; value withheld`)
    }
  }
})

test("real offline Semgrep detects all nine positives and no negatives", () => {
  const reports = [positivePath, negativePath].map(path => {
    const result = spawnSync("semgrep", [
      "scan", "--metrics=off", "--disable-version-check", "--quiet", "--json",
      "--config", "scripts/security/local-rules.yml", path,
    ], {
      encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, SEMGREP_SEND_METRICS: "off", SEMGREP_ENABLE_VERSION_CHECK: "0" },
    })
    assert.equal(result.status, 0, "Local Semgrep unavailable or failed; diagnostic contents withheld")
    const report = JSON.parse(result.stdout)
    assert.equal(report.errors?.length ?? 0, 0)
    return report
  })
  const rules = reports[0].results.map(item => item.check_id.split("local-security.")[1])
  assert.deepEqual(new Set(rules), new Set(expected))
  assert.equal(rules.length, 9)
  assert.equal(reports[1].results.length, 0)
})