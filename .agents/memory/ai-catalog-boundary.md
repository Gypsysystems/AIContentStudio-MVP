---
name: AI catalog boundary
description: Scope and provenance rules for administration-level AI definitions
---

Workspace AI definitions are a separate non-secret catalog, not fields in a project record. A published workflow is a version-pinned configuration, not proof that its provider and model are still available.

**Why:** Project records and checkpoints are project-scoped and may be duplicated or deleted. A shared workspace library has a different lifecycle, while putting provider credentials in client-readable records would expose them to ordinary members. PostgreSQL can enforce structural publication rules but cannot verify live provider availability; connections can change or disappear after publication.

**How to apply:** Preserve stable definition and nested prompt IDs, immutable published snapshots, and version-pinned references within the same workspace. Recheck the server-side provider/model and exact dependency readiness immediately before later execution, even when the workflow is published. Never put credentials or project source content into catalog assets or browser-safe readiness responses; later execution must respect the existing grounding, review, and approval paths.