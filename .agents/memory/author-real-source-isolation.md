---
name: Author real-source isolation
description: Rules for showing source and evidence context in real-project Author workflows.
---

Real-project Author source context must resolve from persisted file IDs, evidence IDs, and committed TOC provenance. Demo filenames, excerpts, source references, and generated responses are allowed only inside an explicit demo-mode branch. If grounded generation is not implemented, generation and contextual AI actions must report that they are unavailable rather than fabricate output.

**Why:** Author UI can otherwise make synthetic data look like project evidence, which breaks provenance and user trust.

**How to apply:** Any new Author source picker, evidence browser, reference badge, or AI action must use persisted IDs for real projects, survive reload through topic metadata where selection is user-controlled, and present a clear empty or unavailable state when grounded data is missing.