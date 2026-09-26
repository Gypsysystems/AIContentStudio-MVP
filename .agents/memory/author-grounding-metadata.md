---
name: Author grounding metadata
description: Durable contract for provenance and safe future regeneration of per-topic Author content.
---

Keep per-topic Author grounding and generation provenance in a separate metadata map keyed by stable central TOC topic ID. Existing authored blocks remain in the backward-compatible topic content map. Content without metadata hydrates as manual legacy content, never as generated content.

**Why:** Grounded generation and regeneration must not overwrite or misclassify existing user-authored content. Topic titles and order can change, while stable topic IDs preserve provenance linkage.

**How to apply:** Future generation should update the metadata record only after producing or accepting a grounded draft. Preserve manual/approval flags, remap copied source references during duplication, and prune only metadata whose stable topic ID is removed from the committed TOC.

Tests that inject authored topic content directly into persisted project records must inject its matching hydrated manual metadata before creating a Review run. The Review snapshot includes that metadata; injecting only blocks causes reload-time metadata synthesis to change the snapshot identity and correctly invalidate the earlier run.

**Why:** An artificial record with content but missing metadata has a different Review input fingerprint before and after hydration. A completed run against the pre-hydration fingerprint should not be represented as current.

**How to apply:** Prefer editing through Author in end-to-end tests. If a fixture must patch persisted content directly, normalize the corresponding metadata with the same project context used on hydration before saving the fixture.