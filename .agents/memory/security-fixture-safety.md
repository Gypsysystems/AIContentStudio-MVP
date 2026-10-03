---
name: Security fixture safety
description: Keeping positive scanner examples effective without triggering provider-secret push protection.
---

Use unmistakably synthetic, non-provider-shaped literals for generic credential-rule fixtures. Never commit complete provider-secret-shaped examples, even when their values are invented.

**Why:** GitHub push protection rejected an invented Stripe-shaped positive fixture. Fragmenting it at runtime avoided the contiguous token but also removed the intended static detection; formatting the logging example across lines independently removed another regex-based detection.

**How to apply:** Check the actual local scanner against every expected positive rule and the negative fixture after sanitization or formatting. Check tracked source for contiguous provider-secret shapes without printing values. A successful source sanitizer alone does not prove positive scanner coverage.