---
name: Topic history from checkpoints
description: Why authored topic history is projected from immutable project checkpoints and how partial reads affect it
---

Read-only authored topic history is a projection of committed project checkpoints, not a stream of every edit. A topic version exists only where a saved checkpoint contains it; stable topic identity links renames and reorders, while ambiguous legacy identities must remain unresolved. Metadata-only reads can validate the saved record and manifest, but cannot claim that archived file bytes were verified. A missing or unsupported checkpoint makes change comparisons across that gap unknown.

**Why:** Separate topic snapshots would diverge from existing immutable project snapshots and imply coverage between checkpoints that the app never recorded. Treating nonadjacent readable checkpoints as adjacent can falsely label content unchanged. Full archive verification requires reading the actual saved bytes.

**How to apply:** Keep future component-history browsing derived from committed, project-scoped checkpoints. Do not infer edits or source references from current project state; present partial histories and integrity scope explicitly, and use the full checkpoint read when byte-level integrity is required.