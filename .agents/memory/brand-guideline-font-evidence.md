---
name: Brand guideline font evidence
description: Why brand typography imports require explicit role-local font declarations.
---

Brand guideline imports should assign a font family to a semantic typography role only when that role's own table row or nearby labeled text explicitly names it. Unknown roles and missing family cells remain unresolved, even if other roles use a known family.

**Why:** A PDF's embedded font metadata describes how the PDF was rendered, not necessarily the brand's intended type system. Inferring a role from metadata or a neighboring row can silently replace "Not detected" with the wrong font.

**How to apply:** When extending brand PDF/DOCX extraction, preserve row-local evidence and source snippets. Treat internal PDF resource IDs and generic CSS families as non-brand values; keep metadata diagnostic rather than using it to fill an unmatched semantic role.