FIX BRAND GUIDELINE IMPORT — REAL DOCUMENT EXTRACTION

The current Brand Guidelines workflow accepts a document but does not actually extract the brand information from it.

This must become a functional prototype feature.

Do not redesign the Brand & Style UI.

The supplied test document contains explicit brand information including:

Primary color: Midnight #18314F
Secondary color: Teal #007F86
Accent color: Amber #F2B134
Background: Mist #F5F8FB
Surface: White #FFFFFF
Body Text: Slate #404C5A
Border: Cloud #D8E1EA
Success: Green #2E8B57
Warning: Orange #D97706
Critical: Red #B42318

Heading font: Aptos Display
Body font: Aptos
Fallback font: Arial
Code font: Consolas

The application must extract this information from the uploaded document rather than use hard-coded values.

====================================================
1. REAL FILE CONTENT EXTRACTION
====================================================

When a user uploads a branding guideline:

PDF:
Use a client-side PDF text parser such as pdfjs-dist / PDF.js.

DOCX:
Use a client-side DOCX text parser such as mammoth.

Do not only store:

filename
file size
MIME type

Actually extract document text.

Store:

brandImport.sourceFileId
brandImport.extractedText
brandImport.extractionStatus

Statuses:

Not started
Extracting
Extracted
Failed

If extraction fails, show a real error.

====================================================
2. COLOR EXTRACTION
====================================================

Scan extracted text for:

HEX values such as:
#18314F
#007F86
#F2B134

RGB values such as:
24, 49, 79

Also associate nearby labels with the color.

Recognize semantic labels such as:

Primary
Secondary
Accent
Background
Surface
Body Text
Heading
Border
Success
Warning
Critical
Info
Table Header

Example input:

Primary
Midnight
#18314F

Expected result:

{
  name: "Midnight",
  value: "#18314F",
  suggestedRole: "Primary"
}

Do NOT simply return every color found in the document.

Prefer colors explicitly presented as named brand colors.

====================================================
3. FONT EXTRACTION
====================================================

Detect font-family declarations from the document.

Recognize surrounding labels such as:

Heading font
Body font
Primary font
Fallback font
Code font
Caption font

Example:

Heading font: Aptos Display

Expected:

{
  family: "Aptos Display",
  suggestedRole: "Heading"
}

Expected test-document results:

Heading → Aptos Display
Body → Aptos
Fallback → Arial
Code → Consolas

====================================================
4. TYPOGRAPHY STYLE EXTRACTION
====================================================

Where clearly defined, extract:

style role
font family
font size
font weight
color

Example:

Heading 1
Aptos Display
22 pt
Semibold
#18314F

Map it as a proposed typography style.

Support at least:

Document Title
Heading 1
Heading 2
Heading 3
Heading 4
Body
Caption
Code

====================================================
5. DO NOT INVENT RESULTS
====================================================

If the document does not explicitly identify:

font size
weight
role
color

do not invent one.

Mark it as:

Not detected

The user can configure it manually.

====================================================
6. EXTRACTION REVIEW SCREEN
====================================================

After parsing:

show actual extracted findings.

Sections:

Detected Colors
Detected Typography
Detected Fonts
Detected Logo / Images
Other Brand Rules

Each item supports:

Accept
Ignore
Edit

Also provide:

Accept All Reviewed

====================================================
7. PROVENANCE
====================================================

For each detected item, retain:

source filename
detected text snippet
page if available
confidence / detection type

Example:

Primary Color
#18314F
Source: Asteria_Brand_Identity_Guidelines.pdf
Detected from:
"Primary | Midnight | #18314F"

Do not fabricate page references if the parser cannot determine them.

====================================================
8. LOGO EXTRACTION
====================================================

For DOCX:

attempt to identify embedded images using the DOCX package.

Show extracted images under:

Detected Logos / Images

Allow user to choose:

Use as Primary Logo
Use as Secondary Logo
Ignore

For PDF:

if reliable image extraction is not available in the prototype,
do NOT claim the logo was extracted.

Instead show:

"Logo image extraction from PDF is not available in this prototype."

Provide:

Upload Logo Separately

This is acceptable.

====================================================
9. CREATE BRAND & STYLE PROFILE
====================================================

When the user accepts findings:

create a new Brand & Style Profile using the accepted values.

Do not copy values from demo/default profile.

Example profile:

Asteria Brand

Colors:
Primary #18314F
Secondary #007F86
Accent #F2B134
Background #F5F8FB
Surface #FFFFFF
Body Text #404C5A
Border #D8E1EA
Success #2E8B57
Warning #D97706
Critical #B42318

Typography:
Heading Font = Aptos Display
Body Font = Aptos
Fallback = Arial
Code Font = Consolas

====================================================
10. LIVE PROFILE UPDATE
====================================================

After Save:

auto-select the newly created profile.

Brand & Style controls must display the extracted values.

Theme preview must update.

Page Layout preview should inherit the accepted colors and fonts.

HTML Master Page preview should inherit them.

====================================================
11. PERSISTENCE
====================================================

Persist:

uploaded guideline metadata
extracted brand data
accepted/ignored state
created Brand & Style Profile

Reload the application.

The extracted/saved profile must remain.

====================================================
12. PDF TEST
====================================================

Upload:

Asteria_Brand_Identity_Guidelines.pdf

EXPECTED DETECTIONS:

Primary
Midnight
#18314F

Secondary
Teal
#007F86

Accent
Amber
#F2B134

Background
Mist
#F5F8FB

Surface
White
#FFFFFF

Body Text
Slate
#404C5A

Border
Cloud
#D8E1EA

Success
Green
#2E8B57

Warning
Orange
#D97706

Critical
Red
#B42318

Heading font:
Aptos Display

Body font:
Aptos

Fallback:
Arial

Code:
Consolas

PASS only if these are extracted from actual file content.

====================================================
13. DOCX TEST
====================================================

Repeat using:

Asteria_Brand_Identity_Guidelines.docx

Verify the same primary brand data is found.

DOCX may additionally expose embedded logo images.

====================================================
14. NO HARDCODING
====================================================

Critical:

Do NOT hard-code Asteria values into the application.

After Asteria testing, upload a different document.

Results must derive only from that document.

====================================================
15. COMPLETION REPORT
====================================================

Report:

PDF text extraction:
PASS / FAIL

DOCX text extraction:
PASS / FAIL

Color extraction:
PASS / FAIL

Font extraction:
PASS / FAIL

Typography extraction:
PASS / FAIL

Logo extraction:
PASS / PARTIAL / FAIL

Profile creation:
PASS / FAIL

Profile persistence:
PASS / FAIL

Theme propagation:
PASS / FAIL

Also state which libraries were used.

Do not report PASS based on filename upload alone.