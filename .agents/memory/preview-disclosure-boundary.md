---
name: Preview disclosure boundary
description: Safety and honesty when the on-screen Preview differs from unchanged HTML publication behavior.
---

When a full-project Preview masks conditional blocks because no audience is selected, warn visibly in both Preview and Publish that HTML currently includes those blocks without filtering; Word and PDF reject them. Never imply the masked view makes HTML publication safe. A hidden HTML master Body block causes HTML generation to fail rather than silently omitting authored content; a master without a Body block may omit content while Preview still shows it for review.

**Why:** The Preview fidelity work was deliberately scoped to avoid changing the frozen exporters. Hiding potentially restricted text in the on-screen view without exposing the HTML export's different behavior would conceal a disclosure risk from the person publishing.

**How to apply:** Any future audience-filtering or export-preview work must compare its visible omissions against each actual exporter. If exporter behavior changes, revise both the warnings and the relevant tests together.