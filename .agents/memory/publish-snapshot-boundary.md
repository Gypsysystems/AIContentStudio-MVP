---
name: Publish snapshot boundary
description: Why publishing reads a deterministic project snapshot rather than mounted editor state
---

Publish enhancements should consume a read-only snapshot ordered by the committed TOC and keyed by stable topic IDs. Keep variable expansion and missing-variable warnings in that snapshot. Any headings needed by older flat-document renderers belong in a temporary rendering adapter, never in persisted Author blocks.

**Why:** The editor can hold only the active topic or an outdated block list, whereas the saved project contains all topics. Editing source content or Review records during export would violate the frozen upstream boundaries.

**How to apply:** When adding media, master composition, styles, or new output formats, extend the export projection and format adapters rather than reaching into the active editor ref or writing back to Author/Review.

Treat a saved destination filename as unresolved unless the export snapshot includes matching file bytes. Do not infer that a filename alone implies an available download.

**Why:** A plausible-looking relative link to an unbundled project file would be broken in the downloaded ZIP, and fetching source files ad hoc would bypass the export snapshot boundary.

**How to apply:** If adding project-file downloads to HTML, include their bytes and identity in the immutable projection before resolving destinations.