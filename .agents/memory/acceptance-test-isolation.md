---
name: Acceptance test isolation
description: Preventing test-runner and disposable PostgreSQL process interference during acceptance batches.
---

Concurrent Playwright invocations must use separate output directories and report files, and reuse one parent-owned loopback test server.

**Why:** Shared output directories let runners delete one another's active traces, while independent server startup races on the same port. These failures do not establish product defects.

**How to apply:** Give the temporary test server one owner and each invocation independent artifact/report paths. Keep the normal application workflow separate.

Run disposable PostgreSQL as a foreground process in a managed background shell, using a private temporary data directory and Unix socket with TCP disabled.

**Why:** Unmanaged child processes may not survive a short-lived shell command. Inherited PostgreSQL defaults may also select a different identity or database than the disposable cluster.

**How to apply:** Keep the server under explicit process ownership and bind tests to its local socket and identity. Never use configured cloud database URLs for disposable integration suites.