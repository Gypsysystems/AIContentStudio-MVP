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