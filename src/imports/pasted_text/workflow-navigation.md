MAKE THE TOP WORKFLOW PROGRESS BAR FULLY NAVIGABLE

The top project workflow currently represents:

Project Details
→ Theme & Styles
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

This must also function as the primary project navigation.

Do not treat it only as a visual progress indicator.

====================================================
1. EVERY STAGE IS CLICKABLE
====================================================

When a project is open, the author must be able to select any stage directly from the top workflow bar.

Examples:

Author → Sources
Author → Theme & Styles
Review → TOC
Publish → Author
Sources → Publish

Do not force the user to navigate sequentially using Next/Back buttons.

====================================================
2. PRESERVE ALL PROJECT STATE
====================================================

Before navigating to another stage:

ensure pending edits are saved.

Navigation must never reset:

Project Details
Theme
Brand & Style Profile
Variables
Page Layouts
HTML Master Pages
Sources
Analysis
TOC
Author content
Conditions
Review findings
Publish configuration

All stages must continue to use the same active project state.

====================================================
3. VISUAL STATE OF EACH STAGE
====================================================

Each stage should clearly show its current status.

Suggested states:

Not Started
In Progress
Complete
Needs Attention
Stale

Do not use excessive visual decoration.

Use subtle indicators such as:

check mark = Complete

dot = In Progress

warning indicator = Needs Attention / Stale

Current stage = clearly highlighted

====================================================
4. DO NOT BLOCK NAVIGATION
====================================================

Authors may navigate to a later stage even if an earlier stage is incomplete.

Example:

Sources are uploaded but Analysis has not been run.

The author may still open Author or Publish.

However, display relevant warnings such as:

"Source Analysis has not been completed."

Do not prevent navigation unless continuing could cause data loss.

====================================================
5. STALE STATE MUST REMAIN VISIBLE
====================================================

If Sources change after Analysis:

Analysis stage should show:
Needs Refresh

If Author content changes after Review:

Review should show:
Needs Re-review

If required publishing configuration is missing:

Publish may show:
Needs Configuration

These states should appear directly in the workflow navigation.

====================================================
6. CURRENT STAGE
====================================================

Clearly highlight the currently open stage.

Example:

Details
Theme
Sources
Analysis
TOC
[AUTHOR]
Review
Publish

The active stage should be visually distinct but consistent with the existing design.

====================================================
7. HOVER INFORMATION
====================================================

When useful, hovering over a stage can show concise status information.

Examples:

Analysis
"Analysis completed using Source Revision 4"

Review
"Content changed since last review"

Publish
"PDF and HTML configured"

Keep this concise.

====================================================
8. RESPONSIVE BEHAVIOR
====================================================

On wide desktop screens:

show all workflow stages.

On smaller widths:

allow horizontal scrolling or a compact representation.

Do not remove access to stages.

If necessary, show:

Current Stage + workflow dropdown

on very small screens.

====================================================
9. UNSAVED CHANGES
====================================================

Autosave should normally make navigation immediate.

If a change cannot be saved:

do not silently navigate away.

Show:

"Your latest changes could not be saved."

Actions:

Retry Save
Stay Here

Do not show unnecessary confirmation dialogs when autosave succeeds.

====================================================
10. BROWSER BACK/FORWARD
====================================================

Where practical in the prototype, stage navigation should update application routing/history so browser Back and Forward behave sensibly.

Do not create separate copies of project state for each route.

====================================================
11. PROJECT HOME
====================================================

The workflow navigation appears only while a project is open.

Provide a separate way to return to:

Projects / Project Home

Returning to Project Home must not delete or reset the active project.

====================================================
12. ACCEPTANCE TEST
====================================================

Open an existing saved project.

From Author:

select Sources.

VERIFY existing sources appear.

Select Theme & Styles.

VERIFY current Theme and Brand Profile remain.

Select TOC.

VERIFY current hierarchy remains.

Select Review.

VERIFY current findings remain.

Select Publish.

VERIFY current output configuration remains.

Return to Author.

VERIFY authored content remains unchanged.

Reload the application and repeat.

PASS only if direct navigation works without state loss.

====================================================
FINAL PRINCIPLE
====================================================

The workflow bar is both:

1. project progress/status
2. direct project navigation

Authors should be able to move freely around their project without losing work.