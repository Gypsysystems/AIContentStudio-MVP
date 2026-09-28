---
name: Content Explorer organization boundary
description: Why project-local folder placement is deliberately separate from TOC and publishing
---

Content Explorer folders and placements are a project-local way to organize references to existing assets. They must never determine the committed TOC hierarchy, topic order, authored content, or publishing structure. A later workspace-wide library or reuse feature must establish its own ownership and linking semantics rather than treating these folders as a cross-project resource catalog.

**Why:** Authors need to rearrange their working view without silently changing the document they generate or publish. This foundation deliberately stops before cross-project reuse.

**How to apply:** When extending Author navigation, AI Topic Generation, Review, or publishing, continue reading canonical topic/content state from the existing project record fields. Treat Content Explorer metadata as an independent organizational projection and keep structural writes on the guarded project save path.