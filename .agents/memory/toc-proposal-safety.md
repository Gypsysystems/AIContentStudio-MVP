---
name: TOC proposal safety
description: Rules for preserving approved structure while generating evidence-grounded TOC proposals.
---

Keep evidence-grounded TOC proposals separate from the committed central TOC until explicit user acceptance. If a committed TOC already exists, acceptance must merge only new topics and preserve existing IDs, order, and user edits.

**Why:** A regenerated proposal can change when sources, analysis, or content type changes. Replacing approved structure would silently discard user decisions and could break downstream numeric TOC references.

**How to apply:** Keep proposal review state independently persisted, require current evidence and grounded analysis before commit, and use stable string topic IDs alongside legacy numeric IDs. Real projects must not use synthetic demo TOCs.