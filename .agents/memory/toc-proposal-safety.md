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

If replacing an edited proposal requires clearing it before an external generation request, preserve a scoped, durable recovery copy before the clear and make restoration revision-guarded. A failed or interrupted call must not silently erase human review.

**Why:** Provider failures, tab closure, and concurrent project writes can happen after the clear but before the replacement is saved; an in-memory or tab-scoped copy cannot cover all of those cases.

**How to apply:** Abort replacement when recovery cannot be persisted; never restore over a newer proposal or project revision without explicit review. Clear the copy only after confirmed success, confirmed recovery, or an explicit discard.

For large mixed-source projects, relevance-select the bounded context sent to generation, but keep freshness tied to the complete authoritative project evidence. Validate the response against exactly the selected evidence IDs, not merely any ID in the full index.

**Why:** Otherwise irrelevant or excluded sources can still be cited as factual support, while treating a selected subset as the whole project can conceal a concurrent source change. Selection must reduce noise without weakening provenance or conflict detection.

**How to apply:** Preserve original evidence IDs and source paths for selected items, scope candidate and analysis references to that same selection, and keep the full project revision guard for the eventual proposal-only save.