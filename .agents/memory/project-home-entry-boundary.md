---
name: Project Home entry boundary
description: Why project-list entry and active-project reload have different destinations.
---

Opening a saved project from the Projects list should show its overview first. An automatic reload of the active project should continue to the existing Sources destination rather than silently changing the legacy re-entry behavior.

**Why:** The overview is an intentional choice made at project selection; older source, extraction, analysis, and cloud workflows rely on reload restoring the previously established Sources entry point. Changing both entry paths at once broke otherwise unaffected persisted-project flows.

**How to apply:** Treat explicit project selection and automatic startup hydration as separate navigation events. Keep direct stage controls available from Home, and keep navigation from stages back to Home immediate under the existing cloud save model.