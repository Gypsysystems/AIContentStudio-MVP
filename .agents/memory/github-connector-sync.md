---
name: GitHub connector sync
description: Authentication boundary between the workspace Git remote and the connected GitHub API.
---

An added GitHub integration does not guarantee that the workspace's HTTPS Git remote can push. Treat Git transport authentication and connector authentication as separate capabilities.

**Why:** An HTTPS push rejected its stored authentication even though the connected GitHub API could write repository objects through its credential-injecting proxy.

**How to apply:** If a requested sync hits that mismatch, use the existing connected API without reading or logging credentials. Verify the target branch has not changed and that uploaded Git objects match local hashes before advancing the branch. Confirm local and remote commit IDs afterward.