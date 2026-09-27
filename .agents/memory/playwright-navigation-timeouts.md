---
name: Playwright navigation timeouts
description: Distinguishing slow full-suite dev-server navigation from application assertions.
---

The full Playwright UI suite can exceed its default navigation timeout before tests reach their assertions, even when the test server answers HTTP requests. A cold transform of the large app module may itself take longer than that timeout; warming that module alone has not reliably eliminated full-suite browser stalls.

**Why:** Repeated full-suite attempts with parallel workers, a single worker, and a warmed test server stalled at browser navigation in unrelated Administration tests. Focused AI tests completed when given a longer timeout. This is not evidence that those unrelated assertions failed, nor proof that the entire suite passes.

**How to apply:** Inspect failed traces for pending module requests and separate navigation timeouts from assertion failures. Use focused checks with a longer timeout to verify changed functionality when appropriate, but report a blocked full-suite run honestly rather than treating targeted passes as a full regression.