MAJOR REFINEMENT — CLIENT STATE, BRAND IMPORT, STYLE EDITOR, COLOR CONTROLS, PAGE LAYOUTS, HTML MASTER PAGES, AND PROFILE DUPLICATION

Refactor ONLY the following areas:

1. Client / Organization management
2. Branding & Styles
3. Style Editor
4. Output Templates
5. PDF / Word Page Layout configuration
6. HTML output configuration

Do not modify Sources, Analysis, TOC, Authoring, Knowledge Map, or Review unless necessary to preserve navigation/state.

IMPORTANT:

This is a professional NO-CODE documentation platform.

Do not expose CSS, HTML, XML, JSON, or implementation code to authors.

Every visible control added in this request must work in the prototype.

============================================================
1. CLIENT STATE — CRITICAL BUG
============================================================

Current issue:

A newly created client does not appear in the Client dropdown.

Fix this.

When a user creates a Client / Organization:

- immediately add it to application state
- immediately make it available in ALL Client dropdowns
- select it automatically when created from project setup
- preserve it during the current browser/prototype session
- allow it to be selected by another new project

Client record should conceptually contain:

Client Name
Optional Description
Brand Profiles
Style Profiles
Output Templates

Do not hard-code client names.

TEST:

Create:
"Nova Government"

Return to Project Details.

Open Client dropdown.

PASS only if:
"Nova Government"
appears and can be selected.

============================================================
2. CLIENT PROFILE RELATIONSHIP
============================================================

Use this reusable structure:

CLIENT PROFILE
    ↓
BRAND PROFILE
    ↓
STYLE PROFILE
    ↓
OUTPUT TEMPLATE PACK

One client can have:

multiple Brand Profiles
multiple Style Profiles
multiple Output Template Packs

A project references these reusable profiles.

Do not permanently embed client styles directly into project content.

============================================================
3. BRAND GUIDELINES UPLOAD
============================================================

Fix "Upload Brand Guidelines".

Clicking it must open the browser's native file picker.

Support prototype selection for:

PDF
DOCX
PPTX
PNG
JPG/JPEG

Also support drag-and-drop.

After file selection show:

actual file name
file type
file size
Ready status
Remove / Replace

Do not fabricate information from an uploaded file.

============================================================
4. BRAND GUIDELINE ANALYSIS WORKFLOW
============================================================

The future production application will use AI to analyze uploaded branding guidelines.

Design the workflow now.

After uploading:

[Analyze Brand Guidelines]

Show analysis state:

"Analyzing branding standards…"

For THIS prototype only, results may be simulated.

Clearly label:

"Prototype brand analysis"

Do not claim the application genuinely extracted the values from the uploaded file.

Conceptually analyze:

Logo
Primary color
Secondary color
Accent colors
Neutral colors
Heading font
Body font
Code font
Heading hierarchy
Table styling
Callout styling
Spacing patterns
Logo usage rules

Present results as suggestions.

============================================================
5. BRAND SUGGESTION REVIEW
============================================================

Do not use the current flat list:

Primary color   #code   Accept Ignore

Replace with a polished review experience.

Example:

Detected Brand Settings

COLORS
Primary
[swatch] Brand Blue
[Accept] [Edit] [Ignore]

Secondary
[swatch] ...

TYPOGRAPHY
Heading family
Arial Bold
[Accept] [Edit] [Ignore]

Body family
Arial
[Accept] [Edit] [Ignore]

ASSETS
Primary Logo
[thumbnail]
[Accept] [Replace] [Ignore]

Every suggestion requires human approval.

Provide:

Accept All Reviewed

Never auto-apply brand-analysis results.

============================================================
6. STANDARD COLOR CONTROL
============================================================

Create ONE reusable color-control component and use it EVERYWHERE in the application.

Remove the existing narrow vertical color strips and awkward permanent hex fields.

Default compact appearance:

[ color swatch ]  Color name / value

Example:

[■] Brand Teal

Clicking the swatch opens a polished color-picker popover.

The popover supports:

Visual color picker

Brand Colors
[swatches]

Recent Colors
[swatches]

HEX:
#06626A

RGB:
6 / 98 / 106

Optional opacity where appropriate

Apply
Cancel

Authors who know a HEX value may enter it directly.

Do NOT show permanent hex-code inputs for every style field.

============================================================
7. BRAND COLOR TOKENS
============================================================

Allow reusable named brand colors.

Examples:

Primary
Secondary
Accent
Heading
Body Text
Border
Table Header
Warning
Note

Style controls should prefer selecting named brand colors.

Example:

Heading 1 Color:
Primary ▼

Instead of repeatedly entering:
#06626A

Allow custom color override where required.

============================================================
8. COLOR UI REGRESSION
============================================================

Replace ALL existing color controls across:

Brand settings
Headings
Body
Tables
Callouts
Procedures
PDF layouts
HTML themes

with the new standardized color-picker component.

Remove visual overlap and malformed input controls.

============================================================
9. RESPONSIVE FORM LAYOUT — CRITICAL
============================================================

Several current configuration fields overlap.

Fix layout architecture.

Use consistent responsive form grids.

Rules:

- Labels always appear above fields
- Fields never overlap
- Maintain minimum horizontal spacing
- Collapse from 3 columns → 2 → 1 as available width decreases
- Do not let long values overflow containers
- Use consistent control heights
- Use consistent card padding
- Keep color control and text field boundaries separate

Test with:
Heading configuration
Callout configuration
Table configuration
Output templates

============================================================
10. DUPLICATE — CRITICAL BUG
============================================================

Make Duplicate functional for:

Brand Profiles
Style Profiles
Output Template Packs
Page Layouts
HTML Master Pages

When Duplicate is selected:

open dialog:

Duplicate Style Profile

Name:
"Acme Documentation – Copy"

Save to:

Current Client
Another Client
Project only

[Duplicate]
[Cancel]

After duplication:

- create independent copy
- select the new copy
- modifications to copy do NOT modify original

============================================================
11. STYLE EDITOR ARCHITECTURE
============================================================

Maintain no-code Style Editor.

Sections:

Typography
Lists
Tables
Callouts
Procedures
Media
Links
Code

Keep live preview.

Do not expose raw CSS.

Internally the application may represent these values as style tokens / CSS / output mappings.

============================================================
12. PAGE LAYOUT LIBRARY
============================================================

Replace the current output-pack buttons and shallow page settings with a reusable PAGE LAYOUT LIBRARY for PDF and Word.

Top control:

Page Layout:
[Acme Standard Content ▼]

Actions:

New
Duplicate
Rename
Delete
Save

Show available layouts in dropdown.

Example:

Acme Standard Cover
Acme Standard Content
Acme Chapter Opener
Landscape Appendix

When selected:

all configuration fields and preview must update to selected layout.

============================================================
13. PAGE LAYOUT TYPES
============================================================

Support layout type:

Cover Page
Content Page
Chapter Opener
Custom

At minimum implement:

Cover Page
Content Page

============================================================
14. PAGE SETTINGS
============================================================

Each PDF/Word layout can configure:

Page Size:
A4
Letter
Custom

Orientation:
Portrait
Landscape

Margins:
Top
Bottom
Left
Right

Header Height
Footer Height

Background Color

Optional background image

============================================================
15. VISUAL PAGE LAYOUT DESIGNER
============================================================

The current implementation only provides Show/Hide checkboxes.

Replace this with a visual NO-CODE Page Layout Designer.

Provide page canvas with structured regions:

Header
Main Content
Footer

Cover Page may also have:

Top region
Center region
Bottom region

Elements available from an element palette:

Logo
Secondary Logo
Document Title
Subtitle
Client Name
Product Name
Version
Date
Confidentiality
Chapter Title
Topic Title
Page Number
Copyright
Custom Text
Image
Divider

Authors can:

drag elements into valid page regions
reorder within region
align left / center / right
show / hide
change content binding
resize elements where appropriate

Do NOT provide unrestricted arbitrary code.

============================================================
16. COVER PAGE DESIGNER
============================================================

Cover Page must support flexible positioning.

Example zones:

TOP
Logo

CENTER
Document Title
Subtitle
Product Name

BOTTOM
Version
Date
Confidentiality

Allow authors to move elements between valid zones.

Provide live page preview.

============================================================
17. CONTENT PAGE DESIGNER
============================================================

Support:

Header region

Main content region

Footer region

Example Header:

Logo | Chapter Title | Version

Example Footer:

Copyright | Confidentiality | Page Number

Allow author to configure which element occupies each region.

Allow alignment and ordering.

Provide live preview.

============================================================
18. PAGE LAYOUT SAVE / REUSE
============================================================

Allow Page Layout save scope:

Client
Product
Project

Example:

Client:
Acme

Layout:
Acme Standard Content

Reuse across:

User Guide
Admin Guide
SOP

Duplicate before making document-specific variations.

============================================================
19. PDF AND WORD SEPARATION
============================================================

PDF and Word may share reusable page-layout definitions.

However, allow format-specific overrides.

Example:

Base:
Acme Standard Content

PDF:
20 mm margins

Word:
25 mm margins

Do not force the two formats to remain identical.

============================================================
20. HTML MUST BE A SEPARATE WORKSPACE
============================================================

Do NOT configure HTML through PDF/Word page settings.

Create a dedicated workspace:

HTML Designer

This is fundamentally different from paginated output.

============================================================
21. HTML MASTER PAGE LIBRARY
============================================================

Create:

HTML Master Pages

Default Master Pages:

Home Page Master
Other Topics Master

Allow:

New
Duplicate
Rename
Delete
Preview

Authors can create additional types.

Examples:

Section Landing Master
Wide Topic Master
Minimal Topic Master
Support Master
Search Master
Custom Master

============================================================
22. HOME PAGE MASTER
============================================================

Create a dedicated visual editor for:

Home Page Master

Allow configuration of:

Header
Logo
Search
Hero
Welcome text
Navigation cards
Featured links
Recent content
Footer

Allow block-level:

Show / Hide
Reorder
Layout selection
Spacing
Alignment

Typography and colors inherit from Brand/Style Profile.

Allow project-level overrides.

============================================================
23. OTHER TOPICS MASTER
============================================================

Create visual editor for:

Other Topics Master

Allow:

Header

Logo

Search

Breadcrumb

Left navigation

Main content

On This Page

Previous / Next topic navigation

Feedback control

Footer

Allow:

enable / disable

reorder where valid

width controls

navigation width

content width

sticky behavior

============================================================
24. HTML MASTER PAGE VISUAL DESIGNER
============================================================

Use structured visual layout editing.

Do not expose HTML/CSS code.

Allow:

drag-and-drop blocks into valid layout zones
reorder
show/hide
set widths
set alignment
configure component options

Use desktop preview.

Add future-ready responsive preview:

Desktop
Tablet
Mobile

============================================================
25. CREATE CUSTOM HTML MASTER PAGE
============================================================

New HTML Master Page:

Name

Base On:
Home Page Master
Other Topics Master
Blank

Type:
Home
Topic
Landing
Custom

After creation:

open in HTML Master Page Designer.

============================================================
26. MASTER PAGE ASSIGNMENT
============================================================

Allow authors to assign HTML Master Pages to topics.

Support assignment from:

Authoring / TOC

AND

Publish preparation

Example:

Home
→ Home Page Master

Getting Started
→ Other Topics Master

Administration
→ Section Landing Master

API Reference
→ Wide Topic Master

============================================================
27. BULK MASTER PAGE ASSIGNMENT
============================================================

Before publishing HTML, provide:

Master Page Assignment

Table/list:

Topic                     Master Page

Home                      Home Page Master
Getting Started           Other Topics Master
Administration            Section Landing Master

Allow:

select multiple topics
assign master page

Provide:

Apply to children

Example:

Administration
→ Section Landing Master

Children:
→ Other Topics Master

============================================================
28. MASTER PAGE INHERITANCE
============================================================

Topics without explicit assignment inherit:

Project Default Topic Master

Home uses:

Project Default Home Master

Authors can override per topic.

============================================================
29. HTML THEME VS MASTER PAGE
============================================================

Maintain clear distinction:

STYLE PROFILE

controls:

fonts
colors
tables
callouts
semantic component styling

HTML MASTER PAGE

controls:

screen layout
navigation
header
footer
search
content regions

Do not duplicate these responsibilities.

============================================================
30. HTML PUBLISHING
============================================================

Publish → HTML Package

Allow selection:

Home Master
Default Topic Master

Show count:

3 topics use custom master pages

[Review Assignments]

Generate HTML Package

============================================================
31. STYLE / TEMPLATE RELATIONSHIP
============================================================

Use this model:

CONTENT
      ↓
STYLE PROFILE
      ↓
OUTPUT LAYOUT

PDF:
Page Layout

Word:
Page Layout

HTML:
HTML Master Page

This separation is critical.

============================================================
32. BRAND GUIDELINE → STYLE MAPPING
============================================================

When prototype Brand Analysis suggestions are accepted:

update corresponding:

Brand Profile
Style Profile

Examples:

Accepted Heading Font
→ H1–H4 default family

Accepted Body Font
→ Body font

Accepted Primary Color
→ Primary brand token

Accepted Logo
→ Brand Logo

Do NOT automatically change page-layout positioning.

============================================================
33. BRAND GUIDELINE → TEMPLATE SUGGESTIONS
============================================================

AI may SUGGEST:

Cover background
Header logo placement
Accent style
Table header color

But these remain:

suggestions

Authors must explicitly Apply them.

============================================================
34. STATE SYNCHRONIZATION
============================================================

If:

Client changes
Brand changes
Style changes
Output template changes

all dependent selectors must update correctly.

No stale hard-coded values.

============================================================
35. LIVE PREVIEW
============================================================

All configuration workspaces must have a useful live preview.

Brand:
brand sample

Style:
document component sample

Page Layout:
page preview

HTML Master Page:
browser-like preview

============================================================
36. SAVE BEHAVIOR
============================================================

Configuration pages use:

Saving…
Saved

No constant manual Save button required for normal changes.

Provide explicit:

Save as New Profile

when author wants reusable copy.

============================================================
37. ACCEPTANCE TEST — CLIENT
============================================================

Create:

Client:
Nova Government

Verify:

Client appears in Project Details dropdown.

Create another project.

Verify:

Nova Government remains selectable during prototype session.

============================================================
38. ACCEPTANCE TEST — DUPLICATE STYLE
============================================================

Duplicate:

Acme Documentation

to:

Acme Documentation Test

Change H1 color in copy.

VERIFY:

Original remains unchanged.

============================================================
39. ACCEPTANCE TEST — COLOR CONTROL
============================================================

Open H1 color.

Select brand color.

Apply.

Verify preview changes.

Open again.

Enter:

#123456

Apply.

Verify preview changes.

Repeat on:

Table Header
Warning
Note

Verify no overlapping controls.

============================================================
40. ACCEPTANCE TEST — BRAND UPLOAD
============================================================

Click:

Upload Brand Guidelines

Verify native file picker opens.

Select sample PDF.

Verify actual filename shown.

Run prototype analysis.

Verify suggestions appear.

Verify results are labeled:

Prototype brand analysis.

Accept Primary Color.

Verify Brand Profile updates.

Edit Body Font.

Verify Style Editor updates.

============================================================
41. ACCEPTANCE TEST — PAGE LAYOUT
============================================================

Create:

Nova Cover

Duplicate:

Nova Cover v2

Modify v2.

Verify Nova Cover unchanged.

Select layout dropdown.

Verify both available.

Switch layouts.

Verify fields + preview update.

============================================================
42. ACCEPTANCE TEST — COVER DESIGNER
============================================================

Move:

Logo → Top region

Document Title → Center

Version → Bottom

Disable Subtitle.

Verify visual preview updates.

============================================================
43. ACCEPTANCE TEST — CONTENT PAGE
============================================================

Configure:

Header:
Logo + Topic Title

Footer:
Copyright + Page Number

Change margins.

Verify preview updates.

============================================================
44. ACCEPTANCE TEST — HTML MASTER PAGES
============================================================

Create:

Home Page Master

Other Topics Master

Duplicate Other Topics Master as:

Wide Topic Master

Modify navigation width.

Verify original unchanged.

============================================================
45. ACCEPTANCE TEST — MASTER ASSIGNMENT
============================================================

Assign:

Home
→ Home Page Master

Getting Started
→ Other Topics Master

API Reference
→ Wide Topic Master

Verify assignments persist during session.

============================================================
46. ACCEPTANCE TEST — REGRESSION
============================================================

After changes ensure these still work:

Project creation
Sources
Analysis
TOC
Authoring
Conditions
Knowledge Map
Review
Publish navigation

============================================================
47. SELF-TEST AND CORRECT
============================================================

After implementation:

exercise every acceptance test above.

If something fails:

fix it
repeat the test

Do not knowingly leave visible controls that do nothing.

============================================================
48. COMPLETION REPORT
============================================================

Report:

IMPLEMENTED

TESTED AND PASSED

FIXED DURING TESTING

NOT FULLY VALIDATED

Do not claim functionality passed unless the interaction was exercised.

============================================================
49. FINAL PRODUCT PRINCIPLE
============================================================

CONTENT is independent.

BRAND PROFILE controls identity.

STYLE PROFILE controls semantic visual presentation.

PDF / WORD PAGE LAYOUTS control paginated layout.

HTML MASTER PAGES control responsive screen structure.

AUTHORS configure everything through NO-CODE controls.

AI suggests.

Humans approve.