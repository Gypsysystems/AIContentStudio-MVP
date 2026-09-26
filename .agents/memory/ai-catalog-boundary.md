---
name: AI catalog boundary
description: Scope and provenance rules for administration-level AI definitions
---

Workspace AI definitions are a separate non-secret catalog, not fields in a project record. Keep provider connections truthful and read-only until a secure credential path exists; definition metadata does not imply an executable workflow.

**Why:** Project records and checkpoints are project-scoped and may be duplicated or deleted. A shared workspace library has a different lifecycle, while putting provider credentials in client-readable records would expose them to ordinary members.

**How to apply:** Preserve stable definition and nested prompt IDs, immutable published snapshots, and version-pinned references within the same workspace. Do not route model execution or project content mutations through catalog editing; later execution must respect the existing grounding, review, and approval paths.