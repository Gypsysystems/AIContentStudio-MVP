---
name: Local-to-cloud persistence boundary
description: Compatibility rules for upgrading local project records and adding guarded writes before a cloud adapter.
---

Treat a missing legacy presentation or condition field differently from an explicitly empty one during record migration. The existing app supplies functional defaults only when the field is absent; eagerly materializing empty arrays or objects changes the reopened project's appearance and behavior.

**Why:** A version upgrade initially filled absent legacy fields with empty values, bypassing the established hydration defaults. This failed the compatibility audit for older projects.

**How to apply:** Make upgrades deterministic without erasing the distinction between absent and empty. Keep old project snapshots and file IDs intact, and test opening a migrated project through the app rather than testing only the migration function.

Use guarded revision writes for project snapshots, but keep project opening and startup hydration read-only, including passive effects that recompute derived state. Keep startup hydration single-flight and serial local saves associated with the project being edited; a conflict must not be silently rebased onto a newer whole-record snapshot.

**Why:** Cloud revisions can advance between selecting and opening a project. Direct reconciliation writes and post-hydration autosaves turned a valid read into a conflict, while development-mode effect replay could also race concurrent hydrations.

**How to apply:** Read the latest authorized record with a bounded conflict retry, reconcile style, Author, Review, and evidence state in memory without advancing the save version, and include those values on a later user-initiated guarded save. Preserve one startup hydration per app mount and never silently rebase a failed user edit.