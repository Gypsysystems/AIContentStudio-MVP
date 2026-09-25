---
name: Local ownership boundary
description: Migration and authorization rules for the local-first workspace foundation.
---

Only historical records with both ownership fields absent may acquire the default local user and workspace. Preserve any complete existing ownership pair, reject incomplete pairs, and keep ownership immutable during ordinary content saves. A portable backup restored as new belongs to its importing actor and workspace; replacement retains the destination's ownership and requires destination permission.

**Why:** Assigning a partially identified record to the local workspace could conceal a future cloud ownership error. A project-owner shortcut also let a user whose workspace membership was downgraded to viewer bypass the viewer role's write and delete restrictions.

**How to apply:** Require the current matching workspace membership for every repository operation, including file access, duplication, and backup. A project owner is attribution, not a role override. Filter foreign records before migrating them for listings so an incompatible foreign schema cannot break a tenant's view. Local-development session contexts are client-side scaffolding, not proof of identity: a future server must resolve identity and memberships from trusted credentials before using these checks.