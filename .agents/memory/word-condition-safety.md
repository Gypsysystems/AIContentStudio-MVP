---
name: Publish condition safety
description: Why Word and PDF export cannot currently select conditional content by output variant
---

Word and PDF exports must reject blocks with nonempty conditions rather than exporting them unconditionally or guessing which conditions match.

**Why:** The full-project publish projection intentionally has no selected output variant or resolved condition membership. Guessing could put restricted content into the wrong audience's Word or PDF file. This is a known boundary limitation, not a reason to change the other export paths as part of a format-specific fidelity batch.

**How to apply:** Keep the explicit Word and PDF failures until a separately scoped change supplies trustworthy variant/condition evaluation to the export boundary and tests the audience-specific behavior end to end.