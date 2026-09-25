---
name: Publish snapshot boundary
description: Why publishing reads a deterministic project snapshot rather than mounted editor state
---

Publish enhancements should consume a read-only snapshot ordered by the committed TOC and keyed by stable topic IDs. Keep variable expansion and missing-variable warnings in that snapshot. Any headings needed by older flat-document renderers belong in a temporary rendering adapter, never in persisted Author blocks.

**Why:** The editor can hold only the active topic or an outdated block list, whereas the saved project contains all topics. Editing source content or Review records during export would violate the frozen upstream boundaries.

**How to apply:** When adding media, master composition, styles, or new output formats, extend the export projection and format adapters rather than reaching into the active editor ref or writing back to Author/Review.