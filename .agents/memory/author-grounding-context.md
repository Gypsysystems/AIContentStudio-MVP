---
name: Author grounding context
description: Durable rules for deterministic per-topic context before grounded draft generation.
---

Build and cache topic grounding context inside stable-ID Author metadata, separate from authored blocks. Required evidence comes only from committed TOC references; optional evidence must be deterministically related and selected. Conflicts, gaps, unavailable information, writing inputs, and provenance remain distinct.

**Why:** Pre-generation context must be inspectable and reproducible without turning missing or stale evidence into synthetic facts or overwriting authored content.

**How to apply:** Use only a current Evidence Index and current grounded analysis. Fingerprint source/extraction, analysis, TOC, content type, variables, and non-visual style/brand inputs. Preserve stale cached context until explicitly refreshed, and remap file references during duplication.