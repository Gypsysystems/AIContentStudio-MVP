FIX BRAND GUIDELINE TYPOGRAPHY EXTRACTION

Do NOT redesign Brand & Style.
Do NOT change the working color extraction.
Do NOT hard-code any font family, brand name, color, or expected test value.

The current Brand Guidelines importer successfully extracts colors but fails to
reliably extract fonts and typography from the uploaded document.

Fix the existing implementation.

============================================================
1. DO NOT USE GENERIC FIRST-WORD FONT DETECTION
============================================================

The current extractor can incorrectly take the first capitalized text in a
table row as the font family.

For example, a typography table may contain columns such as:

Role | Font family | Weight | Size | Color

The font family must come specifically from the:

Font family

column.

Do not infer it from the first capitalized phrase in the row.

============================================================
2. PRESERVE DOCX TABLE CELLS
============================================================

The current DOCX table extraction flattens rows into a single joined string.

Change the DOCX table model so table structure is preserved.

Conceptually:

DocxTable {
  rows: string[][]
}

or equivalent.

Each cell must remain independently addressable.

Do not discard column boundaries.

============================================================
3. DETECT TYPOGRAPHY TABLE SCHEMAS
============================================================

Inspect table header rows.

Recognize columns such as:

Role
Style
Typography
Font
Font family
Typeface
Weight
Size
Default size
Color
Usage

Do not require exact capitalization.

If a table contains a Font family / Typeface column:

use the value from that column as the font family.

If it contains:

Weight
Size
Color

associate those values with the same typography role.

============================================================
4. SUPPORT TOKEN / SUMMARY TABLES
============================================================

Brand guidelines may also contain summary tables such as:

Token | Value | Description

where Token values may describe:

Heading font
Body font
Fallback font
Code font
Display font
Caption font

In this case:

the Value cell is the font family.

Detect these relationships from the actual uploaded document.

Do not hard-code the expected families.

============================================================
5. EXPLICIT TEXT PATTERNS
============================================================

Continue supporting normal prose such as:

Heading font: [value]
Body font: [value]
Fallback font: [value]
Code font: [value]

Also support common separators:

:
-
–
=
table cell boundary

Do not require only colon-based syntax.

============================================================
6. DOCX ACTUAL FONT METADATA
============================================================

For DOCX, add a secondary extraction method using the document package where
practical.

Inspect:

word/document.xml
word/styles.xml
theme/font information where available

Look for run/style font declarations such as:

w:rFonts
ascii
hAnsi
eastAsia
cs

This should be supporting evidence only.

Do NOT automatically treat every font used somewhere in the DOCX as an
approved brand font.

Explicit typography specifications take priority.

============================================================
7. PDF FONT EXTRACTION
============================================================

For PDF:

first use explicit text/table-like typography specifications.

Also inspect PDF.js text style/font metadata where available.

Use PDF metadata only as supporting evidence because embedded/subset font names
may not represent intended brand typography.

Never replace explicit guideline declarations with inferred PDF metadata.

============================================================
8. TYPOGRAPHY ROLE MAPPING
============================================================

Extract roles including where present:

Document Title
Display
Heading 1
Heading 2
Heading 3
Heading 4
Body
Caption
Code
Fallback
Custom

For each detected style store where available:

role
fontFamily
fontWeight
fontSize
color
sourceSnippet
detectionMethod
confidence

Do not invent missing values.

============================================================
9. CREATE FONT SUGGESTIONS FROM ACTUAL EXTRACTION
============================================================

The Brand Import review must show a Detected Fonts section.

Each unique family should appear once.

Show:

Font family
Suggested role
Source evidence
Detection method
Confidence

Possible detection methods:

Explicit label
Typography table
Summary/token table
DOCX style metadata
PDF font metadata

============================================================
10. USE TYPOGRAPHYSTYLES RESULTS
============================================================

The extractor already produces typographyStyles.

The current import workflow does not fully use them.

Fix this.

Brand Import Review must also expose detected typography styles where useful.

For example:

Heading 1
Font family
Weight
Size
Color

Body
Font family
Weight
Size
Color

Do not throw away typographyStyles after extraction.

============================================================
11. SAVE ACCEPTED TYPOGRAPHY INTO PROFILE
============================================================

When the author accepts the extracted typography:

apply accepted values to the new Brand & Style Profile.

Map accepted style information to:

Document title where supported
H1
H2
H3
H4
Body
Caption
Code

Also populate reusable font-role tokens such as:

Heading Font
Body Font
Fallback Font
Code Font

Do not replace detected values with default fonts unless the value was genuinely
not detected.

If a required value is missing:

retain the normal platform default

and identify it internally as:

Default / Not extracted

============================================================
12. FONT FAMILY NORMALIZATION
============================================================

Normalize obvious formatting differences only.

Examples:

leading/trailing whitespace
duplicate spaces
case-only duplicates

Do not rename font families.

Do not translate one font into another.

Do not assume similarly named fonts are equivalent.

============================================================
13. DIAGNOSTICS
============================================================

Expand Extraction Diagnostics with:

typography tables found
font-family cells detected
explicit font declarations detected
DOCX metadata font candidates
PDF metadata font candidates
accepted font families
typography styles detected

If zero fonts are found, show a useful reason.

Do not simply report:

"No font declarations detected"

when a typography table actually exists.

============================================================
14. SOURCE EVIDENCE
============================================================

Every detected font/typography style must retain evidence from the uploaded
document.

For table-based detection show something such as:

Source:
Typography table

Role:
Heading 1

Detected from:
Font family column

Do not fabricate page numbers.

============================================================
15. DO NOT TOUCH COLOR EXTRACTION
============================================================

Color extraction is currently working for the test guideline.

Do not regress it while modifying typography extraction.

After the fix:

both

Detected Colors

and

Detected Fonts / Typography

must populate from the same uploaded guideline.

============================================================
16. DOCUMENT-AGNOSTIC TEST
============================================================

Do NOT encode any expected font names in source code.

Test with at least two unrelated branding guidelines.

Guideline A and Guideline B should contain different typography systems.

The extracted font results must change according to the uploaded file.

No font from A may appear in B unless it genuinely exists in B.

============================================================
17. ACCEPTANCE TEST
============================================================

Upload a branding guideline containing:

a typography table
multiple typography roles
font-family values
weights
sizes

Run Brand Import.

PASS only if:

Detected Fonts contains the families actually written in the uploaded document.

Detected Typography includes the corresponding role mappings.

Accepted typography updates the saved Brand & Style Profile.

Reload the project.

Verify the saved typography remains.

Upload a different guideline.

Verify its fonts replace/change the detected results.

============================================================
18. COMPLETION REPORT
============================================================

Report:

DOCX typography table detection
PASS / FAIL

DOCX Font family column extraction
PASS / FAIL

Token/summary font extraction
PASS / FAIL

Explicit prose font extraction
PASS / FAIL

PDF font extraction
PASS / PARTIAL / FAIL

Typography role mapping
PASS / FAIL

TypographyStyles used by import review
PASS / FAIL

Accepted typography applied to Style Profile
PASS / FAIL

Typography persistence after reload
PASS / FAIL

Hard-coded font families in extraction logic
NONE / FOUND

Color extraction regression
NONE / FOUND