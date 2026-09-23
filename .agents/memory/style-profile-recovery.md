---
name: Style profile recovery
description: Why a recovery selection must not silently apply a project's styles
---

Keep effective-profile resolution separate from applying a style profile. Resolve in this order: project reference, active reference, active-theme rich profile, synthesized legacy brand profile, safe default.

**Why:** If a saved active profile disappears, automatically applying another profile could change document styling without the user's consent. Showing a saved profile for editing is safe; applying it should remain an explicit action.

**How to apply:** Preserve this distinction when changing profile hydration, selection, or deletion recovery. Output generation remains on its existing path until a later milestone explicitly adopts the resolver.