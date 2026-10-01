# Consolidated Acceptance & Quality

## Scope and evidence boundary

Original acceptance batch starting commit: `c96118c1f1109934bfeec584eee0e292215a4db3`.

Focused cleanup starting synchronized commit: `e1b6b9d1e8751207cfc84547456fa8720f3ae706`.

This batch exercises Sources → Structure → Author → Review → Publish, grounded TOC/Topic/Rewrite, background Topic jobs, cross-project reuse, reload/recovery, provenance/revision/staleness, and browser/startup readiness.

Automated evidence uses the existing loopback local-development test mode, browser-only mock-cloud fixtures, provider mocks, and a disposable socket-only PostgreSQL cluster. It does **not** establish real Supabase authentication, private Storage/RLS behavior, a real provider round-trip, live worker heartbeat freshness, or production rollout readiness.

No authentication bypass, production test credential, security-model change, or secret inspection was introduced. No cloud database migrations or production writes were made.

## Changes

- Added a real local-browser Markdown → reviewed TOC → Author → Review → Preview → HTML/Word/PDF download journey. It checks source bytes, explicit TOC consent, persisted reload state, and actual contents of all downloaded formats.
- Added a browser-only mock-cloud two-project reuse journey. It checks read-only preview, explicit copy, exact-version lineage, source preservation, project isolation, reload, and a narrowly expected revision-conflict response.
- Updated obsolete current-schema fixtures and navigation assumptions without removing legacy/malformed/digest, permission, stale-Apply, protected/manual-content, or conflict checks.
- Strengthened passive-hydration tests: compare the complete stored record and revision after the autosave debounce, then verify that a deliberate edit persists.
- Fixed one product status-display defect: an unsupported initial topic now says **Needs Grounding**, and stale applied generated content says **Generated stale**, even when its separate grounding context has been refreshed. Generation, apply, worker, authentication, and persistence behavior are unchanged.

### Focused cleanup

Both remaining original blockers were **test-fixture/navigation updates**, not product fixes. No product, backend, authentication, cloud-security, or context-aware navigation code changed in this cleanup.

- Demo isolation now checks the existing accessible status disclosure, “Demo mode · Sample files are read-only and are not source-verified evidence,” and the “Switch to my files” control. Empty persisted Author grounding metadata, empty topic content, and persisted demo mode assertions remain intact. The following real-source/stable-file-ID selection and reload test fully executed and passed.
- Management return intentionally waits for persistence and the save queue. The delayed-save fixture now verifies that barrier while retaining zero completed saves before release, width 1500, and at most two width saves. It then holds a separate ordinary-project save, navigates Author → Sources using the current accessible sidebar labels, waits for the actual Sources heading, and checks visible/disabled Analyze Sources, unchanged project identity, and no completed save before release. After release it verifies bounded coalescing, retained width, final non-demo state, and sequential record revisions. Conflict/reload assertions remain unchanged.

## Final validation results

**Overall result: AUTOMATED ACCEPTANCE GREEN — FULL ROLLOUT STILL REQUIRES AUTHENTICATED CLOUD/PROVIDER/WORKER VALIDATION.**

| Check | Result |
| --- | --- |
| Final consolidated sweep, 546 unique tests / 89 files | **546 passed, 0 failed, 0 skipped, 0 retries — one clean invocation, one worker** |
| Full Author metadata spec | **6/6 passed**, including the formerly dependent stable-file-ID source-selection/reload test |
| Full cloud-save responsiveness spec | **3/3 passed**, including delayed save/coalescing/revisions, conflict reload, and read-only open |
| Related management/project-context and UX navigation checks | **14/14 passed** in the focused run; also all passed in the final consolidated sweep |
| Production build | Passed |
| TypeScript | Exactly two unchanged known baseline diagnostics; **delta: 0 additional diagnostics**; separate from automated acceptance |
| Isolated PostgreSQL integration | Both actual catalog and Topic-job integration tests passed, including authorization/idempotency/lease/fencing checks |
| Instrumented new end-to-end journeys | Both passed; no unexpected page/console errors; only the explicitly asserted mock-copy 409 is allowed |
| Development startup | HTTP 200; app and existing development Topic-worker workflows running |
| Main preview | Normal signed-out screen renders; anonymous session/refresh 401s are expected, not evidence of authenticated cloud readiness |

The final result is a clean full-suite invocation, not deduplicated success assembled from reruns. The recorded final invocation used one worker and no retries, with both SQL opt-ins enabled against a private socket-only disposable PostgreSQL cluster.

### Earlier run evidence

Before cleanup, the previous batch's latest-per-test result was 543 passed, 2 failed, and 1 dependent test not run. Its original full sweep was 530 passed, 11 failed, and 5 not run.

The first cleanup consolidated sweep used two workers: **544 passed, 2 failed, 0 skipped**. Both original blockers passed, but two different cases failed:

1. `ai-control-center.spec.ts`: the mocked-cloud catalog test expected “Saving catalog changes.” but saw “Reference set definition saved as v1.” The fixture simulates a short-lived saving state.
2. `management-navigation.spec.ts`: the project-switch/Back test could not locate the History searchbox “Search notes, actors, or IDs” when checking its cleared value.

Both cases passed unchanged in a single-worker isolated rerun (**2/2**), and then both passed in the final single-worker consolidated sweep (**546/546**). Neither unrelated spec nor any product code was modified to obtain those passes. The clean serial result does not claim that parallel-run timing is reliable.

### Remaining automation blockers

**None in the final consolidated sweep.** The two known TypeScript baseline diagnostics remain separately reported and were intentionally not repaired. Full rollout remains gated only by the legitimate authenticated cloud/provider/live-worker and published-browser acceptance steps below.

### Nine acceptance statuses

| Acceptance area | Exact status |
| --- | --- |
| Sources → Structure → Author → Review → Publish | **VERIFIED AUTOMATED — local deterministic browser journey**, including real source bytes and downloaded HTML/Word/PDF contents |
| Grounded TOC | **VERIFIED AUTOMATED — mocked provider/API/browser**, including review-only proposals, explicit commit, replacement consent and revision recovery |
| Grounded Topic | **VERIFIED AUTOMATED — mocked provider/API/browser**, including reviewed proposals, replacements and save failure preservation |
| Grounded Rewrite | **VERIFIED AUTOMATED — mocked provider/API/browser**, including eligible selected diffs and protected/manual content preservation |
| Async Topic worker | **VERIFIED AUTOMATED — disposable SQL contract + mocked browser lifecycle**; live provider completion and heartbeat freshness remain unverified |
| Cross-project copy/reuse | **VERIFIED AUTOMATED — mocked cloud/browser and server-contract coverage**, including exact-version lineage, explicit copy, reload and conflict preservation |
| Reload/recovery | **VERIFIED AUTOMATED — local/mock browser and recovery contracts**, including delayed-save/coalescing/revisions and persisted stable-file-ID source selection after reload |
| Provenance/revision/staleness | **VERIFIED AUTOMATED — local/mock/API/SQL coverage**, including signed inputs, revision guards, freshness, lineage, demo isolation, and real-source selection |
| Full rollout/browser readiness | **AUTOMATED CHECKS GREEN / FULL ROLLOUT REQUIRES AUTHENTICATED CLOUD SESSION** — the full automated sweep, build, startup, and instrumented journeys pass; real cloud/provider/live-worker and published-browser checks remain |

Every real-cloud assertion above remains **REQUIRES AUTHENTICATED CLOUD SESSION**. Mock sessions and disposable PostgreSQL are explicitly not substitutes for Supabase/RLS/Storage, live provider calls, or production acceptance.

The TypeScript check retains the two known baseline `TS2345` diagnostics at `src/contentExplorerModel.ts:566`; this batch intentionally does not repair that unrelated baseline.

## Signed-in manual cloud acceptance script

Use the application's normal sign-in form yourself, with an existing authorized test account/workspace. Do not send credentials, cookies, tokens, connection strings, or private source material to the agent. Prefer a non-production test workspace. Capture only redacted screenshots and non-secret result/status details.

1. **Session and permissions**
   - Sign in normally. Confirm the intended organization, workspace, and membership role.
   - Verify cloud storage readiness and that the project's cloud save completes. Reload and sign out/in again; confirm the same project remains available.
   - With separately authorized editor/viewer test sessions, verify the applicable controls and server-denied mutation paths. Do not grant new permissions merely to make a test pass.

2. **Sources → reviewed structure**
   - Create two uniquely named test projects, A and B. In A, upload a small approved Markdown source containing two clearly supported procedures and one explicitly unsupported outline topic.
   - Wait for extraction/evidence to be Current and the save indicator to settle.
   - Analyze sources and request grounded TOC generation using an already configured, ready workflow/connection.
   - Inspect the exact proposed titles, evidence excerpts, source paths, uncertainties, and captured provenance. Before explicit acceptance, verify the committed TOC and authored content remain unchanged.
   - Commit the reviewed proposal explicitly. Reload; confirm stable topic identities/order, retained source files, and no duplicate authored content.

3. **Grounded Topic and explicit apply**
   - Select a supported committed topic, open AI Assist, and refresh grounding when required.
   - Generate Topic with the ready authorized workflow. Verify the proposal's topic, source evidence, configuration/model identity, and input revisions.
   - Confirm that receiving or viewing a proposal does not overwrite authored blocks. Apply only through the review/confirmation controls.
   - Add a clearly identifiable manual paragraph and protect/approve a block. Reload and confirm content and generation provenance remain separate and intact.
   - Select the unsupported empty topic: it must not fabricate sourced content or misleadingly show Grounded.

4. **Background job lifecycle and recovery**
   - Queue a Topic job. Observe the real queued/running/completed status and matching project/topic/job identity.
   - Reload while queued/running, then after completion. Confirm recovery reaches the same job/draft without a duplicate apply or enqueue.
   - Review the completed result and apply explicitly. A worker's existence or a readiness flag alone is insufficient evidence: require an actual persisted completed result and current live worker status.
   - In an authorized disposable sandbox only, exercise a controlled retry/error and stale-result rejection. Never disrupt a production worker or alter real provider credentials for this test.

5. **Rewrite, staleness, and revision consent**
   - Rewrite the supported generated topic. Inspect the diff and select only eligible changes.
   - Confirm manual/protected/approved blocks remain untouched and that no content changes before explicit apply.
   - In another tab, deliberately change the relevant source/content/configuration or project revision. Confirm stale proposals/results cannot silently apply and any recovery uses explicit consent to the current revision.
   - Refresh grounding without applying new content: existing stale generated content must still display Generated stale. Reload and confirm that inspection alone does not write a new record revision.

6. **Cross-project reuse and conflicts**
   - Open B, enter Author, and use Reuse content to preview A's exact catalog version. Preview must not modify A or B.
   - Copy explicitly into B at the selected insertion point. Confirm new destination identities, exact reused text, retained B-only settings/content, and origin project/item/version lineage.
   - Switch A → B and reload both: A must remain unchanged, and B's copied content and lineage must survive.
   - Use a second authorized B tab to create a revision conflict before copying. Confirm the conflict is visible, the preview remains recoverable, and neither remote changes nor later local edits are overwritten.

7. **Review → preview → publish**
   - Add one identifiable unsupported claim to a test topic, refresh the claim check when required, and run Review.
   - Inspect the matching required finding, evidence, and Author navigation. Mark its decision explicitly; do not treat resolution as a text rewrite.
   - Verify publishing is blocked while required findings remain open, then becomes available after the required decisions.
   - Preview the complete committed project, not only the active Author topic. Generate and download HTML, Word, and PDF; open the files and confirm all intended topics, source-derived content, manual edits, styles, and media behavior.
   - For conditional content, select the intended audience explicitly where supported; verify unsupported/ambiguous Word/PDF cases fail closed rather than silently leaking content.

8. **Browser and rollout gate**
   - Exercise the above flows at desktop and narrow widths, including drawers, menus, keyboard access, reload, errors, and recovery.
   - Check for blank/blocked screens, duplicate or lost content, cross-project leakage, unexpected browser errors, and unhandled network responses. Distinguish deliberate conflict/unauthenticated responses from unexpected failures.
   - Run the same signed-in checks against the intended published environment before approving rollout. Development HTTP 200, build success, SQL/mocked tests, and running workflows do not substitute for this evidence.

Do not declare full rollout complete until the authenticated cloud/provider/worker checks above pass with real authorized evidence.