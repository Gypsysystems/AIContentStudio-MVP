---
name: Review-to-Author navigation
description: Safety boundary for opening persisted real Review findings in Author.
---

Real Review navigation is an inspection action, not an edit. Resolve the current project topic and block by stable IDs, and refuse stale or missing targets rather than substituting a nearby topic or block. When an editor field cannot be focused, identify that limit in Author.

**Why:** Opening an existing topic and focusing an editable block can run Author's normal hydration and blur handlers. A no-op focus/blur must not count as a content revision, because that immediately stales the Review finding the user came to inspect.

**How to apply:** Before navigating, check the current Review input snapshot, finding freshness, and persisted target existence. When opening and leaving Author, avoid re-saving identical block data or treating unchanged blur text as an edit. Keep demo jump behavior separate from real findings.