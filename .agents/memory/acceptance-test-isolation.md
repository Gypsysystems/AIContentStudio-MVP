---
name: Acceptance test isolation
description: Preventing test-runner and disposable PostgreSQL process interference during acceptance batches.
---

Concurrent Playwright invocations must isolate reports/artifacts and explicit server ownership. Runner-owned servers use distinct strict loopback ports; a shared server is safe only when its lifecycle has one explicit parent owner.

**Why:** Shared output directories let runners delete one another's active traces, while independent server startup races on the same port. These failures do not establish product defects.

**How to apply:** Keep the normal application workflow separate. Do not automatically reuse an unidentified server. When each runner owns a server, keep one port and artifact UUID per invocation and inherit them into workers.

Playwright reloads configuration inside worker processes. Dynamic ports and run identities must be allocated once in the runner and inherited, not generated afresh at every configuration evaluation.

**Why:** Recomputing the port in worker configuration sent browsers to unused ports even though the runner's server was healthy.

**How to apply:** Test inherited worker configuration and independent concurrent invocations. Use strict-port binding so a port race fails rather than attaching tests to another server.

Acceptance servers must not use development file watching/live reload while validating multi-step persistence journeys.

**Why:** Saving Markdown reports caused a Vite full-page reload in a controlled reproduction, even without application-code edits. During acceptance this can interrupt reloads, clear transient confirmations, or abandon pending persistence.

**How to apply:** Use a test-only configuration that retains the same application/API plugins but disables watching and HMR. Leave normal development behavior unchanged, and finish application-code edits before starting a gate.

Run disposable PostgreSQL as a foreground process in a managed background shell, using a private temporary data directory and Unix socket with TCP disabled.

**Why:** Unmanaged child processes may not survive a short-lived shell command. Inherited PostgreSQL defaults may also select a different identity or database than the disposable cluster.

**How to apply:** Keep the server under explicit process ownership and bind tests to its local socket and identity. Never use configured cloud database URLs for disposable integration suites.

Requested SQL integration gates must fail on unavailable/unsafe preflight, not skip.

**Why:** An opted-in run can otherwise appear green without executing its SQL assertions when the selected client binary or database setup is missing.

**How to apply:** Use the selected PostgreSQL client installation, sanitize ambient libpq routing, and reserve skips for explicit opt-out only.

Use a controlled single-worker full sweep when parallel browser runs fail on transient saving or project-switch UI states. Preserve the parallel-run failures as evidence rather than weakening the assertions.

**Why:** A loaded parallel sweep missed transient UI states in otherwise unchanged fixtures; the same cases passed in isolation and in a clean serial full sweep.

**How to apply:** Distinguish run-dependent test failures from confirmed product defects. A clean serial sweep establishes functional acceptance coverage, not parallel-run timing reliability; report that distinction explicitly.

Database isolation is insufficient for concurrent PostgreSQL fixtures that create or drop roles: roles are cluster-global.

**Why:** Separate disposable databases still collide when fixtures reuse role names. A broad parallel gate must not accidentally test against role objects another fixture is changing.

**How to apply:** Give concurrent SQL invocations separate owned clusters, or deliberately execute those fixtures serially. Keep their results separate from the comprehensive browser sweep and report the exclusion precisely.

Raw legacy fixtures must be seeded only after the application's startup list/enrollment has successfully settled, not merely after a heading appears.

**Why:** Headings render while loading; startup and an explicit authorized read can both try enrolling a newly seeded legacy record, producing a correct duplicate-ownership rejection.

**How to apply:** Wait for a successful completed-list state before raw fixture writes. Preserve authorization assertions and server conflicts; do not treat duplicate enrollment as authorization success.

Isolate Playwright's transform cache before its CLI starts, not only browser servers and reports.

**Why:** Separate servers and reports do not separate the default mutable compiler entries. Cache ownership is a reproducibility boundary, not proof that every native loader failure is fixed.

**How to apply:** Set an owned per-invocation `PWTEST_CACHE_DIR` inherited by workers. Disposable helpers can bind it to their private temporary directory; never clear another invocation's cache.

Do not attribute a zero-duration, unassigned-worker native loader failure to an application assertion or a particular imported module without evidence.

**Why:** Such failures persisted after compiler-cache isolation; reports identified no specific module or load hook, while complete serial coverage and focused repeated cases passed.

**How to apply:** Preserve the complete parallel outcomes, distinguish collection/loading from test execution, and stop speculative fixes when there is no reproducible causal evidence.

Keep Playwright's supported asynchronous loader selected for owned acceptance invocations under the current Node 22/framework combination, rather than changing global Node flags or application imports.

**Why:** The default synchronous loader reproduced a null-source rejection before a publishing case executed despite private compiler caches. A pass-through diagnostic observer did not reproduce it; repeated full sweeps using the framework's asynchronous path passed with unchanged assertions. This validates a scoped compatibility mitigation, not a particular module/race explanation.

**How to apply:** Preserve normal development runtime settings and failed-run evidence. Guard the actual installed framework loader path, and reassess the compatibility selection against full repeated sweeps after Node or Playwright upgrades. Do not count an observer-only pass as clearing an uninstrumented gate.