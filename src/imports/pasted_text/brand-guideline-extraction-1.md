============================================================
REAL BRAND GUIDELINE EXTRACTION — NO HARDCODED BRAND DATA
============================================================

The Brand Guidelines import must analyze the ACTUAL uploaded document.

The previous implementation successfully detected some typography information but failed to detect the document's color palette.

Fix this without hard-coding any test brand values.

IMPORTANT:

Do NOT put any expected:
- HEX values
- RGB values
- color names
- font names
- logo names
- brand names
- typography values

into the application logic.

The uploaded guideline is the ONLY source of truth.

============================================================
1. PARSE THE ACTUAL UPLOADED FILE
============================================================

When the user uploads a PDF or DOCX branding guideline:

actually read and parse the uploaded document.

PDF:
extract textual content and document structure where possible.

DOCX:
extract paragraphs, tables, styles, text formatting, and embedded images where possible.

Do not perform analysis based only on:

filename
file type
file size
previous test data
default Theme
existing profile
sample constants

Store the extracted source information so it can be reviewed and reused.

============================================================
2. EXTRACT COLORS FROM DOCUMENT CONTENT
============================================================

Analyze the uploaded guideline for brand colors.

Detect color values expressed in formats such as:

HEX
RGB
RGBA
HSL
CMYK where parsable

Also analyze surrounding text to determine whether a detected color is actually part of the official brand palette.

Examples of semantic roles that may appear:

Primary
Secondary
Accent
Background
Surface
Heading
Body Text
Border
Link
Success
Warning
Critical
Information
Table Header
Custom brand color

These are role categories only.

Do NOT assign any predefined color values to them.

============================================================
3. READ COLORS FROM TABLES
============================================================

Brand guidelines frequently define colors inside tables.

The parser must inspect table cells.

For example, if a row contains:

role/name
color name
color value
usage

associate those values together as one proposed brand color.

Do not extract only normal paragraphs and ignore tables.

============================================================
4. DETECT VISUAL COLOR SWATCHES WHERE POSSIBLE
============================================================

A brand guideline may show a colored rectangle/swatches alongside a label rather than relying only on text.

Where the document format exposes fill/background information:

inspect:

table-cell fills
shape fills
text colors
paragraph/background styling
drawing/object fills

Use this information as supporting evidence.

Do not simply collect every color used in the document.

A decorative color does not automatically become a brand token.

============================================================
5. COLOR NORMALIZATION
============================================================

Normalize detected colors into a consistent internal representation.

Where possible store:

originalValue
normalizedHex
RGB
colorName if explicitly stated
suggestedRole
sourceContext
sourcePage or section if available
detectionMethod

Example detection methods:

Explicit text
Table value
Cell fill
Shape fill
Text formatting

Do not invent missing values.

============================================================
6. DUPLICATE COLORS
============================================================

If the same color appears multiple times:

merge the detections into one proposed brand color where appropriate.

Keep its supporting source locations.

Do not create several identical palette entries unnecessarily.

============================================================
7. TYPOGRAPHY EXTRACTION
============================================================

Continue extracting typography from the uploaded guideline.

Detect explicit relationships between:

font family
style role
font size
weight
line height
text color
alignment where specified

Potential semantic roles include:

Document Title
Heading 1
Heading 2
Heading 3
Heading 4
Body
Caption
Code
Fallback
Custom

Again:

do NOT hard-code font families or style values.

Derive them only from the uploaded document.

============================================================
8. FONT DETECTION SOURCES
============================================================

For DOCX, consider both:

explicit written specifications

AND

actual document styles/formatting where accessible.

For PDF, prioritize:

explicit textual typography specifications

and available font metadata where reliably accessible.

Clearly distinguish:

Explicitly specified
Inferred from document formatting

============================================================
9. LOGO / IMAGE DETECTION
============================================================

For DOCX:

inspect embedded images.

Present likely branding images under:

Detected Logos / Images

Allow:

Use as Primary Logo
Use as Secondary Logo
Ignore

Do not automatically assume every embedded image is a logo.

For PDF:

attempt extraction only if technically reliable.

Otherwise clearly state:

Logo could not be automatically extracted from this PDF.

Allow manual logo upload.

============================================================
10. BRAND EXTRACTION REVIEW
============================================================

After extraction, show:

Detected Colors
Detected Typography
Detected Fonts
Detected Logos / Images
Detected Brand Rules

The review screen must show values that came from THIS uploaded document.

For each item provide:

Accept
Edit
Ignore

Provide:

Accept All Reviewed

============================================================
11. SHOW SOURCE EVIDENCE
============================================================

Each finding should provide enough information to prove where it came from.

For example:

Detected from:
Typography section

or:

Detected from:
Color Palette table

or:

Detected from:
Document table / cell fill

Where technically possible also show:

page
section
surrounding text

Do not fabricate page numbers.

============================================================
12. DO NOT USE EXISTING THEME VALUES AS DETECTIONS
============================================================

Existing Theme colors or fonts must not appear as if they were extracted.

Keep these concepts separate:

Existing profile
Detected from guideline
User edits

Only values actually detected from the uploaded guideline appear under:

Detected

============================================================
13. CREATE PROFILE FROM ACCEPTED FINDINGS
============================================================

After the author accepts the findings:

create a Brand & Style Profile from those accepted values.

The saved profile must use exactly the accepted:

colors
typography
fonts
logo selections
brand rules

Do not replace missing values with sample brand data.

Where a required profile value was not detected:

use the normal platform default only as a fallback,

and label it internally as:

Default / Not extracted

============================================================
14. BRAND IMPORT MUST BE DOCUMENT-AGNOSTIC
============================================================

This is critical.

The implementation must work with different companies and different brand guidelines.

Test using at least two branding documents with clearly different:

color palettes
font families
brand names

After importing Document A:

Profile A must reflect Document A.

After importing Document B:

Profile B must reflect Document B.

There must be no values carried from A into B.

============================================================
15. COLOR EXTRACTION ACCEPTANCE TEST
============================================================

Upload a branding guideline that contains:

multiple named brand colors
explicit color values
typography definitions

Do NOT tell the extraction logic what those values are.

Before parsing:

the application must have no knowledge of the expected results.

Run extraction.

Manually compare the detected palette against the source document.

PASS only if the values shown in Detected Colors were discovered from the uploaded file.

============================================================
16. SECOND-DOCUMENT TEST
============================================================

Upload a completely different branding guideline.

Its palette and typography should be materially different.

Run extraction again.

PASS only if:

the detected results change according to the new document

and

no values from the previous guideline appear unless they genuinely exist in the new document.

This test is mandatory because it proves the extraction is not hard-coded.

============================================================
17. DEBUG INFORMATION
============================================================

For development/testing only, provide an expandable:

Extraction Diagnostics

Show:

file successfully parsed
number of text blocks extracted
number of tables found
number of potential color values found
number of accepted brand-color candidates
number of font candidates
number of embedded images
parsing warnings

This helps diagnose failures without exposing technical complexity in the normal UI.

============================================================
18. FAILURE HANDLING
============================================================

If no colors are found:

do NOT silently populate defaults as detected colors.

Show:

"No brand colors could be confidently extracted from this document."

Provide:

Review extracted content
Enter Colors Manually
Try Another File

Similarly for typography.

============================================================
19. PERSISTENCE
============================================================

Persist:

source guideline
extraction result
review decisions
accepted profile
ignored findings

Reload the project.

Everything must remain.

============================================================
20. COMPLETION REPORT
============================================================

Report:

Actual file parsed:
PASS / FAIL

Tables analyzed:
PASS / FAIL

Text color values analyzed:
PASS / FAIL

Table/shape fills analyzed where supported:
PASS / PARTIAL / FAIL

Brand colors extracted from document:
PASS / FAIL

Typography extracted from document:
PASS / FAIL

Fonts extracted from document:
PASS / FAIL

Logo/images extracted:
PASS / PARTIAL / FAIL

Second unrelated guideline test:
PASS / FAIL

Hard-coded brand values:
NONE / FOUND

If hard-coded brand-specific values remain anywhere in the extraction path,
report their location and remove them.

Do not mark Brand Extraction PASS merely because fonts were detected.

Color extraction and typography extraction must be validated independently.

============================================================
FINAL PRINCIPLE
============================================================

Brand Guidelines Import means:

UPLOAD DOCUMENT
→ PARSE DOCUMENT
→ DISCOVER BRAND INFORMATION
→ SHOW EVIDENCE
→ HUMAN REVIEW
→ CREATE PROFILE

It must never mean:

UPLOAD DOCUMENT
→ LOAD PREDEFINED SAMPLE BRAND.