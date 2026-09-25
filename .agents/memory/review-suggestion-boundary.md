---
name: Review suggestion boundary
description: Limits on real Review corrections and their relationship to authored content and history.
---

Only high-confidence, deterministic spelling suggestions are eligible for Review Apply. An explicit diff is a proposal, not permission to write. Recheck the current Review snapshot, run, topic/block IDs, full block text and fingerprint immediately before the edit. Change only that exact text, record the applied resolution, and use Author's normal content update path so generated baselines and manual/approved/mixed block states are not silently replaced.

**Why:** A finding can outlive its source text or be viewed from old Review history. Applying an old suggestion to a different or since-edited block would corrupt authored content and could falsely preserve generated-content provenance.

**How to apply:** Keep other Review categories without automatic Apply unless they receive their own narrow, verified diff policy. Reject and Dismiss record a status/history decision only; neither edits authored content. A successful Apply increments authored content revision and consequently stales findings from its old input snapshot.