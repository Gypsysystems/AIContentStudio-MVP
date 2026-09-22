============================================================
CRITICAL ARCHITECTURE — PREVIEW MUST MATCH OUTPUT
============================================================

This is a NON-NEGOTIABLE requirement.

Do NOT create one implementation for Preview and a different implementation for generated outputs.

Preview and publishing must consume the SAME:

- structured project content
- Theme
- Brand & Style Profile
- Output Variant
- Conditions
- Variables
- PDF/Word Page Layout
- HTML Master Page
- Master Page assignments
- project overrides

Use one shared rendering/configuration model.

A configuration change must propagate to BOTH:

1. Preview
2. Generated output

There must not be duplicated hard-coded preview styling.

============================================================
PREVIEW / OUTPUT SOURCE OF TRUTH
============================================================

Use the saved project configuration as the single source of truth.

Example:

Project
  ↓
Theme
  ↓
Brand & Style Profile
  ↓
Format Configuration
  ↓
Selected Page Layout / Master Page
  ↓
Shared Render Model
  ├── Preview
  └── Final Output

Preview must never use mock styling that differs from the publishing renderer.

============================================================
LIVE PROPAGATION
============================================================

When an author changes any applicable configuration:

- font
- font size
- heading color
- body color
- callout style
- table style
- page size
- margins
- orientation
- header
- footer
- logo placement
- page-number placement
- HTML navigation width
- content width
- Master Page components
- Master Page ordering
- breadcrumbs
- On This Page
- footer
- light/dark settings

the corresponding Preview must update automatically.

The next generated output must use those exact saved values.

============================================================
PDF PREVIEW FIDELITY
============================================================

PDF Preview must use the currently selected PDF Page Layout.

If the author changes:

Page Size
Orientation
Margins
Cover Page Layout
Content Page Layout
Header
Footer
Logo location
Topic title location
Page-number location
Background
Typography
Table styling
Callout styling

the PDF Preview must immediately reflect those changes.

When PDF is generated, use the SAME resolved configuration.

Example:

If Content Page Layout changes from:

Header:
Logo left
Topic title center

Footer:
Page number right

to:

Header:
Topic title left

Footer:
Copyright left
Page number center

both:

PDF Preview

and

generated PDF

must show the updated arrangement.

============================================================
WORD PREVIEW FIDELITY
============================================================

Word Preview must consume the same:

Theme
Brand & Style Profile
Word Page Layout
Word-specific overrides

used by DOCX generation.

Reflect:

page size
orientation
margins
cover page
header
footer
typography
headings
tables
callouts
images

If browser preview cannot perfectly reproduce Microsoft Word rendering, clearly label it:

"Word layout preview"

However:

the configuration feeding Preview and DOCX generation must remain identical.

Do NOT maintain separate hard-coded Word preview styling.

============================================================
HTML PREVIEW FIDELITY — CRITICAL
============================================================

HTML Preview must render the ACTUAL selected HTML Master Page configuration.

Do not create a simplified fake HTML preview.

For Home:

use the currently selected Home Page Master.

For Topic pages:

use the topic's assigned Master Page.

If no topic-specific assignment exists:

use the Project Default Topic Master.

HTML Preview must consume the same:

Master Page components
component order
visibility
widths
navigation settings
content width
header
logo
search
breadcrumbs
left navigation
On This Page
Previous / Next
feedback
footer
Theme
Brand & Style Profile

that will be used to generate the HTML package.

============================================================
HTML MASTER PAGE CHANGES
============================================================

If an author modifies an HTML Master Page:

Example:

Other Topics Master

Changes:

Left Navigation Width:
260px → 320px

On This Page:
Enabled → Disabled

Breadcrumb:
Enabled

Footer:
Disabled

Header Logo:
Changed

Then:

1. HTML Preview must immediately show those changes.
2. Full HTML Preview must show those changes.
3. Generated HTML topic pages using that Master Page must use those changes.

No additional manual synchronization step.

============================================================
MASTER PAGE ASSIGNMENT PREVIEW
============================================================

HTML Preview must allow previewing a specific topic.

Example:

Preview Topic:
API Reference

Assigned Master:
Wide Topic Master

The preview must use:

Wide Topic Master

not the default Other Topics Master.

Switch Preview Topic:

Getting Started

If assigned/default:

Other Topics Master

the preview must automatically render using Other Topics Master.

============================================================
PAGE LAYOUT CHANGES
============================================================

PDF/Word Page Layout changes must behave the same way.

Example:

Selected Layout:
Government Standard Content

Change:

Margins:
20mm → 25mm

Header:
Logo removed

Footer:
Version added

Immediately update:

PDF Preview

Word Preview where the shared setting applies

Then generate new outputs.

The generated files must use those updated values.

============================================================
FORMAT-SPECIFIC OVERRIDES
============================================================

Respect format-specific overrides.

Example:

Base Page Layout:
Government Standard Content

PDF override:
Margins = 20mm

Word override:
Margins = 25mm

PDF Preview must show 20mm.

Word Preview must show 25mm.

Generated PDF and DOCX must use their respective values.

============================================================
STYLE PROFILE CHANGES
============================================================

If the author changes:

H1 font
H1 size
H1 color
Body font
Table header color
Warning styling

the changes must propagate to:

Author representation where applicable
PDF Preview
Word Preview
HTML Preview

and subsequently generated:

PDF
DOCX
HTML

Use format-specific rendering while retaining the same semantic style configuration.

============================================================
OUTPUT VARIANT CHANGES
============================================================

If the author changes Output Variant:

Example:

Presight External

to:

Government Client

Preview must immediately re-resolve:

Theme
Brand & Style Profile
Conditions
Output Templates

and render the selected format accordingly.

The generated output must match that same resolved variant.

============================================================
PREVIEW DIRTY STATE
============================================================

When configuration changes:

mark Preview as refreshing if necessary.

Example:

Updating preview…

Then render the latest saved configuration.

Do not leave stale previews visible without indication.

============================================================
NO HARDCODED PREVIEW DATA
============================================================

Do not use:

hard-coded colors
hard-coded fonts
hard-coded logos
hard-coded layouts
hard-coded Nexus sample project settings

inside Preview components.

Read everything from active project/output configuration.

============================================================
WYSIWYG EXPECTATION
============================================================

For PDF and HTML, the goal is:

What the author previews should closely represent what the author downloads.

HTML should have especially high fidelity because the Preview can use the same HTML/CSS/component implementation as the generated package.

PDF should use the same layout/style model while acknowledging browser PDF-rendering limitations where applicable.

Word may have minor differences caused by Microsoft Word's own rendering engine, but style/layout configuration must remain shared.

============================================================
ACCEPTANCE TEST — PDF SYNCHRONIZATION
============================================================

1. Open PDF Page Layout.
2. Change H1 color.
3. Change left margin.
4. Move page number in Footer.
5. Change logo visibility.
6. Return to Publish.

VERIFY:

PDF Preview shows all four changes.

Generate PDF.

VERIFY:

downloaded PDF reflects the same configuration.

============================================================
ACCEPTANCE TEST — HTML SYNCHRONIZATION
============================================================

1. Open Other Topics Master.
2. Increase left navigation width.
3. Disable On This Page.
4. Enable breadcrumbs.
5. Remove Footer.
6. Change Header Logo.
7. Return to Publish.
8. Select HTML preview.

VERIFY:

Preview reflects every change.

Generate HTML ZIP.

VERIFY:

topic pages using Other Topics Master contain the same configuration.

============================================================
ACCEPTANCE TEST — MASTER ASSIGNMENT
============================================================

Assign:

API Reference
→ Wide Topic Master

Getting Started
→ Other Topics Master

In HTML Preview:

select API Reference.

VERIFY:

Wide Topic Master renders.

Select Getting Started.

VERIFY:

Other Topics Master renders.

Generate HTML package.

VERIFY:

each generated topic uses its assigned Master Page.

============================================================
ACCEPTANCE TEST — STYLE SYNCHRONIZATION
============================================================

Change Brand & Style Profile:

Body Font
H1 Font
H1 Color
Table Header Color
Warning Accent Color

Open:

PDF Preview
Word Preview
HTML Preview

VERIFY:

all three reflect the updated semantic styles according to their format renderer.

Generate all three outputs.

VERIFY:

the outputs use the same selected profile.

============================================================
REGRESSION RULE
============================================================

Preview improvements must NOT create a second independent configuration system.

There must be one saved configuration feeding both Preview and Publish.