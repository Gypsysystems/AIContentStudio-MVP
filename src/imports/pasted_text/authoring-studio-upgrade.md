Upgrade ONLY the Authoring Studio / Content workspace into a functional structured authoring experience.

Do not redesign the entire application.
Preserve the existing application shell, workflow, TOC panel, Knowledge Map, and overall visual language.

GOAL

The Author stage must behave like a professional structured-content editor rather than a static document preview.

The author must be able to directly edit generated content, format it, insert structured content blocks, manage tables, apply conditional tags, and navigate efficiently between topics.

==================================================
1. AUTHORING MODE
==================================================

The Content workspace should open in EDIT mode by default.

The main document canvas must be directly editable.

Users must be able to:
- click inside headings and paragraphs
- place the text cursor
- select text
- type
- delete
- copy/paste
- edit generated content directly

Keep the existing Preview action.

Preview should render the current content using the selected document template.

Do not require code editing.

==================================================
2. CONTEXTUAL NAVIGATION
==================================================

Do NOT add a generic Back button everywhere.

Use contextual navigation.

At the bottom of each authored topic, provide subtle:

← Previous topic

Next topic →

These should navigate according to the current TOC.

If the user entered Author mode from a Review finding, show a compact:

"Back to Review"

action until that review task is completed or closed.

Keep the left TOC as the primary document-navigation mechanism.

Completed workflow stages in the top workflow may remain navigable where appropriate.

==================================================
3. FUNCTIONAL AUTHORING TOOLBAR
==================================================

Make the current top formatting toolbar functional.

Organize it into logical groups.

PRIMARY ACTIONS

- Undo
- Redo

TEXT / PARAGRAPH

- Paragraph
- Heading 1
- Heading 2
- Heading 3
- Heading 4
- Bold
- Italic
- Underline
- Strikethrough
- Link

LISTS

- Bulleted list
- Numbered list
- Increase indent
- Decrease indent

Do not overload the toolbar with every possible feature.

Use compact menus such as:
Insert
Conditions
More

==================================================
4. INSERT MENU
==================================================

Add an "Insert" menu to the toolbar.

Include:

- Image
- Table
- Note
- Tip
- Important
- Warning
- Example
- Code Block
- Quote
- Divider
- Media
- Cross-reference

These are semantic content blocks.

Authors choose the content type.
The template/Brand Kit determines its final visual styling.

==================================================
5. SEMANTIC CALLOUT BLOCKS
==================================================

Implement structured callout blocks:

Note
Tip
Important
Warning
Example

When inserted:
- create an editable content block in the document
- show a subtle type label
- allow users to type directly inside it

When selected, provide contextual actions:
- Change type
- Move
- Duplicate
- Delete

Example:

Note
[Editable note content]

The author must NOT manually configure colors, borders, or fonts for these blocks.

Visual styling comes from the active template/Brand Kit.

==================================================
6. TABLE CREATION
==================================================

Make table insertion functional.

When the user selects:
Insert → Table

show a compact row/column selector.

Examples:
2 × 2
3 × 3
4 × 5

Allow custom row/column count.

After insertion, users must be able to edit table-cell content directly.

==================================================
7. CONTEXTUAL TABLE TOOLBAR
==================================================

When the cursor is inside a table, show contextual table actions.

Include:

- Add row above
- Add row below
- Add column left
- Add column right
- Delete row
- Delete column
- Merge cells
- Split cells
- Toggle header row
- Cell alignment
- Table properties
- Delete table

Do not display these actions when the cursor is outside a table.

Support basic drag resizing of column widths where possible.

==================================================
8. CONDITIONAL TAGGING
==================================================

Add a toolbar action called:

"Conditions"

Allow the author to apply one or more conditional tags to:

- a paragraph
- heading
- content block
- table
- image/media
- entire topic

For the prototype, include example condition groups:

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

Language
- English
- Arabic

Allow:
- Apply condition
- Remove condition
- View active conditions

Display applied conditions subtly in Edit mode.

Do not make conditional tags visually dominate the authored document.

In Preview mode, provide a future-ready concept where content can be filtered by selected conditions.

==================================================
9. STRUCTURED CONTENT PRINCIPLE
==================================================

Do not treat the whole document as plain rich text.

Maintain meaningful content types such as:

Heading
Paragraph
Procedure
Step
List
Table
Note
Tip
Warning
Example
Image
Media

This should conceptually support future HTML, PDF, Word, and eLearning outputs.

==================================================
10. PROCEDURES AND STEPS
==================================================

Support an explicit Procedure block.

Insert → Procedure

A Procedure block can contain:

Procedure title
Optional introduction
Prerequisites
Numbered steps
Expected result
Note / Warning

Allow authors to:
- add step
- delete step
- reorder steps
- insert media between steps

Do not force every numbered list to become a Procedure.

==================================================
11. MEDIA
==================================================

Insert → Media should support:

- Upload image
- Generate image
- Diagram
- Infographic
- Chart
- Video placeholder/concept

For the prototype, AI generation can remain simulated.

Allow:
- caption
- alt text
- alignment
- replace
- delete

==================================================
12. LINK AND CROSS-REFERENCE
==================================================

Make Link functional.

Allow:
- URL
- Email
- Internal topic link

Also add:
Insert → Cross-reference

Allow an author to select another topic/heading in the current project.

Show the topic title rather than requiring manual IDs.

==================================================
13. SOURCES
==================================================

Keep the existing Sources control.

When opened, show a compact source-reference experience.

Authors should be able to:
- view supporting sources
- attach a source reference to selected content
- inspect evidence

Do not permanently occupy the writing canvas with a source panel.

==================================================
14. AI ACTIONS
==================================================

Keep AI contextual.

When text or a structured block is selected, show a compact contextual AI menu with actions such as:

- Improve
- Rewrite
- Shorten
- Expand
- Simplify
- Convert to steps
- Convert to table
- Summarize
- Verify against source
- Generate example
- Generate visual
- Ask AI

Do NOT add a permanent AI chat sidebar.

AI suggestions must require author approval before replacing content.

==================================================
15. SELECTION TOOLBAR
==================================================

When text is selected, show a lightweight floating toolbar close to the selection.

Include only common actions such as:

Bold
Italic
Link
AI
Comment / Review

Keep advanced features in the main toolbar.

==================================================
16. TOC SYNCHRONIZATION
==================================================

When the author changes a heading/title:

- synchronize the TOC automatically
- preserve hierarchy
- update Preview
- update internal cross-references

TOC structural changes must continue to preserve authored content.

==================================================
17. UNDO / REDO
==================================================

Make Undo and Redo functional for common editing operations:

- typing
- formatting
- block insertion
- block deletion
- table edits
- TOC hierarchy edits where practical

==================================================
18. SAVE STATE
==================================================

Show a subtle save indicator near the document/project area:

Saving…
Saved

Do not require a manual Save button for normal editing.

For the prototype, persistence can remain browser-session based.

==================================================
19. ACCESSIBILITY
==================================================

Ensure:
- keyboard navigation
- visible focus states
- toolbar tooltips
- familiar keyboard shortcuts where possible

Examples:
Ctrl/Cmd+B = Bold
Ctrl/Cmd+I = Italic
Ctrl/Cmd+Z = Undo

==================================================
20. DESIGN PRINCIPLE
==================================================

Keep the writing canvas as the dominant element.

Do not make this look like Microsoft Word.

Do not add multiple permanent sidebars.

Use:
- progressive disclosure
- contextual controls
- compact menus
- semantic blocks
- clean authoring interactions

The result should feel like a modern structured-authoring environment designed specifically for AI-assisted professional documentation.