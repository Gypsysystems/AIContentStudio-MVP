---
name: Project Home entry boundary
description: Why project-list entry and active-project reload have different destinations.
---

Opening a saved project from the Projects list should show its overview first. An automatic reload while inside a project should continue to the existing Sources destination rather than silently changing the legacy workflow re-entry behavior.

**Why:** The overview is an intentional choice made at project selection; older source, extraction, analysis, and cloud workflows rely on reload restoring the previously established Sources entry point. Changing both entry paths at once broke otherwise unaffected persisted-project flows.

**How to apply:** Treat explicit project selection and automatic startup hydration as separate navigation events. Keep direct stage controls available from Home, and keep navigation from stages back to Home immediate under the existing cloud save model.

Refresh from Projects and explicit fresh sign-in must land on Projects, even when an accessible active-project pointer remains. Preserve that pointer and authorized loading; never clear project storage or reset project state merely to choose the landing page. Navigation intent must not transfer between verified users/workspaces.

**Why:** The user’s manual acceptance exposed that retaining project selection unintentionally overrode an explicit return to Projects and the fresh-login landing page. The user authorized only a minimal navigation-policy fix, not changes to project state, auth semantics or other workflow navigation.

**How to apply:** Separate dashboard landing intent from project selection and distinguish fresh sign-in from session restoration. Keep in-project reload and explicit project-open behavior unchanged; inaccessible selections must fall back safely to Projects.

Keep Analysis reachable through Home's direct stage action even when the Sources action for analyzing is disabled.

**Why:** Sources can correctly block analysis while evidence is stale or incomplete. Removing a global workflow strip must not also remove the route to inspect the Analysis screen and its recovery actions.

**How to apply:** When simplifying project navigation or updating UI checks, use Home's stage action for direct Analysis access; reserve the Sources action for starting analysis when evidence is ready.