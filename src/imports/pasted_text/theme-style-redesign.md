THEME & STYLE SYSTEM REDESIGN — UNIFIED BRAND → TEMPLATE WORKFLOW

This is an existing Content Studio application.

IMPORTANT:
- Do NOT rebuild the application.
- Do NOT modify the frozen project-state/persistence architecture.
- Do NOT modify Sources, Analysis, TOC, Author, Review, or Publish pipelines.
- Preserve stable IDs, IndexedDB persistence, project isolation, Theme persistence,
  Page Layout persistence, HTML Master persistence, Variables, and current project navigation.
- This task is ONLY about improving Theme & Styles and Output Templates.

The current Theme & Styles experience is fragmented and confusing.

Redesign it into one coherent presentation system:

BRAND PROFILE
→ APPLY TO PROJECT
→ OUTPUT TEMPLATES INHERIT BRAND
→ OPTIONAL LOCAL TEMPLATE OVERRIDES

============================================================
1. REMOVE THE OVERVIEW TAB
============================================================

Remove the Overview tab entirely.

The Theme & Styles workspace should have only:

Brand & Style
Output Templates
Variables

When the user enters Theme & Styles, open:

Brand & Style

by default.

Do not create a separate overview screen.

============================================================
2. BRAND & STYLE MUST BE THE BRAND PROFILE HUB
============================================================

Brand & Style should be the central place for:

- viewing saved Brand Profiles
- selecting a Brand Profile
- creating a Brand Profile
- importing Brand Guidelines
- duplicating a Brand Profile
- renaming a Brand Profile
- deleting a Brand Profile
- editing every brand property
- applying a Brand Profile to the project

Design this as a modern professional workspace.

Suggested layout:

LEFT:
Brand Profile library / selector

CENTER:
Profile editor

RIGHT or top summary:
Profile status + Apply to Project

Do not scatter profile management across multiple unrelated screens.

============================================================
3. BRAND PROFILE LIBRARY
============================================================

Show existing profiles clearly.

Each profile should display:

Profile Name
optional organization/client/product metadata
logo thumbnail where available
small palette preview
primary typography preview
Reusable / Project-only status
Applied to Project indicator

Actions:

New
Import Brand Guidelines
Duplicate
Rename
Delete

The currently applied profile should have a clear:

Applied

badge.

Selected profile and Applied profile may be different.

Example:

Selected:
Corporate Brand 2026

Applied to Project:
Product Brand

This allows authors to inspect/edit another profile without accidentally
changing the project.

============================================================
4. APPLY TO PROJECT
============================================================

Retain the existing Apply to Project concept.

Improve the UI.

When a profile is selected:

show:

Apply to Project

If already applied:

show:

Applied to Project ✓

Applying a profile updates:

activeStyleProfileId

using the existing central project state.

Do NOT copy all profile values into separate project values.

Templates should reference the active Style Profile by ID.

============================================================
5. BRAND IMPORT WORKFLOW
============================================================

Keep:

Import Brand Guidelines

Support actual existing extraction from:

DOCX
PDF

Do not pretend unsupported formats were analyzed.

The import flow can remain:

Upload
Analyze
Map Brand
Review & Save

but the result must create a real Brand Profile.

Do NOT stop at a disconnected import result.

============================================================
6. IMPORT MUST POPULATE THE COMPLETE PROFILE
============================================================

When a brand guideline is imported successfully:

populate all detected values directly into the new Brand Profile.

At minimum:

Logo / Brand Assets
Colors
Font Families
Typography Roles
Heading Styles
Body Style
Caption Style
Code Style
Tables
Callouts
Links

where the uploaded guideline actually provides them.

Never hard-code test values.

If information is not detected:

leave the field as:

Not detected

or inherit the platform default.

Do not present platform defaults as extracted values.

============================================================
7. FONT SYSTEM — SINGLE SOURCE OF TRUTH
============================================================

The current typography flow is disconnected.

Redesign the profile font model.

A Brand Profile should support:

Primary Font
Heading Font
Body Font
Fallback Font
Code Font
Caption Font if separately defined

Primary Font acts as the default family.

If the guideline provides only one primary family:

set:

Primary Font = detected family
Heading Font = Primary Font
Body Font = Primary Font

unless the guideline explicitly defines different families.

Fallback remains independently configurable.

Code Font remains independently configurable.

============================================================
8. FONT IMPORT PROPAGATION
============================================================

When an imported guideline identifies a Primary Font:

the saved Brand Profile must immediately reflect it.

It must also propagate to semantic typography styles unless those styles have
an explicit different family.

Example inheritance:

Primary Font
 ├─ Document Title
 ├─ H1
 ├─ H2
 ├─ H3
 ├─ H4
 ├─ Body
 └─ Caption

where appropriate.

If the guideline explicitly defines:

Heading Font
Body Font

use those instead.

Do NOT leave H1–H4 using old/default fonts after Primary Font has been imported.

============================================================
9. FONT INHERITANCE UI
============================================================

Make inheritance understandable.

For typography styles show something like:

Font Family
Inherit from Heading Font

or:

Font Family
Custom Override

Example:

Heading 1
Font: Heading Font (inherited)

If user manually changes H1:

Heading 1
Font: Custom Override

Provide:

Reset to Brand

Do not silently duplicate font values across controls.

============================================================
10. BRAND PROFILE EDITOR SECTIONS
============================================================

Use a clear left-side section navigator inside Brand & Style:

Brand
Colors
Typography
Headings
Lists
Tables
Callouts
Procedures
Media
Links

Do not create excessive nested screens.

============================================================
11. BRAND SECTION
============================================================

Support:

Profile Name
Brand Name
Primary Logo
Secondary Logo
Logo for Dark Background
Logo for Light Background where useful

Allow:

Upload
Replace
Remove

Imported logo assets should appear here automatically.

============================================================
12. COLORS
============================================================

Provide semantic brand tokens:

Primary
Secondary
Accent
Background
Surface
Heading Text
Body Text
Border
Link
Success
Information
Warning
Critical
Table Header
Custom

Each color supports:

visual picker
HEX
RGB where useful
Theme Colors
Recent Colors

Imported colors populate these semantic roles.

Allow manual modification.

============================================================
13. TYPOGRAPHY
============================================================

Provide:

Primary Font
Heading Font
Body Font
Fallback Font
Code Font

Then semantic styles:

Document Title
H1
H2
H3
H4
Body
Caption
Code

Each semantic style supports:

Font Family
Weight
Size
Line Height
Color
Spacing where useful

Default to inheritance.

Allow explicit override.

Changing Heading Font updates H1–H4 styles that are still inherited.

Changing Body Font updates Body and Caption styles that are still inherited.

============================================================
14. IMPORT TYPOGRAPHY MUST UPDATE HEADINGS
============================================================

Critical requirement:

If a guideline import detects typography:

the imported Brand Profile must update:

Primary Font
Heading Font
Body Font
Fallback Font
Code Font

AND semantic styles:

Document Title
H1
H2
H3
H4
Body
Caption
Code

where supported by the source document.

Do not populate the Brand Import review but leave the actual profile unchanged.

============================================================
15. SAVE BEHAVIOR
============================================================

Do not require separate confusing Save buttons for every tiny subsection.

Use project/profile autosave where safe.

Show:

Saving…
Saved

If a destructive/major update requires explicit save, make it clear.

Avoid repetitive:

Save Typography
Save Headings
Save Tables

unless technically necessary.

============================================================
16. OUTPUT TEMPLATES — BRAND INHERITANCE
============================================================

Output Templates contains:

PDF / Word Page Layouts
HTML Master Pages

Both must automatically consume the currently applied Brand Profile.

Do not copy brand colors/fonts into templates as disconnected values.

Templates should reference semantic tokens such as:

brand.primary
brand.secondary
brand.headingFont
brand.bodyFont
brand.headingText
brand.bodyText
brand.surface

Changing the applied Brand Profile must immediately re-render template previews.

============================================================
17. TEMPLATE LOCAL OVERRIDES
============================================================

Templates may override Brand Profile values.

Example:

Background:
Brand Primary (Inherited)

or:

Background:
Custom Override

Provide:

Reset to Brand

Clearly distinguish inherited versus overridden values.

============================================================
18. PDF / WORD PAGE LAYOUT DESIGNER
============================================================

Keep PDF/Word Page Layouts.

Improve usability.

Page Layout types:

Cover
Content
Chapter Opener
TOC
End Page
Custom

Common settings:

Page size
Orientation
Margins
Background
Header
Footer

Page elements should include:

Logo
Text
Document Title
Subtitle
Product Name
Version
Date
Confidentiality
Page Number
Copyright
Variable
Image
Divider
Watermark

============================================================
19. PAGE LAYOUT TEXT EDITING
============================================================

Every text-capable page element must allow the user to enter text.

Text source options:

Manual Text
Variable
Mixed Text + Variables

Example:

{{ProductName}} User Guide

Do not limit editable text to fixed placeholder elements.

============================================================
20. PAGE LAYOUT BRAND INHERITANCE
============================================================

New Page Layouts should automatically use:

applied Brand Profile colors
applied typography
applied logo

Example:

Cover background → Brand Primary
Document Title → Document Title style
Subtitle → Body/Subtitle style
Logo → Primary Logo

Changing Brand Profile should update the preview automatically unless a local
override exists.

============================================================
21. HTML MASTER PAGE BUILDER — ADVANCED BUT NO-CODE
============================================================

Retain the 3-pane builder:

LEFT:
Components

CENTER:
Live canvas

RIGHT:
Properties

Make it significantly more functional.

Do not use unrestricted freeform absolute positioning.

Use responsive structured Sections / Columns / Blocks.

============================================================
22. ALL TEXT-BEARING BLOCKS MUST BE EDITABLE
============================================================

The current builder allows editable content mainly in Hero.

Fix this.

The following components must support direct text/property editing:

Header
Hero
Welcome Text
Rich Text
Heading
Image + Text
Button / CTA
Navigation Card
Quick Link
Featured Link
Accordion
FAQ
Tab
Announcement
Status Banner
Statistic
Footer
and other text-bearing components

When a block is selected:

show its editable properties in the right panel.

Where useful also allow direct inline text editing on canvas.

============================================================
23. VARIABLES INSIDE TEMPLATE TEXT
============================================================

All relevant text fields should support Variables.

Example:

Welcome to {{ProductName}}

Version {{Version}}

Documentation for {{CompanyName}}

Use variable IDs/tokens.

Do not store only resolved text.

============================================================
24. NAVIGATION CARDS — FULL CONFIGURATION
============================================================

Navigation Cards are a key component.

A card must support:

Title
Description
Image / Icon
Destination
Style
Visibility

Destination options:

Documentation Topic
TOC Section
External URL
File / Download where supported
None

For Documentation Topic:

show the project's actual TOC.

Allow user to select a topic.

Store:

topicId

NOT the topic title.

If the topic is renamed:

the card link remains valid.

============================================================
25. NAVIGATION CARD COLLECTION
============================================================

Navigation Cards component should support:

Manual Cards

or:

Generate from TOC

Generate from TOC can create cards from:

top-level topics
selected section children
selected topics

Cards should then be editable independently.

============================================================
26. CARD IMAGE OPTIONS
============================================================

Each navigation card should support:

No image
Icon
Upload Image
Project Asset
AI Generated Image

For Upload:

support normal image upload.

For Project Asset:

allow selecting existing project/brand assets.

For AI Generated Image:

show prompt field such as:

"Modern abstract illustration representing user management"

If an actual image-generation capability is available in the current environment:

generate and insert the image.

If no real generation service is connected:

do NOT fake an AI-generated image.

Show:

"AI image generation is not connected in this prototype."

The architecture should retain an image asset reference so an AI provider can be
connected later.

============================================================
27. IMAGE COMPONENTS
============================================================

Image and Image + Text components should support:

Upload
Project Asset
Brand Asset
AI Generated Image where available

Properties:

Alt Text
Fit
Aspect Ratio
Alignment
Corner Radius where appropriate
Link
Caption

============================================================
28. COMPONENT LIBRARY
============================================================

Retain / expand useful components:

STRUCTURE
Section
Columns
Divider
Spacer
Footer

CONTENT
Hero
Welcome Text
Rich Text
Heading
Image
Image + Text
Video
Button / CTA
Icon
Icon + Text

NAVIGATION
Search
Navigation Cards
Knowledge Categories
Quick Links
Featured Links
Breadcrumb

DYNAMIC
Recent Content
Recently Updated
Featured
Popular

INTERACTIVE
Accordion
FAQ
Tabs
Checklist
Progress Bar
Stepper
Timeline
Announcement
Status Banner
Statistic
Carousel
Gallery
Feedback
Contact
Download

Do not create components that cannot actually be edited/configured.

============================================================
29. BLOCK OPERATIONS
============================================================

Every block should support as appropriate:

Edit
Duplicate
Move Up
Move Down
Hide
Show
Delete
Lock

Drag-and-drop may remain.

But Move Up / Move Down must provide a reliable fallback.

============================================================
30. RESPONSIVE SETTINGS
============================================================

Desktop
Tablet
Mobile

Preview modes must work.

Allow per-block:

visibility
column behavior
spacing
alignment

Navigation Cards example:

Desktop: 3 columns
Tablet: 2 columns
Mobile: 1 column

============================================================
31. HOME MASTER
============================================================

Home Page Master should support:

Header
Hero
Search
Navigation Cards
Knowledge Categories
Featured Content
Recent Content
Announcements
Footer

No content should be hard-coded to a sample product.

============================================================
32. TOPIC MASTER
============================================================

Topic Master should support:

Header
Search
Breadcrumb
Left Navigation
Main Content
On This Page
Related Topics
Previous / Next
Feedback
Footer

Main Content is mandatory.

============================================================
33. TOPIC MASTER LINKS TO REAL TOC
============================================================

Left Navigation and breadcrumb must derive from the project's current TOC.

Previous / Next must derive from TOC order.

On This Page must derive from headings in current topic content.

Do not hard-code navigation data.

============================================================
34. MASTER PAGE ASSIGNMENT
============================================================

Allow assignment by stable IDs.

Examples:

Home Master → HTML Home
Topic Master → default topics

Later individual topics can override the default Master.

Do not link assignments by display name.

============================================================
35. VARIABLES TAB
============================================================

Keep Variables as a separate top-level tab.

Improve usability where needed.

Variables should support:

Token
Value
Description

Allow:

New
Edit
Delete where safe

Variables are available in:

Author
Page Layouts
HTML Masters
Publish

Do not tie Variables to visual branding unnecessarily.

============================================================
36. DESIGN QUALITY
============================================================

Make the redesigned workspace feel like a modern professional design system,
not a settings form.

Use:

clear hierarchy
comfortable spacing
profile cards
visual palette previews
typography previews
live component previews
inheritance indicators
compact property controls

Avoid:

huge blank spaces
excessive nested cards
unnecessary buttons
technical terminology for ordinary authors
clutter

Preserve the existing overall Content Studio visual language.

============================================================
37. DO NOT BREAK EXISTING DATA
============================================================

Existing:

Themes
Style Profiles
Page Layouts
HTML Masters
Variables

must be migrated/preserved.

Do not delete existing saved projects.

Add safe defaults for any newly introduced properties.

============================================================
38. ACCEPTANCE TEST — BRAND
============================================================

Import a DOCX Brand Guideline.

Verify:

Profile is created
Profile appears in Brand & Style
Colors populate
Primary Font populates
Heading Font populates/inherits
Body Font populates/inherits
Fallback Font populates if detected
Code Font populates if detected
H1–H4 use imported Heading Font unless explicitly overridden
Body uses imported Body Font
Logo appears if extracted/selected

Edit one value manually.

Reload.

Verify it remains.

============================================================
39. ACCEPTANCE TEST — APPLY PROFILE
============================================================

Create two very different Brand Profiles.

Apply Profile A.

Verify:

Page Layout preview changes
HTML Master preview changes

Apply Profile B.

Verify:

both previews change automatically.

No manual template recreation should be required.

============================================================
40. ACCEPTANCE TEST — NAVIGATION CARDS
============================================================

Create a TOC containing multiple topics.

Add Navigation Cards to Home Master.

Create three cards.

Link each card to a different TOC topic.

Rename one TOC topic.

Verify:

card still links correctly using topicId.

Add an uploaded image to one card.

Verify persistence after reload.

============================================================
41. ACCEPTANCE TEST — EDITABLE TEMPLATE CONTENT
============================================================

Add:

Heading
Rich Text
Image + Text
Button
Navigation Card
Footer

Verify each supports actual editing through Properties.

Do not mark PASS if only Hero supports editable text.

============================================================
42. COMPLETION REPORT
============================================================

Report:

Overview removed
PASS / FAIL

Brand Profile library
PASS / FAIL

Brand import creates complete profile
PASS / FAIL

Primary Font extraction → profile
PASS / FAIL

Heading font inheritance
PASS / FAIL

Body font inheritance
PASS / FAIL

Manual brand editing
PASS / FAIL

Apply to Project
PASS / FAIL

Page Layout brand inheritance
PASS / FAIL

HTML Master brand inheritance
PASS / FAIL

Page Layout editable text
PASS / FAIL

HTML block editable text
PASS / FAIL

Navigation Cards → TOC topic IDs
PASS / FAIL

Navigation card images
PASS / FAIL

AI image option
PASS / PARTIAL / FAIL

Variables inside templates
PASS / FAIL

Responsive Master Pages
PASS / FAIL

Persistence after reload
PASS / FAIL

Also identify any Theme/Template setting that remains disconnected from the
active Brand Profile.

============================================================
FINAL PRODUCT PRINCIPLE
============================================================

The author should experience Theme & Styles as one connected system:

CREATE / IMPORT BRAND PROFILE
        ↓
REVIEW / EDIT BRAND
        ↓
APPLY TO PROJECT
        ↓
PAGE LAYOUTS + HTML MASTERS INHERIT BRAND
        ↓
OPTIONAL LOCAL OVERRIDES
        ↓
PUBLISH

The user should never need to manually recreate the same branding separately
inside every template.