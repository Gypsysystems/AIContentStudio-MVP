---
name: Local-to-cloud persistence boundary
description: Compatibility rules for upgrading local project records and adding guarded writes before a cloud adapter.
---

Treat a missing legacy presentation or condition field differently from an explicitly empty one during record migration. The existing app supplies functional defaults only when the field is absent; eagerly materializing empty arrays or objects changes the reopened project's appearance and behavior.

**Why:** A version upgrade initially filled absent legacy fields with empty values, bypassing the established hydration defaults. This failed the compatibility audit for older projects.

**How to apply:** Make upgrades deterministic without erasing the distinction between absent and empty. Keep old project snapshots and file IDs intact, and test opening a migrated project through the app rather than testing only the migration function.

Use guarded revision writes for project snapshots, and ensure startup hydration is single-flight before allowing reconciliation to save. Keep serial local saves associated with the project being edited; a conflict must not be silently rebased onto a newer whole-record snapshot.

**Why:** Development-mode effect replay can start two concurrent hydrations. Once reconciliation writes became guarded, the second hydration correctly conflicted but could clear the successfully opened in-memory project.

**How to apply:** Preserve one startup hydration per app mount, carry the returned revision through each reconciliation and save, and surface real conflicts rather than falling back to unguarded writes.