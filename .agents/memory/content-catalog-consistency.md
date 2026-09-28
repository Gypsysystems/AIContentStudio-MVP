---
name: Content catalog consistency
description: Why catalog synchronization distinguishes malformed optional content from storage failures.
---

The authored cloud project record remains authoritative. The reusable-content catalog is a derived read model, not a second place to edit project content. Malformed optional assets can be skipped or retired without making the project unavailable, but an actual catalog database write failure must abort the project transaction. Do not publish an empty or partial current payload in place of malformed content.

**Why:** Otherwise a successful Author save can leave catalog items stale, missing, or falsely reusable; future copy flows would then present content that does not match the authoritative project.

**How to apply:** When extending extraction, restore, or catalog lifecycle behavior, keep normalization failures isolated to the affected asset, but propagate persistence failures. Retain immutable history for retired assets and verify any new current listing reflects only valid active content.