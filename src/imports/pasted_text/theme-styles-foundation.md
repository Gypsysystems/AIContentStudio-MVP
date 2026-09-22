COMPLETE THE THEME & STYLES FOUNDATION

Work ONLY on:

- Theme management
- Theme & Styles
- Brand Guidelines import
- Brand Settings
- Style Editor
- Fonts
- PDF/Word Page Layouts
- HTML Master Pages
- Theme persistence and duplication

Do NOT modify:

- Sources
- Analysis
- TOC
- Authoring editor
- Knowledge Map
- Review

The goal is to create a reliable NO-CODE theme and publishing-design system for professional documentation.

============================================================
1. THEME IS THE PRIMARY REUSABLE CONCEPT
============================================================

A Theme contains:

BRAND SETTINGS
TYPOGRAPHY
CONTENT STYLES
OUTPUT TEMPLATES

Optional Theme metadata may contain:

Client
Organization
Product
Description

But project creation selects a THEME, not a client.

============================================================
2. THEME & STYLES WORKSPACE
============================================================

Organize the workspace into these tabs:

Overview
Brand
Styles
Output Templates

Do not expose implementation code.

============================================================
3. THEME OVERVIEW
============================================================

Show:

Theme Name
Optional Client
Optional Product
Description

Current assets summary:

Logo
Brand colors
Typography
Style profile
PDF layouts
Word layouts
HTML master pages

Actions:

Duplicate Theme
Rename Theme
Archive Theme

Duplicate MUST work.

============================================================
4. DUPLICATE THEME
============================================================

When Duplicate Theme is selected:

Open:

Duplicate Theme

Name:
[Original Theme – Copy]

Scope:
Reusable Theme
Project-only variation

Actions:
Duplicate
Cancel

The duplicate must be an INDEPENDENT copy.

Changing:

font
color
table style
callout
page layout
HTML master page

in the duplicate must NOT modify the original.

============================================================
5. BRAND GUIDELINES UPLOAD
============================================================

Fix Upload Brand Guidelines.

Clicking Upload must open the native file picker.

Support:

PDF
DOCX
PPTX
PNG
JPG/JPEG

Also support drag-and-drop.

After selection show:

actual filename
file type
file size
Ready
Replace
Remove

Do not fabricate extracted values immediately.

============================================================
6. BRAND GUIDELINE ANALYSIS
============================================================

Provide:

Analyze Brand Guidelines

For this prototype, analysis may be simulated.

Clearly label:

Prototype AI analysis

Conceptually detect:

Primary logo
Secondary logo
Primary color
Secondary color
Accent colors
Neutral colors
Heading font
Body font
Code font
Heading appearance
Table style
Callout style
Spacing patterns

Present everything as SUGGESTIONS.

Never apply automatically.

============================================================
7. REVIEW DETECTED BRAND SETTINGS
============================================================

Replace the current flat suggestion list with grouped cards.

Example:

COLORS

Primary
[color swatch] Brand Blue
Accept
Edit
Ignore

Secondary
[color swatch]
Accept
Edit
Ignore

TYPOGRAPHY

Heading font
Arial Bold

Body font
Arial

ASSETS

Primary Logo
[thumbnail]

Actions:

Accept
Edit
Ignore

Provide:

Accept All Reviewed

Accepted values must update the Theme immediately.

============================================================
8. ONE STANDARD COLOR PICKER
============================================================

The current color inputs are visually inconsistent and overlap.

Create ONE reusable Color Picker component and replace every color field in Theme & Styles with it.

Collapsed appearance:

[COLOR SWATCH]  Primary

or:

[COLOR SWATCH]  #06626A

Do NOT permanently show narrow vertical color controls or overlapping text inputs.

On click open a popover containing:

visual color selector

Theme Colors
Recent Colors

HEX
#06626A

RGB
6 98 106

Apply
Cancel

============================================================
9. NAMED THEME COLORS
============================================================

Allow reusable named colors:

Primary
Secondary
Accent
Body Text
Heading
Border
Surface
Table Header
Note
Tip
Warning
Important
Example

Styles should preferably reference Theme Colors.

Example:

Heading 1 Color:
Primary

rather than duplicating a HEX code everywhere.

Custom overrides remain possible.

============================================================
10. COLOR STATE — CRITICAL
============================================================

ALL color controls must use persistent application state.

Do NOT use defaultValue for saved Theme/style values.

Changing a color must:

update preview immediately
remain after clicking elsewhere
remain after switching tabs
remain after returning to Styles
remain after selecting another configuration section

Applies to:

Theme colors
Heading colors
Body text
Links
Tables
Callouts
Procedures
PDF/Word layouts
HTML master pages

============================================================
11. FORM LAYOUT QUALITY
============================================================

Fix overlapping fields throughout Theme & Styles.

Rules:

Labels above inputs

Consistent control height

Consistent card padding

No overlapping borders

No field may cover another field

Use responsive grids:

3 columns when enough room
2 columns when narrower
1 column when necessary

Long values must truncate or wrap safely.

============================================================
12. FONT LIBRARY
============================================================

Provide a proper Font Library.

Categories:

Theme Fonts
Uploaded Fonts
Common Fonts
Recent Fonts

Include common examples:

Arial
Arial Narrow
Aptos
Aptos Display
Calibri
Cambria
Georgia
Segoe UI
Tahoma
Times New Roman
Trebuchet MS
Verdana
Courier New

Provide font search.

============================================================
13. CUSTOM FONT UPLOAD
============================================================

Provide:

Add Custom Font

Prototype supported options:

TTF
OTF
WOFF
WOFF2

Show:

Font Family
Weights
Styles

Add informational message:

"Ensure you have the appropriate license to use uploaded fonts."

Do not require users to install the font locally.

============================================================
14. LOCAL FONT OPTION
============================================================

Provide future-ready:

Use Local Font

But do NOT make local-system font detection the primary architecture.

If unavailable:

"Upload the licensed font to the Theme Font Library for consistent publishing."

============================================================
15. TYPOGRAPHY STYLES
============================================================

Configure:

Body
Heading 1
Heading 2
Heading 3
Heading 4
Caption
Code
Links

Controls:

Font Family
Size
Weight
Color
Alignment
Line Height
Space Before
Space After

Heading numbering where applicable.

All no-code.

============================================================
16. LIVE STYLE PREVIEW
============================================================

Style changes must update a live document preview immediately.

Preview:

H1
H2
H3
Paragraph
Link
Ordered List
Unordered List
Table
Procedure
Note
Warning
Example
Code

============================================================
17. LIST STYLES
============================================================

Configure:

Ordered Level 1
Ordered Level 2
Ordered Level 3

Unordered Level 1
Unordered Level 2
Unordered Level 3

Support:

number/bullet style
indent
spacing
text style

============================================================
18. TABLE STYLES
============================================================

Configure:

Header Font
Header Text Color
Header Background

Body Font
Body Text Color

Border Color
Border Width

Cell Padding

Alternate Row:
On / Off

Alternate Row Color

First Column Emphasis:
On / Off

Caption Style

Use standard Color Picker controls.

============================================================
19. CALLOUT STYLES
============================================================

Configure:

Note
Tip
Important
Warning
Example

For each:

Label
Optional Icon
Accent Color
Background Color
Text Style

All values MUST persist in Theme state.

Do not use defaultValue.

============================================================
20. PROJECT OVERRIDES
============================================================

When a project selects a Theme, allow:

Use Theme As-Is

Customize for This Project

Project customization creates OVERRIDES.

It does NOT modify the original Theme.

Show overridden properties subtly.

Provide:

Reset to Theme

============================================================
21. OUTPUT TEMPLATES WORKSPACE
============================================================

Under Output Templates separate:

PDF / Word Page Layouts

HTML Master Pages

Do NOT mix HTML configuration with paginated-document configuration.

============================================================
22. PAGE LAYOUT LIBRARY
============================================================

For PDF/Word create a reusable Page Layout Library.

Top selector:

Page Layout:
[Theme Standard Content ▼]

Actions:

New
Duplicate
Rename
Delete

Example layouts:

Standard Cover
Standard Content
Chapter Opener
Landscape Appendix

All form fields and preview update when selected layout changes.

============================================================
23. DUPLICATE PAGE LAYOUT
============================================================

Duplicate must work.

Example:

Standard Content

Duplicate →

Standard Content Copy

Modifications to the copy must NOT modify the original.

============================================================
24. PAGE LAYOUT TYPE
============================================================

Support:

Cover Page
Content Page
Chapter Opener
Custom

At minimum fully represent:

Cover Page
Content Page

============================================================
25. PAGE SETTINGS
============================================================

Configurable:

Page Size
A4
Letter
Custom

Orientation
Portrait
Landscape

Margins
Top
Bottom
Left
Right

Header Height
Footer Height

Background Color
Optional Background Image

============================================================
26. VISUAL PAGE LAYOUT DESIGNER
============================================================

Replace simple Show Elements checkboxes with a visual Page Layout Designer.

The author must be able to define WHERE elements appear.

Use structured layout regions rather than unrestricted arbitrary positioning.

COVER PAGE REGIONS:

Top
Center
Bottom

CONTENT PAGE REGIONS:

Header
Main Content
Footer

============================================================
27. PAGE ELEMENT PALETTE
============================================================

Available elements:

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

Allow authors to add/remove elements.

============================================================
28. PAGE ELEMENT MOVEMENT
============================================================

Support drag-and-drop where reliable.

Valid drop regions must highlight.

Also ALWAYS provide accessible fallback:

Move to…
Move Up
Move Down

Do not rely solely on drag-and-drop.

============================================================
29. COVER PAGE DESIGNER
============================================================

Example:

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

Allow users to move elements between valid regions.

Live page preview must update.

============================================================
30. CONTENT PAGE DESIGNER
============================================================

Support configurable:

HEADER
Logo
Document Title
Chapter Title
Topic Title
Version
Custom text

MAIN
Content region

FOOTER
Copyright
Confidentiality
Version
Page Number
Custom text

Authors control:

element order
visibility
alignment
region

============================================================
31. PDF / WORD SHARED BASE
============================================================

PDF and Word may use the same base Page Layout.

Allow format-specific overrides.

Example:

Base:
Standard Content

PDF margins:
20 mm

Word margins:
25 mm

============================================================
32. HTML MASTER PAGES WORKSPACE
============================================================

Create separate:

HTML Master Pages

Default master pages:

Home Page Master
Other Topics Master

Actions:

New
Duplicate
Rename
Delete
Preview

============================================================
33. HOME PAGE MASTER
============================================================

Visual no-code editor.

Available components:

Header
Logo
Search
Hero
Welcome Text
Navigation Cards
Featured Links
Recent Content
Footer

Allow:

Show / Hide
Reorder
Layout option
Spacing
Alignment

Theme controls colors/typography.

============================================================
34. OTHER TOPICS MASTER
============================================================

Available components:

Header
Logo
Search
Breadcrumbs
Left Navigation
Main Content
On This Page
Previous / Next
Feedback
Footer

Allow:

Show / Hide
Reorder where valid
Navigation width
Content width
Sticky behavior

============================================================
35. ADDITIONAL HTML MASTER PAGES
============================================================

Allow authors to create:

Section Landing Master
Wide Topic Master
Minimal Topic Master
Support Master
Custom Master

New Master Page asks:

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

============================================================
36. DUPLICATE HTML MASTER PAGE
============================================================

Must work.

Duplicate:

Other Topics Master

to:

Wide Topic Master

Changing Width/Navigation in Wide Topic must NOT modify Other Topics Master.

============================================================
37. HTML MASTER ASSIGNMENT
============================================================

Allow master-page assignment to topics.

Conceptually available from:

Author / TOC

and:

Publish

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
38. DEFAULT MASTER INHERITANCE
============================================================

Project defaults:

Default Home Master

Default Topic Master

Topics without explicit assignment inherit the default.

Allow per-topic override.

============================================================
39. BULK ASSIGNMENT
============================================================

Before HTML publishing provide:

Master Page Assignment

Topic | Master Page

Allow multiple topic selection.

Provide:

Apply to Children

============================================================
40. THEME SAFETY
============================================================

Changing Themes must NEVER change:

authored text
TOC hierarchy
conditions
variables
snippets
cross-references
source evidence

Theme controls presentation only.

============================================================
41. SELF-TEST: THEME CREATION
============================================================

Create:

Theme:
Nova Documentation

Confirm it appears in the Project Details Theme dropdown.

Create another project.

Confirm it is selectable.

============================================================
42. SELF-TEST: THEME DUPLICATION
============================================================

Duplicate:

Nova Documentation

to:

Nova Documentation Green

Change Primary color in Green.

PASS only if original remains unchanged.

============================================================
43. SELF-TEST: COLOR PERSISTENCE
============================================================

Change:

H1 color
Warning Accent
Warning Background
Table Header Background

Navigate away.

Return.

PASS only if all values persist.

============================================================
44. SELF-TEST: BRAND FILE UPLOAD
============================================================

Click Upload Brand Guidelines.

Confirm native file picker opens.

Select a file.

Confirm real filename appears.

Run Prototype AI Analysis.

Accept one color suggestion.

Confirm Theme color updates.

============================================================
45. SELF-TEST: PAGE LAYOUT
============================================================

Create:

Nova Cover

Duplicate to:

Nova Cover Alt

Modify Alt.

Confirm original unchanged.

Switch using Page Layout dropdown.

Confirm settings and preview update.

============================================================
46. SELF-TEST: PAGE ELEMENT PLACEMENT
============================================================

Move:

Logo → Top

Document Title → Center

Version → Bottom

Verify preview.

Move Version using Move to... fallback.

Navigate away and return.

PASS only if placement persists.

============================================================
47. SELF-TEST: HTML MASTER PAGE
============================================================

Duplicate:

Other Topics Master

to:

Wide Topic Master

Change content/navigation width.

Confirm original unchanged.

Assign:

API Reference → Wide Topic Master

Navigate away and return.

Confirm assignment persists.

============================================================
48. REGRESSION CHECK
============================================================

Ensure these still function:

Project creation
Theme selection
Sources
Analysis
TOC
Author
Knowledge Map
Review
Publish navigation

============================================================
49. SELF-CORRECTION
============================================================

After implementation:

exercise the tests above.

If something fails:

fix it
repeat the failed test

Do not knowingly leave a visible non-functional control.

============================================================
50. COMPLETION REPORT
============================================================

Report:

IMPLEMENTED

TESTED AND PASSED

FIXED DURING TESTING

NOT FULLY VALIDATED

Be explicit about anything that could not be exercised.

============================================================
51. PRODUCT PRINCIPLE
============================================================

CONTENT
is independent.

THEME
controls brand and styles.

PDF / WORD PAGE LAYOUTS
control paginated layout.

HTML MASTER PAGES
control responsive web layout.

PROJECT OVERRIDES
allow project-specific presentation changes without modifying the reusable Theme.

Everything remains NO-CODE.