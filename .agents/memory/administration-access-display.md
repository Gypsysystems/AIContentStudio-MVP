---
name: Administration access display
description: Trust and persistence boundaries for the first workspace administration surface
---

Show a signed-in member's role and projected project permissions for orientation, but do not present the client projection as final cloud authorization. Every cloud operation is independently checked against the server's current session and membership. Workspace and role settings must remain read-only until there is a supported, authorized persistence path; existing project settings may use the guarded project-record save path when the current role and project ownership permit writing.

**Why:** The current app has project permissions and verified workspace context, but not a membership-management or workspace-settings write API. An editable administration UI without one would imply changes had been saved when they had not. A cached browser role also cannot overrule a revoked or changed server membership.

**How to apply:** When extending administration, add server-authorized writes and failure states before enabling role or workspace controls. Keep any access claims tied to the current verified session and scoped project, and require explicit consent before discarding unsaved project edits after authorization or save failure.