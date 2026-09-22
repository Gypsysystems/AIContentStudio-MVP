MASTER PAGE & PAGE LAYOUT FOUNDATION — COMPLETE NO-CODE DESIGNER PASS

Work ONLY on:

1. PDF / Word Page Layouts
2. HTML Master Pages
3. Page/Master designers
4. Their live previews and persistent state

Do NOT work on Publish yet.

Do NOT modify:
Sources
Analysis
TOC
Authoring
Knowledge Map
Review

GOAL

Make Page Layouts and HTML Master Pages complete, reliable, easy-to-use NO-CODE design systems for professional documentation.

Authors must be able to visually design:

- PDF/Word cover pages
- PDF/Word content pages
- HTML home pages
- HTML topic pages
- additional reusable HTML master pages

Everything configured here must later become the single source of truth for Preview and Publish.

============================================================
PART A — SHARED ARCHITECTURE
============================================================

1. SINGLE SOURCE OF TRUTH

Designer state, live preview, Publish preview, and generated output must eventually consume the SAME saved configuration.

Do not create hard-coded preview implementations.

Use:

Saved Layout/Master Configuration
        ↓
Designer Canvas
        ↓
Preview
        ↓
Publishing Renderer

For this request, concentrate on making Designer + Live Preview correct and persistent.

============================================================
2. PERSISTENT STATE

Every configuration field must use controlled persistent application state.

Do not rely on defaultValue for saved configuration.

Changes must remain when:

- clicking elsewhere
- switching layouts
- switching master pages
- changing tabs
- leaving Theme & Styles
- returning during the current prototype session

============================================================
3. SAVED ITEM SELECTORS

PDF/Word Page Layouts use ONE dropdown.

HTML Master Pages use ONE dropdown.

Dropdown entries must be sorted alphabetically.

When an item is:

created
duplicated
renamed
deleted

update and re-sort the dropdown immediately.

============================================================
4. INLINE RENAME

Do not show permanent Rename buttons.

Hover name → pencil icon.

Click pencil → inline edit.

Enter = save
Click outside = save
Escape = cancel

Re-sort dropdown after rename.

============================================================
PART B — PDF / WORD PAGE LAYOUTS
============================================================

5. PAGE LAYOUT TYPES

Support:

Cover Page
Content Page
Chapter Opener
TOC Page
End Page
Custom

At minimum make Cover Page and Content Page fully functional.

============================================================
6. PAGE SETTINGS — ALL LAYOUT TYPES

Each page layout supports:

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

Background:
Color
Image
None

Background image:
Upload
Fit
Fill
Center
Opacity

Content Page MUST also support background color/image.

Currently only Cover supports background. Fix this.

============================================================
7. MARGIN PREVIEW BUG

Current issue:

Margins on newly created or duplicated layouts do not reliably update the preview.

Fix this at the state architecture level.

Changing any margin must immediately change the visible page content boundary in the live preview.

The same must work for:

original layout
new layout
duplicated layout

Test independently.

============================================================
8. DUPLICATED LAYOUT STATE

Duplicate must create a deep independent copy.

Copy:

page settings
margins
background
zones
elements
element properties
bindings
header/footer
all style overrides

After duplication:

modifying margins or any other field in the duplicate must update its preview

and must NOT alter the original.

============================================================
9. VISUAL PAGE CANVAS

Use a visual page canvas representing the selected paper size and orientation.

Show:

page boundary
margin boundary
zones
placed elements

Allow selected element highlighting.

Preview should respond immediately to configuration.

============================================================
10. PAGE REGIONS

For Cover Page support:

TOP
CENTER
BOTTOM

For Content Page support:

HEADER
CONTENT
FOOTER

Do NOT tie specific element types permanently to specific zones.

Any compatible decorative/metadata element can move to another valid zone.

============================================================
11. FLEXIBLE LOGO PLACEMENT

Logo must be placeable in:

TOP
CENTER
BOTTOM

For Content Page:

HEADER
CONTENT where appropriate
FOOTER

Inside a region support:

Left
Center
Right

Also support:

Logo size:
Small
Medium
Large
Custom

Custom width

Maintain aspect ratio.

Authors must be able to use logo at center or bottom of Cover Page.

============================================================
12. GENERIC PAGE ELEMENT MODEL

Available page elements:

Primary Logo
Secondary Logo
Document Title
Subtitle
Product Name
Client Name
Organization Name
Version
Date
Confidentiality
Author
Document ID
Chapter Title
Topic Title
Page Number
Copyright
Custom Text
Image
Divider
Variable
Watermark where applicable

Authors can:

Add
Remove
Move
Duplicate
Reorder
Align
Configure

============================================================
13. PAGE ELEMENT MOVEMENT

Implement working drag-and-drop.

Use a reliable pointer-based drag-and-drop implementation rather than relying only on native HTML draggable behavior.

When dragging:

show valid zones
highlight insertion location
show drop indicator

After drop:

save state
update preview

Also ALWAYS provide:

Move To…
Move Up
Move Down

as accessible fallback.

============================================================
14. BOTTOM ZONE ALIGNMENT BUG

Current issue:

Bottom-zone alignment does not work.

Fix it.

For EVERY zone element:

Alignment:
Left
Center
Right

must visibly change its location in the page preview.

Do not use alignment as a label-only field.

Test:

Version → Left
Date → Center
Confidentiality → Right

Then reverse them.

============================================================
15. TEXT ELEMENT CONTENT SOURCE

Every text-based element must have:

Content Source:

Manual Text
Variable

If Manual Text:

show editable text field.

If Variable:

show available Variables dropdown.

Example:

Product Name

Content Source:
Variable

Variable:
ProductName

Preview:
Orion Platform

============================================================
16. MIXED TEXT + VARIABLES

Where useful support composition:

Manual text + Variables.

Example footer:

Confidential — {{ProductName}} — {{Version}}

Use:

Insert Variable

inside supported text fields.

Do not make the author enter token syntax manually.

============================================================
17. VARIABLE SELECTOR

Variable selector uses all project/theme variables already available.

Examples:

DocumentTitle
ProductName
Version
ReleaseDate
OrganizationName
ClientName
CopyrightYear

plus user-created Variables.

If a variable has no value:

show an obvious preview placeholder

and indicate unresolved state.

============================================================
18. TEXT ELEMENT TYPOGRAPHY

Every Cover Page text element supports optional layout-level formatting:

Font Source:
Inherit Style Profile
Override

If Override:

Font Family
Font Size
Weight
Color
Alignment
Line Height

Examples:

Document Title
Subtitle
Product Name
Version
Date
Confidentiality
Custom Text

Do NOT require authors to change global Style Profile just to change cover-title size.

============================================================
19. STYLE INHERITANCE

Default:

inherit Brand & Style Profile.

Allow local layout override.

Clearly mark:

Inherited

or

Overridden

Provide:

Reset to inherited style.

============================================================
20. HEADER / FOOTER DESIGNER

For Content Page provide configurable Header and Footer.

Authors can add:

Logo
Document Title
Chapter Title
Topic Title
Version
Date
Page Number
Copyright
Confidentiality
Custom Text
Variable
Divider

Allow:

position
order
alignment
font size/color
visibility

============================================================
21. PAGE NUMBER SETTINGS

Page Number supports:

1
Page 1
Page 1 of N

Alignment:
Left
Center
Right

Start number

Hide on Cover:
Yes/No

============================================================
22. WATERMARK

Add optional:

Text Watermark
Image Watermark

Text supports:

Text / Variable
Opacity
Orientation
Position
Font Size
Color

Image supports:

Upload
Opacity
Size
Position

============================================================
23. PDF TABLE OF CONTENTS LAYOUT

Allow creation of TOC Page layout.

Configure:

Title

Heading levels:
H1
H2
H3
H4

Show page numbers:
On/Off

Typography

Spacing

Use live sample hierarchy.

============================================================
24. END PAGE

Provide End Page layout similar to Cover Page.

Useful for:

legal notice
contact information
closing branding
support information

============================================================
PART C — HTML MASTER PAGE DESIGNER
============================================================

25. THREE-PANE BUILDER

Keep/enhance:

LEFT:
Component Library

CENTER:
Live Canvas

RIGHT:
Properties Inspector

Make the CENTER canvas the primary interactive design surface.

============================================================
26. DRAG AND DROP — CRITICAL

Current drag-and-drop is unreliable.

Reimplement it using a stable pointer-based sortable/drop-zone architecture.

Requirements:

Component Library → Canvas:
drag to add.

Canvas → Canvas:
drag to reorder.

Column → Column:
drag compatible component.

Show:

drag ghost/preview
drop indicator
highlighted destination
invalid-drop indication

Do not update content until drop completes.

After drop:

save state
update canvas immediately.

============================================================
27. DRAG FALLBACK

Every component also supports:

Move Up
Move Down
Move To Section
Move To Column

This remains available even when drag-and-drop works.

============================================================
28. HOME MASTER COMPONENT LIBRARY

Provide these no-code blocks:

STRUCTURE

Header
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
GIF
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
Breadcrumb where appropriate

DYNAMIC CONTENT

Recent Content
Recently Created
Recently Updated
Featured Topics
Popular Topics
Most Viewed
Most Liked

INTERACTIVE

Accordion
FAQ
Tabs
Checklist
Progress Bar
Stepper
Timeline
Announcement Banner
Status Banner
Statistic / Counter
Carousel
Image Gallery
Feedback
Simple Form
Contact Card
Download Card
Expandable Content

MEDIA / EMBED

Video
GIF
Image
External Embed placeholder

Do not expose raw code to normal authors.

============================================================
29. EXTENSIBLE COMPONENT MODEL

Do not hard-code the designer architecture so only the above components can ever exist.

Every component should conceptually use:

type
id
content/data
layout
style overrides
visibility
responsive settings
interaction settings

This lets more block types be added later without redesigning the builder.

============================================================
30. SECTION COMPONENT

Section properties:

Width:
Full
Contained

Background:
Theme Color
Custom Color
Image
None

Padding:
Compact
Standard
Large
Custom

Minimum Height

Alignment

Visibility

============================================================
31. COLUMN LAYOUTS

Section layout options:

1 column

2 columns:
50/50
33/67
67/33

3 columns:
equal
25/50/25

4 columns:
equal

Custom future-ready

Allow compatible blocks to be dragged into columns.

============================================================
32. PER-ELEMENT BACKGROUND

Every applicable Home Page element must support:

Background:
Transparent
Theme Color
Custom Color
Image where applicable

Use standard color picker.

Examples:

Hero
Welcome Text
Cards
Recent Content
CTA
Checklist
FAQ
Footer

============================================================
33. PER-ELEMENT TYPOGRAPHY

Text-capable components support:

Typography Source:
Inherit Theme
Override

Override supports:

Font Family
Font Size
Weight
Color
Alignment
Line Height

When applicable distinguish:

Heading Style
Body Style
Label Style

Do not force authors to globally change Theme typography for one Home Page component.

============================================================
34. WELCOME TEXT

Current issue:

Welcome Text can be added but its text cannot be edited.

Fix it.

Properties:

Heading optional
Body text

Use a rich text editor with:

Bold
Italic
Underline
Link
Ordered List
Unordered List
Alignment

Allow Variables.

============================================================
35. RICH TEXT BLOCK

Rich Text supports:

Headings
Paragraphs
Bold
Italic
Underline
Links
Ordered lists
Unordered lists
Variables
Alignment

No raw HTML required.

============================================================
36. HERO BLOCK

Properties:

Heading
Description
Background Color/Image
Background opacity
Alignment
Height
Logo optional
Search optional

Primary CTA:
Label
Destination

Secondary CTA:
Label
Destination

Support Variables in text.

============================================================
37. NAVIGATION CARDS

Properties:

Section Title

Columns:
1
2
3
4

Card Count:
author chooses

Cards can be:

Manual
Dynamic from TOC categories/topics

Individual card supports:

Icon
Uploaded Image
GIF where appropriate
Title
Description
Destination
Background
Text color

Authors can:

Add card
Duplicate card
Delete
Drag reorder

============================================================
38. CARD RESPONSIVENESS

If author selects:

4 desktop columns

responsive defaults:

Tablet:
2 columns

Mobile:
1 column

Allow override.

============================================================
39. ICON LIBRARY

Provide:

Built-in icon library
Search icons
Upload SVG/PNG
Use image

Authors should not need icon code.

============================================================
40. IMAGE BLOCK

Support:

Upload
Drag/drop
Alt text
Caption
Width
Height behavior
Alignment
Link
Border radius
Fit:
Contain
Cover

============================================================
41. GIF SUPPORT

GIF can be uploaded wherever an Image-capable component supports it.

Preserve animation in HTML output.

Provide alt text.

============================================================
42. VIDEO BLOCK

Support:

Uploaded video placeholder
Video URL
YouTube/Vimeo-style external URL concept
Poster image
Caption
Autoplay off by default
Controls on/off

Do not auto-play media by default.

============================================================
43. CHECKLIST COMPONENT

Add interactive Checklist.

Properties:

Title
Description
Items

Authors can:

Add item
Delete item
Reorder item

Reader behavior:

check/uncheck

Persistence option:

None
Browser local session
Browser local storage

Default:
Browser local storage

Optional:

Progress display:
On/Off

============================================================
44. PROGRESS BAR

Progress Bar supports:

STATIC MODE

Author specifies:
value
label

or

LINKED MODE

Source:
Checklist completion
Topic completion future-ready
Custom data future-ready

Display:

percentage
label
bar

Style inherits Theme.

============================================================
45. STEPPER

Stepper supports:

Horizontal
Vertical

Each step:

Title
Description
Icon
Link optional

Useful for:

Getting Started
Onboarding
Processes

============================================================
46. ACCORDION / FAQ

Accordion items:

Title
Content

Allow:

Single open
Multiple open

FAQ is specialized Accordion.

Rich text within content.

============================================================
47. TABS

Tabs:

Add/remove/reorder tabs.

Each tab:

Label
Content

Content may contain rich text and selected compatible blocks where practical.

============================================================
48. ANNOUNCEMENT / STATUS BANNER

Support:

Info
Success
Warning
Critical
Custom

Text
Link/CTA
Dismissible:
On/Off

Background inherits semantic Theme style unless overridden.

============================================================
49. CAROUSEL

Carousel items support:

Image
Heading
Text
Link

Properties:

Autoplay:
Off by default

Navigation arrows
Dots
Interval

Mobile responsive.

============================================================
50. TIMELINE

Timeline supports:

Date / label
Heading
Description
Icon

Useful for:

release history
roadmap
process milestones

============================================================
51. RECENT CONTENT — DYNAMIC

Recent Content should NOT require manual maintenance by default.

Properties:

Data Source:

Recently Updated
Recently Created
Featured Topics
Most Viewed
Most Liked
Manual Selection

For this Figma prototype:

Recently Updated:
derive from topic modified metadata.

Recently Created:
derive from created metadata.

Most Viewed / Most Liked:
may use clearly labeled prototype analytics data if real analytics do not exist.

Featured Topics:
author explicitly marks topics Featured.

Manual:
author chooses topics.

============================================================
52. RECENT CONTENT SETTINGS

Allow:

Number of items:
3
5
10
Custom

Display:

Title
Description
Modified date
Icon/Image

Layout:

List
Cards

Columns:
when Cards selected

============================================================
53. AUTOMATIC UPDATE BEHAVIOR

Dynamic components must resolve their data at preview/publish time.

Example:

Recently Updated

should reflect the most recently modified topics without the author manually editing the Home Master.

Do not copy a static list into the Master configuration.

Store:

query/configuration

not the results themselves.

============================================================
54. FEATURED TOPICS

Allow topic metadata:

Featured:
Yes/No

Featured Content component automatically displays Featured topics.

============================================================
55. QUICK LINKS

Manual links.

Each:

Label
Icon
Destination
External/Internal

Allow reorder.

============================================================
56. KNOWLEDGE CATEGORIES

Generate from current TOC/category hierarchy.

Authors can:

Include/exclude categories
Reorder
Set display title
Override icon/image

Keep links dynamic.

============================================================
57. FEEDBACK COMPONENT

Prototype modes:

Was this helpful?
Thumbs up/down
Rating
Custom prompt

For Figma prototype:
interaction can store session/local state.

Production analytics comes later.

============================================================
58. SIMPLE FORM

Provide simple no-code form component concept:

Text field
Email
Dropdown
Checkbox
Textarea
Submit

This prototype does NOT need a real external form backend.

Clearly label if submission is prototype-only.

============================================================
59. COMPONENT SIZE

Every major layout component supports sensible size controls, depending on type.

Examples:

Width:
Auto
Full
Custom
Column width

Height:
Auto
Compact
Standard
Large
Custom where applicable

Do not force fixed heights for text-rich blocks.

============================================================
60. COMPONENT SPACING

Properties:

Margin top/bottom where appropriate
Padding
Gap

Use:

Compact
Standard
Spacious
Custom

Theme defaults remain available.

============================================================
61. COMPONENT DUPLICATION

Every user-added Home Page block supports:

Duplicate

The copy is inserted immediately after original.

Use independent state.

============================================================
62. COMPONENT VISIBILITY

Support:

Visible
Hidden

Future-ready:

Desktop only
Tablet only
Mobile only

Do not delete content just to hide it.

============================================================
63. COMPONENT LOCK

Optional:

Lock Position

prevents accidental drag/reorder.

Useful after Home Page has been finalized.

============================================================
64. HOME PAGE CANVAS DIRECT EDITING

For simple text:

allow double-click/click-to-edit directly on canvas where reliable.

Example:

Welcome heading
CTA label
Card title

Properties Inspector remains available.

============================================================
65. UNDO / REDO FOR DESIGNER

Add:

Undo
Redo

for:

add
remove
move
duplicate
property changes
section changes

============================================================
66. DESKTOP / TABLET / MOBILE

Keep device preview:

Desktop
Tablet
Mobile

Responsive preview must use the same Master configuration.

Do not create separate copies unless explicit responsive overrides exist.

============================================================
PART D — TOPIC MASTER PAGES
============================================================

67. TOPIC MASTER DESIGNER

Topic Master uses same three-pane builder.

Core structural components:

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

Main Content mandatory.

============================================================
68. TOPIC LAYOUT PRESETS

Provide:

Content Only

Left Nav + Content

Content + On This Page

Left Nav + Content + On This Page

Header + Content

Allow visual resizing of columns.

============================================================
69. TOPIC COMPONENT STYLING

Header, Footer, Navigation, Breadcrumb, On This Page etc. support:

Background
Typography
Spacing
Borders where appropriate

Default:
inherit Theme.

Allow scoped override.

============================================================
70. LEFT NAVIGATION

Properties:

Width
Min/max width
Sticky
Collapsible
Show hierarchy
Default expanded levels
Active item style from Theme

Allow drag separator width adjustment in designer.

============================================================
71. MAIN CONTENT

Properties:

Maximum width
Alignment
Padding

Do not allow Main Content deletion.

============================================================
72. ON THIS PAGE

Properties:

Width
Sticky
Heading
Heading levels included

Generated dynamically from topic headings.

============================================================
73. RELATED TOPICS

Source:

Manual
AI Suggested future-ready
Same parent/category

Limit

Display:
List/Cards

============================================================
PART E — DESIGNER UX
============================================================

74. SELECTED COMPONENT

Click a block on canvas.

Highlight it subtly.

Properties Inspector shows only relevant configuration.

Do not display hundreds of irrelevant settings.

============================================================
75. COMPONENT ACTION BAR

Selected/hovered block gets compact actions:

Drag
Move Up
Move Down
Duplicate
Hide
Delete

Avoid clutter when not selected.

============================================================
76. ADD COMPONENT

Support both:

Drag from library

and

Click component in library

Click-to-add inserts it after current selected block or at bottom if nothing selected.

This ensures users are never blocked by drag-and-drop problems.

============================================================
77. EMPTY DROP ZONES

Empty sections/columns display:

+ Add component

Click opens searchable component picker.

============================================================
78. SEARCH COMPONENT LIBRARY

Provide component search.

Example:

search "progress"

→ Progress Bar

search "image"

→ Image
Image + Text
Gallery

============================================================
79. COMPONENT CATEGORIES

Group library:

Layout
Text
Navigation
Media
Dynamic
Interactive
Feedback

Allow collapse/expand.

============================================================
80. TOOLTIP / HELP

Each component can show:

short tooltip
"What is this?"

Do not require authors to know web-design terminology.

============================================================
PART F — PREVIEW & STATE TESTS
============================================================

81. PAGE LAYOUT MARGIN TEST

Create new Content Page Layout.

Change all four margins.

PASS only if preview boundary updates.

Duplicate it.

Change duplicate margins.

PASS only if duplicate preview updates and original stays unchanged.

============================================================
82. CONTENT PAGE BACKGROUND TEST

Set Content Page background color.

PASS:
preview changes.

Navigate away/return.

PASS:
color persists.

============================================================
83. COVER LOGO TEST

Move logo:

Top Left
Top Center
Center Center
Bottom Right

PASS:
preview shows all placements.

============================================================
84. COVER TYPOGRAPHY TEST

Set Document Title:

Font
Size
Weight
Color

PASS:
preview responds.

Switch content source to Variable.

Select ProductName.

PASS:
resolved value appears.

Switch to Manual Text.

Enter:
"Administrator Guide"

PASS:
manual text appears.

============================================================
85. BOTTOM ALIGNMENT TEST

Place:

Version
Date
Confidentiality

in Bottom.

Set:

Version = Left
Date = Center
Confidentiality = Right

PASS:
visually distinct positions.

============================================================
86. HOME PAGE TEXT TEST

Add Welcome Text.

Enter:

Heading:
"Welcome to Orion Help"

Body:
"Find guidance, tutorials, and reference information."

Apply:

custom font size
text color
background

PASS:
canvas changes immediately.

============================================================
87. NAVIGATION CARD TEST

Add Navigation Cards.

Set:

6 cards
3 columns

PASS:
shows 2 rows × 3 cards desktop.

Switch Tablet.

PASS:
responsive arrangement.

Switch Mobile.

PASS:
single-column or configured mobile arrangement.

============================================================
88. MEDIA TEST

Add:

Image
GIF
Video

Verify:

upload/selection works
preview renders
properties work

============================================================
89. INTERACTIVE TEST

Add:

Checklist
Progress Bar
Accordion
Tabs

Verify reader preview interaction.

Check checklist items.

If Progress linked to Checklist:

bar updates.

============================================================
90. RECENT CONTENT TEST

Add Recent Content.

Source:
Recently Updated

Modify a sample topic's modified timestamp in prototype data where possible.

PASS:
Recent Content order updates automatically.

============================================================
91. DRAG/DROP TEST

Add blocks:

Welcome Text
Cards
Recent Content

Drag Recent Content above Cards.

PASS:
order changes.

If drag cannot be automatically validated:

manual tester must still be able to exercise it.

Verify fallback Move Up/Down also works.

============================================================
92. MASTER DUPLICATION TEST

Duplicate Home Page Master.

Modify duplicate.

PASS:
original unchanged.

Dropdown sorted alphabetically.

============================================================
93. PERSISTENCE TEST

Modify master.

Switch master.

Return.

PASS:
all state remains.

============================================================
94. RESPONSIVE TEST

Preview Home Master in:

Desktop
Tablet
Mobile

Verify:

no overlap
no clipped text
cards reflow
images scale
interactive blocks remain usable

============================================================
95. SELF-CORRECTION

After implementation:

run the acceptance tests.

If a test fails:

fix it
repeat it.

Do not knowingly leave a visible control that does nothing.

============================================================
96. COMPLETION REPORT

Report:

PDF/WORD PAGE LAYOUTS
- Implemented
- Tested
- Fixed
- Not validated

HOME PAGE MASTER
- Implemented
- Tested
- Fixed
- Not validated

TOPIC MASTER
- Implemented
- Tested
- Fixed
- Not validated

DRAG AND DROP
- Manual/Programmatic status

INTERACTIVE COMPONENTS
- status

Do not claim success for interactions not exercised.

============================================================
97. FINAL UX PRINCIPLE

The Master Page Designer must feel approachable to a documentation author, not a web developer.

Authors work with:

blocks
sections
columns
properties
variables
media
dynamic content
interactive components

Never require:

HTML
CSS
JavaScript

Theme controls default visual identity.

Master Pages control layout and experience.

Page Layouts control paginated document structure.

Everything is reusable, visual, interactive, and NO-CODE.