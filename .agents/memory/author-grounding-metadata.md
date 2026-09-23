---
name: Author grounding metadata
description: Durable contract for provenance and safe future regeneration of per-topic Author content.
---

Keep per-topic Author grounding and generation provenance in a separate metadata map keyed by stable central TOC topic ID. Existing authored blocks remain in the backward-compatible topic content map. Content without metadata hydrates as manual legacy content, never as generated content.

**Why:** Grounded generation and regeneration must not overwrite or misclassify existing user-authored content. Topic titles and order can change, while stable topic IDs preserve provenance linkage.

**How to apply:** Future generation should update the metadata record only after producing or accepting a grounded draft. Preserve manual/approval flags, remap copied source references during duplication, and prune only metadata whose stable topic ID is removed from the committed TOC.