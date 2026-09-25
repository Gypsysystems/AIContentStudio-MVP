---
name: Review rule evidence
description: When Review may enforce language or style rules without inventing project requirements.
---

Real Review must not treat the mere presence of typography, table colors, or a default profile as a writing or formatting mandate. Only enforce writing or structure expectations when an explicit, observable rule is present in the current Review snapshot. Grammar and spelling can use a deliberately narrow pattern set when the snapshot declares a supported language; do not present that set as comprehensive proofreading.

**Why:** A canonical style profile can contain appearance defaults without asserting that a table requires a header, prose must use direct address, or every sentence must follow a particular style. Inferring those rules would generate false standards violations and muddy the separation between grounded Review and demo suggestions.

**How to apply:** Extend snapshot-backed checks only for concrete rules whose violations can be observed in persisted authored blocks. Carry the exact standard reference and block identity into findings. Leave unsupported rules unevaluated rather than guessing from nearby profile properties or silently changing Author content.