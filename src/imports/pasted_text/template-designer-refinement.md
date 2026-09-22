MAJOR TEMPLATE DESIGNER REFINEMENT — PAGE LAYOUT SYNCHRONIZATION AND VISUAL HTML MASTER PAGE BUILDER

Modify ONLY:

1. PDF / Word Page Layouts
2. HTML Master Pages
3. Their live previews
4. Their relationship with Publish preview/output

Do NOT modify Sources, Analysis, TOC, Authoring, Knowledge Map, or Review.

GOAL

Create an intuitive professional NO-CODE template-design experience.

Authors must be able to:

- manage reusable Page Layouts
- manage reusable HTML Master Pages
- visually design HTML home/topic layouts
- immediately see every template change in Preview
- publish output using the EXACT SAME saved template configuration

CRITICAL RULE:

Template Designer
→ Preview
→ Generated Output

must all consume ONE shared saved configuration.

Do not create independent hard-coded preview layouts.

============================================================
1. FIX PAGE LAYOUT PREVIEW SYNCHRONIZATION
============================================================

Current problem:

Changes made to PDF / Word Page Layouts are not reliably reflected in the Page Layout preview or final Publish preview.

Fix the state/render architecture.

Every Page Layout control must write to persistent layout state.

The preview must read directly from that same state.

Examples:

Page size
Orientation
Margins
Background
Header/Footer configuration
Element location
Alignment
Visibility
Logo
Title
Version
Date
Page number

Changing any value must update the preview immediately.

Do not require page refresh.

============================================================
2. PAGE LAYOUT → PUBLISH SYNCHRONIZATION
============================================================

When a Page Layout is saved/changed:

PDF Publish Preview must use the changed layout.

Word Publish Preview must use the applicable changed layout.

Generated PDF/Word must use the same saved configuration.

Example:

If the author changes:

Left margin:
25mm → 35mm

Logo:
Top Left → Top Center

Page Number:
Footer Right → Footer Center

the Page Layout preview must update immediately.

The Publish preview must show the same configuration.

The next generated output must use the same values.

============================================================
3. PAGE LAYOUT SELECTOR
============================================================

Keep one primary Page Layout dropdown.

All saved Page Layouts must appear in it.

Sort alphabetically by layout name.

Example:

Chapter Opener
Landscape Appendix
Presight Standard Content
Presight Standard Cover

When New/Duplicate/Rename/Delete occurs:

update the dropdown immediately.

============================================================
4. DUPLICATE PAGE LAYOUT
============================================================

Duplicate must create a fully independent copy.

Example:

Presight Standard Cover

Duplicate →

Presight Standard Cover Copy

Automatically select the copy after creation.

Then place it into the dropdown in alphabetical order.

Changing the copy must not change the original.

============================================================
5. INLINE RENAME
============================================================

Do not require a visible Rename button.

Show a pencil icon when hovering over the selected Layout/Master Page name.

Click pencil:

edit inline.

Enter:
save

Click outside:
save

Escape:
cancel

After rename:

re-sort dropdown alphabetically.

============================================================
6. HTML MASTER PAGE SELECTOR
============================================================

Replace the existing HTML Master Page card/list selector with ONE dropdown.

Label:

HTML Master Page

Example options:

Home Page Master
Other Topics Master
Section Landing Master
Wide Topic Master

Sort alphabetically by name.

Provide actions beside the dropdown:

+ New
Duplicate
Delete

Rename uses hover pencil.

============================================================
7. HTML MASTER PAGE CREATION
============================================================

New opens:

Create HTML Master Page

Name

Type:

Home
Topic
Landing
Custom

Base On:

Blank
Home Page Master
Other Topics Master
Existing Master Page

Create

After creation:

- save the master
- add it to dropdown
- sort alphabetically
- select it automatically
- open it in the visual designer

============================================================
8. HTML MASTER PAGE DUPLICATION
============================================================

Duplicate selected Master Page.

Create independent copy.

Example:

Other Topics Master

→

Other Topics Master Copy

Immediately:

add to dropdown
sort alphabetically
select duplicate

Changes to duplicate must NOT affect original.

============================================================
9. REPLACE CURRENT HTML MASTER PAGE FORM
============================================================

The current HTML Master Page editor is mostly checkboxes and width fields.

Replace it with a visual block-based Master Page Designer.

Use THREE regions:

LEFT:
Component Library

CENTER:
Live Master Page Canvas

RIGHT:
Properties Inspector

This workspace should feel simple enough for non-technical documentation authors.

============================================================
10. COMPONENT LIBRARY — HOME MASTER
============================================================

For Home-type master pages offer components such as:

Header
Logo
Primary Navigation
Secondary Navigation
Hero
Search
Welcome Text
Rich Text
Knowledge / Topic Cards
Multi-column Cards
Categories
Quick Links
Featured Content
Recent Content
Image + Text
Video
Call To Action
Divider
Spacer
Footer

Do not require authors to write HTML/CSS.

============================================================
11. HOME PAGE CANVAS
============================================================

Authors must be able to drag components from the Component Library onto the Home Master canvas.

Show obvious drop locations.

On drag-over:

highlight valid insertion point.

On drop:

insert the component.

Support:

drag to reorder
move up/down fallback
duplicate component
hide/show
delete

Do not use unrestricted absolute pixel positioning.

Use structured responsive sections.

============================================================
12. SECTION LAYOUTS
============================================================

Allow Home Master authors to add sections.

A section can use:

Full Width

Two Columns:
50 / 50
33 / 67
67 / 33

Three Columns

Authors can drag compatible components into columns.

Example:

SECTION

┌──────────────────┬──────────────────┐
│ Image            │ Rich Text        │
└──────────────────┴──────────────────┘

============================================================
13. HERO COMPONENT
============================================================

Hero properties:

Background:
Color
Gradient where practical
Image

Heading

Description

Search:
On / Off

Primary CTA:
On / Off

Secondary CTA:
On / Off

Alignment:
Left
Center

Height:
Compact
Standard
Large

Use Theme colors/fonts by default.

============================================================
14. SEARCH COMPONENT
============================================================

Properties:

Placeholder text

Width:
Small
Medium
Large
Full

Alignment

Search icon:
On / Off

For prototype:

search behavior may be simple, but do not display a permanently non-functional search control in generated output without labeling limitations.

============================================================
15. CARDS / CATEGORIES
============================================================

Card-based sections should support:

Title
Description
Icon/Image
Destination topic/category
Columns:
2
3
4

Allow drag reorder.

Use Brand & Style Profile for visual styling.

============================================================
16. RICH TEXT / IMAGE + TEXT
============================================================

Rich Text supports:

Heading
Paragraph
Button/Link
Alignment

Image + Text supports:

Image left
Image right

Image
Heading
Paragraph
Link

Do not expose raw HTML.

============================================================
17. TOPIC MASTER COMPONENT LIBRARY
============================================================

For Topic-type Master Pages offer:

Header
Logo
Search
Primary Navigation
Breadcrumb
Left Navigation
Main Content
On This Page
Previous / Next
Feedback
Related Topics
Footer

MAIN CONTENT is required.

It cannot be deleted.

============================================================
18. TOPIC MASTER CANVAS
============================================================

Use structured layout regions.

Example:

HEADER

BODY

┌─────────────┬────────────────────────┬─────────────┐
│ Left Nav    │ Main Content           │ On This Page│
└─────────────┴────────────────────────┴─────────────┘

FOOTER

Allow:

Left Nav enabled/disabled
On This Page enabled/disabled

Allow body layouts:

Content only

Left Nav + Content

Content + On This Page

Left Nav + Content + On This Page

============================================================
19. COLUMN WIDTHS
============================================================

Authors must be able to resize Topic Master columns visually by dragging separators.

Example:

Left navigation:
280px

Main:
flex

On This Page:
220px

Drag separator to resize.

Show resize cursor.

Store new width in Master Page state.

Also allow numeric width via Properties Inspector.

============================================================
20. COMPONENT PROPERTIES INSPECTOR
============================================================

When a component is selected show relevant settings on right.

Generic properties:

Visibility
Width
Alignment
Background
Padding
Spacing
Sticky
Responsive behavior

Component-specific properties appear only when relevant.

Do not show every setting for every component.

============================================================
21. THEME/STYLES INHERITANCE
============================================================

Master Page components inherit:

Theme
Brand & Style Profile

for:

fonts
colors
links
tables
callouts
general visual language

HTML Master Page controls structure/layout.

Do not duplicate Brand/Style settings unnecessarily inside Master Page Designer.

Allow limited layout-specific overrides where required.

============================================================
22. RESPONSIVE PREVIEW
============================================================

Provide preview controls:

Desktop
Tablet
Mobile

Switching device preview must render the same Master Page responsively.

Authors do NOT create three separate pages.

============================================================
23. MASTER PAGE SAVE STATE
============================================================

Use:

Saving…
Saved

Changes persist during prototype session.

Switching to another Master Page and returning must retain all changes.

============================================================
24. MASTER PAGE → PUBLISH SYNCHRONIZATION
============================================================

CRITICAL.

HTML Publish Preview must render from the currently saved Master Page configuration.

Do not recreate the HTML layout independently.

Example:

Other Topics Master changes:

Left Nav:
280px → 340px

Breadcrumb:
Off → On

On This Page:
On → Off

Footer:
On → Off

Immediately:

Master Page canvas reflects changes.

Then:

HTML Publish Preview must reflect those same changes.

Generated HTML output must use the same values.

============================================================
25. HOME MASTER → PUBLISH SYNCHRONIZATION
============================================================

If Home Page Master changes:

Hero removed
Search moved
Cards reordered
Image + Text added
Footer hidden

HTML Preview Home must show exactly those changes.

Generated index.html must use that configuration.

============================================================
26. TOPIC MASTER ASSIGNMENT
============================================================

Allow topics to select an HTML Master Page.

Provide assignment from:

TOC / Author
and
Publish

Each topic can choose:

Default
or
specific Master Page

============================================================
27. MASTER PAGE ASSIGNMENT DROPDOWN
============================================================

The assignment selector must show all Topic-compatible Master Pages alphabetically.

Home-compatible Master Pages should appear only where relevant.

Do not show incompatible page types.

============================================================
28. DEFAULT MASTER PAGES
============================================================

Project supports:

Default Home Master

Default Topic Master

Unassigned topics inherit Default Topic Master.

Home uses Default Home Master.

============================================================
29. LIVE CONTENT SAMPLE
============================================================

Inside Master Page Designer, show representative project content rather than empty generic boxes.

For Topic Master:

Topic title
paragraph
table
callout
image

For Home:

project/product title
sample categories
sample cards

This makes layout design meaningful.

============================================================
30. PREVIEW SOURCE OF TRUTH
============================================================

Use one renderer/config model:

Saved Master Page
        ↓
Designer Canvas
        ↓
Publish Preview
        ↓
Generated HTML

Do NOT maintain three separate hard-coded implementations.

============================================================
31. PDF/WORD SOURCE OF TRUTH
============================================================

Likewise:

Saved Page Layout
        ↓
Layout Designer Preview
        ↓
Publish Preview
        ↓
Generated PDF / Word

============================================================
32. REMOVE STALE PREVIEW
============================================================

If a saved layout/master changes and preview requires recalculation:

show briefly:

Updating preview…

Then display current state.

Never silently show outdated preview.

============================================================
33. ACCEPTANCE TEST — PAGE LAYOUT
============================================================

Select:

Presight Standard Cover

Change:

Background color

Margins

Move Logo alignment

Move Version position

VERIFY:

Layout preview updates immediately.

Navigate away and return.

VERIFY:
changes persist.

Go to Publish → PDF Preview.

VERIFY:
same configuration appears.

============================================================
34. ACCEPTANCE TEST — MASTER DROPDOWN
============================================================

Create:

Zebra Topic Master

Create:

Alpha Topic Master

Duplicate:

Other Topics Master

VERIFY dropdown alphabetical:

Alpha Topic Master
Home Page Master where type compatible
Other Topics Master
Other Topics Master Copy
Zebra Topic Master

Respect Master Type filtering where appropriate.

============================================================
35. ACCEPTANCE TEST — HOME BUILDER
============================================================

Open Home Page Master.

Add:

Hero
Search
3-column Card section
Image + Text
Footer

Drag reorder:

Image + Text above Cards.

Hide Footer.

VERIFY:

Designer canvas updates.

HTML Publish Preview Home updates.

============================================================
36. ACCEPTANCE TEST — TOPIC MASTER
============================================================

Open Other Topics Master.

Set layout:

Left Nav + Content + On This Page

Resize:

Left Nav to 320px

Disable:

On This Page

Enable:

Breadcrumb

VERIFY:

Designer updates.

HTML Publish Preview updates.

============================================================
37. ACCEPTANCE TEST — DUPLICATION
============================================================

Duplicate:

Other Topics Master

to:

Wide Topic Master

Change:

navigation width
content width

VERIFY:

Original remains unchanged.

============================================================
38. ACCEPTANCE TEST — TOPIC ASSIGNMENT
============================================================

Assign:

API Reference
→ Wide Topic Master

Assign:

Getting Started
→ Other Topics Master

Open Publish HTML Preview.

Switch preview topic.

VERIFY:

each topic uses assigned Master Page.

============================================================
39. OUTPUT TEST
============================================================

Generate HTML package.

Verify:

Home reflects Home Master.

Getting Started reflects Other Topics Master.

API Reference reflects Wide Topic Master.

Generated HTML must match preview structure.

============================================================
40. FALLBACK INTERACTION
============================================================

If browser drag-and-drop cannot be programmatically tested:

still implement it.

Also provide:

Move Up
Move Down
Move To Section

as accessible fallback.

Do not remove visual drag-and-drop merely because automated validation is unavailable.

============================================================
41. SELF-TEST
============================================================

After implementation:

exercise the tests above.

Fix failed interactions.

Do not knowingly leave a visible control non-functional.

============================================================
42. COMPLETION REPORT
============================================================

Report:

PAGE LAYOUT SYNCHRONIZATION

HTML MASTER PAGE DROPDOWN

HOME PAGE BUILDER

TOPIC MASTER BUILDER

PREVIEW SYNCHRONIZATION

DUPLICATION

MASTER ASSIGNMENT

NOT FULLY VALIDATED

Be explicit about drag-and-drop if it could not be exercised programmatically.

============================================================
43. FINAL PRINCIPLE
============================================================

Authors configure layout visually.

Theme controls appearance.

Master Pages control responsive HTML structure.

Page Layouts control paginated PDF/Word structure.

Preview and generated output use the SAME saved configuration.

Everything is NO-CODE.