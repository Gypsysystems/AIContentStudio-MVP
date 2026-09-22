AUTHORING STUDIO – COMPLETE FUNCTIONAL IMPLEMENTATION PASS

Perform a comprehensive architecture, interaction, and functionality upgrade of ONLY:

1. Project typography/style selection where required
2. Author → Content workspace
3. Authoring toolbar
4. Structured editor blocks and their contextual tools

Do NOT redesign:
- global navigation
- Sources
- Analysis
- pre-generation TOC workflow
- Knowledge Map
- Review
- Export

Preserve the current visual language unless a small UI change is required for functionality.

This application is an AI-assisted PROFESSIONAL STRUCTURED AUTHORING SYSTEM for technical documentation.

It must combine the usability users expect from modern word processors with the structured-authoring capabilities expected from professional documentation systems.

CRITICAL RULE:

DO NOT create controls that only look functional.

Every visible control introduced by this request must perform its prototype interaction.

If an interaction cannot be implemented reliably, do not expose the control yet.

============================================================
1. PROJECT TYPOGRAPHY AND STYLE PROFILE
============================================================

Add project-level typography selection to the project creation workflow.

Authors must NOT choose arbitrary font families independently throughout document content.

Provide:

Typography

Option 1:
Use Organization Style Profile

Option 2:
Custom Project Typography

Custom Project Typography supports:

Heading Font
Body Font
Monospace / Code Font
Base Body Size
Default Line Spacing

Also allow selection of a predefined typography preset.

Examples:
Modern Sans
Editorial
Corporate
Technical

Once the project is created, these settings become project-wide defaults.

Allow them to be modified later through Project Settings, not through normal inline authoring.

All document components must inherit project typography:

Headings
Paragraphs
Lists
Tables
Callouts
Procedures
Captions

The selected Template / Brand Kit may override project typography when explicitly configured.

============================================================
2. EDITOR STATE ARCHITECTURE
============================================================

Fix the editor architecture before adding additional controls.

Every editable element must have:

- stable unique ID
- stable component key
- independent editor/block state
- correct selection range
- correct caret state

Do NOT reconstruct the active editable DOM on every keystroke.

Do NOT generate new React keys during editing.

Do NOT allow toolbar interaction to destroy the active selection.

Editor commands must operate on:

1. selected text, if text is selected
2. active block, when there is no text selection
3. explicitly selected multiple blocks, when supported

NO command may apply to the entire document unless the user explicitly requests a document-wide action.

============================================================
3. EMPTY PARAGRAPH BEHAVIOR
============================================================

Fix blank blocks left after paragraph deletion.

Required behavior:

If an author selects all text in a paragraph and deletes it:
- keep one temporary editable empty paragraph while the cursor remains there

If the author presses Backspace/Delete again on that empty paragraph:
- remove the empty block
- move the caret logically to the previous/next block

Backspace at the beginning of a paragraph:
- merge with the previous compatible paragraph when appropriate

Delete at the end:
- merge with the next compatible paragraph when appropriate

Do not leave unexplained permanent blank vertical space.

Allow intentional spacing only through semantic structure/template spacing, not orphaned blank paragraphs.

============================================================
4. BASIC EDITING
============================================================

Implement:

Select text
Select block
Cut
Copy
Paste
Paste as plain text
Delete
Duplicate block

Keyboard support:

Ctrl/Cmd+C
Ctrl/Cmd+X
Ctrl/Cmd+V
Ctrl/Cmd+Shift+V where supported
Ctrl/Cmd+A within appropriate editing context

============================================================
5. UNDO / REDO
============================================================

Make fully functional:

Undo
Redo

Must handle:

typing
deleting
formatting
paragraph changes
list changes
table edits
block insertion/deletion
conditions
variables
AI Apply actions
image operations

Ctrl/Cmd+Z
Ctrl/Cmd+Shift+Z

============================================================
6. SEMANTIC STYLE MENU
============================================================

Replace simple "Paragraph" control with a functional Style menu.

Core styles:

Paragraph
Heading 1
Heading 2
Heading 3
Heading 4
Caption
Code Block

Allow project/organization style profiles to expose additional named styles later.

Heading levels must synchronize with:

TOC
document numbering
cross-references
Preview

Do not use manual font-size changes to create headings.

============================================================
7. CHARACTER FORMATTING
============================================================

Functional:

Bold
Italic
Underline
Strikethrough

Under More:

Superscript
Subscript
Inline Code
Clear Character Formatting
Change Case:
- Sentence case
- lowercase
- UPPERCASE
- Title Case

Formatting applies ONLY to the current selection/current typing state.

============================================================
8. PARAGRAPH FORMATTING
============================================================

Provide functional:

Align Left
Center
Align Right
Justify

Increase Indent
Decrease Indent

Optional paragraph menu:

Line Spacing:
1.0
1.15
1.5
2.0

Do not expose arbitrary paragraph margin controls in normal authoring.

============================================================
9. LIST ENGINE – CRITICAL
============================================================

Rebuild list behavior so lists are true nested structured blocks.

Support lists inside:

normal topic content
Procedure steps
table cells
Notes
Tips
Warnings
Examples

Support at least THREE nesting levels.

Ordered defaults:

Level 1:
1. 2. 3.

Level 2:
a. b. c.

Level 3:
i. ii. iii.

Unordered defaults:

Level 1:
•

Level 2:
○

Level 3:
–

Support:

Enter = new list item
Enter twice on empty item = leave list
Tab = indent
Shift+Tab = outdent
Shift+Enter = soft line break within same item

============================================================
10. LIST SCOPE – CRITICAL BUG FIX
============================================================

Changing list type at one nested level MUST NOT modify unrelated lists or the entire page.

Example:

1. Parent
   a. Child one
   b. Child two

If the author selects only:
a. Child one
b. Child two

and chooses Bulleted List, result becomes:

1. Parent
   • Child one
   • Child two

The parent remains numbered.

No other list elsewhere in the document changes.

All list commands must respect active selection boundaries.

============================================================
11. MIXED LISTS
============================================================

Support mixed nested list types.

Example:

1. Configure access
   • Verify account
   • Verify role
      a. Administrator
      b. Editor

2. Continue

Each level/list branch can independently be ordered or unordered.

============================================================
12. LISTS INSIDE TABLE CELLS
============================================================

Allow tables cells to contain:

Paragraphs
Ordered lists
Unordered lists
Nested lists up to three levels
Links
Variables
Inline conditions

Example cell content:

Supported roles:
• Administrator
  ○ System Admin
  ○ Project Admin
• Editor

List indentation must remain inside the cell boundaries.

List toolbar commands must operate only inside the active cell/list.

============================================================
13. PROCEDURE BLOCK
============================================================

Procedure is a semantic structured block.

Support:

Procedure Title
Optional Introduction
Prerequisites
Steps
Expected Result

Each Step can contain:

Paragraph
Ordered nested list
Unordered nested list
Mixed lists
Image
Table
Note
Tip
Important
Warning
Example
Code

Provide:

Add Step
Add Substep
Add Bullet
Duplicate Step
Delete Step
Drag to Reorder

Step numbering must update automatically.

============================================================
14. TABLE INSERTION
============================================================

Insert → Table must work.

Allow visual rows × columns selector and custom values.

Inserted cells must be fully editable.

============================================================
15. TABLE CONTEXTUAL MODE
============================================================

When cursor/selection is in a table, reveal contextual Table controls.

Support:

Insert Row Above
Insert Row Below
Insert Column Left
Insert Column Right

Delete Row
Delete Column
Delete Table

Merge Cells
Split Cells

Header Row On/Off
Header Column On/Off

Cell Horizontal Alignment:
Left
Center
Right

Cell Vertical Alignment:
Top
Middle
Bottom

Table Caption
Accessibility Description

AutoFit:
- Contents
- Available Width
- Fixed Width

Distribute Rows
Distribute Columns

============================================================
16. TABLE WIDTH RESIZING
============================================================

Column separators must be draggable.

Hover:
show column resize cursor

Drag:
update width interactively

Do not lose cell contents.

Rows grow naturally based on content.

Allow table width to adapt to the authoring canvas.

============================================================
17. TABLE SELECTION
============================================================

Allow selection of:

single cell
multiple adjacent cells
row
column
entire table

Merge Cells only works when valid adjacent cells are selected.

Table formatting operations must not affect unrelated tables.

============================================================
18. IMAGE INSERTION
============================================================

Insert → Image must work.

Click Upload:
open native file picker

Support:
PNG
JPG/JPEG
SVG
WEBP

Support drag-and-drop onto image/media placeholder.

After upload render the actual local image.

============================================================
19. IMAGE CONTROLS
============================================================

When image selected:

Replace
Delete
Resize
Align Left
Center
Right
Caption
Alt Text

Allow resizing with handles while maintaining aspect ratio by default.

For multi-output reliability, do NOT implement arbitrary floating image/text wrapping in this MVP.

Use structured block placement.

============================================================
20. FIGURE/TABLE CAPTIONS
============================================================

Support semantic captions.

Allow:

Figure Caption
Table Caption

Conceptually maintain numbering:

Figure 1
Figure 2

Table 1
Table 2

Numbers must update when figures/tables move or are deleted.

Captioned items become available to Cross-reference.

============================================================
21. CALLOUTS
============================================================

Support semantic:

Note
Tip
Important
Warning
Example

Directly editable.

Contextual actions:

Change Type
Duplicate
Move
Delete

Styles come from Template/Brand Kit.

Authors do not manually choose callout border/background colors.

============================================================
22. CONDITIONAL CONTENT
============================================================

Implement professional conditional tagging.

Conditions menu:

Apply Condition
Remove Condition
Manage Conditions
Preview Conditions

Manage Conditions allows custom:

Condition Groups
Tags

Example:

Audience:
Beginner
Advanced
Administrator

Platform:
Web
Mobile

Release:
v1
v2

Region:
UAE
Global

Allow entirely custom groups/tags.

============================================================
23. CONDITION SCOPE
============================================================

Apply conditions to:

selected characters/text
paragraph
heading
list
individual list item
procedure
procedure step
table
table row
table cell where practical
image
callout
entire topic

Multiple conditions may exist on one item.

Condition markers appear subtly in Edit mode.

They do NOT appear in published output.

============================================================
24. VARIABLES
============================================================

Implement:

Insert Variable
Manage Variables

Variables consist of:

Name
Value
Optional description

Examples:

ProductName
Version
CompanyName
ReleaseDate

Inserted variables remain semantic tokens in Edit mode.

Preview resolves their current values.

============================================================
25. SNIPPETS / REUSABLE CONTENT
============================================================

Implement:

Insert Snippet
Create Snippet from Selection
Manage Snippets

A snippet may contain:

text
lists
tables
images
callouts
variables
conditions where appropriate

Prototype persistence may remain session-local.

Inserted snippet should be visually identifiable in Edit mode without affecting published appearance.

============================================================
26. HYPERLINKS
============================================================

Implement:

External URL
Email
Internal topic
Bookmark/anchor

For existing links:

Open
Edit
Remove

============================================================
27. BOOKMARKS
============================================================

Implement named bookmarks/anchors.

They must be selectable as destinations for:

Internal Links
Cross-references

============================================================
28. CROSS-REFERENCES
============================================================

Implement Cross-reference to:

Topic
Heading
Bookmark
Figure
Table

Use human-readable selectable destinations.

Cross-reference text should update conceptually when its target title/number changes.

============================================================
29. SOURCE REFERENCES
============================================================

Keep source evidence separate from ordinary hyperlinks.

Allow:

Add Source Reference
View Source Evidence
Remove Source Reference

Selected content can have one or multiple supporting source references.

============================================================
30. COMMENTS
============================================================

Allow comments on selected content.

Support:

Add Comment
Reply
Resolve
Delete

Comments remain authoring/review metadata and never publish into final content.

Use contextual display rather than permanent large sidebar.

============================================================
31. FIND / REPLACE
============================================================

Ctrl/Cmd+F opens Find.

Support:

Find
Previous
Next
Replace
Replace All

Provide search scopes:

Current Topic
Entire Project

Project-wide actions can be simulated for this prototype but the interaction/state must work.

============================================================
32. SPECIAL CHARACTERS
============================================================

Under More → Insert Special Character.

Provide common technical-writing characters:

©
®
™
°
±
×
→
←
–
—
…
nonbreaking space

Do not overload the toolbar with these.

============================================================
33. LANGUAGE / DIRECTION
============================================================

Support:

English (US)
Arabic
Future languages

Direction:

LTR
RTL
Auto

Default project:
English (US) / LTR

Allow block-level direction override.

Caret behavior must remain stable.

============================================================
34. SPELLING / LANGUAGE CUES
============================================================

Retain browser/native spelling indicators where available.

Do not implement fake spelling/grammar detection.

Quality Review will eventually provide deeper writing checks.

============================================================
35. AI CONTEXTUAL EDITING
============================================================

AI remains contextual.

On selected text/block:

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

No permanent AI sidebar.

============================================================
36. AI APPLY – CRITICAL
============================================================

Apply must work.

When Apply is clicked:

- restore original selection
- modify ONLY that selected content/block
- preserve unrelated content
- preserve applicable Conditions
- preserve Source References
- preserve comments where appropriate
- update Undo history
- update Saving/Saved
- close suggestion dialog
- briefly highlight changed content

Discard leaves original content untouched.

Add:
Try Again
Insert Below
where appropriate.

============================================================
37. BLOCK SELECTION SAFETY
============================================================

All commands MUST respect block boundaries.

A command applied inside:

table cell
procedure step
list branch
callout

must not accidentally modify neighboring blocks or whole-document content.

============================================================
38. FLOATING TEXT TOOLBAR
============================================================

Text selection floating toolbar contains only:

Bold
Italic
Link
AI
Comment

Main toolbar remains available for advanced actions.

============================================================
39. PRIMARY TOOLBAR
============================================================

Use ONE persistent toolbar.

Recommended order:

Undo
Redo

|

Style ▼

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

Right side:

Saving / Saved
Sources
Quality
Preview
Export

Do not add permanent second toolbar.

Use contextual toolbars for block-specific commands.

============================================================
40. PROJECT STYLE CONSISTENCY
============================================================

Do NOT add ordinary toolbar controls for:

Font family
Font size
Text color
Background color

These are controlled through:

Project Typography
Organization Style Profile
Template
Brand Kit
Named semantic styles

This prevents inconsistent manual formatting.

============================================================
41. CONTEXTUAL TABLE TOOLBAR
============================================================

Only when table active:

Rows
Columns
Merge/Split
Headers
Alignment
AutoFit
Distribute
Properties

============================================================
42. CONTEXTUAL IMAGE TOOLBAR
============================================================

Only when image active:

Replace
Resize
Alignment
Caption
Alt Text
Delete

============================================================
43. CONTEXTUAL PROCEDURE TOOLBAR
============================================================

Only when Procedure/step active:

Add Step
Substep
Bullet
Callout
Media
Move
Duplicate
Delete

============================================================
44. SAVE STATE
============================================================

After edit:

Saving…

Then:

Saved

Browser/session persistence is acceptable for this prototype.

============================================================
45. EDITOR ACCEPTANCE TEST – MANDATORY
============================================================

After implementing the features, DO NOT immediately finish.

Use the running Figma Make preview to test the Authoring Studio.

Create/use a dedicated temporary test topic named:

"Editor QA Test"

Run these interactions sequentially.

A. PARAGRAPH TEST

1. Type three paragraphs.
2. Delete the middle paragraph completely.
3. Verify no permanent blank block remains after removing it.
4. Undo.
5. Redo.

PASS only if block deletion/undo behaves correctly.

B. HEADING TEST

1. Convert paragraph to H1.
2. Convert to H2.
3. Undo.
4. Verify only selected paragraph changed.

C. ALIGNMENT TEST

Apply:
Left
Center
Right
Justify

Verify each works only on active paragraph.

D. LIST TEST

Create:

1. Level one
   a. Level two
      i. Level three

Convert ONLY Level two to unordered bullets.

EXPECTED:

1. Level one
   • Level two
      i. Level three

No other list/document content may change.

E. MIXED LIST TEST

Create:

1. Parent
   • Child bullet
      a. Nested number
   • Second bullet
2. Next parent

Verify hierarchy remains intact.

F. TABLE TEST

Insert 3 × 3 table.

Inside first cell create:

• Item one
  ○ Item two
    – Item three

Verify nesting remains contained in the cell.

Add row below.
Add column right.
Delete row.
Delete column.

Resize second column by dragging.

Merge two cells.
Split them again.

Enable header row.

Verify unrelated table content remains unchanged.

G. PROCEDURE TEST

Insert Procedure.

Add six steps.

Inside Step 2 add:

• Bullet
  ○ Nested bullet
     a. Numbered child

Insert Warning after Step 3.

Reorder Step 5 above Step 4.

Verify numbering recalculates.

H. IMAGE TEST

Insert Image.

Test:
file picker upload
drag-and-drop
resize
caption
alt text
replace
delete

I. CONDITION TEST

Create condition group:
Region

Tags:
UAE
Global

Apply UAE to one paragraph only.

Verify neighboring blocks are not conditioned.

J. VARIABLE TEST

Create:
ProductName = Orion

Insert variable in paragraph.

Preview must show:
Orion

K. SNIPPET TEST

Create snippet from selected paragraph.

Insert snippet elsewhere.

Verify content appears.

L. LINK TEST

Create external link.

Edit it.

Remove it.

M. CROSS-REFERENCE TEST

Create bookmark.

Create cross-reference to bookmark/topic/heading.

Verify interaction works.

N. AI TEST

Select one sentence.

Run Improve.

Click Apply.

VERIFY:
only selected sentence changes.

Undo.

VERIFY:
original sentence returns.

O. CARET TEST

Type exactly:

"This is a test sentence for the documentation editor."

inside:

paragraph
procedure step
table cell
warning block

VERIFY:
characters appear in correct order and cursor advances normally.

Then click in the middle and insert text.

VERIFY:
caret does not jump.

P. FIND/REPLACE TEST

Find a repeated word.

Replace one occurrence.

Replace all remaining occurrences.

VERIFY correct scope.

============================================================
46. SELF-CORRECTION REQUIREMENT
============================================================

If ANY acceptance test above fails:

- inspect the relevant component/state logic
- fix the issue
- repeat the failed test

Continue until the interaction passes or the capability cannot be reliably implemented.

Do not knowingly leave a visible control that does nothing.

If a requested capability cannot be reliably implemented in this Figma Make prototype:

- remove/disable that control
- clearly report which capability could not be validated

Do not silently pretend it works.

============================================================
47. REGRESSION CHECK
============================================================

After all Authoring tests pass, verify that these still work:

TOC topic navigation
TOC resizing
Knowledge Map opening
Sources control
Quality navigation
Preview
Export navigation
top workflow navigation

Authoring changes must not break existing workflow functionality.

============================================================
48. COMPLETION REPORT
============================================================

After implementation/testing, respond in chat with a concise report:

PASSED:
[list tested features]

FIXED DURING TESTING:
[list]

NOT FULLY VALIDATED:
[list]

Do NOT claim a feature passed unless you exercised its interaction in the running prototype.

============================================================
49. FINAL PRINCIPLE
============================================================

This editor must NOT behave like a generic WYSIWYG text area.

It is a structured documentation authoring environment.

Author controls:

content
semantic structure
hierarchy
conditions
reuse
references

Project Style Profile / Brand Kit controls:

typography
colors
spacing
component appearance
published design

AI assists the author but never silently overwrites human content.