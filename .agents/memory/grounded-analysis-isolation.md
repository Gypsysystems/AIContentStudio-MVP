---
name: Grounded analysis isolation
description: Why real evidence-derived analysis is stored separately from demo and downstream pipeline results.
---

Real-project concept and terminology analysis must remain a separate persisted record from legacy demo analysis and downstream TOC/content state until those later P2 milestones are explicitly implemented.

**Why:** This prevents real projects from inheriting synthetic Nexus/Asteria findings and prevents a concept-only milestone from silently triggering gap, TOC, authoring, review, or publish behavior.

**How to apply:** Extend the grounded record by controlled milestone, preserve direct Evidence Index references, and do not route it into downstream generation until that downstream stage has its own source-grounded implementation and tests.