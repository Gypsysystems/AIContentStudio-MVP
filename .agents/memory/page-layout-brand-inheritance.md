---
name: Layout and master brand inheritance
description: Rules for combining canonical Brand Profile defaults with local Page Layout and HTML Master overrides
---

Page Layout and HTML Master presentation defaults should be resolved dynamically from the canonical applied Brand Profile rather than copied into each layout, master, or block.

**Why:** Copying brand values makes previews stale after a profile change and makes intentional local values indistinguishable from generated defaults. Existing persisted layout and block styling must remain authoritative.

**How to apply:** Treat new layouts and blocks as inherited by default. Store only local overrides, provide reset actions that delete the relevant override, and resolve preview colors, typography, borders, component accents, and logo assets at render time. Do not route published output through these preview resolvers until a separate milestone.