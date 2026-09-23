---
name: Review data boundary
description: Persistence and lifecycle rules for real Review history versus the explicit demo Review.
---

Persist real Review runs and findings as project-scoped history with stable identifiers. Keep the existing static demo findings outside that model and expose them only in explicit demo mode. Persist the current real-project Review inputs as a separate deterministic, read-only snapshot that automatically refreshes when content, sources, evidence, analysis, style, standards, or Author provenance changes. Legacy Review fields remain compatibility state until a later milestone intentionally migrates their behavior.

**Why:** Real projects must never acquire fabricated demo findings, while Review history and the exact inputs used by later checks need to survive reloads and project duplication. Input inspection must not create findings or alter authored content. Removing a topic should retire only findings linked to that topic so unrelated history remains intact.

**How to apply:** Future Review checks should read the persisted input snapshot, write only to the structured Review run/finding model, retain provenance and freshness metadata, and use stable topic/block references. Never derive real-project inputs from static demo data. Duplication may preserve run and finding IDs within the copied project but must remap project and copied source references and recompute snapshot identity. The shared Review screen must keep legacy demo status controls separate from persisted real finding statuses.