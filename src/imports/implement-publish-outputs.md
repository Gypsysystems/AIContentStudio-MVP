IMPLEMENT REAL OUTPUT GENERATION FOR THE EXISTING PUBLISH PAGE

IMPORTANT:

Do NOT redesign the Publish page.

Do NOT replace the existing layout.

The current Publish screen already contains:

- Output Configuration
- PDF / Word / HTML preview tabs
- Output Format selections
- Generate Outputs button
- Download PDF
- Download Word
- Download HTML

The problem is that Generate Outputs and Download actions currently do nothing.

Make these existing controls FUNCTIONAL.

This is a prototype publishing engine for workflow validation.

============================================================
1. CRITICAL REQUIREMENT
============================================================

Do not simulate successful output generation.

Do not display:

"Output ready"

unless actual downloadable files have been created in browser memory.

Every enabled Download button must download a real file.

============================================================
2. GENERATE OUTPUTS
============================================================

Make the existing:

Generate Outputs

button functional.

When clicked:

1. Read the current project's authored content.
2. Read the active Theme.
3. Read the active Brand & Style Profile.
4. Read the selected output configuration.
5. Apply applicable conditions and variables.
6. Generate each selected file.
7. Store generated Blob/object data in browser state.
8. Only then show "Output ready".

Show generation states:

Preparing content…
Applying Theme…
Applying styles…
Generating PDF…
Generating Word…
Generating HTML…
Finalizing…

If an individual format fails, show that format as failed while allowing successful formats to remain downloadable.

============================================================
3. OUTPUT FORMAT SELECTION
============================================================

Respect the existing checkboxes.

If only PDF is selected:

generate only PDF.

If Word + HTML are selected:

generate only DOCX and HTML ZIP.

Do not generate unchecked formats.

============================================================
4. PDF GENERATION
============================================================

Generate a REAL valid PDF.

Use a suitable browser-compatible PDF library available to the project.

The downloaded file must have:

.pdf

extension and valid PDF binary content.

Use actual current project content rather than hard-coded Nexus demo content.

At minimum include:

Document Title
H1
H2
H3
H4
Paragraphs
Bulleted lists
Numbered lists
Tables
Procedure steps
Notes
Warnings
Examples
Images where available

Apply selected Theme where practical:

Body font
Heading font
Heading colors
Body color
Table header colors
Callout styling

============================================================
5. PDF PAGE LAYOUT
============================================================

Use the selected PDF Page Layout configuration where practical.

Apply:

Page size
Orientation
Margins

Cover Page

Content Page

Header
Footer
Page numbers

Logo where available

Do not fabricate support for advanced pagination that is not implemented.

============================================================
6. PDF DOWNLOAD
============================================================

Make the existing Download PDF button functional.

Use Blob + browser download behavior.

Filename example:

Project-Name-User-Guide.pdf

The file must download when clicked.

Do not navigate away from the application.

============================================================
7. WORD / DOCX GENERATION
============================================================

Generate a REAL valid Microsoft Word .docx file.

Use an appropriate browser-compatible DOCX generation library.

Do NOT create an HTML file renamed to .docx.

The resulting ZIP-based DOCX structure must be valid.

Use actual project content.

Map semantic content approximately to:

Document Title

Paragraph

Heading 1
Heading 2
Heading 3
Heading 4

Bulleted lists

Numbered lists

Nested lists where supported

Tables

Procedure steps

Callouts

Images where supported

Captions where supported

============================================================
8. WORD STYLES
============================================================

Apply the active Brand & Style Profile where supported.

Map:

Body → Normal

H1 → Heading 1

H2 → Heading 2

H3 → Heading 3

H4 → Heading 4

Caption → Caption

Use configured font families and colors where supported.

If the selected primary font is unavailable:

use configured fallback font.

============================================================
9. WORD PAGE LAYOUT
============================================================

Apply where supported:

Page size

Orientation

Margins

Header

Footer

Logo

Page numbers

Cover page

Use the active Word/Page Layout configuration.

============================================================
10. WORD DOWNLOAD
============================================================

Make Download Word functional.

Download:

Project-Name-User-Guide.docx

Use actual generated DOCX Blob.

============================================================
11. HTML OUTPUT MODEL
============================================================

HTML is NOT a paginated document.

Do not render HTML using PDF page-layout logic.

Generate a responsive Help package based on:

Theme

Brand & Style Profile

HTML Master Pages

Master Page assignments

============================================================
12. HTML PACKAGE CONTENT
============================================================

Generate a REAL ZIP archive.

Use a browser-compatible ZIP library.

At minimum create:

index.html

topics/

css/

assets/

images/

Suggested structure:

index.html

topics/
introduction.html
getting-started.html
...

css/
theme.css

assets/

images/

============================================================
13. HTML HOME PAGE
============================================================

Generate index.html using the selected:

Home Page Master

Reflect enabled components such as:

Header

Logo

Search placeholder

Hero / Welcome content

Navigation

Footer

============================================================
14. HTML TOPIC PAGES
============================================================

Generate topic pages using:

Other Topics Master

or the topic's assigned custom Master Page.

Where enabled include:

Header

Breadcrumb

Left Navigation

Main Content

On This Page

Previous / Next

Footer

============================================================
15. HTML STYLES
============================================================

Generate CSS from the active Brand & Style Profile.

Map semantic components including:

body

h1
h2
h3
h4

links

ordered lists

unordered lists

tables

Note

Tip

Important

Warning

Example

Procedure

Code

Captions

============================================================
16. HTML MASTER PAGE ASSIGNMENTS
============================================================

Respect existing per-topic HTML Master Page assignments.

If no explicit assignment exists:

use Project Default Topic Master.

Home uses:

Project Default Home Master.

============================================================
17. HTML PORTABILITY
============================================================

Use relative links.

Do not depend on Figma preview URLs for core content.

The extracted HTML package should conceptually work as a standalone static Help site.

============================================================
18. HTML DOWNLOAD
============================================================

Make Download HTML functional.

Download:

Project-Name-User-Guide-html.zip

The ZIP must contain the generated package.

============================================================
19. CONDITIONAL CONTENT
============================================================

Respect the existing Conditions system.

Before generating output:

evaluate the active output conditions.

Exclude content that does not match.

Example:

Audience = Administrator

Edition = Enterprise

Do not show condition-authoring badges in published output.

============================================================
20. VARIABLES
============================================================

Resolve semantic Variables before publishing.

Example:

{{ProductName}}

must output its actual configured value.

Do not leave unresolved variable syntax in published output.

============================================================
21. THEME SAFETY
============================================================

Output generation must NOT change:

source authored content

TOC

conditions

variables

Theme

Style Profile

Page Layout

Master Pages

Publishing reads those configurations only.

============================================================
22. FORMAT-AWARE OUTPUT CONFIGURATION
============================================================

Keep the existing Publish layout, but make Output Configuration context-sensitive.

When PDF preview/tab is selected show relevant:

Theme

Brand & Style Profile

PDF Page Layout

Cover Layout

Content Layout

When Word is selected show:

Theme

Brand & Style Profile

Word Page Layout

Cover Layout

Content Layout

When HTML is selected show:

Theme

Brand & Style Profile

Home Master Page

Default Topic Master Page

Custom Master assignments

Do NOT show PDF page settings as HTML configuration.

============================================================
23. FORMAT-AWARE PREVIEW
============================================================

Improve existing preview behavior without redesigning the page.

PDF preview:
show paginated document appearance.

WORD preview:
show Word-style paginated document appearance.

HTML preview:
show browser/Help layout with:

Header
Navigation
Main Topic
On This Page
Footer

Do NOT show HTML as an A4 document.

============================================================
24. OUTPUT READY STATE
============================================================

Only show:

Output ready

after at least one selected file was actually generated.

Show separately:

PDF Ready
Word Ready
HTML Ready

Download button appears only when corresponding file Blob exists.

============================================================
25. DOWNLOAD BUTTON BEHAVIOR
============================================================

Existing Download buttons must:

create an object URL

trigger browser file download

release/revoke URL afterward where appropriate

They must NOT merely change UI state.

============================================================
26. ERROR HANDLING
============================================================

If generation fails:

show format-specific error.

Example:

PDF generation failed.

[Retry PDF]

Do not get stuck indefinitely in loading state.

============================================================
27. TEST PROJECT
============================================================

Create/use a temporary project:

Publish QA Test

Include:

Title

H1

H2

Paragraph

Bulleted list

Nested numbered list

3 × 3 table

Procedure with 3 steps

Warning

Note

Image if available

Variable

Conditional paragraph

============================================================
28. PDF ACCEPTANCE TEST
============================================================

Select only PDF.

Click Generate Outputs.

PASS ONLY IF:

PDF Ready appears.

Click Download PDF.

PASS ONLY IF:

a real .pdf file downloads
file size is greater than zero
file starts with valid PDF data
project content is represented

Do not report success merely because the UI says Ready.

============================================================
29. WORD ACCEPTANCE TEST
============================================================

Select only Word.

Generate.

Download.

PASS ONLY IF:

a real .docx file downloads
file size is greater than zero
file is a valid ZIP-based DOCX package

If Figma runtime cannot open Microsoft Word to test it:

report:

"Generated valid DOCX package; external Microsoft Word opening not programmatically validated."

============================================================
30. HTML ACCEPTANCE TEST
============================================================

Select only HTML.

Generate.

Download.

PASS ONLY IF:

ZIP downloads
ZIP is non-empty
contains index.html
contains at least one topic
contains CSS

============================================================
31. MULTI-FORMAT TEST
============================================================

Select:

PDF
Word
HTML

Generate Outputs.

PASS:

all three formats generate independently.

Each gets its own functional Download button.

============================================================
32. CONTENT CHANGE TEST
============================================================

Go back to Author.

Change a visible paragraph.

Return to Publish.

Generate outputs again.

PASS:

new output contains updated text.

This verifies publishing uses current project content rather than hard-coded sample content.

============================================================
33. THEME TEST
============================================================

Generate PDF using Theme A.

Switch to Theme B.

Generate again.

PASS:

content remains the same

presentation changes.

============================================================
34. FILENAME TEST
============================================================

Use sanitized project names.

Example:

"My User Guide v2"

becomes something like:

My-User-Guide-v2.pdf

My-User-Guide-v2.docx

My-User-Guide-v2-html.zip

============================================================
35. REGRESSION TEST
============================================================

After implementing publishing verify:

Back to Editor

Theme & Styles

Author

Review

Publish

continue to work.

============================================================
36. SELF-CORRECTION
============================================================

After implementation:

perform all tests above in the running prototype.

If an output test fails:

inspect the generated file logic

fix it

repeat the failed test

Do not knowingly leave:

Generate Outputs

or any Download button

non-functional.

============================================================
37. HONEST COMPLETION REPORT
============================================================

At completion report exactly:

IMPLEMENTED

PDF:
status

WORD:
status

HTML:
status

TESTED AND PASSED

FIXED DURING TESTING

NOT FULLY VALIDATED

LIMITATIONS

Do not claim a format passed if no actual downloadable file was created.

============================================================
38. IMPORTANT PRODUCT BOUNDARY
============================================================

This is a PROTOTYPE publishing engine.

Prioritize:

real downloadable files

correct current content

basic Theme/style application

workflow validation

Do NOT claim production-grade publishing parity with MadCap Flare.