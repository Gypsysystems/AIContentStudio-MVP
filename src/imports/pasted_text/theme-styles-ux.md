REORGANIZE THEME & STYLES UX AND IMPLEMENT A COMPLETE BRAND-IMPORT WORKFLOW

Refactor ONLY the Theme & Styles area.

Do not change Sources, Analysis, TOC, Author, Knowledge Map, Review, or Publish except where state synchronization requires it.

GOAL

Simplify Theme & Styles so professional authors can:

- select reusable Themes
- create and manage Brand & Style Profiles
- import brand guidelines
- use AI to detect colors/fonts/logos
- review and map detected brand attributes
- save the result as a reusable Brand & Style Profile
- edit saved profiles
- manage Output Templates

The entire experience must remain NO-CODE.

============================================================
1. SIMPLIFY THE TOP-LEVEL TABS
============================================================

Replace the current tabs:

Overview
Brand
Styles
Output Templates

with:

Overview
Brand & Style
Output Templates

REMOVE the separate Brand tab completely.

Brand configuration and Brand Guidelines import belong inside:

Brand & Style

============================================================
2. THEME ARCHITECTURE
============================================================

Use this conceptual architecture:

THEME

contains:

Brand & Style Profiles
Output Templates

A project selects one Theme.

Within that Theme, the project uses one active Brand & Style Profile and one or more output templates.

Theme may contain optional metadata, but do not clutter normal project setup with unnecessary client fields.

============================================================
3. THEME OVERVIEW
============================================================

Simplify Overview.

Show:

Theme Name
Active Brand & Style Profile
PDF/Word Layout count
HTML Master Page count
Output Pack

Example:

Government Standard Theme

Brand & Style:
Government Standard Style

PDF/Word Layouts:
2

HTML Master Pages:
3

Output Pack:
Government Standard Pack

Avoid duplicate profile cards or redundant configuration controls.

============================================================
4. INLINE THEME RENAMING
============================================================

Remove the visible "Rename" button.

When user hovers over the Theme name:

show a subtle pencil icon.

Click pencil:

convert Theme name to inline editable field.

Save behavior:

Click outside = Save
Enter = Save
Escape = Cancel

Do not open a modal for simple renaming.

Apply the same inline rename pattern later to:

Brand & Style Profile
Output Template
Page Layout
HTML Master Page

============================================================
5. SWITCH THEME DROPDOWN
============================================================

The Switch Theme dropdown MUST dynamically display ALL saved Themes.

Do not hard-code Theme names.

When a new Theme is created or duplicated:

- immediately add it to Theme state
- immediately show it in Switch Theme dropdown
- allow it to be selected

Changing the active Theme must update:

Brand & Style profile options
Output Templates
Overview summary
active project presentation settings

Do not change authored content.

============================================================
6. BRAND & STYLE TAB
============================================================

Rebuild the Brand & Style tab around ONE main profile selector.

At top:

Brand & Style Profile

[ Selected Profile ▼ ]

Actions:

+ New
Import Brand Guidelines
Duplicate

Do NOT display a large permanent list/card gallery of all profiles.

The dropdown is the primary selector.

Selecting a profile loads its editable configuration below.

============================================================
7. BRAND & STYLE PROFILE DROPDOWN
============================================================

The dropdown must contain every saved Brand & Style Profile available to the Theme.

Example:

Presight Documentation
TechCorp Documentation
Government Standard Style
Minimal Product Style

When a profile is saved:

it must immediately appear in this dropdown.

No refresh required.

============================================================
8. INLINE PROFILE RENAMING
============================================================

Show selected profile name prominently.

On hover:

show pencil icon.

Click:

inline editing.

Click outside:
Save

Enter:
Save

Escape:
Cancel

The dropdown list must update immediately after rename.

============================================================
9. NEW PROFILE
============================================================

+ New opens:

Create Brand & Style Profile

Name:
[                       ]

Base On:

Blank
Current Profile
Another Existing Profile

Scope:

Reusable in Theme
Project only

Create

After creation:

select the new profile automatically
show it immediately in dropdown
open it for editing

============================================================
10. DUPLICATE PROFILE
============================================================

Duplicate must work.

Duplicate selected profile.

Prompt:

Name:
[Original Name – Copy]

Scope:

Reusable
Project only

After duplication:

select the duplicate automatically.

The duplicate must be INDEPENDENT.

Changing duplicate:

colors
fonts
table styles
callouts

must NOT modify original profile.

============================================================
11. IMPORT BRAND GUIDELINES
============================================================

Clicking:

Import Brand Guidelines

must open a LARGE MODAL.

Do NOT show the import experience permanently inside the page.

Modal title:

Import Brand Guidelines

The workflow should have four stages:

1. Upload
2. Analyze
3. Map Brand
4. Review & Save

============================================================
12. BRAND IMPORT — UPLOAD
============================================================

Allow:

PDF
DOCX
PPTX
PNG
JPG/JPEG

Support:

Choose File
Drag and Drop

Show:

actual filename
type
size
Ready

Allow:

Replace
Remove

Do not show synthetic results before Analyze is selected.

============================================================
13. BRAND IMPORT — ANALYZE
============================================================

Provide:

Analyze Brand Guidelines

For Figma prototype:

analysis may be simulated.

Clearly display:

"Prototype AI analysis"

Conceptually detect:

Logos
Colors
Fonts
Heading styles
Table patterns
Callout patterns
Spacing conventions

Do NOT automatically apply anything.

============================================================
14. DETECTED BRAND COLORS
============================================================

Present detected colors visually.

Example:

Detected Colors

[SWATCH] #1D4ED8
Suggested role:
Primary

[SWATCH] #404040
Suggested role:
Secondary

[SWATCH] #FFFFFF
Suggested role:
Background

[SWATCH] #007BFF
Suggested role:
Accent

Each detected color must have:

Accept
Ignore

and editable:

Role ▼

Supported roles:

Primary
Secondary
Accent
Background
Surface
Heading
Body Text
Border
Table Header
Note
Tip
Warning
Important
Example
Custom

Allow multiple custom colors.

============================================================
15. ACCEPT ALL COLORS
============================================================

Provide:

Accept All Detected Colors

This accepts every non-ignored detected color.

AI-suggested role mappings may be used initially.

Authors may still change mappings before saving.

============================================================
16. DETECTED TYPOGRAPHY
============================================================

Present detected fonts visually.

Example:

Detected Fonts

Aptos
Suggested Role:
Primary / Heading Font

Arial
Suggested Role:
Body Font

Arial
Suggested Role:
Fallback Font

Consolas
Suggested Role:
Code Font

Each font provides:

Accept
Ignore
Role ▼

Supported roles:

Primary Font
Heading Font
Body Font
Fallback Font
Code Font
Caption Font
Custom

============================================================
17. FONT ROLE MAPPING
============================================================

Author MUST be able to explicitly decide:

Primary Font

Heading Font

Body Font

Fallback Font

Code Font

Do not silently assume AI decisions.

Fallback Font is important for environments where primary/client font is unavailable.

============================================================
18. ACCEPT ALL TYPOGRAPHY
============================================================

Provide:

Accept All Detected Fonts

This accepts all non-ignored detected fonts.

Suggested mappings remain editable.

============================================================
19. LOGO DETECTION
============================================================

Show detected logo thumbnails.

Allow:

Use as Primary Logo
Use as Secondary Logo
Ignore
Replace

Do not silently apply detected logo.

============================================================
20. ACCEPT ALL REVIEWED
============================================================

At the bottom of the Analyze/Map workflow provide:

Accept All Reviewed

This must work.

Behavior:

accept all items not explicitly ignored
preserve author-edited role mappings
move to Review & Save

============================================================
21. REVIEW & SAVE BRAND PROFILE
============================================================

Final step:

Review Brand & Style Profile

Show concise summary:

PROFILE NAME

[ Presight Corporate Documentation ]

COLORS

Primary
Secondary
Accent
Background

TYPOGRAPHY

Heading Font
Body Font
Fallback Font
Code Font

LOGO

Primary logo

STYLE SUGGESTIONS

Tables
Callouts
Headings

Allow edits before save.

============================================================
22. SAVE IMPORTED BRAND
============================================================

Provide:

Save as New Brand & Style Profile

Require:

Profile Name

Allow scope:

Reusable in this Theme
Project only

When Save is clicked:

create profile
close modal
select saved profile automatically
show profile immediately in Brand & Style dropdown
populate Style Editor with accepted brand values
update Live Preview

This is CRITICAL.

============================================================
23. IMPORTED PROFILE EDITING
============================================================

After saving an imported profile, author must be able to edit it normally.

Selecting it from dropdown must expose all profile configuration.

Brand settings:

Logo
Theme Colors

Typography:

Primary
Heading
Body
Fallback
Code

Content styles:

Headings
Lists
Tables
Callouts
Procedures
Links
Media

No imported profile is read-only.

============================================================
24. PROFILE CONFIGURATION SECTIONS
============================================================

Inside Brand & Style use logical collapsible sections or secondary navigation:

Brand
Typography
Headings
Lists
Tables
Callouts
Procedures
Media
Links

Do not create separate top-level Brand tab.

============================================================
25. STANDARD COLOR PICKER
============================================================

Use ONE consistent color picker everywhere.

Collapsed state:

[SWATCH] Color Name

or

[SWATCH] #06626A

Click opens:

Color selector

Theme Colors

Recent Colors

HEX

RGB

Apply
Cancel

Remove all malformed narrow vertical color inputs and overlapping controls.

============================================================
26. COLOR TOKEN MODEL
============================================================

Allow profile colors to be named.

Example:

Primary
Secondary
Accent
Background
Surface
Heading
Body
Border

Style components should preferably use these named tokens.

Example:

Heading 1 Color:
Primary ▼

Table Header:
Primary ▼

Custom override remains possible.

============================================================
27. TYPOGRAPHY MODEL
============================================================

Profile typography must support:

Primary Font
Heading Font
Body Font
Fallback Font
Code Font

Individual style controls can inherit from these.

Example:

H1 Font:
Heading Font

Paragraph:
Body Font

Code:
Code Font

Provide custom override where necessary.

============================================================
28. FONT FALLBACK
============================================================

Every relevant typography configuration must support fallback.

Example:

Primary Font:
DIN Next

Fallback:
Arial

When primary font cannot render/be used, fallback font becomes active.

Do not require authors to configure fallback on every heading individually.

Profile-level fallback is sufficient by default.

============================================================
29. PROFILE LIVE PREVIEW
============================================================

Keep one live preview.

Show:

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
Procedure
Code

Changes update immediately.

============================================================
30. REMOVE REDUNDANT PROFILE CARDS
============================================================

Do not show:

a profile dropdown

AND

a large list/card gallery of the same profiles simultaneously.

Use dropdown as selector.

Use page content for selected-profile editing.

This reduces clutter.

============================================================
31. STYLE SOURCE INDICATOR
============================================================

For imported profiles, optionally show:

Source:
Imported from Brand Guidelines

For manually created:

Source:
Manual

For duplicated:

Source:
Based on Presight Documentation

Keep this subtle.

============================================================
32. OUTPUT TEMPLATES
============================================================

Leave Output Templates as separate top-level tab.

It continues to manage:

PDF/Word Page Layouts
HTML Master Pages
Output Packs

Do not move these controls into Brand & Style.

============================================================
33. THEME OVERVIEW CARDS
============================================================

Overview summary cards may remain clickable shortcuts.

Example:

Brand & Style
1 active profile

PDF/Word Layouts
2

HTML Master Pages
2

Output Packs
1

Clicking card opens corresponding configuration.

Do not duplicate full editors on Overview.

============================================================
34. REMOVE CLIENT LANGUAGE FROM GENERAL UI
============================================================

Current text says:

"same document renders differently for each client"

Replace with more general:

"Content remains independent from presentation, allowing the same document to use different Themes and output styles."

Client may exist as metadata, but Theme is the primary user-facing concept.

============================================================
35. PROJECT THEME OVERRIDE
============================================================

When an author selects another Brand & Style Profile within the active Theme:

update project preview.

Do not modify authored content.

Allow:

Apply to Project

If modifications are project-only:

show:

"Project Override"

Provide:

Reset to Theme Profile

============================================================
36. PERSISTENT STATE
============================================================

All created/edited items must remain during prototype session:

Themes
Brand & Style Profiles
Profile names
Theme colors
Typography
Imported profile mappings
Output template selections

Do not use defaultValue for persistent settings.

============================================================
37. ACCEPTANCE TEST — INLINE RENAME
============================================================

Hover Theme name.

Verify pencil appears.

Rename:

Government Standard Theme

to:

Gov Standard Theme

Click outside.

PASS:
new name saved
Theme dropdown updates

Repeat for Brand & Style Profile.

============================================================
38. ACCEPTANCE TEST — IMPORT
============================================================

Open:

Import Brand Guidelines

Upload sample PDF.

Verify real filename appears.

Analyze.

Verify:

colors
fonts
logo

are shown as prototype suggestions.

Click:

Accept All Detected Colors

Click:

Accept All Detected Fonts

Change:

one detected color role

Change:

one detected font role

Proceed.

============================================================
39. ACCEPTANCE TEST — SAVE IMPORTED PROFILE
============================================================

Name profile:

Imported Corporate Brand

Save as reusable profile.

PASS:

modal closes

Imported Corporate Brand appears in Brand & Style dropdown

it becomes selected automatically

Style Editor contains accepted colors/fonts

Live Preview reflects profile

============================================================
40. ACCEPTANCE TEST — EDIT IMPORTED PROFILE
============================================================

Select:

Imported Corporate Brand

Change:

Primary color

Heading font

Warning color

Navigate away.

Return.

PASS:

all changes persist.

============================================================
41. ACCEPTANCE TEST — ACCEPT ALL
============================================================

Import another guidelines file.

Use:

Accept All Reviewed

PASS:

all non-ignored recommendations move into final review.

Ignored items remain excluded.

============================================================
42. ACCEPTANCE TEST — DUPLICATE
============================================================

Duplicate:

Imported Corporate Brand

Name:

Imported Corporate Brand Alt

Change primary color.

PASS:

original remains unchanged.

============================================================
43. ACCEPTANCE TEST — THEME DROPDOWN
============================================================

Create or duplicate a new Theme.

Open Switch Theme.

PASS:

new Theme appears.

Select it.

PASS:

Overview updates.

============================================================
44. ACCEPTANCE TEST — NO DUPLICATION OF UI
============================================================

Verify Brand & Style tab contains:

one profile selector

one editor for selected profile

one Import Brand Guidelines action

Do NOT show redundant profile card lists.

============================================================
45. REGRESSION CHECK
============================================================

Verify these remain functional:

Project Details
Theme selection
Output Templates
Sources navigation
Analysis
TOC
Author
Review
Publish

============================================================
46. SELF-CORRECTION
============================================================

After implementation:

exercise all tests above.

If a test fails:

fix implementation
repeat failed test

Do not knowingly leave non-functional visible controls.

============================================================
47. COMPLETION REPORT
============================================================

Report:

IMPLEMENTED

TESTED AND PASSED

FIXED DURING TESTING

NOT FULLY VALIDATED

Do not claim a capability passed unless exercised.

============================================================
48. FINAL UX PRINCIPLE
============================================================

THEME

is the reusable presentation package.

BRAND & STYLE PROFILE

contains:

logo
colors
typography
semantic content styling

OUTPUT TEMPLATES

contain:

PDF/Word page layouts
HTML master pages

Brand guidelines can be imported using AI suggestions.

AI suggests.

Author maps and approves.

Saved profiles remain fully editable.

Everything is NO-CODE.