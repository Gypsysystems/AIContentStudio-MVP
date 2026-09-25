---
name: TOC proposal safety
description: Rules for preserving approved structure while generating evidence-grounded TOC proposals.
---

Keep evidence-grounded TOC proposals separate from the committed central TOC until explicit user acceptance. If a committed TOC already exists, acceptance must merge only new topics and preserve existing IDs, order, and user edits.

**Why:** A regenerated proposal can change when sources, analysis, or content type changes. Replacing approved structure would silently discard user decisions and could break downstream numeric TOC references.

**How to apply:** Keep proposal review state independently persisted, require current evidence and grounded analysis before commit, and use stable string topic IDs alongside legacy numeric IDs. Committed freshness includes evidence, analysis, and content type. Duplication must preserve whether a proposal was current or stale. Real projects must not use synthetic demo TOCs.

Content-type-specific proposals should treat source headings and section paths as evidence, not the final reader-facing hierarchy. A User Guide task or capability needs local user-action evidence; otherwise retain the subject as a concept or clearly optional structure.

**Why:** Implementation-oriented headings such as an internal export adapter can describe technical components without proving that a reader can export anything. Copying them into a User Guide, or turning them into tasks from the heading alone, would misrepresent the sources.

**How to apply:** Organize supported topics for the selected content type while keeping heading-derived topic IDs stable across regenerated titles, and retain local evidence IDs, source paths, and rationale. Do not turn a passive mention or an internal noun into a user action.