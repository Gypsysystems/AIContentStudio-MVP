# Final local-only cleanup

## Scope and baseline

This batch starts from synchronized `6b9201eefe9375b377404ee92a0211c3302077f4`.
It is limited to local fixtures, test infrastructure diagnosis, offline checks,
readiness documentation, build/audit validation and anonymous startup smoke.
No signed-in cloud validation, provider execution, remote database writes,
schema/grant/policy changes, publication or invitations are part of this batch.
The development Topic worker was stopped and remains stopped.

This report supersedes historical Git/startup status in
[Final private-beta readiness](final-private-beta-readiness.md), without erasing
the prior failed-run evidence. Git synchronization is not beta approval.

## Sanitized scanner fixture

The previously synchronized fragment-constructed example avoided a contiguous
Stripe-shaped key, but real Semgrep detected only **7 of 9** intended positive
rules: the generic literal-credential rule and the line-oriented logging rule
were no longer exercised. Negative detection remained zero.

The fixture now uses an explicit, non-provider-shaped synthetic literal and
restores the single-line logging example. No scanner rule or application
behavior changed. The new fixture regression checks synthetic intent, absence
of nine common contiguous provider-secret shapes, all nine actual positive
Semgrep detections and zero negative detections. It never executes the unsafe
fixture or logs credential values.

- Fixture plus scanner helper tests: **11 passed**, zero failed/skipped/cancelled.
- Real fixture scan: **9 detections / 9 expected rules**, zero negative findings.
- Initial infrastructure/security helpers: **29 passed**.
- Final helpers including loader-path regressions: **31 passed**, zero failed/skipped/cancelled.

Local provider-shape checks are not a guarantee of equivalence to GitHub's
complete push-protection detector set. The URL-credential examples are
explicitly synthetic scanner/test cases, not production connection settings.

## Parallel loader investigation

The historical two-worker failures occurred before test execution with
duration zero and worker index -1. Their native load-hook error named neither
a module nor a hook. Cache isolation had not resolved them.

Current runtime: Node **22.22.0**, Playwright **1.63.0**. This Playwright
installation selects Node's synchronous `registerHooks` loader by default;
Node's non-builtin load-result validation rejects null source. That matches
the error category, but is not proof of which module or race caused the old
failures.

A diagnostic-only pass-through wrapper preserved hook arguments and results
and recorded file paths if a null source was returned. The full diagnostic
sweep passed **566 browser tests / 90 files** and **2 SQL tests / 2 files**,
with zero skips, flaky results or retries. It recorded no null-source event.
A native CommonJS/import overlap probe and forty Playwright-mediated repeated
imports also passed. Earlier exploratory calls failed on a non-exported
package path and a non-exported helper before the corrected probe ran; they
are not counted as successful loader reproductions.

The first uninstrumented full sweep then reproduced the error in
`publish-projection.spec.ts`, on "exports every committed topic in TOC order,
with its stable ID and master reference": **565 browser passed / 1 failed**,
duration zero / worker index -1; both SQL cases passed. Evidence:
`.playwright/runs/e2e/afc93800-4444-4a01-92c4-9c35c4f9f41c/evidence.json`.
The second default-loader sweep was deliberately stopped to apply the scoped
compatibility mitigation; its partial log/evidence is retained and is not
counted as a passing or complete gate. The pre-mitigation serial run passed
**568 / 91 files**, but is not substituted for post-mitigation validation.

The installed Playwright explicitly provides `PLAYWRIGHT_FORCE_ASYNC_LOADER`.
Owned parallel and disposable SQL/serial runners now set it to **1** before
starting Playwright. This uses the existing asynchronous `module.register`
path instead of Node 22's synchronous `registerHooks` source validator.
It is a test-runner compatibility mitigation, not a change to application
Node options, Vite, import graphs, dependencies or product behavior.
Assertions, global timeouts and retries remain unchanged.

New regressions verify that owned runners pin the fallback without modifying
ambient `NODE_OPTIONS`, and that actual installed Playwright registers exactly
one asynchronous loader, no synchronous loader, and successfully imports the
real TypeScript publish projection. The original failing module/race remains
unidentified; no JSZip or provider-library cause is asserted. Both final full
uninstrumented two-worker gates passed under this compatibility setting.
This clears the current gate for this runtime/settings combination, not
universal runtime determinism or a claim that the original race was explained.

## Offline and static checks

- TypeScript and production build: **exit 0**.
- Dependency audit: **0 critical/high/moderate/low/info advisories**.
- Local Semgrep: **98 application files / 0 findings**.
- Explicit expanded-size App scan: **1 file / 0 findings / 0 errors**.
- OSV Scanner **2.3.3**, strictly offline, no resolution or call analysis:
  parsed **193 packages**, exit **127**, with
  `no offline version of the OSV database is available` for npm.
  **Unverified**, not clean.
- Managed static/security/privacy clearance remains unavailable and unverified.
  No managed scanner or live-cloud check was run in this batch.

## Warnings, artifacts and startup

The prior import/chunk-size warning analysis found no obvious low-risk bundle
split. Its projectService, JSZip, PDF.js and load-order boundaries are unchanged.
No warning limit was raised and no warning was suppressed. Bundle architecture
remains optional/deferred. The current build passes.

Old JSON/HTML reports, traces, failure evidence and compiler caches remain
untouched. New durable evidence is under ignored
`.playwright/final-independent/`; no failed-run history was deleted.

The application workflow was restarted once for current anonymous smoke.
The screenshot shows the expected signed-out screen. Proxied requests with
the correct method and Origin returned root **200**, session **401**, refresh
**401**. Earlier curl probes without the correct method/Origin returned **405**
and **403**; those were diagnostic request errors, not passing auth checks.
The browser capture showed only expected authentication-denial resource errors.
These checks prove startup and anonymous denial only, not signed-in behavior.
The Topic worker is stopped; no provider job was enqueued.

## Git and final gate status

All final post-mitigation gates below completed successfully.

| Gate | Final result |
| --- | --- |
| Full serial / disposable PostgreSQL | **568 passed / 91 files**; zero failed/skipped/flaky/retried; both SQL integration cases executed |
| Full two-worker sweep 1 | **566 browser / 90 files + 2 SQL / 2 files**, all passed; zero skipped/flaky/retried |
| Full two-worker sweep 2 | **566 browser / 90 files + 2 SQL / 2 files**, all passed; zero skipped/flaky/retried |
| Repeated full publishing suite | **33 passed**, two workers, three repeats, zero failures/skips/flaky/retries |
| Infrastructure/security helpers | **31 passed**, zero failed/skipped/cancelled |
| TypeScript / production build | **exit 0 / exit 0** |
| Dependency audit | **exit 0**, zero advisories at every reported severity |
| Local Semgrep / expanded App scan | **98 files / 0 findings**, plus **1 App file / 0 findings / 0 errors** |
| Strictly offline OSV | **exit 127 / unverified**: 193 parsed packages but no npm advisory database |
| Managed scanner clearance | **Unverified**; no successful managed clearance obtained |
| Startup | App running, signed-out screenshot, proxied root 200 / session 401 / refresh 401; worker stopped |

Full parallel evidence:

- `.playwright/runs/e2e/360c193b-6ec9-47b7-acaf-a49708a4385f/evidence.json`
- `.playwright/runs/e2e/4e1bf22d-64fc-4764-b589-ff1ff1ebb4b7/evidence.json`

Both record `inputChangedDuringRun: false`, with the same SHA-256 input
fingerprint `5a0a0bd4065f7307de7c711d2b3e64f9e8123b63657b3ecbb75b96e1e7257ca5`
across **298 files**. The final serial completion fingerprint matches it.
Serial JSON is `.playwright/final-independent/gates/async-serial.json`;
other completed gates use distinct `async-*` logs/reports/exit markers there.
Pre-mitigation and interrupted logs remain separate and unmodified.

The baseline was verified synchronized before work began. CLI push preflight
fails authentication (`Invalid username or token`); integration
inventory exposes GitHub only as an unconnected connector. Git synchronization
therefore requires authorization recovery before any claim that the subsequent
cleanup commit matches local HEAD, origin/main and live GitHub main.

The final completion response and `.playwright/final-independent/gates/git-verification.json`
record the exact local commit, working-tree state, push attempt and whether
the live remote identity was verifiable. No synchronization equality is claimed
while authentication is blocked. A commit cannot embed its own SHA without
changing that SHA; the final identity belongs in the Git verification evidence
and completion response.

## Remaining external gates

### Requires signed-in/live assistance

- Approved isolated target with real owner/editor/viewer and other-workspace
  sessions; session persistence, server-denied mutations and isolation.
- Private source Storage upload/download/reload/deletion using synthetic data.
- Live TOC/Topic/Rewrite, separate provenance, explicit Apply and preservation
  of manual/protected/approved content.
- Fresh persisted heartbeat, real async completion, reload/recovery and
  idempotent explicit application.
- Cross-project lineage, two-tab copy conflicts and stale-proposal protection.
- Required Review blocking/decisions, complete actual HTML/Word/PDF outputs
  and audience/conditional disclosure checks.
- Administrator confirmation of actual schema/RPC/grants/RLS/private Storage,
  narrow identities and operational suitability of the separately observed
  pooler backend transport.
- GitHub authorization recovery if the CLI/connector remains unavailable.

### Requires explicit consequential approval

- Bounded live provider calls and disposable cloud writes.
- Remote schema/RPC/role/grant/RLS/Storage policy or membership provisioning.
- Credentials/configuration, additional privileges or resource/cost increases.
- Consequential negative/failure/retry tests outside an approved sandbox.
- App/worker hosting, publication/visibility, invitations, operational owners,
  resource limits, residual-risk acceptance and explicit beta/rollout approval.

### Deferred or optional

- Optional bundle splitting/initial-download reduction.
- Historical native-loader root cause if it remains non-reproducible.
- OSV and managed scanner clearance until their required resources are usable.
  Unavailable scanner clearance is not automatically an accepted release risk.