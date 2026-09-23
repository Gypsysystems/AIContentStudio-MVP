---
name: Author draft review boundary
description: Rules for evidence-backed Author generation, persistence, freshness, and applying drafts.
---

Persist generated Author drafts inside stable-ID topic metadata, separate from authored topic blocks. Generate only from the topic's current grounding context, retain the exact evidence IDs used, and require explicit confirmed apply before changing authored content.

**Why:** Generation must remain reviewable and reversible. A stale context, conflict, gap, or unavailable fact must never be silently converted into asserted product content.

**How to apply:** Gate generation and apply on the grounding context ID and current freshness. Flag uncertainty and omit unsupported detail. If no external model is configured, use and label the deterministic evidence builder rather than presenting it as AI output.

For regeneration, compare the proposal against both the last applied generated baseline and the current authored blocks. Preserve manually edited, legacy, and approved blocks by default; apply only explicitly selected diff changes.

**Why:** Authored content can diverge after generation, and replacing the whole topic would silently destroy user work.

**How to apply:** Persist block-state and baseline linkage by stable topic ID. If authored content changes after a proposal is built, invalidate its apply path and require regeneration from the current content.