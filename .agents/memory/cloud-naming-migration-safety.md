---
name: Cloud naming migration safety
description: Integrity constraints when introducing workspace-scoped cloud name uniqueness over existing records.
---

When a database key mirrors client-side normalization, test both implementations against the same unusual whitespace characters, including BOM and nonbreaking spaces. For a backfill that changes a project name, advance the guarded record revision in both the row and JSON record; otherwise tabs open before migration can still try to save an obsolete name.

**Why:** Text-only migration checks missed Unicode normalization differences and stale-tab behavior. A disposable PostgreSQL run also exposed migration prerequisites that string assertions could not detect.

**How to apply:** Before deploying name-related migrations, test representative duplicate, suffix-collision, malformed legacy, and cross-workspace rows in a disposable database. Verify that a unique-index race fails and that old revisions conflict after renamed rows are backfilled. Keep this separate from the live migration.