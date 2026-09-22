Complete the Authoring Studio editor functionality.

Modify ONLY the Author / Content workspace and its editing interactions.

Do not redesign the overall application shell, workflow, TOC, Knowledge Map, Review, or visual identity.

The Authoring Studio must behave like a functional structured technical-authoring editor rather than a visual mockup.

==================================================
1. DIRECT EDITING
==================================================

Make all document content directly editable.

Authors must be able to:
- click anywhere inside editable content
- place the text cursor
- select text
- type
- delete
- copy
- cut
- paste
- paste plain text
- select entire content blocks

Preserve structured blocks while editing.

==================================================
2. UNDO / REDO
==================================================

Make Undo and Redo fully functional.

Support undo/redo for:
- typing
- deletion
- formatting
- list changes
- block insertion/removal
- table changes
- image insertion/removal
- conditional tagging
- AI-applied changes

Support standard shortcuts:

Ctrl/Cmd + Z = Undo
Ctrl/Cmd + Shift + Z = Redo

==================================================
3. PARAGRAPH / HEADING STYLES
==================================================

Fix the Paragraph dropdown.

Provide:

- Paragraph
- Heading 1
- Heading 2
- Heading 3
- Heading 4

H1 must be available.

Applying a heading style must visibly change the selected paragraph.

Changing heading level must remain synchronized with:
- TOC
- document numbering
- Preview
- internal cross-references

Do not expose arbitrary font-size controls as the primary way of creating headings.

Use semantic heading styles.

==================================================
4. INLINE TEXT FORMATTING
==================================================

Make these existing toolbar actions functional:

- Bold
- Italic
- Underline
- Strikethrough
- Link

Also add through a compact More menu:

- Superscript
- Subscript
- Inline code
- Clear formatting

Add paragraph alignment:

- Left
- Center
- Right

Do not add arbitrary font/color controls as primary authoring features.
Templates and Brand Kits should control document appearance.

==================================================
5. LINKS
==================================================

Make Insert Link functional.

Allow:

- External URL
- Email address
- Internal topic
- Heading/anchor within the current document

When existing linked text is selected, provide:

- Open link
- Edit link
- Remove link

==================================================
6. ORDERED LISTS
==================================================

Make ordered lists functional.

Support at least THREE nested levels.

Default numbering:

Level 1:
1.
2.
3.

Level 2:
a.
b.
c.

Level 3:
i.
ii.
iii.

Allow:
- Enter to add another item
- Tab to indent
- Shift+Tab to outdent
- toolbar Increase indent
- toolbar Decrease indent

Authors must also be able to change the list type of an individual nested level.

==================================================
7. UNORDERED LISTS
==================================================

Make unordered lists functional.

Support at least THREE nested levels even though two levels are the minimum requirement.

Example visual hierarchy:

Level 1:
• item

Level 2:
○ item

Level 3:
– item

Allow:
- Tab to indent
- Shift+Tab to outdent
- Increase indent
- Decrease indent

==================================================
8. MIXED NESTED LISTS
==================================================

Allow ordered and unordered lists to be mixed.

Example:

1. Configure the environment
   • Verify access
   • Confirm permissions
      a. Administrator
      b. Editor

2. Start the application

Do not force a nested list to use the same type as its parent.

Allow at least three nested levels.

==================================================
9. PROCEDURE BLOCK
==================================================

Upgrade the Procedure content block.

A Procedure may contain:

- Procedure title
- Introductory paragraph
- Prerequisites
- Numbered steps
- Substeps
- Bulleted content
- Mixed ordered/unordered nested lists
- Notes
- Tips
- Warnings
- Examples
- Images/media
- Expected result

Within procedure steps allow at least three nested list levels.

Authors must be able to:

- Add step
- Add substep
- Add bullet under a step
- Change list type
- Reorder steps using drag-and-drop
- Delete step
- Duplicate step
- Insert note/warning/example after a step
- Insert media between steps

Do not treat the Procedure as a rigid fixed layout.

==================================================
10. TABLE INSERTION
==================================================

Make Insert → Table fully functional.

When selected, allow users to choose rows × columns visually.

Also support custom row/column values.

After inserting a table, users must be able to type directly in every cell.

==================================================
11. TABLE EDITING
==================================================

When the cursor is inside a table, show a contextual table toolbar.

Provide:

- Add row above
- Add row below
- Add column left
- Add column right
- Delete row
- Delete column
- Delete table
- Merge cells
- Split cells
- Toggle header row
- Toggle first column as header
- Horizontal alignment
- Vertical alignment

Allow users to resize column widths by dragging column separators.

Show the resize cursor while hovering over a column boundary.

Allow row height to grow naturally based on content.

Add:

- Table caption
- Table accessibility description

Do not require authors to manually choose border colors or visual table styling.
The template controls visual styling.

==================================================
12. IMAGE / MEDIA BLOCK
==================================================

Make the existing Media/Image block functional.

When the user clicks Upload:
- open the operating system file picker

Allow:
- PNG
- JPG/JPEG
- SVG
- WEBP

Also support drag-and-drop directly into the media block.

When dragging a valid image over the block:
- visually highlight the drop target

After upload:
- display the actual local image
- preserve it during the current prototype session

Provide contextual image controls:

- Replace
- Remove
- Resize
- Align left
- Align center
- Align right
- Caption
- Alt text

Allow image resizing through drag handles.

Do not distort image aspect ratio by default.

Keep Generate as a separate AI option.

AI image generation can remain simulated.

==================================================
13. CALLOUT BLOCKS
==================================================

Keep semantic content blocks:

- Note
- Tip
- Important
- Warning
- Example

Allow authors to insert them manually through:

Insert → Callout

Allow changing an existing callout type through the contextual control already shown.

Users must edit the callout content directly.

Do not let users manually choose callout colors.
Brand/template controls styling.

==================================================
14. CONDITIONAL TAGGING
==================================================

Upgrade Conditions into a full manual conditional-tagging system similar to professional structured-authoring tools.

Do NOT limit conditions to predefined tags.

Provide:

Conditions
→ Apply Condition
→ Manage Conditions

"Manage Conditions" must allow authors to create their own:

CONDITION GROUP

Examples:
Audience
Platform
Edition
Region
Language
Release
Product
Custom

Allow users to create any group name.

Inside each group, allow users to create custom tags.

Example:

Group:
Audience

Tags:
Beginner
Advanced
Administrator
Reviewer

Another example:

Group:
Release

Tags:
v1.0
v1.1
v2.0

Allow:
- Create group
- Rename group
- Delete group
- Create tag
- Rename tag
- Delete tag

Give each tag a subtle identification color for authoring purposes.

Do not allow condition colors to affect published content styling.

==================================================
15. APPLY CONDITIONS
==================================================

Allow conditions to be applied to:

- selected text
- paragraph
- heading
- list
- list item
- table
- table row
- image
- callout
- procedure block
- entire topic

Allow multiple conditions on the same content.

Show applied tags subtly in Edit mode.

Example:

[Audience: Administrator]
[Edition: Enterprise]

Do not show condition tags in final published output.

==================================================
16. CONDITION PREVIEW
==================================================

Provide a future-ready Preview filter.

Example:

Preview Conditions

Audience:
Administrator

Edition:
Enterprise

Language:
English

Preview should show/hide conditioned content accordingly.

Allow:

Show all conditions

This remains a prototype interaction.

==================================================
17. CROSS-REFERENCES
==================================================

Make:

Insert → Cross-reference

functional.

Allow selection of:
- topic
- heading
- table
- figure

Display human-readable titles.

If the destination title changes, conceptually keep the cross-reference synchronized.

==================================================
18. VARIABLES
==================================================

Add:

Insert → Variable

Support reusable variables such as:

Product Name
Version
Company Name
Release Date

Provide:

Manage Variables

Authors can:
- create variable
- edit value
- insert variable

Display variables subtly in Edit mode.

Example:

{{ProductName}}

Preview should display the resolved value.

==================================================
19. REUSABLE SNIPPETS
==================================================

Add a future-ready structured-authoring capability:

Insert → Snippet

Allow authors to save selected reusable content as a named snippet.

Example:

Standard Login Prerequisite
Support Contact Note
Legal Disclaimer

Allow:
- Insert existing snippet
- Create snippet from selected content

For this prototype, persistence can remain session-based.

==================================================
20. BOOKMARKS / ANCHORS
==================================================

Add:

Insert → Bookmark

Allow authors to create named internal anchors.

These can be used by:
- internal links
- cross-references

Keep management simple.

==================================================
21. FIND AND REPLACE
==================================================

Add a Find action accessible through:

Ctrl/Cmd + F

Support:
- Find
- Next
- Previous

Also provide:
- Replace
- Replace All

Highlight matching text in the document.

==================================================
22. COMMENTS / REVIEW NOTES
==================================================

Allow selected content to receive an author comment.

Use a contextual action:

Add Comment

Comments must remain separate from published content.

Do not permanently open a large comments sidebar.

Show comments contextually when selected.

==================================================
23. SOURCE REFERENCES
==================================================

Allow selected content to be linked to a source reference.

Actions:

- Add Source Reference
- View Source Evidence
- Remove Source Reference

Keep source evidence separate from normal hyperlink functionality.

==================================================
24. AI CONTEXT MENU
==================================================

Fix all contextual AI actions.

When users select text or right-click a block, AI actions may include:

- Improve
- Rewrite
- Shorten
- Expand
- Simplify
- Summarize
- Convert to steps
- Convert to bullets
- Convert to table
- Generate example
- Check terminology
- Verify against source
- Generate visual
- Ask AI

AI responses may remain simulated in this prototype.

However, the interaction must work.

==================================================
25. AI APPLY / DISCARD
==================================================

The Apply button currently does nothing.

Fix it.

When AI proposes replacement text:

Apply:
- replace the originally selected text with the proposed content
- preserve the paragraph/block structure where appropriate
- preserve applied conditions where appropriate
- create an undoable operation
- close the AI popover
- briefly highlight the changed content

Discard:
- close the proposal
- preserve original content

Also provide, where appropriate:

- Insert Below
- Try Again

Do not automatically change content without explicit author approval.

==================================================
26. SAVE STATE
==================================================

Keep the existing:
Saved

indicator.

Change dynamically to:

Saving…

after an edit.

Then return to:

Saved

For the prototype, browser-session persistence is sufficient.

==================================================
27. TOOLBAR ORGANIZATION
==================================================

Do not put every function directly on the toolbar.

Keep the interface clean.

Suggested organization:

Primary toolbar:
Undo
Redo
Paragraph style
Bold
Italic
Underline
Lists
Indent
Link

Menus:
Insert
Conditions
More

Contextual toolbars:
Table tools only inside tables
Image tools only when image selected
Callout tools only when callout selected
AI actions only when text/block selected

==================================================
28. ACCESSIBILITY / KEYBOARD
==================================================

Support familiar keyboard behavior where practical:

Ctrl/Cmd+B = Bold
Ctrl/Cmd+I = Italic
Ctrl/Cmd+U = Underline
Ctrl/Cmd+Z = Undo
Ctrl/Cmd+Shift+Z = Redo
Ctrl/Cmd+F = Find
Tab = list indent
Shift+Tab = list outdent

Provide visible focus states and tooltips.

==================================================
29. STRUCTURED AUTHORING PRINCIPLE
==================================================

Do not build this as a generic word processor.

Maintain semantic content types:

Heading
Paragraph
Procedure
Step
Ordered List
Unordered List
Table
Note
Tip
Important
Warning
Example
Image
Media
Code
Quote
Variable
Cross-reference
Snippet

The selected Template / Brand Kit should control visual styling.

Authors control meaning and structure.

==================================================
30. DO NOT CHANGE
==================================================

Do not modify:

- global workflow
- TOC behavior
- Knowledge Map
- Source Analysis
- Review
- Export
- current overall visual identity

Focus only on completing Authoring Studio functionality.