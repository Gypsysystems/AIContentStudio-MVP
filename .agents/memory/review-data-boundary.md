---
name: Review data boundary
description: Persistence and lifecycle rules for real Review history versus the explicit demo Review.
---

Persist real Review runs and findings as project-scoped history with stable identifiers. Keep the existing static demo findings outside that model and expose them only in explicit demo mode. Legacy Review fields remain compatibility state until a later milestone intentionally migrates their behavior.

**Why:** Real projects must never acquire fabricated demo findings, while Review history needs to survive reloads and project duplication. Removing a topic should retire only findings linked to that topic so unrelated history remains intact.

**How to apply:** Future Review checks should write to the structured model, retain provenance and freshness metadata, and use stable topic/block references. Duplication may preserve run and finding IDs within the copied project but must remap project and copied source references.