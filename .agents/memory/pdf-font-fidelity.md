---
name: PDF font fidelity
description: Why PDF export maps brand typography to bundled fonts instead of claiming custom embedding
---

Use bundled PDF fonts when they match the requested profile family. Otherwise, use a configured fallback if it maps to a bundled font, then use the renderer's standard sans-serif. Preserve the profile's sizes, spacing, and colors independently of that substitution.

**Why:** The publish projection contains family names but no usable font-file bytes. Naming a custom family in a PDF without embedding the font would claim fidelity the file cannot deliver.

**How to apply:** Only add custom-font embedding in a separately scoped change that supplies actual licensed, usable font bytes and verifies the embedded fonts in the generated PDF.