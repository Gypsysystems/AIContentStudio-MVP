---
name: Style profile recovery
description: Why a recovery selection must not silently apply a project's styles
---

Treat `projectMeta.styleProfileId` as the applied-profile source of truth and keep the legacy active ID synchronized. Resolve in this order: project reference, active reference, active-theme rich profile, synthesized legacy brand profile, safe default.

**Why:** Two independently restored applied-profile IDs can drift and make the editor disagree with persisted project styling. Explicitly selected non-applied profiles still remain edit-only until Apply.

**How to apply:** Apply updates both IDs atomically. Hydration and applied-profile deletion reconcile both IDs to the canonical stored fallback; duplication, import, and edits do not apply profiles. Output generation remains unchanged until a later milestone.