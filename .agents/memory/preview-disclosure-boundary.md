---
name: Conditional export safety
description: Keep Preview, Publish, and downloadable HTML aligned with the selected audience condition.
---

When a full-project Preview masks conditional blocks because no audience is selected, HTML must reject export rather than include them. With a valid selected condition, filter matching blocks in Preview and every HTML output surface, including topic pages, search, and media. Word and PDF still reject conditional blocks. Bind generated download availability to both the selected condition and the exact project snapshot; changing either invalidates stale download cards. A hidden HTML master Body block causes HTML generation to fail rather than silently omitting authored content.

**Why:** Masking restricted text in Preview while HTML included it was an unsafe mismatch. Fixing the exporter alone left a second disclosure path: after switching audiences, the Publish UI could still offer a ZIP generated for the previous audience.

**How to apply:** Any future audience-filtering or export-preview work must compare its visible omissions against each actual exporter and bind cached/downloadable files to their inputs. If exporter behavior changes, revise warnings and tests together.