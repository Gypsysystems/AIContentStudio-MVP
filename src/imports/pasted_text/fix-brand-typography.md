FIX BRAND TYPOGRAPHY TABLE MAPPING — FONT FAMILY COLUMN IS EMPTY

Do NOT redesign the Brand Import UI.
Do NOT change the working color extraction.
Do NOT hard-code any brand font names, colors, sizes, or expected values.

CURRENT BUG:

The Brand Import screen successfully displays typography rows such as:

Document Title
Heading 1
Heading 2
Heading 3
Body
Caption
Code

and extracts:

Weight
Size
Color

but the FONT FAMILY column is empty for every row.

Some typography values also appear shifted between rows.

This proves that typography is being detected, but the table column-to-role mapping is incorrect.

Fix the actual extraction/mapping logic.

============================================================
1. PRESERVE TABLE ROWS AND COLUMNS EXACTLY
============================================================

Do not flatten typography tables into strings before parsing them.

A typography table must remain structurally equivalent to:

[
  ["Role", "Font Family", "Weight", "Size", "Color"],
  ["...", "...", "...", "...", "..."],
  ...
]

Each row must retain its original cell boundaries.

Do not concatenate the cells and later try to recover them with regex.

============================================================
2. DETECT THE HEADER ROW FIRST
============================================================

Before parsing typography rows, identify the table header.

Normalize header text for matching:

trim whitespace
lowercase
collapse duplicate spaces

Recognize equivalents such as:

Role
Style
Typography Role

Font Family
Font
Typeface
Font Name

Weight
Font Weight

Size
Font Size
Default Size

Color
Text Color

Build a column-index map.

Conceptually:

{
  role: 0,
  fontFamily: 1,
  weight: 2,
  size: 3,
  color: 4
}

Do NOT assume fixed column positions unless the header confirms them.

============================================================
3. READ FONT FAMILY FROM THE FONT FAMILY CELL
============================================================

For each typography row:

role = row[roleColumn]
fontFamily = row[fontFamilyColumn]
weight = row[weightColumn]
size = row[sizeColumn]
color = row[colorColumn]

The font family must NOT come from:

the role name
the first capitalized phrase
the document's default font
the current UI font
a regex scanning the entire row

Use the actual Font Family / Typeface table cell.

============================================================
4. DO NOT SHIFT VALUES BETWEEN ROWS
============================================================

All values shown for one typography role must come from the SAME source row.

Never map:

Role from row N
Font from row N+1
Size from row N-1

Preserve row integrity.

Add a development assertion/debug check:

sourceRowIndex

to each detected typography style.

============================================================
5. HANDLE MERGED / BLANK CELLS SAFELY
============================================================

Some documents may contain merged cells or intentionally blank values.

If Font Family is genuinely blank:

show Not detected.

Do NOT borrow the font family from another row unless the document explicitly
uses an inheritance rule.

If the document states something such as:

"All headings use [family]"

then inheritance may be applied only when that relationship is explicit.

Record:

detectionMethod = "Inherited from explicit typography rule"

============================================================
6. DOCX — PARSE TABLE XML WHEN NEEDED
============================================================

For DOCX, Mammoth HTML/text conversion may lose important table/style metadata.

Where necessary, inspect the DOCX ZIP directly using the existing JSZip capability.

Parse:

word/document.xml

and preserve:

w:tbl
w:tr
w:tc

as real table → row → cell structure.

Extract text inside each cell in document order.

Also inspect where useful:

word/styles.xml
word/theme/theme1.xml

for supporting font information.

Explicit typography table values have priority over metadata.

============================================================
7. PDF — RECONSTRUCT TABLE ROWS BY POSITION
============================================================

PDF.js returns positioned text fragments rather than semantic table cells.

For PDF typography tables:

use x/y coordinates to reconstruct rows and columns.

Group text fragments that share approximately the same Y position into one row.

Use X position and detected header locations to assign fragments to:

Role
Font Family
Weight
Size
Color

Do not rely only on PDF text extraction order.

If table reconstruction cannot be done confidently:

show the row as partially detected rather than shifting values into incorrect columns.

============================================================
8. VERIFY FONT TEXT EXISTS IN EXTRACTED DOCUMENT
============================================================

Add diagnostics for each typography table:

Typography table found: Yes/No
Header cells detected
Role column index
Font Family column index
Weight column index
Size column index
Color column index

For each row show development diagnostics such as:

sourceRow
roleRaw
fontFamilyRaw
weightRaw
sizeRaw
colorRaw

This diagnostic view can remain collapsed by default.

This will make it immediately clear whether the font name was read from the source.

============================================================
9. TYPOGRAPHY REVIEW MUST USE THE SAME ROW OBJECT
============================================================

The "Detected Typography Styles" UI must render directly from the correctly
parsed typography style object.

Example conceptual object:

{
  role,
  fontFamily,
  fontWeight,
  fontSize,
  color,
  sourceRowIndex,
  sourceTableIndex,
  detectionMethod
}

Do not separately recalculate Font Family in the UI.

============================================================
10. DETECTED FONTS MUST BE DERIVED FROM TYPOGRAPHY STYLES
============================================================

After typography rows are parsed correctly:

derive the unique Detected Fonts list from:

typographyStyles[].fontFamily

plus any explicit standalone typography declarations.

Deduplicate exact/normalized family names.

Do not invent families.

============================================================
11. INVALID FONT CANDIDATE FILTER
============================================================

Do not accept these as font-family values:

Heading 1
Heading 2
Body
Caption
Code
Semibold
Regular
Bold
Medium
Primary
Secondary
Title

These are roles or weights, not font families.

============================================================
12. ACCEPTED PROFILE MAPPING
============================================================

When the user accepts typography:

store the actual extracted font family against the corresponding semantic style.

For example conceptually:

H1.fontFamily = extracted H1 fontFamily
Body.fontFamily = extracted Body fontFamily

Do not silently substitute the platform default font.

If extraction failed:

show:

Not detected

and leave the fallback/default clearly distinguishable from extracted values.

============================================================
13. TEST DOCX FIRST
============================================================

Test the same Brand Guideline using its DOCX version first.

Inspect the typography table.

PASS only if:

Font Family values displayed in Brand Import match the values physically written
in the uploaded DOCX table.

Also verify:

Role
Weight
Size
Color

all come from the SAME source row.

============================================================
14. THEN TEST PDF
============================================================

Upload the PDF version of the same guideline.

Verify the same typography information.

If PDF table reconstruction is less reliable than DOCX:

report PDF as PARTIAL.

Do not fill missing font families using DOCX test values or hard-coded data.

============================================================
15. NO BRAND-SPECIFIC VALUES IN CODE
============================================================

Search the implementation for test brand font names.

There must be no special cases for the current test guideline.

The parser must work with another unrelated brand guideline.

============================================================
16. COMPLETION REPORT
============================================================

Report:

DOCX table cells preserved
PASS / FAIL

Typography header mapping
PASS / FAIL

Font Family column identified
PASS / FAIL

Font family values extracted from same source row
PASS / FAIL

Weight/size/color row alignment
PASS / FAIL

DOCX typography extraction
PASS / FAIL

PDF typography table reconstruction
PASS / PARTIAL / FAIL

Detected Fonts derived from extracted typography
PASS / FAIL

Accepted font families saved to Style Profile
PASS / FAIL

Hard-coded test font values
NONE / FOUND