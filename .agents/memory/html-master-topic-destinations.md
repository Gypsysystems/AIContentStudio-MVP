---
name: HTML master topic destinations
description: Rules for linking HTML Master navigation cards to the central project TOC
---

Navigation cards that target documentation content must store the central TOC item's stable numeric ID, not its title or breadcrumb path.

**Why:** TOC titles and hierarchy can change while IDs remain stable. Saving display text as the destination would break links on rename and hide deleted references.

**How to apply:** Resolve titles and breadcrumb paths from the live central TOC at preview time. Preserve card content independently from destination metadata, normalize legacy component type names safely, and show a clear broken-link state when a stored topic ID no longer exists. Keep published output unchanged until its own milestone.