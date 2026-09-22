FOUNDATION UPGRADE — CLIENT BRANDING, STYLE PROFILES, TYPOGRAPHY, PAGE LAYOUTS, AND MULTI-OUTPUT PUBLISHING

Refactor the prototype to support reusable professional client branding and publishing.

This application is used by documentation teams who create User Guides, Admin Guides, SOPs, Quick Starts, Knowledge Base content and other professional documentation for MULTIPLE CLIENTS and PRODUCTS.

The current "Typography Preset" capability is too high-level.

Replace it with a flexible NO-CODE branding, style, and output-template architecture.

IMPORTANT PRINCIPLE:

CONTENT must remain independent from PRESENTATION.

The same authored User Guide must be capable of being rendered for Client A or Client B without rewriting or duplicating the underlying content.

Authors must NEVER need to edit CSS, HTML, XML, JSON, or code.

============================================================
1. GLOBAL ARCHITECTURE
============================================================

Introduce these reusable concepts:

CLIENT / ORGANIZATION PROFILE

BRAND PROFILE

STYLE PROFILE

OUTPUT TEMPLATE PACK

A client may have multiple profiles.

Example:

Client:
Acme Government

Brand Profile:
Acme Corporate

Style Profile:
Acme Documentation Standard

Output Template Pack:
Acme Standard Documentation

Projects reference these profiles rather than embedding all styling directly into content.

============================================================
2. UPDATED PROJECT CREATION FLOW
============================================================

Refactor project creation into logical stages:

1. Project Details
2. Branding & Styles
3. Sources
4. Analysis
5. TOC
6. Author
7. Review
8. Publish

Replace the current high-level Typography Preset section with the new Branding & Styles step.

============================================================
3. PROJECT DETAILS
============================================================

Project Details includes:

Project Name

Content Type:
User Guide
Admin Guide
Quick Start
SOP
Knowledge Base
etc.

Client / Organization:
Select existing
Create new

Product:
Optional selection/create

Primary Language:
English (US)
Arabic
Future languages

Document Version:
Optional

Continue → Branding & Styles

============================================================
4. BRANDING & STYLES
============================================================

Provide two primary options:

USE EXISTING PROFILE

CREATE / CUSTOMIZE PROFILE

Existing profile example:

Client:
Acme Government

Brand:
Acme Corporate

Style Profile:
Acme Documentation

Output Templates:
Acme Standard Pack

Allow preview before applying.

============================================================
5. BRAND PROFILE
============================================================

Brand Profile contains:

Client/organization logo
Secondary logo where required

Primary color
Secondary color
Accent color
Neutral colors

Typography

Optional:
favicon
brand imagery

Allow:

Upload Branding Guidelines

Supported prototype examples:
PDF
DOCX
PPTX
image

For this Figma prototype, analysis may be simulated.

When uploaded, show:

"Suggested branding detected"

Examples:

Primary color
Secondary color
Heading font
Body font
Logo
Common visual patterns

Human must review and approve every detected brand setting.

AI never silently changes branding.

============================================================
6. FONT LIBRARY
============================================================

Replace simple typography presets with a proper Font Library.

Show commonly available fonts.

Include representative commonly used families such as:

Arial
Calibri
Aptos
Aptos Display
Times New Roman
Georgia
Verdana
Tahoma
Trebuchet MS
Courier New
Segoe UI

Also allow future font sources.

Provide:

Search fonts

Recent fonts

Organization fonts

Common fonts

Uploaded custom fonts

============================================================
7. CUSTOM FONT UPLOAD
============================================================

Provide:

"+ Add Custom Font"

Future production support should conceptually include:

TTF
OTF
WOFF
WOFF2

For this prototype:
simulate font upload/storage where needed.

Display:

Font family name
Available weights/styles
Uploaded by
Client/Organization
Usage scope

Example:

DIN Next
Regular
Medium
Bold

Add a note:

"Ensure your organization is licensed to use uploaded fonts."

============================================================
8. LOCAL FONT SUPPORT
============================================================

Do NOT make locally installed operating-system fonts the primary font architecture.

Provide a future-ready OPTIONAL action:

"Use local font"

Where browser/platform support permits, this may request user permission to access locally available fonts.

If unsupported, explain:

"Upload the licensed font to your organization's Font Library to ensure consistent output."

Do not assume all browsers can automatically enumerate locally installed fonts.

============================================================
9. TYPOGRAPHY CONFIGURATION
============================================================

Provide NO-CODE typography controls.

BODY

Font Family
Font Size
Font Weight
Text Color
Line Height
Space Before
Space After

HEADING 1

Font Family
Font Size
Weight
Color
Alignment
Space Before
Space After
Numbering

Repeat for:

Heading 2
Heading 3
Heading 4

Also support:

Caption
Code / Monospace
Links

Users choose values from:

dropdowns
numeric inputs
sliders where appropriate
color pickers
checkboxes

NO code editor.

============================================================
10. LIVE PREVIEW
============================================================

Provide a live style preview beside/in the configuration experience.

Preview representative content:

H1
H2
H3
Paragraph
Link
Ordered list
Unordered list
Table
Note
Warning
Example
Procedure

When a style value changes, update the preview immediately.

============================================================
11. LIST STYLES
============================================================

Style Profile supports:

Ordered Level 1
Ordered Level 2
Ordered Level 3

Allow numbering scheme selection.

Examples:

1.
a.
i.

or

1.
1.1
1.1.1

Unordered Level 1
Level 2
Level 3

Allow bullet style selection.

Allow:

indentation
spacing between items
spacing before/after list

No code.

============================================================
12. TABLE STYLES
============================================================

Provide table style controls:

Header font
Header font weight
Header text color
Header background color

Body font
Body text color

Border color
Border width

Cell padding

Alternate row shading:
On / Off

Alternate row color

First column emphasis:
On / Off

Table caption style

Provide live preview.

============================================================
13. CALLOUT STYLES
============================================================

Configure independently:

Note
Tip
Important
Warning
Example

For each:

Label
Icon optional
Accent color
Background color
Border style
Text style

Provide sensible defaults.

Authors do not manually style individual callouts in Author mode.

============================================================
14. PROCEDURE STYLE
============================================================

Configure:

Procedure title
Step-number appearance
Step-number color
Step-number size
Step indentation
Spacing between steps
Expected Result style
Prerequisite style

Provide live preview.

============================================================
15. MEDIA STYLE
============================================================

Configure:

Default image alignment
Default max width
Caption style
Caption position
Space before/after media
Figure numbering

Do not expose arbitrary floating text wrapping in MVP.

============================================================
16. STYLE PROFILE INHERITANCE
============================================================

Support a simple scope model.

A project may:

Use Client Style Profile exactly

OR

Use Client Style Profile + Project Overrides

Example:

Base:
Acme Documentation

Project override:
H1 accent color changed

Clearly identify overridden styles.

Provide:

Reset to client style

============================================================
17. SAVE STYLE PROFILE
============================================================

Allow:

Save as Client Style Profile

Save as Product Style Profile

Save as Project Style Profile

Example:

Client:
Acme

Product:
Data Platform

Profile:
Data Platform Documentation

Do not require authors to recreate settings for every project.

============================================================
18. DUPLICATE PROFILE
============================================================

Allow:

Duplicate Style Profile

Example:

Acme Standard
→ duplicate
→ Acme Product X

Authors may make small changes without altering the original profile.

============================================================
19. INTERNAL CSS MODEL
============================================================

Conceptually, the application may generate CSS/style tokens internally from the no-code configuration.

Do NOT expose CSS source code to normal authors.

The internal styling engine should be capable of mapping the Style Profile to:

HTML styles
PDF styles
Word styles

The user interacts only with semantic no-code controls.

============================================================
20. OUTPUT TEMPLATE PACK
============================================================

Create a separate Output Template Pack concept.

One Template Pack may contain:

PDF Template

Word Template

HTML Theme

Example:

Acme Standard Documentation Pack

This pack can be reused across multiple projects and document types.

============================================================
21. PDF TEMPLATE DESIGNER
============================================================

Provide a NO-CODE PDF Page Layout Designer.

Support two primary page-template types:

COVER PAGE

CONTENT PAGE

Authors can save both as part of the client Output Template Pack.

============================================================
22. PDF COVER PAGE DESIGNER
============================================================

Allow configurable elements:

Logo
Secondary logo
Document title
Subtitle
Client name
Product name
Version
Date
Confidentiality label
Image
Decorative brand element
Footer

Page settings:

Page size:
A4
Letter
Custom

Orientation:
Portrait
Landscape

Margins

Background color/image

Allow elements to be:

shown/hidden
positioned
aligned

Use visual controls.

No code.

============================================================
23. PDF CONTENT PAGE DESIGNER
============================================================

Configure:

Page size
Orientation
Margins

Header:

Logo
Document title
Chapter/topic title
Version
Custom text

Footer:

Copyright
Confidentiality
Page number
Version
Custom text

Allow:

First content page variation
Odd/even page variation as future-ready capability

Configure:

Page numbering
Starting number
Page number format

Allow chapter/topic start behavior:

Continue
New page

============================================================
24. WORD TEMPLATE DESIGNER
============================================================

Provide a similar NO-CODE Word Output Template.

Support:

COVER PAGE

CONTENT PAGE

Configure:

Margins
Page size
Orientation
Header
Footer
Page number
Logo
Document metadata

Map semantic content styles to Word styles:

Heading 1
Heading 2
Heading 3
Heading 4
Normal/Body
Caption
List
Table
Code
Callouts where supported

The underlying implementation can later generate DOCX.

Prototype interactions can be simulated but configuration must be functional.

============================================================
25. HTML HELP THEME
============================================================

Provide a separate HTML Theme configuration.

HTML is responsive and not page-based.

Allow:

Header
Logo
Navigation position
Navigation width
Search
Breadcrumbs
Topic content width
On This Page
Previous/Next navigation
Footer

Options:

Light mode
Dark mode
Follow system

Typography and component styles come from the selected Style Profile.

============================================================
26. HTML PACKAGE
============================================================

Publish target:

HTML Package

Conceptually generates:

HTML topics
CSS
JavaScript
assets
images
search resources

Do not require the author to understand these files.

============================================================
27. SAME CONTENT – MULTIPLE CLIENT OUTPUTS
============================================================

CRITICAL FEATURE.

The underlying authored content must remain independent from client appearance.

Provide a publishing workflow allowing:

Same project content

→ Acme Brand/Profile

→ Client B Brand/Profile

without duplicating or rewriting topics.

Example:

Output Variant:

Acme Government
Style:
Acme Documentation
Template:
Acme Standard Pack

OR

Client B
Style:
Client B Documentation
Template:
Client B Standard Pack

Changing output branding must NOT change underlying authored content.

============================================================
28. OUTPUT VARIANTS
============================================================

Introduce Output Variants.

Example:

Variant:
External Client A

Conditions:
Client A content

Brand:
Client A

Style Profile:
Client A Documentation

Template Pack:
Client A Standard

Formats:
PDF
Word
HTML

Another variant:

Internal

Different:
conditions
branding
styles
templates

This architecture must work with the existing conditional-content system.

============================================================
29. PUBLISH STAGE
============================================================

Rename the global final workflow stage:

Export

to:

Publish

Global workflow:

Project Details
→ Branding & Styles
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

Within Publish show:

OUTPUT VARIANT

FORMAT

☑ PDF
☑ Word
☑ HTML Package

Future:
SCORM
Knowledge Base
SharePoint
GitHub

Provide:

Generate Outputs

============================================================
30. OUTPUT PREVIEW
============================================================

Before publishing, allow preview by:

Client/variant
Format

Example:

Preview:
Acme Government

Format:
PDF

Switch:
Word
HTML

Preview should reflect selected:

brand
typography
styles
page layout/theme
conditions

============================================================
31. CLIENT PROFILE LIBRARY
============================================================

Provide a reusable profile-management area outside individual projects.

Example:

Client Profiles

Acme Government
├ Brand
├ Style
└ Output Templates

Client B
├ Brand
├ Style
└ Output Templates

Allow:

Create
Duplicate
Rename
Archive

Do not expose this prominently in the current MVP navigation if it makes the UI heavy.

It can initially be accessible from project setup/settings.

============================================================
32. BRAND GUIDELINE IMPORT
============================================================

Allow:

Upload Branding Guidelines

For prototype:
simulate analysis.

Suggest:

colors
fonts
logo
table patterns
heading styles

Show all suggestions for human review.

Actions:

Accept
Edit
Ignore

Do NOT automatically apply inferred branding without author approval.

============================================================
33. STYLE SOURCE PROVENANCE
============================================================

Where useful, indicate:

Configured manually

Detected from Brand Guidelines

Inherited from Client Profile

Project Override

This allows authors to understand why a style exists.

============================================================
34. PROJECT SETTINGS
============================================================

After project creation allow:

Project Settings
→ Branding & Styles

Author can switch:

Client profile
Style profile
Output template pack

Show warning:

"Changing styles affects presentation across this project but does not modify authored content."

Provide live preview before applying.

============================================================
35. STYLE CHANGE SAFETY
============================================================

Switching Style Profiles must NOT:

change authored text
remove content
change TOC hierarchy
remove conditions
remove variables
break cross-references
change source evidence

It changes presentation only.

============================================================
36. TEMPLATE CHANGE SAFETY
============================================================

Changing PDF/Word/HTML templates must affect:

layout
branding
presentation

not semantic content.

============================================================
37. AUTHORING STUDIO RELATIONSHIP
============================================================

Author mode continues using semantic content:

Heading
Paragraph
Procedure
Table
Note
Warning
Example
Image
etc.

Authors do NOT choose fonts/colors for individual blocks during normal authoring.

The active project Style Profile renders those semantic blocks.

============================================================
38. STYLE PREVIEW FROM AUTHOR
============================================================

From Author mode allow a small action:

"Style Profile"

This opens the current profile summary.

Do NOT add full visual styling controls to the authoring toolbar.

Provide:

View Profile
Edit Project Styles

============================================================
39. TEMPLATE REUSE
============================================================

Allow Page Layout and HTML themes to be saved at:

Client level
Product level
Project level

Example:

Client:
Acme

Template:
Acme Standard Documentation

Reuse for:

User Guide
Admin Guide
Quick Start

Authors can duplicate and modify a template for another content type without altering the original.

============================================================
40. DOCUMENT TYPE VARIATIONS
============================================================

A client Output Template Pack may support document-type variations.

Example:

Acme Pack

User Guide Cover
Admin Guide Cover
Quick Start Cover

Common:
Content Page
Header
Footer
Brand styles

This avoids duplicating entire template packs.

============================================================
41. NO-CODE REQUIREMENT
============================================================

At no point should authors need to type:

CSS
HTML
XML
JSON
code

Use:

Dropdowns
Color pickers
Toggles
Checkboxes
Numeric controls
Font selectors
Visual page layout controls
Drag-and-drop where appropriate

============================================================
42. FUNCTIONAL PROTOTYPE REQUIREMENT
============================================================

Do not implement visual-only controls.

All controls shown in this Figma Make prototype must modify prototype state visibly.

Examples:

Changing H1 color:
Live preview changes.

Changing font:
Live preview changes.

Changing table header color:
Table preview changes.

Changing logo:
Cover preview changes.

Changing page margin:
Page preview changes.

Switching client/style profile:
Preview changes.

============================================================
43. ACCEPTANCE TEST — STYLE PROFILE
============================================================

Create temporary test profiles:

CLIENT A

Brand:
Blue primary color

Body:
Arial

H1:
Arial Bold, blue

Table Header:
blue background / white text

CLIENT B

Brand:
Green primary color

Body:
Georgia

H1:
Georgia Bold, green

Table Header:
green background / white text

Use the same sample User Guide content.

Switch Client A → Client B.

VERIFY:

Content text remains identical.

TOC remains identical.

Conditions remain identical.

Only presentation changes.

============================================================
44. ACCEPTANCE TEST — TYPOGRAPHY
============================================================

Change:

Body font

H1 font

H1 size

H1 color

Line spacing

Verify live preview updates.

Save profile.

Reload/reselect profile.

Verify configuration persists during prototype session.

============================================================
45. ACCEPTANCE TEST — TABLE STYLE
============================================================

Modify:

Header background
Header text color
Border color
Cell padding
Alternate rows

Verify table preview updates.

============================================================
46. ACCEPTANCE TEST — PAGE TEMPLATE
============================================================

Create Cover Page:

Logo
Document title
Product
Version
Date

Create Content Page:

Header logo
Topic title
Footer page number

Change margins.

Verify page preview responds.

Save template.

Apply to project.

============================================================
47. ACCEPTANCE TEST — OUTPUT VARIANT
============================================================

Create:

Variant A:
Client A
PDF + Word + HTML

Variant B:
Client B
PDF + Word + HTML

Switch Preview between variants.

Verify visual branding changes while content stays unchanged.

============================================================
48. ACCEPTANCE TEST — REGRESSION
============================================================

After implementing this architecture ensure these existing features still work:

Sources
Analysis
TOC
Author content editing
TOC navigation
Conditions
Variables
Snippets
Tables
Images
Knowledge Map
Review
Preview

Branding changes must not break authoring functionality.

============================================================
49. SELF-TEST AND CORRECT
============================================================

After implementation:

Run all acceptance tests above using the running prototype.

If a test fails:

inspect the implementation
fix the behavior
repeat the failed test

Do not claim completion until the interaction works or explicitly report that it could not be validated.

============================================================
50. COMPLETION REPORT
============================================================

At completion report:

IMPLEMENTED

TESTED AND PASSED

FIXED DURING TESTING

NOT FULLY VALIDATED

Do not claim a capability passed without exercising it.

============================================================
51. CORE PRODUCT PRINCIPLE
============================================================

The platform owns structured content.

Client Profiles own branding.

Style Profiles own semantic presentation.

Output Templates own page/screen layout.

Output Variants combine:

content
conditions
client branding
styles
template
format

The author remains completely NO-CODE.