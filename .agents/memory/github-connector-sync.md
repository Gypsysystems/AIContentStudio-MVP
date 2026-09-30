---
name: GitHub connector sync
description: Authentication boundary between the workspace Git remote and the connected GitHub API.
---

An added GitHub integration does not guarantee that the workspace's HTTPS Git remote can push. Treat Git transport authentication and connector authentication as separate capabilities.

**Why:** An HTTPS push rejected its stored authentication even though the connected GitHub API could write repository objects through its credential-injecting proxy.

**How to apply:** If a requested sync hits that mismatch, use the existing connected API without reading or logging credentials. Verify the target branch has not changed and that uploaded Git objects match local hashes before advancing the branch. Confirm local and remote commit IDs afterward.

Recheck the GitHub branch ref after a failed HTTPS push and before writing through the connector.

**Why:** The remote branch can advance to the exact local commit asynchronously even when the command-line push reports an authentication error. Treating an earlier ref read as current would lead to unnecessary or conflicting connector writes.

**How to apply:** Compare the fresh GitHub ref, local commit, and tracking ref first. If they already match, no connector write is needed; otherwise verify the expected parent before uploading objects or updating the branch.

When recreating a local Git commit with GitHub's Git database API, preserve the commit message's trailing newline. The API does not add it automatically; an otherwise identical tree, parent, author, and timestamp will produce a different commit SHA without it.

**Why:** A connector-created commit initially differed from the local object by exactly one missing final newline.

**How to apply:** Compare the resulting commit SHA with the local SHA before advancing the branch. Include the message's final newline and verify the branch still points to the expected parent before a non-forced ref update.