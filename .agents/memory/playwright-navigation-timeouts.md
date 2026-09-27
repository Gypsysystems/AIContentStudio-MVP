---
name: Playwright navigation timeouts
description: Distinguishing slow full-suite dev-server navigation from application assertions.
---

The full Playwright UI suite can exceed its default navigation timeout before tests reach their assertions, even when the test server answers HTTP requests. A cold transform of the large app module may itself take longer than that timeout; warming that module alone has not reliably eliminated full-suite browser stalls.

**Why:** Repeated full-suite attempts with parallel workers, a single worker, and a warmed test server stalled at browser navigation in unrelated Administration tests. Focused AI tests completed when given a longer timeout. This is not evidence that those unrelated assertions failed, nor proof that the entire suite passes.

**How to apply:** Inspect failed traces for pending module requests and separate navigation timeouts from assertion failures. Warming one HTTP module is not sufficient; a real browser page load before parallel tests makes Vite finish the transitive graph without changing individual test timeouts. Still report a blocked full-suite run honestly rather than treating targeted passes as a full regression.

Direct IndexedDB test fixtures have a separate reload race: a successful `put()` request does not mean the transaction committed. Reloading after request success can discard fixture data and make unrelated assertions appear flaky.

**Why:** Two Author tests intermittently lost the patched project structure after an immediate reload in the complete parallel suite, while focused runs passed.

**How to apply:** When a test fixture patches IndexedDB and then reloads, await the transaction's `complete` event and fail on `abort`, rather than resolving on an individual request's `success` event.

Long, multi-stage UI fixtures can spend almost all of a short test budget before reaching their actual assertion, while asynchronous uploads may render a file before its save completes.

**Why:** In a complete parallel run, a source appeared in the UI while the header still said "Saving changes"; a separate multi-stage Author test reached reload with only a couple of seconds left. Neither failure demonstrated a broken Author feature.

**How to apply:** Wait for the app's explicit save-complete signal before checking persisted upload state. Give only an inherently long test its own sufficient budget; do not increase the suite-wide timeout or remove assertions.