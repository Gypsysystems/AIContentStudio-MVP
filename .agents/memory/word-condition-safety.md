---
name: Word condition safety
description: Why Word export cannot currently select conditional content by output variant
---

Word export must reject blocks with nonempty conditions rather than exporting them unconditionally or guessing which conditions match.

**Why:** The full-project publish projection intentionally has no selected output variant or resolved condition membership. Guessing could put restricted content into the wrong audience's Word file. This is a known boundary limitation, not a reason to change the HTML/PDF paths as part of Word fidelity work.

**How to apply:** Keep the explicit Word failure until a separately scoped change supplies trustworthy variant/condition evaluation to the export boundary and tests the audience-specific behavior end to end.