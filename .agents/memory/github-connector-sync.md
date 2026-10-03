---
name: GitHub connector sync
description: Authentication boundary between the workspace Git remote and the connected GitHub API.
---

An added GitHub integration does not guarantee that the workspace's HTTPS Git remote can push. Treat Git transport authentication and connector authentication as separate capabilities.

**Why:** An HTTPS push rejected its stored authentication even though the connected GitHub API could write repository objects through its credential-injecting proxy.

**How to apply:** If a requested sync hits that mismatch, use the existing connected API without reading or logging credentials. Verify the target branch has not changed and that uploaded Git objects match local hashes before advancing the branch. Confirm local and remote commit IDs afterward.

A generic Git-pane `PUSH_REJECTED` message does not establish that the remote has newer commits.

**Why:** The pane suggested remote divergence while a fresh fetch and connected branch read showed a fast-forward relationship; a push dry-run exposed invalid Git transport authentication.

**How to apply:** Check current ancestry and a non-mutating push preflight before recommending pull/rebase. A healthy connector must not be reauthorized merely because separate Git transport credentials fail.

Recheck the GitHub branch ref after a failed HTTPS push and before writing through the connector.

**Why:** The remote branch can advance to the exact local commit asynchronously even when the command-line push reports an authentication error. Treating an earlier ref read as current would lead to unnecessary or conflicting connector writes.

**How to apply:** Compare the fresh GitHub ref, local commit, and tracking ref first. If they already match, no connector write is needed; otherwise verify the expected parent before uploading objects or updating the branch.

When recreating a local Git commit with GitHub's Git database API, preserve the commit message's trailing newline. The API does not add it automatically; an otherwise identical tree, parent, author, and timestamp will produce a different commit SHA without it.

**Why:** A connector-created commit initially differed from the local object by exactly one missing final newline.

**How to apply:** Compare the resulting commit SHA with the local SHA before advancing the branch. Include the message's final newline and verify the branch still points to the expected parent before a non-forced ref update.

When transferring a large Git blob through the connector, do not trust a single long base64 line returned by CodeExecution's shell callback. Read it in small character slices and verify the reconstructed Git blob hash before uploading.

**Why:** A long base64 line was silently shortened despite a generous output budget, producing a valid but incorrect uploaded blob.

**How to apply:** Split base64 output into slices of no more than 64,000 characters, check each slice's expected length, then compare both the reconstructed and uploaded blob hashes to the local Git object. Verify tree and commit hashes before updating the remote ref.