---
name: Project Home entry boundary
description: Canonical refresh preservation, fresh-login landing, and explicit project-entry behavior.
---

Browser refresh must preserve the valid UI screen the user was actually viewing, including Project Home, workflow screens and management pages. Project progress/latest stage is metadata, not a refresh destination.

**Why:** The user explicitly broadened the navigation rule after manual acceptance found that refreshing Project Home left the overview. This supersedes the earlier legacy Sources-on-reload policy.

**How to apply:** Restore validated, authorized, tab-local UI location independently of project hydration. Preserve management origin/selection and Back behavior, not just its visible screen label. Invalid or incompatible locations fall back to Projects or Project Home.

Refresh from Projects and explicit fresh sign-in must land on Projects, even when an accessible active-project pointer remains. Preserve that pointer and authorized loading; never clear project storage or reset project state merely to choose the landing page. Navigation intent must not transfer between verified users/workspaces.

**Why:** The user’s manual acceptance confirmed that fresh-login and Projects-refresh behavior works and explicitly required retaining both while broadening restoration. Navigation changes must not change project data, auth semantics or workflow state.

**How to apply:** Explicit fresh login overrides prior restoration intent and lands on Projects. Explicit project selection opens Project Home. Never clear project storage/state merely to select a landing page.

Keep Analysis reachable through Home's direct stage action even when the Sources action for analyzing is disabled.

**Why:** Sources can correctly block analysis while evidence is stale or incomplete. Removing a global workflow strip must not also remove the route to inspect the Analysis screen and its recovery actions.

**How to apply:** When simplifying project navigation or updating UI checks, use Home's stage action for direct Analysis access; reserve the Sources action for starting analysis when evidence is ready.