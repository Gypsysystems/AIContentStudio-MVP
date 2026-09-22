FINAL PUBLISH FIDELITY PASS

Improve ONLY the Publish/output rendering engine and output previews.

Do NOT redesign or modify:

Project Details
Theme & Styles
Sources
Analysis
TOC
Authoring
Knowledge Map
Review

The Review workflow is complete and must remain unchanged.

GOAL

Content Studio must generate visually credible, professional outputs from the SAME structured authored content in:

1. PDF
2. Microsoft Word DOCX
3. Responsive HTML Help Package

The outputs must reflect:

- current authored content
- selected Theme
- selected Brand & Style Profile
- conditions
- variables
- PDF/Word Page Layouts
- HTML Master Pages
- images/media
- semantic document structure

This is still a prototype publishing engine, but the generated files must look representative of the finished product.

Do NOT simulate successful generation.

============================================================
1. CORE PUBLISHING ARCHITECTURE
============================================================

Use this publishing model:

STRUCTURED CONTENT
        ↓
CONDITIONS + VARIABLES
        ↓
BRAND & STYLE PROFILE
        ↓
FORMAT-SPECIFIC RENDERER
        ↓
PDF / DOCX / HTML

The content itself must remain format-independent.

Do NOT modify authored content during publishing.

============================================================
2. FORMAT-SPECIFIC CONFIGURATION
============================================================

Make Output Configuration change according to the selected preview/output format.

PDF shows:

Theme
Brand & Style Profile
PDF Layout Pack
Cover Page Layout
Content Page Layout
Conditions / Output Variant

WORD shows:

Theme
Brand & Style Profile
Word Layout Pack
Cover Page Layout
Content Page Layout
Conditions / Output Variant

HTML shows:

Theme
Brand & Style Profile
Home Page Master
Default Topic Master
Custom Master Page Assignments
Conditions / Output Variant

Do NOT display PDF page-layout information when HTML is selected.

============================================================
3. OUTPUT VARIANT
============================================================

Add:

Output Variant

A Variant combines:

Theme
Brand & Style Profile
Conditions
Output Templates
Formats

Example:

Presight External Documentation

Another:

Government Client Documentation

Allow:

Create
Duplicate
Rename

The same project content can use different variants without duplicating the content.

============================================================
4. PDF OUTPUT — TARGET QUALITY
============================================================

Improve PDF rendering so it resembles a professionally published technical manual.

The PDF must support, where represented in the project:

Cover Page

Generated Table of Contents

Document Title

H1
H2
H3
H4

Paragraphs

Ordered Lists

Unordered Lists

Nested Lists

Mixed Lists

Procedures

Tables

Notes

Tips

Important blocks

Warnings

Examples

Code Blocks

Images

Figure Captions

Table Captions

Cross-references where technically supported

Variables

Conditional Content

============================================================
5. PDF COVER PAGE
============================================================

Use the selected Cover Page Layout.

Render the configured elements in the configured regions.

Examples:

Logo
Document Title
Subtitle
Product Name
Version
Date
Confidentiality
Client metadata where configured
Brand decoration

Do not use hard-coded Nexus/Presight placeholder values.

Use the current project metadata.

============================================================
6. PDF CONTENT PAGES
============================================================

Use selected Content Page Layout.

Respect:

A4 / Letter / Custom page size

Portrait / Landscape

Margins

Header height

Footer height

Header elements

Footer elements

Page numbers

Logo

Document title

Chapter/topic title

Version

Copyright

Confidentiality

============================================================
7. PDF TABLE OF CONTENTS
============================================================

Generate a real document TOC from the current topic hierarchy.

Reflect H1–H4/topic hierarchy.

Where page-number calculation is technically available, show page numbers.

If page numbers cannot be calculated reliably in the browser prototype:

do NOT fabricate them.

Use a clean TOC without fake pagination.

============================================================
8. PDF TYPOGRAPHY
============================================================

Apply the active Brand & Style Profile.

Use:

Body Font
Heading Font
Fallback Font
Code Font

Apply configured:

font sizes
weights
colors
line heights
spacing

If the primary font cannot be embedded:

use the configured fallback.

Do not silently substitute unrelated fonts.

============================================================
9. PDF TABLES
============================================================

Render table styles from the Brand & Style Profile:

Header background
Header text
Body text
Borders
Cell padding
Alternate-row shading
Captions

Avoid clipped text.

Allow tables to wrap content correctly.

Avoid splitting a small table unnecessarily when practical.

============================================================
10. PDF CALLOUTS
============================================================

Render:

Note
Tip
Important
Warning
Example

using their configured semantic styles.

Include:

Label
Accent
Background
Text

Do not use authoring condition badges or editor controls in output.

============================================================
11. PDF PROCEDURES
============================================================

Render procedures clearly.

Maintain:

Procedure Title
Intro
Prerequisites
Step numbering
Nested bullets
Substeps
Notes/Warnings
Expected Result

Do not flatten procedures into plain paragraphs.

============================================================
12. PDF MEDIA
============================================================

Render uploaded images.

Respect:

alignment
caption
maximum width
aspect ratio

Do not output broken object URLs.

Embed image data properly where required.

============================================================
13. PDF PAGINATION QUALITY
============================================================

Avoid obvious layout problems:

heading stranded at bottom of page

callout label separated from callout

table header separated incorrectly

procedure step number separated from step text

caption separated from image where practical

Do not claim advanced pagination parity with MadCap Flare if browser generation cannot support it.

============================================================
14. WORD DOCX — TARGET QUALITY
============================================================

Generate a genuine editable DOCX.

Do NOT create HTML renamed to .docx.

Use semantic Microsoft Word styles.

Map:

Document Title → Title

H1 → Heading 1

H2 → Heading 2

H3 → Heading 3

H4 → Heading 4

Body → Normal

Caption → Caption

Code → custom Code style where possible

Callouts → structured Word presentation where possible

============================================================
15. WORD CONTENT
============================================================

Include:

Title

Headings

Paragraphs

Ordered lists

Unordered lists

Nested lists

Mixed lists where DOCX library supports them

Procedures

Tables

Images

Captions

Links

Cross-references where supported

Variables resolved

Conditional content filtered

============================================================
16. WORD LISTS
============================================================

Use native Word numbering/list structures where practical.

Preserve at least:

Ordered Level 1
Ordered Level 2
Ordered Level 3

Unordered Level 1
Unordered Level 2
Unordered Level 3

Do not convert every list to plain paragraphs.

============================================================
17. WORD TABLES
============================================================

Generate editable Word tables.

Support:

Header Row

Body Rows

Configured colors

Borders

Cell padding where supported

Captions

Do not convert tables into screenshots.

============================================================
18. WORD IMAGES
============================================================

Insert real image content into DOCX.

Include:

caption where present

alt text where the library supports it

Do not output broken local URLs.

============================================================
19. WORD PAGE LAYOUT
============================================================

Apply selected Word Layout settings:

Page size

Orientation

Margins

Headers

Footers

Page numbering where supported

Logo

Document metadata

Cover Page

============================================================
20. WORD THEME FIDELITY
============================================================

Apply Brand & Style Profile values to Word styles.

When a user opens the document in Word and modifies:

Heading 1

the Word document should conceptually use Heading 1 style rather than hard-coded direct formatting everywhere.

Preserve editability.

============================================================
21. HTML OUTPUT — TARGET QUALITY
============================================================

Rebuild HTML rendering as a real responsive Help system.

HTML must NOT resemble a printed PDF page shown in a browser.

Use:

Home Page Master

Other Topics Master

Custom Master Pages

Topic assignments

Theme

Brand & Style Profile

============================================================
22. HTML PACKAGE STRUCTURE
============================================================

Generate a real ZIP.

Use a structure similar to:

index.html

topics/
  introduction.html
  getting-started.html
  installation.html
  ...

css/
  theme.css
  layout.css

js/
  navigation.js
  ui.js

assets/

images/

Use relative paths.

The package must not require Figma Make URLs for normal rendering.

============================================================
23. HTML HOME PAGE
============================================================

Render index.html using Home Page Master.

Support configured blocks such as:

Header

Logo

Search

Hero area

Welcome content

Navigation cards

Featured links

Footer

Do not automatically display a printed-document TOC as the homepage unless the selected master page explicitly requires it.

============================================================
24. HTML TOPIC PAGE
============================================================

Render topic pages using their assigned Master Page.

Typical Other Topics layout:

Header
Logo / Product Name
Search
Breadcrumb
Left Navigation
Main Topic Content
On This Page
Previous / Next
Footer

Use a real browser-style layout.

============================================================
25. HTML LEFT NAVIGATION
============================================================

Generate navigation from the current TOC.

Support nested hierarchy.

Allow branches to expand/collapse where practical.

Highlight active topic.

Preserve at least four TOC levels.

============================================================
26. ON THIS PAGE
============================================================

Generate On This Page from headings inside the current topic where enabled by the Master Page.

Do not include the topic title twice.

Allow anchor navigation.

============================================================
27. BREADCRUMBS
============================================================

Where enabled:

show hierarchical breadcrumbs.

Example:

Home
>
Administration
>
User Management
>
Create User

Links should work.

============================================================
28. PREVIOUS / NEXT
============================================================

When enabled:

generate Previous Topic and Next Topic based on TOC order.

Links must work.

============================================================
29. HTML SEARCH
============================================================

If full client-side search can be implemented reliably:

provide simple search across topic titles/content.

If not:

display a clearly labeled prototype search behavior.

Do not expose a non-functional search box.

============================================================
30. HTML RESPONSIVENESS
============================================================

HTML output must adapt to:

Desktop
Tablet
Mobile

At narrower sizes:

left navigation may collapse

On This Page may hide/collapse

main content uses available width

text remains readable

images stay within viewport

tables may scroll horizontally when required

============================================================
31. HTML DARK/LIGHT MODE
============================================================

If the selected HTML Master/Theme enables:

Light Mode

Dark Mode

Follow System

apply it.

Do not add dark mode automatically when it is not configured.

============================================================
32. HTML SEMANTIC STYLING
============================================================

Generate CSS from Brand & Style Profile for:

body
h1
h2
h3
h4
a
ol
ul
table
note
tip
important
warning
example
procedure
code
caption

Use reusable CSS classes.

Do not inject excessive inline styling into every element.

============================================================
33. HTML CONDITIONS
============================================================

Resolve publishing Conditions before generating pages.

Authoring condition labels/tags must not appear in final HTML.

Excluded content must not be rendered.

============================================================
34. VARIABLES
============================================================

Resolve all variables before all three formats are generated.

Example:

{{ProductName}}

must render the configured project value.

Flag unresolved variables before generation.

Do not silently publish {{VariableName}} placeholders.

============================================================
35. LINKS AND CROSS-REFERENCES
============================================================

Validate internal references during generation.

For HTML:

produce working relative links and anchors.

For PDF/Word:

produce supported links where practical.

If a target does not exist:

report a publishing warning.

Do not silently create broken links.

============================================================
36. MASTER PAGE ASSIGNMENT
============================================================

Respect per-topic HTML Master assignments.

Example:

Home
→ Home Page Master

Normal topics
→ Other Topics Master

API Reference
→ Wide Topic Master

Do not ignore the assignments during HTML generation.

============================================================
37. PREVIEW — PDF
============================================================

PDF preview must resemble a paginated PDF.

Show:

Cover
Page boundaries
Headers/Footers
Page layout
Brand styling

Use current project content.

============================================================
38. PREVIEW — WORD
============================================================

Word preview must resemble the Word document structure.

Show:

Pages
Margins
Heading styles
Tables
Images
Headers/Footers

Do not reuse PDF preview blindly.

============================================================
39. PREVIEW — HTML
============================================================

HTML preview must resemble a browser Help site.

Show:

Header
Navigation
Search if enabled
Topic
On This Page
Footer

Do not use a paper/page metaphor for HTML.

============================================================
40. FULL PREVIEW
============================================================

Make:

Full Preview

functional.

Open a larger preview mode for the currently selected format.

Allow switching:

PDF
WORD
HTML

Do not modify project content from preview.

============================================================
41. GENERATE OUTPUTS
============================================================

Keep generation functional.

Only show:

Output Ready

after actual output files exist.

Show separately:

PDF Ready
Word Ready
HTML Ready

============================================================
42. DOWNLOADS
============================================================

Download buttons must download real files.

PDF:
.pdf

Word:
.docx

HTML:
.zip

Use sanitized filenames.

============================================================
43. OUTPUT VALIDATION
============================================================

Before generation check for:

Unresolved Variables

Broken Internal Links

Missing Required Page Layout

Missing HTML Master

Missing mandatory Theme/Profile

Show warnings.

Allow author to return and correct them.

Do not fabricate successful validation.

============================================================
44. OUTPUT QA PANEL
============================================================

Add a compact pre-publish QA summary.

Example:

Ready to Publish

Variables:
All resolved

Internal Links:
18 valid
1 broken

Master Pages:
All assigned

Images:
12 available

Review:
Complete

Do not use arbitrary quality scores.

============================================================
45. SAME CONTENT — DIFFERENT THEME TEST
============================================================

Use one authored test document.

Generate using Theme A.

Generate again using Theme B.

VERIFY:

text/content remains identical

TOC remains identical

only presentation changes.

============================================================
46. PDF ACCEPTANCE TEST
============================================================

Generate test PDF containing:

Cover page
TOC
H1–H4
Paragraph
Three-level list
Table
Procedure
Note
Warning
Image
Caption

Download.

VERIFY:

valid PDF

readable

Theme applied

no editor controls

no obvious content clipping

============================================================
47. WORD ACCEPTANCE TEST
============================================================

Generate DOCX containing the same content.

VERIFY:

valid DOCX package

semantic headings

editable paragraphs

lists

editable table

images

Theme styles represented

Do not claim Microsoft Word application opening was tested if runtime cannot open Word externally.

============================================================
48. HTML ACCEPTANCE TEST
============================================================

Generate HTML ZIP.

VERIFY:

index.html exists

topic pages exist

CSS exists

images/assets included

Home Page Master represented

Other Topics Master represented

navigation generated

internal links use relative paths

============================================================
49. HTML VISUAL ACCEPTANCE TEST
============================================================

Open/render generated HTML in the available browser preview.

VERIFY:

looks like a Help application, NOT a PDF/document page.

Check:

Header
Navigation
Main content
On This Page
Footer
Responsive behavior

============================================================
50. CONTENT FRESHNESS TEST
============================================================

Edit a paragraph in Author.

Publish again.

VERIFY:

PDF
DOCX
HTML

all use the updated paragraph.

No hard-coded demo text.

============================================================
51. CONDITION TEST
============================================================

Create conditioned content:

Audience: Administrator

Generate Variant without Administrator.

VERIFY:
content excluded.

Generate Administrator Variant.

VERIFY:
content included.

============================================================
52. VARIABLE TEST
============================================================

Set:

ProductName = Orion

Generate all formats.

VERIFY:

Orion appears.

{{ProductName}} does not.

============================================================
53. MASTER PAGE TEST
============================================================

Assign one topic to:

Wide Topic Master

Generate HTML.

VERIFY:

that topic uses Wide Topic Master.

Other topics continue using Other Topics Master.

============================================================
54. OUTPUT ERROR HANDLING
============================================================

If one format fails:

show that specific failure.

Example:

Word generation failed.

Retry Word

Other successful formats remain downloadable.

============================================================
55. DO NOT OVERSTATE CAPABILITY
============================================================

This remains a PROTOTYPE publishing implementation.

Do not claim:

full MadCap Flare parity

perfect PDF pagination

complete Word field/cross-reference support

production search indexing

unless actually implemented and validated.

============================================================
56. REGRESSION CHECK
============================================================

After publishing improvements verify:

Project Details
Theme
Sources
Analysis
TOC
Author
Review

remain functional.

Do not break the existing Review workflow.

============================================================
57. COMPLETION REPORT
============================================================

At completion report:

PDF
Implemented:
Tested:
Limitations:

WORD
Implemented:
Tested:
Limitations:

HTML
Implemented:
Tested:
Limitations:

FIXED DURING TESTING

NOT FULLY VALIDATED

Do not report success based only on UI state.

============================================================
58. FINAL PRODUCT PRINCIPLE
============================================================

The same structured content feeds all formats.

PDF and Word use paginated Page Layouts.

HTML uses responsive Master Pages.

Brand & Style Profiles control semantic visual presentation.

Conditions and Variables resolve during publishing.

Publishing never changes source authored content.