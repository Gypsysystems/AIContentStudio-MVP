---
name: Page layout brand inheritance
description: Rules for combining canonical Brand Profile defaults with local Page Layout overrides
---

Page Layout presentation defaults should be resolved dynamically from the canonical applied Brand Profile rather than copied into each layout.

**Why:** Copying brand values makes layouts stale after a profile change and makes intentional layout-specific values indistinguishable from generated defaults. Existing layouts created before inheritance metadata must keep their stored background as an explicit override.

**How to apply:** Treat new layouts as inherited by default. Store only local overrides, provide a reset that removes an override, and resolve preview colors, typography, borders, and logo assets at render time. Do not route published output through this preview resolver until a separate milestone.