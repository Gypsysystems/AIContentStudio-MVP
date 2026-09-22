Perform a complete functional upgrade of ONLY the Authoring Studio toolbar and authoring commands.

Do not redesign the application shell, TOC, Knowledge Map, workflow navigation, Review, Sources, or Export.

GOAL

Create a professional structured-authoring command system for an AI-assisted documentation platform.

The toolbar must be:
- powerful
- compact
- logically grouped
- fully functional
- context-sensitive
- suitable for User Guides, Admin Guides, SOPs, Quick Starts, Knowledge Base content, and future documentation formats

DO NOT create visual-only toolbar buttons.

Every command added in this request must perform a real prototype interaction.

==================================================
A. TOOLBAR ARCHITECTURE
==================================================

Use ONE permanent primary authoring toolbar.

Do NOT create multiple permanently stacked toolbars.

Keep:

Content | Knowledge Map

as the workspace selector.

Organize authoring commands into logical groups separated by subtle dividers.

Use menus for less frequently used functionality.

Use contextual controls for:
- tables
- images
- procedures
- callouts
- links
- selected text

The document canvas must remain visually dominant.

==================================================
B. PRIMARY TOOLBAR LAYOUT
==================================================

Build the primary toolbar approximately in this order:

Undo
Redo

|

Paragraph Style ▼

|

Bold
Italic
Underline
Strikethrough

|

Alignment ▼

|

Bulleted List
Numbered List
Decrease Indent
Increase Indent

|

Insert ▼

Conditions ▼

References ▼

AI ✦

More ▼

On the far right retain:

Saved / Saving
Sources
Quality
Preview
Export

Do not overcrowd the toolbar.

When available horizontal width becomes insufficient, move lower-priority commands into an overflow menu rather than wrapping to a second permanent toolbar.

==================================================
C. UNDO / REDO
==================================================

Make Undo and Redo functional.

They must support:
- typing
- deleting
- formatting
- list changes
- table changes
- inserted blocks
- deleted blocks
- AI Apply operations
- conditions where practical

Keyboard:

Ctrl/Cmd + Z = Undo
Ctrl/Cmd + Shift + Z = Redo

==================================================
D. PARAGRAPH STYLE
==================================================

Make Paragraph Style functional.

Menu:

Paragraph
Heading 1
Heading 2
Heading 3
Heading 4

H1 MUST be available.

Applying a style must immediately change the selected/current block.

Use semantic heading levels.

Do not implement heading styles through arbitrary font-size changes.

Heading changes must conceptually synchronize with:
- TOC
- numbering
- Preview
- internal cross-references

==================================================
E. BASIC TEXT FORMATTING
==================================================

Make functional:

Bold
Italic
Underline
Strikethrough

Also place under More:

Superscript
Subscript
Inline Code
Clear Formatting

When text is selected, apply formatting only to the selection.

When no text is selected, formatting applies to subsequently typed text.

==================================================
F. TEXT ALIGNMENT
==================================================

Add an Alignment menu.

Options:

Align Left
Align Center
Align Right
Justify

Use familiar alignment icons.

Apply alignment to the current paragraph/block or selected blocks.

The menu must visibly indicate the current alignment.

Default English content:
Align Left

==================================================
G. BULLETED LISTS
==================================================

Make Bulleted List functional.

Support at least THREE nested levels.

Default visual hierarchy:

Level 1:
• Item

Level 2:
○ Item

Level 3:
– Item

Support:

Enter = next item
Tab = indent
Shift+Tab = outdent

Decrease Indent and Increase Indent toolbar controls must also work.

==================================================
H. NUMBERED LISTS
==================================================

Make Numbered List functional.

Support at least THREE nested levels.

Default:

Level 1:
1. 2. 3.

Level 2:
a. b. c.

Level 3:
i. ii. iii.

Support:

Enter
Tab
Shift+Tab
Decrease Indent
Increase Indent

==================================================
I. MIXED MULTILEVEL LISTS
==================================================

Allow ordered and unordered lists to be mixed at nested levels.

Example:

1. Configure the environment
   • Verify access
   • Confirm permissions
      a. Administrator
      b. Editor

2. Start the application

Changing one nested level to bullets must NOT convert every parent/child level.

==================================================
J. INSERT MENU
==================================================

Create a functional Insert menu.

Group commands logically.

CONTENT BLOCKS

Procedure
Table

CALLOUTS

Note
Tip
Important
Warning
Example

MEDIA

Image
Media
Diagram placeholder
Chart placeholder

OTHER

Code Block
Quote
Divider

REFERENCES / REUSE may remain under their own toolbar menus rather than duplicating them here.

==================================================
K. PROCEDURE BLOCK
==================================================

Insert → Procedure must create a functional structured Procedure block.

Procedure may contain:

Procedure Title
Optional Introduction
Prerequisites
Steps
Expected Result

Steps must support:

Add Step
Delete Step
Duplicate Step
Reorder Step

Within a step allow:

Paragraph text
Nested numbered list
Nested bulleted list
Mixed lists
Note
Tip
Warning
Example
Image/Media

Support at least THREE nested list levels.

When a Procedure is selected, show a contextual Procedure toolbar/menu:

Add Step
Add Substep
Add Bullet
Insert Callout
Insert Media
Reorder
Duplicate
Delete Procedure

==================================================
L. TABLE INSERTION
==================================================

Insert → Table must work.

Show a compact visual row × column selector.

Also allow custom values.

Example:

2 × 2
3 × 3
4 × 5

After insertion:
- every cell must be directly editable
- caret behavior must remain normal
- table must preserve browser selection correctly

==================================================
M. TABLE CONTEXTUAL TOOLS
==================================================

When the cursor is inside a table, expose contextual table commands.

Add:

Row Above
Row Below

Column Left
Column Right

Delete Row
Delete Column

Merge Cells
Split Cells

Toggle Header Row
Toggle Header Column

Cell Alignment ▼

Table Properties
Delete Table

CELL ALIGNMENT

Horizontal:
Left
Center
Right

Vertical:
Top
Middle
Bottom

==================================================
N. TABLE RESIZING
==================================================

Allow authors to resize table columns by dragging column separators.

When hovering over a column boundary:
- show column-resize cursor

Dragging must visually resize the column.

Do not require entering numeric widths for basic resizing.

Allow rows to increase height automatically based on content.

Provide optional Table Properties for more precise width controls.

==================================================
O. TABLE ACCESSIBILITY
==================================================

Table Properties should allow:

Table Caption
Accessibility Description

Do not expose manual border/color styling as the primary experience.

Template/Brand Kit controls table visual appearance.

==================================================
P. IMAGE / MEDIA UPLOAD
==================================================

Insert → Image must create a working image block.

The existing Upload action MUST work.

Click Upload:
- open native browser file picker

Support:

PNG
JPG/JPEG
SVG
WEBP

Also support drag-and-drop directly onto the image/media block.

When a valid image is dragged over:
- highlight the drop target

After upload:
- render the actual image
- maintain aspect ratio
- retain image during current prototype session

==================================================
Q. IMAGE CONTEXTUAL TOOLS
==================================================

When an image is selected show:

Replace
Resize
Align Left
Align Center
Align Right
Caption
Alt Text
Remove

Allow visual resizing using drag handles.

Do not stretch/distort aspect ratio by default.

==================================================
R. CALLOUTS
==================================================

Support semantic blocks:

Note
Tip
Important
Warning
Example

Authors must be able to type directly inside them.

When selected provide:

Change Type
Move
Duplicate
Delete

Do NOT allow authors to manually select arbitrary callout colors.

Template / Brand Kit controls styling.

==================================================
S. CONDITIONS MENU
==================================================

Create a functional Conditions menu.

Options:

Apply Condition
Remove Condition
Manage Conditions
Preview Conditions

Do NOT use only predefined conditions.

==================================================
T. MANAGE CONDITIONS
==================================================

Allow authors to manually create condition groups similar to professional structured-authoring systems.

Provide:

Create Condition Group
Rename Group
Delete Group

Inside each group:

Create Tag
Rename Tag
Delete Tag

Examples:

Audience
- Beginner
- Advanced
- Administrator

Platform
- Web
- Mobile

Edition
- Standard
- Enterprise

Release
- v1
- v2

Language
- English
- Arabic

Users must also be able to create completely custom group names and tag names.

Condition identification colors are for authoring only and must not affect published document styling.

==================================================
U. APPLY CONDITIONS
==================================================

Allow conditions on:

Selected text
Paragraph
Heading
List
List item
Procedure
Table
Table row
Image
Callout
Entire Topic

Allow multiple conditions on one item.

Show applied conditions subtly in Edit mode.

Do NOT display authoring condition tags in published Preview output.

==================================================
V. REFERENCES MENU
==================================================

Create:

References ▼

Options:

Insert Link
Cross-reference
Bookmark
Source Reference

==================================================
W. INSERT LINK
==================================================

Make Insert Link functional.

Support:

External URL
Email
Internal Topic
Internal Heading/Bookmark

For an existing link provide:

Open
Edit
Remove

==================================================
X. CROSS-REFERENCE
==================================================

Allow the author to select:

Topic
Heading
Table
Figure

Show human-readable titles.

Do not require authors to type internal IDs.

==================================================
Y. BOOKMARK
==================================================

Allow creation of a named bookmark/anchor.

Bookmarks should become available to:

Internal Link
Cross-reference

==================================================
Z. SOURCE REFERENCE
==================================================

Allow selected authored content to receive a source reference.

Provide:

Add Source Reference
View Evidence
Remove Source Reference

Keep source references separate from normal hyperlinks.

==================================================
AA. AI MENU
==================================================

AI must remain contextual.

Primary toolbar may contain one compact AI ✦ trigger.

When text or a block is selected, available AI actions include:

Improve
Rewrite
Shorten
Expand
Simplify
Summarize
Convert to Steps
Convert to Bullets
Convert to Table
Generate Example
Check Terminology
Verify Against Source
Generate Visual
Ask AI

Do not open a permanent AI sidebar.

==================================================
AB. AI APPLY
==================================================

Fix Apply for ALL AI operations.

When Apply is selected:

- restore the original selection
- replace the intended text/block
- preserve appropriate structure
- preserve conditions and references where appropriate
- push change into Undo history
- close AI proposal
- briefly highlight changed content
- update Saved state

Discard:
- close proposal
- leave original content unchanged

Where appropriate also provide:

Insert Below
Try Again

==================================================
AC. MORE MENU
==================================================

More ▼ should contain less frequently used authoring commands.

Include:

Find / Replace
Superscript
Subscript
Inline Code
Clear Formatting
Variables
Snippets
Comments
Language / Direction
Document Statistics

==================================================
AD. FIND / REPLACE
==================================================

Make:

Ctrl/Cmd + F

open Find.

Support:

Find
Previous
Next
Replace
Replace All

Highlight occurrences.

==================================================
AE. VARIABLES
==================================================

Allow:

Insert Variable
Manage Variables

Examples:

Product Name
Version
Company Name
Release Date

Authors may create custom variables.

Preview must display resolved values.

==================================================
AF. REUSABLE SNIPPETS
==================================================

Allow:

Insert Snippet
Create Snippet from Selection
Manage Snippets

For prototype:
session-based storage is sufficient.

==================================================
AG. COMMENTS
==================================================

Allow selected content to receive an author/reviewer comment.

Comments must remain separate from published content.

Use contextual display rather than permanent large sidebar.

==================================================
AH. LANGUAGE AND TEXT DIRECTION
==================================================

Provide a future-ready Language / Direction action under More.

Support:

Language:
English (US)
Arabic
Custom/Future

Direction:
LTR
RTL
Auto

Default User Guide:
English (US)
LTR

Direction must be block-scoped where appropriate rather than globally forcing every block.

==================================================
AI. DOCUMENT STATISTICS
==================================================

Provide optional:

Word Count
Character Count
Topic Count

Do not clutter the main toolbar with these values.

==================================================
AJ. FLOATING SELECTION TOOLBAR
==================================================

When text is selected, show a compact toolbar close to the selection.

Include only:

Bold
Italic
Link
AI
Comment

Do not duplicate the entire primary toolbar.

==================================================
AK. SELECTION AND CARET RELIABILITY
==================================================

CRITICAL REQUIREMENT.

Toolbar actions must NOT cause the active text selection/caret to be lost before formatting is applied.

Preserve the browser selection range while interacting with toolbar controls.

When appropriate:
- capture current selection before toolbar interaction
- restore selection immediately before applying action

Toolbar clicks must not move the caret to the start of the block.

Do not reconstruct active contenteditable DOM on every keystroke.

Use stable component keys.

Typing must remain natural in:

paragraphs
headings
procedure steps
lists
table cells
callouts

==================================================
AL. CONTEXTUAL TOOLBARS
==================================================

Do not create multiple permanent toolbar rows.

Show contextual commands only when appropriate.

TEXT selected:
Floating text toolbar

TABLE active:
Table tools

IMAGE selected:
Image tools

PROCEDURE selected:
Procedure tools

CALLOUT selected:
Callout tools

LINK selected:
Link tools

==================================================
AM. RESPONSIVE TOOLBAR BEHAVIOR
==================================================

If horizontal space becomes limited:

Keep highest-priority commands visible.

Move lower-priority actions into More/overflow.

Do NOT wrap toolbar controls onto a permanent second row.

==================================================
AN. SAVE STATE
==================================================

Keep:

Saved

After any content change:

Saving…

then:

Saved

Prototype persistence may remain browser-session based.

==================================================
AO. TOOLTIP REQUIREMENT
==================================================

Every toolbar icon without visible text must show a tooltip.

Example:

Bold
Italic
Align Left
Numbered List
Increase Indent

==================================================
AP. FUNCTIONAL ACCEPTANCE TEST
==================================================

Before considering this change complete, ensure the prototype behavior supports the following test sequence:

1. Select a paragraph.
2. Change it to Heading 1.
3. Undo.
4. Redo.
5. Apply Bold to selected words.
6. Center-align the paragraph.
7. Justify the paragraph.
8. Create a three-level bulleted list.
9. Convert the second level to numbered items.
10. Increase and decrease indentation.
11. Insert a hyperlink and edit it.
12. Insert a Procedure.
13. Add six steps.
14. Create a nested bullet under one step.
15. Insert a Warning inside the Procedure.
16. Insert a 3 × 3 table.
17. Add a row.
18. Add a column.
19. Resize a column by dragging.
20. Merge cells.
21. Insert an image using file picker.
22. Insert another image using drag-and-drop.
23. Add caption and alt text.
24. Create a custom condition group called "Region".
25. Add tags "UAE" and "Global".
26. Apply "Region: UAE" to a paragraph.
27. Create a cross-reference.
28. Create a reusable variable.
29. Run AI Improve on selected text.
30. Click Apply and verify that the content actually changes.
31. Undo the AI change.
32. Use Find/Replace.

Do not render a control if its interaction is not implemented for the prototype.

==================================================
AQ. FINAL DESIGN PRINCIPLE
==================================================

This is NOT a generic word processor.

It is a structured technical-content authoring environment.

Authors control:

content
meaning
hierarchy
conditions
references

Templates and Brand Kits control:

fonts
colors
spacing
borders
callout appearance
table appearance
published visual design

Keep the UI clean, professional, contextual, and efficient.