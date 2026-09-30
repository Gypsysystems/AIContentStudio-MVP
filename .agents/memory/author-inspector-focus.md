---
name: Author inspector focus
description: Focus and visibility contract for Author contextual inspectors.
---

Closing a draft or grounding inspector should focus the AI Assist trigger while leaving the contextual drawer closed.

**Why:** Opening the drawer automatically after inspector close covers its own trigger in the editor toolbar, preventing users and existing rewrite flows from clicking AI Assist. Returning focus instead keeps the next action discoverable without putting a panel over the editor.

**How to apply:** When changing inspector dismissal or narrow-screen overlays, verify the Assist trigger is keyboard-focused, remains clickable, and can reopen the contextual actions. Do not restore the drawer as a side effect of closing the inspector.