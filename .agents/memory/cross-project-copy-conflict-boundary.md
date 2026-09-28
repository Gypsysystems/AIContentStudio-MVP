---
name: Cross-project copy conflict boundary
description: How to handle Author autosaves and local edits around a cross-project catalog copy.
---

Copy reusable content from an immutable catalog version into a destination cloud project with an expected-revision write, then reload the destination authoritatively. Do not merge the source payload into browser state. If the user edits the destination while the copy request or reload is in flight, preserve those local edits and show an explicit conflict instead of hydrating over them. A successful server copy does not imply it is safe to discard a newer unsaved browser snapshot.

**Why:** Author autosaves and catalog copies can race. Even when the server's revision guard prevents a stale write, an unconditional client reload could silently replace edits made after the pre-copy save barrier.

**How to apply:** Flush queued saves before requesting a copy, use the resulting revision for the server compare-and-swap, and guard both the response and reload against later local edits and project switches. Keep lineage metadata separate from authored content; only the destination record is authoritative after a safe reload.