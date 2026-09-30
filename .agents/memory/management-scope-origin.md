---
name: Management scope and origin
description: Context boundary when navigating workspace management from a project or Projects
---

Project selection inside a management view is an inspection/editing scope, not an implicit decision to abandon the entry location. Back restores the original project and screen (or Projects when entered from there); a deliberate workflow action such as Continue may open the selected project's workflow. Nested management screens return to their parent scope before returning to the original location.

**Why:** A selected project can differ from the project that supplied the shell and the user's return path. Treating selection as navigation silently strands users in another project's workspace, while treating every action as Back breaks the existing Continue action.

**How to apply:** Separate selected project from origin, keep save barriers on editing exits, and route every management exit explicitly. Project switching should fence stale async UI results and settle short persistence operations, but must not block indefinitely on long-running extraction or other background work.

When adding secondary filters to shared management screens, give them accessible names that cannot be confused with the shared project picker. Keep a single origin-aware Back control in managed views; standalone component backs are for unmanaged use only.

**Why:** A broad role query for “Project” also matched a new “Project activity” filter, and duplicate Back controls obscured which destination would be restored.

**How to apply:** Use distinct filter labels and scope navigation tests to the shared picker when adding controls. Leave save and origin restoration with management scope rather than building local replacements.