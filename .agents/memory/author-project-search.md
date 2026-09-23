---
name: Author project search
description: Durable rules for project-wide Author content search and result navigation.
---

Project-wide Author search indexes persisted topic content associated with the central TOC and identifies topics by stable topic ID, not title or current order. Real projects must never fall back to synthetic demo search records.

**Why:** Topic titles and ordering are editable, while stable IDs preserve the content association across reloads, renames, reordering, and duplication. Synthetic fallback can present nonexistent content as a real search result.

**How to apply:** Search meaningful text in every persisted block field, return block-level context, and navigate by stable topic ID plus block ID. Keep demo search records behind explicit demo mode and keep search read-only. Topic-scoped Find & Replace remains a separate editing path.