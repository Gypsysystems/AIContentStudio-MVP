---
name: Style profile recovery
description: Why a recovery selection must not silently apply a project's styles
---

Keep recovery selection separate from applying a style profile.

**Why:** If a saved active profile disappears, automatically applying another profile could change document styling without the user's consent. Showing a saved profile for editing is safe; applying it should remain an explicit action.

**How to apply:** Preserve this distinction when changing profile hydration, selection, or deletion recovery.