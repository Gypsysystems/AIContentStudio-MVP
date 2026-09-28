---
name: Async AI result boundary
description: Security and review constraints when an AI generation moves from an authenticated request to a separate worker and durable result.
---

A separately authorized AI worker must verify the same signed connection-test proof as synchronous execution. A database row saying a connection is verified is not sufficient.

**Why:** The connection state and proof can be submitted together by an authorized workspace user, but only the valid signature establishes that the provider test actually passed. A worker that trusts the state alone can bypass the synchronous readiness check.

**How to apply:** Share the cryptographic proof verifier between execution paths; retrieve proof metadata through a worker-only, lease-fenced channel. Never expose proof or credentials in job status.

Sanitize or reject sensitive values in the *persisted result* independently of sanitizing the provider prompt. Keep structural identifiers out of heuristic secret scans while checking the actual credential against the whole result.

**Why:** The generation packet can exclude a secret-like guidance value while a draft constructor still copies that original value into a durable, browser-readable result. Conversely, blanket heuristic scans of IDs can reject legitimate long topic IDs.

**How to apply:** Inspect the exact draft that will be stored, limiting heuristic scans to user/model-authored free text and guidance, and fail safely before committing any secret-bearing result.