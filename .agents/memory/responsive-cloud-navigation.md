---
name: Responsive cloud navigation
description: Tradeoff between immediate section changes and preserving guarded whole-project saves.
---

Cloud section navigation may update the interface before a remote save finishes, but leave-project navigation and Review-to-Author transitions must retain save barriers. Development-mode local navigation should also retain its barrier.

**Why:** Cloud readiness checks and whole-project writes make ordinary navigation feel delayed. Local writes are cheap, and some local workflows depend on a completed save before directly inspecting or editing IndexedDB; removing that barrier caused timing-dependent persistence failures. A failed cloud write must remain visible with an explicit retry, not be silently treated as saved.

**How to apply:** Coalesce only the latest queued snapshot while preserving one revision-guarded write at a time. Tie queued writes and status updates to the active project generation, and never overwrite newer queued state with an older timer. Keep the saved indicator visible until a new edit, a failure, or a project reset; old status timers must not clear a later result.