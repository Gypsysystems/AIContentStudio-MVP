# Final private-beta readiness

## Scope and evidence boundary

This is the single final-open-items readiness report. The batch starts from synchronized commit `e0ba91eb4acd5bf1dbe61ecd096715613adb6ddc`.

The prior automated baseline is **546 passing tests / 89 files**, a passing production build, and two TypeScript diagnostics at `src/contentExplorerModel.ts:566`. Its clean serial sweep does not prove parallel timing reliability or authenticated cloud readiness.

No secret values are inspected or disclosed. No authentication bypass, production permission change, cloud migration, live provider credential change, or publication is authorized by this batch. Local fixtures and disposable PostgreSQL are not evidence of real Supabase/RLS/Storage/provider behavior.

**Decision: authenticated private-beta acceptance has not yet passed. Full rollout and private-beta approval remain withheld.**

Automated readiness has passed. The app is technically ready to begin controlled, normally signed-in real-cloud acceptance in an approved isolated environment, subject to Section B's prerequisites. This is not approval to publish, invite beta users, or claim that the remote authorization/storage/provider environment is verified.

## A. Complete / verified automated

### Changes and preservation review

- **TypeScript:** explicitly type the media-category order map as `Map<string, number>`. Runtime sorting is unchanged; the existing hydration test now asserts the exact fixed category order.
- **Storage hardening (moderate finding):** validate backend-returned object paths against the exact bucket/workspace/project/stage/checkpoint/file identity before reads, copies or deletion; reject traversal/mismatched metadata and encode individual URL segments. Regression coverage retains existing conflict and cleanup assertions.
- **Error/draft sanitation (low–moderate findings):** replace raw cloud database/provider error details with stable safe messages/codes. Topic/Rewrite draft guidance now uses the same sensitive-variable/brand-name filters as the provider packet.
- **Configuration validation (low finding):** malformed JWT-shaped public keys fail closed. Supported opaque/publishable keys remain supported; legacy JWT shape requires canonical segments, object header/payload, a recognized signing algorithm and the public `anon` role. This is configuration-shape validation, not a substitute for Supabase signature/session verification.
- **Worker operations:** structured allowlisted events contain only safe categories, validated IDs, revisions and timestamps, never raw error/provider/source/connection contents. Startup, poll, liveness, lease, failure-transition and actual persisted finish outcomes are observable. Repeated failure logging is bounded; unavailable log sinks cannot change job behavior. Retry classification, idempotency, lease tokens and fencing remain unchanged.
- **Test infrastructure:** each invocation owns a strict-port loopback server and isolated reports/artifacts. Worker configuration reloads inherit the same invocation UUID/port. A test-only Vite wrapper preserves the base app/API plugins while disabling file watching and HMR so report edits cannot reload in-progress journeys; normal development is unchanged. Disposable PostgreSQL uses a private Unix socket with TCP disabled, selected client binaries, sanitized libpq routing and signal/exit cleanup. Requested SQL execution now fails instead of silently skipping when setup is unavailable.
- **Dependency patches:** lockfile selects Vite **8.0.16**, PostCSS **8.5.28**, NanoID **3.3.19**, and jsPDF-scoped DOMPurify **3.4.16**. No major package replacement or product redesign.

A second preservation/security review passed after correcting checkpoint fixtures, malformed JWT configuration checks, finish-outcome logging, inherited worker ports and SQL preflight behavior. No migration, grant, RLS, production-role, secret-value or publishing changes were made.

### Verification

| Gate | Result |
| --- | --- |
| Full consolidated suite | **561 passed / 90 files; 0 failed, 0 skipped, 0 retries**, one worker, both disposable SQL opt-ins executed; prior baseline 546 / 89 |
| Focused changed-area suites | **85 passed, 0 failed, 0 skipped, 0 retries** |
| Infrastructure helper tests | **7 passed, 0 failed, 0 skipped** |
| Affected persistence/navigation checks | **18 unchanged product tests passed** after isolation; separate browser Markdown-write isolation proof **1/1 passed** |
| Representative parallel stress | Final acceptance configuration: **30/30 executions passed**, two workers, two repeats, zero retries |
| Concurrent independent-run smoke | Final acceptance configuration: **2/2 executions passed**, launched while the stress runner was active, zero retries |
| TypeScript | **Exit 0; zero diagnostics**, versus two baseline diagnostics |
| Production build | **Exit 0; passed** |
| Local dependency audit | **Zero critical/high/moderate/low/info advisories**, versus six high, three moderate and one low before the patch |
| Application startup | Existing managed workflow restarted successfully on Vite 8.0.16 |
| Development worker startup | Existing managed workflow restarted and emitted the allowlisted `worker.started` event; no live test job was enqueued |
| Static/privacy scanner services | Three scanner callbacks failed; **no scanner-based clearance claimed** |
| Disposable PostgreSQL cleanup | No owned temporary PostgreSQL master remains after the completed runs |

Commands: `pnpm test:infra`; focused Playwright suites with `--workers=1 --retries=0`; representative stress with `--workers=2 --repeat-each=2 --retries=0`; `pnpm exec tsc --noEmit`; `pnpm build`; `pnpm audit --json`; and `pnpm test:consolidated -- --reporter=line,json`. The consolidated helper owns its disposable database, forbids filtering the full run, and forces one worker/no retries.

The first infrastructure-focused invocation had 66 passing and five connection-refused browser failures because worker configuration reloads recalculated the server port. That defect was corrected before the 85-test passing focused run. An initial consolidated-command attempt rejected pnpm's `--` separator before starting tests; the helper now handles that separator. Neither incident was hidden by assertion changes, retries or timeout increases.

The initial complete serial sweep recorded **558 passed, 3 failed, 0 skipped, 0 retries**. It failed the AI Control Center publication-toast check during an unexpected navigation, an Author Rewrite explicit reload with `ERR_ABORTED`, and Author source-selection persistence after reload. All three windows coincided with report/memory Markdown edits. A controlled diagnostic then observed a Vite `full-reload` WebSocket event and immediate main-frame navigation when the readiness Markdown was saved. The acceptance server now disables watching/HMR without changing app/API behavior, product assertions, timeouts or retries. All 561 tests then passed in a fresh complete serial run.

The first isolation-focused run passed all 18 affected product tests but failed a newly introduced infrastructure assumption that disabled HMR meant no WebSocket transport. Vite still opens its native transport. The corrected regression permits transport while strictly rejecting `update`/`full-reload` frames and extra main-frame navigation after an exclusively created/cleaned synthetic Markdown sentinel. Its standalone proof, full-suite invocation, repeated parallel invocation and concurrent second runner all passed. Earlier failed outcomes remain recorded above rather than being counted as clean.

The running normal app renders the expected signed-out sign-in screen. An anonymous proxied-browser check confirmed only expected `401` responses from `/api/auth/session` and `/api/auth/refresh`, zero uncaught page errors and zero failed network requests. This is startup/auth-denial evidence, not authenticated cloud acceptance.

## B. Prepared, but requires user signed-in cloud validation

### Prerequisites and environment checklist

- Choose an isolated non-production Supabase environment/workspace and disposable projects. Do not use customer/private source files.
- Use existing authorized owner/editor/viewer accounts through normal sign-in. Missing membership must be provisioned by an authorized administrator; do not self-promote or weaken policies.
- An authorized administrator confirms the actual schema/RPC versions, grants, RLS, private Storage bucket/policies, and narrow worker/connection-reader roles. Repository SQL files are not proof that the remote environment matches.
- Configure required values only through the approved environment/Secrets interface. Never paste their values into chat, screenshots, reports, logs, or test artifacts.
- Confirm application configuration includes Supabase URL/public key, session signing configuration, and the exact approved app origin. Development and published origins/configuration must not be assumed interchangeable.
- Confirm the approved AI connection database/TLS/encryption configuration, ready workspace-bound published workflows, exact dependency versions, and the provider/model selected for TOC, Topic, and Rewrite.
- Approve a small bounded number of live provider calls and disposable project/file writes.
- Confirm the worker uses its intended narrow database identity and the same approved environment as the application. Observe fresh persisted heartbeat evidence; process existence alone is insufficient.
- For publication, approve app hosting, persistent-worker hosting, privacy/access restrictions, invitees, resource limits, and rollback/incident ownership. Static assets alone cannot serve authenticated APIs or run a persistent worker.
- Keep loopback-only local test mode out of staging/production. Publishing privacy is an additional gate, not a replacement for application authorization/RLS.
- No active publication was present during the preflight. Obtain any eventual published URL from actual deployment metadata, never from the development domain or a guessed name.

| Configuration name | Approved environment expectation; never share its value |
| --- | --- |
| `NODE_ENV` | Set to `production` for a published staging/private-beta runtime so production validation applies. |
| `LOCAL_DEV_AUTH` | Unset/disabled outside explicitly private loopback tests; never use it to authenticate hosted acceptance. |
| `SUPABASE_URL` | HTTPS endpoint for the selected isolated project. |
| `SUPABASE_ANON_KEY` | Supported public anon/publishable configuration, not a service-role/secret key. |
| `SESSION_SECRET` | Strong session-signing configuration meeting the runtime validator. |
| `APP_ORIGIN` | Exact approved HTTPS application origin, confirmed against deployment metadata after authorized publication. |
| `AI_CONNECTION_DATABASE_URL` | Approved narrow connection-reader database identity and supported TLS configuration. |
| `AI_CONNECTION_DATABASE_CA` | Approved CA when required by the database certificate configuration; do not disable certificate validation. |
| `AI_CONNECTION_ENCRYPTION_KEY` | Approved encryption/signing configuration matching the intended connection records. |
| `GENERATE_TOPIC_WORKER_DATABASE_URL` | Intended narrow worker identity for the same approved environment, not an administrator/service-role substitute. |
| App/worker run commands | Validate the chosen host runs the auth/cloud API middleware plus built UI, and separately supervises the persistent worker. `pnpm preview` installs auth/cloud handlers; the legacy `/api/project-access` bridge intentionally remains unavailable there. |

### Synthetic source

Create `beta-access-check.md` locally with only:

```markdown
# Account access

Administrators review privileged access every quarter.

Users request access through the service desk.
```

Use unique disposable project names A and B. Record only non-secret test labels, safe project/topic/job IDs, timestamps, status/error codes, and redacted screenshots. Do not record cookies, authorization headers, signed download URLs, connection configuration values, or provider payloads containing private material.

### Exact signed-in actions and expected results

| Check | Short action | Required expected result |
| --- | --- | --- |
| Supabase session persistence | Sign in normally to the intended workspace; create A, reload, then sign out/in and reopen A. | Verified membership remains correct; A and its saved content persist; signed-out access fails safely. |
| Editor/viewer permissions | In separately authorized editor/viewer sessions, open the disposable project and exercise available edit controls. Inspect the normal request result when a mutation is attempted. | Editor changes persist; viewer is read-only and any issued mutation is server-denied, with no changed revision/content. Disabled UI alone does not prove server denial. If no request is issued, record server-denial verification as pending for an approved in-session negative check. |
| Workspace/project isolation | With a separately authorized other-workspace session, attempt normal access to the disposable project's approved test identifier. | Access is denied/not found without disclosing source/content; membership in one workspace does not authorize another. If a second workspace/session is unavailable, this check remains unverified. |
| Private Storage | Upload the synthetic Markdown in A, wait for extraction/save, reload, then use the normal authorized download/open control. Check denial from the other authorized workspace/session. Delete only the disposable file after dependent tests are finished. | Exact source bytes survive; authorized access works; unauthorized access fails; deletion removes access and does not affect B or unrelated files. A public-looking or signed URL alone is not proof of private policy enforcement. |
| Live Generate TOC | Analyze A's source, select the ready TOC workflow, generate, inspect evidence/provenance, then explicitly accept and reload. | A real provider result is evidenced; the proposal is separate from committed structure until consent; supported titles/evidence and stable committed identities survive reload. |
| Live Generate Topic | Select a supported committed topic, refresh grounding as needed, then use the ready Topic workflow. | A real proposal references A's actual source evidence, workflow/model and input revisions; authored blocks do not change merely by receiving/viewing it. |
| Provenance + explicit Apply | Inspect proposal evidence/configuration/revisions; apply using the review/confirmation control, then reload. | Only explicitly accepted content is applied; stable topic identity, separate provenance and persisted content agree. Readiness flags are not evidence of execution. |
| Live Rewrite | Add an identifiable manual paragraph and protect/approve a block. Generate a rewrite and select only eligible changes before confirming. | Real diff is reviewable; no automatic rewrite occurs; manual/protected/approved content stays intact and selected changes persist. |
| Live heartbeat | Observe authorized worker/database status over multiple normal heartbeat intervals in the approved environment. | Timestamp advances and is fresh under the actual readiness contract. A dev workflow process, startup success or cached “ready” flag is insufficient. |
| Async queue → running → completed | Queue one supported Topic job, observe its safe ID/status, and inspect the completed draft. | Same project/topic/job reaches an actual persisted completed result from the provider. Unexpected failures have a safe, traceable code; no automatic apply occurs. |
| Async reload/recovery | Reload while queued/running and after completion; reopen the same topic/job and apply once explicitly. | Same job/draft is recovered; no duplicate enqueue, completion application or lost manual content. Controlled retry/failure testing is limited to an approved disposable sandbox. |
| Cross-project reuse/lineage | In B, preview A's exact reusable version, copy explicitly, then reload both projects. | Preview is read-only; A is unchanged; B has new destination identities, exact copied content and origin/version lineage; B-only settings/content persist. |
| Copy conflict in second tab | Open B in two authorized tabs. Save a deliberate change in tab 2, then attempt the prepared copy in stale tab 1. | Conflict is visible; remote changes and later local edits are preserved; no silent overwrite or duplicate copy occurs. |
| Stale proposal/apply | Generate a proposal in tab 1; change relevant source/content/configuration or revision in tab 2, then attempt apply in tab 1. | Stale apply is rejected or requires explicit valid recovery consent; manual/protected content remains intact. Refreshing grounding alone must not make stale generated content “fresh.” |
| Review → Publish | Use an enabled, enforceable rule to create a controlled required finding; run Review, inspect evidence/Author navigation, resolve explicitly, then publish. | Required open findings block publishing; applicable explicit decisions unblock it. A Review decision is not an implicit text rewrite. If no required rule exists, report that configuration gap rather than claiming the gate was tested. |
| HTML/Word/PDF files | Generate each format from the complete committed disposable project; download and open each file. | All intended topics, source-derived content, accepted/manual edits, styles and media are present. Verify file contents, not just download buttons or HTTP success. |
| Conditional-content safety | Add clearly distinguishable audience-specific synthetic text; choose each supported audience and inspect actual downloaded files. Test an unsupported/ambiguous case. | No unintended audience text leaks. Unsupported or ambiguous export paths fail closed; inspect Word/PDF behavior separately from HTML. |
| Published desktop/narrow browser | After approved publication, repeat the core journey at desktop and narrow widths; use keyboard, menus/drawers, Back, project switching and reload. | No blank/blocked screens, scope leakage, lost edits, inaccessible controls, unexpected browser errors or unhandled network failures. Deliberately asserted conflicts/unauthenticated responses are distinguished from unexpected failures. |
| Private-beta go/no-go | Gather the evidence below and review residual risks with the release owner. | An explicit bounded beta decision is recorded; full rollout is not inferred from automated checks or a successful publication. |

If a step fails, capture only a safe code/ID/timestamp and redacted screenshot. Stop dependent steps rather than pretending readiness or switching to mock sessions. Use approved normal monitoring to investigate; do not share raw headers, cookies, database/provider responses, or secret-bearing URLs.

### Dependency order

Approved target/roles/configuration → real session → authorization/RLS → private Storage → extracted source → live TOC/committed topics → live Topic/provenance/explicit Apply → Rewrite.

Worker readiness + supported topic + ready published workflow → real async completion → reload/recovery.

Persisted A/B + authorized sessions → reuse/lineage/isolation/conflicts → multi-tab stale/revision checks → Review gates → actual exports → conditional-content checks.

Approved publication + the above evidence → desktop/narrow-browser acceptance + operational evidence → explicit beta/rollout decision.

## C. Gated changes requiring explicit approval

- Any missing/incorrect remote schema, RPC, RLS, bucket policy, grant, role or membership provisioning: document the exact proposed change for an authorized administrator. Do not apply it automatically.
- Any live provider credential/connection change, production secret/configuration change, additional privilege, external access mechanism, or resource-cost increase.
- Creating or publishing a staging/private-beta environment, selecting persistent worker hosting, inviting beta users, or changing publishing visibility.
- Controlled live failure/retry/security-negative tests with consequential writes or broader access than the approved disposable sandbox.
- Full rollout approval requires real authenticated evidence and release-owner authorization.

## D. Deferred / optional

- Parallel timing reliability is separate from serial functional acceptance. Retain any stress failures and their exact scope; do not remove assertions, hide failures with retries, or raise global timeouts to call the suite clean.
- Scanner/service unavailability must be reported as unverified, not “no findings.” A manual review or dependency audit is not a substitute for unavailable static/privacy scanning.

## Final go/no-go evidence checklist

- [ ] Approved isolated target and legitimate role/workspace sessions.
- [ ] Actual schema/RLS/Storage and least-privilege configuration confirmed.
- [ ] Session persistence, authorized/denied paths and private file access passed.
- [ ] Real TOC/Topic/Rewrite and separate provenance/explicit Apply passed.
- [ ] Fresh heartbeat, actual persisted completion and async recovery passed.
- [ ] Reuse/lineage/isolation/conflicts and multi-tab stale protection passed.
- [ ] Required Review gate and actual complete HTML/Word/PDF outputs passed.
- [ ] Conditional disclosure checks passed for supported and rejected cases.
- [ ] Published desktop/narrow-browser and safe operational evidence passed.
- [x] Automated regression/build/TypeScript results are current for this batch.
- [ ] Security scan/review limitations and residual findings are accepted explicitly.
- [ ] Incident/rollback owner, bounded beta audience and resource limits agreed.
- [ ] Release owner explicitly approves private beta; full rollout separately approved.