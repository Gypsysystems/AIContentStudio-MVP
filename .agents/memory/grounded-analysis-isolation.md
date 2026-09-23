---
name: Grounded analysis isolation
description: Why real evidence-derived analysis is stored separately from demo and downstream pipeline results.
---

Real-project concept and terminology analysis must remain a separate persisted record from legacy demo analysis and downstream TOC/content state until those later P2 milestones are explicitly implemented.

**Why:** This prevents real projects from inheriting synthetic Nexus/Asteria findings and prevents a concept-only milestone from silently triggering gap, TOC, authoring, review, or publish behavior.

**How to apply:** Extend the grounded record by controlled milestone, preserve direct Evidence Index references, and do not route it into downstream generation until that downstream stage has its own source-grounded implementation and tests.

Conflict findings require materially incompatible claims with concrete evidence in different sources. Gap findings must be labeled as not found or insufficiently covered and limited to source structure, explicit missing-information signals, unresolved references, incomplete numbered workflows, or repeated concepts supported only by headings.

**Why:** Treating wording variation as conflict or importing generic product expectations as gaps would create findings that the sources do not support.

**How to apply:** Prefer missing a weak finding over reporting an ungrounded one; retain every supporting Evidence ID, filename, and exact location for each side or rationale.