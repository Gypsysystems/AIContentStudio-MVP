END-TO-END PROJECT DATA PIPELINE AND INTEGRATION AUDIT

THIS IS A FOUNDATION/ARCHITECTURE PASS.

Do NOT redesign the UI.

Do NOT add new visual features.

Do NOT spend time refining small controls.

The current screens and features already exist.

The priority is to make all existing stages operate as ONE CONNECTED PROJECT:

Project Details
→ Theme & Styles
→ Templates
→ Variables
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

Current concern:

Several screens appear to maintain independent/local/mock state and therefore behave like orphaned features.

Fix the data and state architecture before further feature development.

============================================================
1. ONE PROJECT — ONE SOURCE OF TRUTH
============================================================

Create one central project state/model.

All workflow stages must read from and write to this SAME active project.

Do NOT create separate sample projects or hard-coded project data inside individual screens.

Conceptually maintain:

Project
- id
- name
- documentType
- version

Theme
- activeThemeId
- activeBrandStyleProfileId
- projectStyleOverrides

Templates
- pdfLayouts
- wordLayouts
- htmlMasterPages
- defaultMasterAssignments

Variables

Sources
- sourceFiles
- styleGuides
- approvedSamples

Analysis
- concepts
- evidence
- gaps
- conflicts
- detectedStandards

TOC
- topicTree

Content
- topics
- contentBlocks

Conditions

Review
- findings

Publish
- outputVariants
- configuration
- masterAssignments

============================================================
2. REMOVE MOCK / HARDCODED PIPELINE DATA
============================================================

Audit all workflow screens.

Locate values that are currently:

hard-coded
sample-only
Nexus demo content
locally generated without project linkage
duplicated in separate components

Replace them with reads from the active Project state.

Demo data may remain ONLY when explicit Demo Mode is enabled.

Normal projects must never silently fall back to demo content.

============================================================
3. STABLE IDS — CRITICAL
============================================================

Assign stable IDs to:

Project

Source
Style Guide
Approved Sample

Topic

Content Block

Variable

Condition

Review Finding

Theme

Brand & Style Profile

Page Layout

HTML Master Page

Output Variant

Do not use title/name as the relationship key.

Renaming an item must NOT break references.

============================================================
4. PROJECT DETAILS → ENTIRE WORKFLOW
============================================================

When Project Name changes:

Header/breadcrumb must update.

Publish filename must use project name.

Preview metadata must update where applicable.

Do not retain "Untitled Project" once project has a saved name.

Document Type must remain available throughout workflow.

Version must resolve wherever the Version variable/metadata is used.

============================================================
5. THEME → DOWNSTREAM CONNECTION
============================================================

The selected Theme must drive:

Author presentation
Style rendering
PDF/Word Page Layout availability
HTML Master Page availability
Preview
Publish

Changing Theme must NOT:

rewrite authored content
change TOC
remove sources
remove variables
remove review findings

It changes presentation/configuration only.

============================================================
6. BRAND & STYLE → DOWNSTREAM CONNECTION
============================================================

The active Brand & Style Profile must drive semantic presentation for:

Author
PDF Preview
Word Preview
HTML Preview
Generated PDF
Generated DOCX
Generated HTML

Examples:

H1 style
Body style
Table style
Note
Warning
Procedure
Links

Do not maintain separate hard-coded style objects in downstream screens.

============================================================
7. PAGE LAYOUT → PUBLISH CONNECTION
============================================================

Saved PDF/Word Page Layouts must be read directly by:

Publish Preview
PDF generation
Word generation

Changing:

margins
background
element position
header
footer
logo
page number

must affect downstream rendering.

Do NOT copy Page Layout values into a separate Publish model.

Publish references the layout by ID.

============================================================
8. HTML MASTER PAGE → PUBLISH CONNECTION
============================================================

Saved HTML Master Pages must be read directly by:

HTML Preview
HTML generation

Master assignment references Master Page ID.

Changes made to the Master Page must automatically affect all topics assigned to that Master.

Do NOT clone the Master configuration into each topic.

============================================================
9. VARIABLES → ENTIRE CONTENT PIPELINE
============================================================

Variables must be central reusable values.

Example:

ProductName = Orion

A Variable used in:

Cover Page
Header
Footer
Topic content
Callout
HTML Home Page
HTML Topic Master

must resolve to Orion everywhere.

Changing:

Orion
→ Orion Enterprise

must update all rendered references.

Do not manually duplicate variable values into components.

============================================================
10. VARIABLE TOKENS
============================================================

Authored content must retain semantic variable references.

Example conceptual representation:

Variable:
ProductName

NOT plain copied text:
Orion

Preview/Publish resolves the current value.

============================================================
11. SOURCES → ANALYSIS
============================================================

Analysis must use ONLY sources belonging to the active project.

Source categories:

Product Sources

Style Guides

Approved Samples

Brand Guidelines are Theme/Style input and should not be confused with factual product sources.

============================================================
12. SOURCE ID REFERENCES
============================================================

Analysis evidence must reference actual Source IDs.

Example:

Concept:
Authentication

Evidence:
sourceId: source-004
location: page/section

View Source must retrieve that actual source.

Do not generate fake source names or evidence.

============================================================
13. SOURCE CHANGE INVALIDATION
============================================================

If product Sources change after Analysis:

mark Analysis:

Needs refresh

Do NOT silently pretend previous Analysis remains current.

Do NOT automatically overwrite Author content.

Provide:

Re-analyze Sources

============================================================
14. ANALYSIS → TOC
============================================================

AI-Proposed TOC must derive from the current Analysis/project sources.

Store:

proposal basis
analysis revision

Once the author approves/edits the TOC:

the TOC becomes human-controlled project structure.

Later source changes may suggest:

"New source information may affect structure"

but MUST NOT silently regenerate/overwrite approved TOC.

============================================================
15. TOC → AUTHOR
============================================================

TOC topic IDs must become the same topic IDs used by Author.

Example:

TOC:
topic-101 Getting Started

Author:
topic-101 Getting Started

Changing a TOC title must update:

Author outline
topic heading
HTML navigation
generated TOC
cross-reference destinations

without losing topic content.

============================================================
16. TOC MOVE / PROMOTE / DEMOTE
============================================================

Moving a TOC item changes hierarchy only.

It must preserve:

topic ID
topic content
source references
conditions
review findings
Master Page assignment

============================================================
17. TOC ADD / DELETE
============================================================

Adding a TOC topic:

creates corresponding Author topic.

Deleting a topic:

must detect whether content exists.

If content exists:

confirm deletion.

Do not leave orphaned Author topics.

============================================================
18. AUTHOR → TOC CONNECTION
============================================================

Author Outline must render from current TOC hierarchy.

Do not maintain a second independent Author outline structure.

============================================================
19. AUTHOR CONTENT MODEL
============================================================

Each topic contains structured blocks.

Each block has stable ID.

Examples:

paragraph
heading
list
table
procedure
callout
image
code
variable
snippet

Review and Sources must reference these block IDs.

============================================================
20. SOURCE REFERENCES IN AUTHOR
============================================================

Source references attached to Author content must reference real project Source IDs.

View Source from Author must open actual evidence/source context.

============================================================
21. CONDITIONS
============================================================

Conditions attached during Authoring remain semantic metadata on:

text
block
topic

Publish resolves them according to Output Variant.

Theme changes must not remove conditions.

TOC movement must not remove conditions.

============================================================
22. AUTHOR → REVIEW
============================================================

Review must analyze the CURRENT Author content.

Do not use a separate static review document.

Every finding stores:

findingId
topicId
blockId where applicable
findingType
severity
status
evidence

============================================================
23. REVIEW → AUTHOR ROUND TRIP
============================================================

Jump to Content must use:

topicId
blockId

to navigate to the exact Author content.

Fixing content updates the same Content state.

Returning to Review must re-evaluate/update that finding.

Do not copy text into Review and edit it separately.

============================================================
24. REVIEW INVALIDATION
============================================================

If Author content changes after Review completion:

mark Review appropriately:

Changes since last review

Do not continue displaying Review Complete as if nothing changed.

Allow:

Review changes

Do not necessarily force a complete re-review of everything in the prototype.

============================================================
25. REVIEW → PUBLISH
============================================================

Publish reads Review status.

If Review complete:

show current status.

If Author content changed afterwards:

show:

Review may be outdated.

Do not use a disconnected boolean.

============================================================
26. AUTHOR → PUBLISH
============================================================

Publish must always consume current Content state.

Test:

Edit paragraph in Author.

Go directly to Publish.

Preview must show edited paragraph.

Generated files must contain edited paragraph.

No hard-coded content.

============================================================
27. TOC → PUBLISH
============================================================

Current TOC hierarchy must drive:

PDF generated TOC

HTML navigation

topic order

Previous/Next

Do not create a separate Publish navigation list.

============================================================
28. VARIABLES → PUBLISH
============================================================

Resolve Variables at render time.

Same Variable values must be used by:

PDF
Word
HTML

Changing a Variable then regenerating output must show new value.

============================================================
29. CONDITIONS → OUTPUT VARIANT
============================================================

Output Variant selects Condition values.

Publishing filters Content based on those conditions.

It must NOT modify Author content.

============================================================
30. THEME/TEMPLATE → PUBLISH
============================================================

Publish references current:

Theme ID

Brand & Style Profile ID

PDF Layout ID

Word Layout ID

HTML Master Page IDs

Do not copy/freeze styling settings when entering Publish.

If configuration changes:

returning to Publish must render the new configuration automatically.

============================================================
31. HTML MASTER ASSIGNMENT
============================================================

Store:

topicId
masterPageId

Example:

topic-201
→ master-wide-topic

Renaming either topic or Master Page must not break assignment.

============================================================
32. PROJECT NAVIGATION PERSISTENCE
============================================================

Navigate:

Theme
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

Then backwards:

Publish
→ Review
→ Author
→ TOC
→ Analysis
→ Sources
→ Theme

All project state must remain.

No screen should silently reset because it unmounted.

============================================================
33. PROJECT SWITCH SAFETY
============================================================

If multiple projects exist:

switch Project A → Project B.

Every stage must show Project B data.

Switch back to Project A.

Project A state must remain separate.

No cross-project leakage.

============================================================
34. REVISION / STALE STATE MODEL
============================================================

Introduce lightweight revision tracking.

Conceptually maintain:

sourcesRevision
analysisRevision
tocRevision
contentRevision
reviewRevision

Use them to detect stale dependencies.

Examples:

Sources changed
→ Analysis stale

Author changed
→ Review stale

Theme changed
→ output render needs refresh
NOT content stale

============================================================
35. DO NOT OVER-INVALIDATE
============================================================

Changing Theme/Style:

must NOT invalidate Analysis
TOC
Author content
Review content accuracy

unless a Review rule specifically checks formatting/style.

Changing PDF Page Layout:

must affect only Preview/Publish.

============================================================
36. INTEGRATION HEALTH INDICATORS
============================================================

For prototype/debugging create a subtle developer/testing view:

Project Pipeline Status

Project
Theme
Sources
Analysis
TOC
Content
Review
Publish

Show:

Current
Needs refresh
Not configured

This may be hidden behind:

Settings → Project Diagnostics

Do NOT make this a prominent end-user feature.

============================================================
37. DIAGNOSTICS DETAIL
============================================================

Diagnostics may show:

Active Project ID
Active Theme ID
Active Style Profile ID

Sources:
count/revision

Analysis:
source revision used

TOC:
topic count

Content:
topic/block count

Review:
content revision reviewed

Publish:
active output configuration

This is for debugging integration problems.

============================================================
38. FULL PIPELINE ACCEPTANCE TEST
============================================================

Create a clean project:

Pipeline QA

Document Type:
User Guide

Version:
1.0

============================================================
39. TEST — THEME
============================================================

Select Theme A.

Select Style A.

Change H1 color.

Continue through workflow.

VERIFY Author renders Style A.

Later verify Publish uses same Style A.

============================================================
40. TEST — VARIABLE
============================================================

Create:

ProductName = Pipeline Product

Insert ProductName into:

Cover layout
Topic content
HTML Home Master

VERIFY all show:

Pipeline Product

Change to:

Pipeline Product Pro

VERIFY all three update.

============================================================
41. TEST — SOURCES
============================================================

Add Product Source A.

Run Analysis.

VERIFY:

Analysis references Source A.

Add Source B afterwards.

VERIFY:

Analysis becomes Needs Refresh.

============================================================
42. TEST — ANALYSIS
============================================================

Re-analyze.

VERIFY:

current Source A + Source B are used.

Create proposed TOC.

============================================================
43. TEST — TOC
============================================================

Approve TOC.

Rename one topic.

Add one topic.

Move one topic.

VERIFY:

Author Outline immediately reflects all changes.

============================================================
44. TEST — AUTHOR
============================================================

Enter text into newly added topic:

"PIPELINE CONNECTION TEST"

Add Variable ProductName.

Attach a Source reference.

VERIFY:

Source reference links to actual source.

============================================================
45. TEST — REVIEW
============================================================

Run Review.

Create/find a finding in edited topic.

Jump to Author.

VERIFY:

correct Topic and Block selected.

Edit content.

Return to Review.

VERIFY:

same finding updates.

============================================================
46. TEST — REVIEW STALE STATE
============================================================

Complete Review.

Return to Author.

Change text.

Return to Review/Publish.

VERIFY:

system indicates content changed since review.

============================================================
47. TEST — PAGE LAYOUT
============================================================

Change selected PDF Content Layout:

margin
background
footer

Go to Publish.

VERIFY:

PDF Preview uses current layout.

============================================================
48. TEST — HTML MASTER
============================================================

Change Other Topics Master:

navigation width
breadcrumb
footer visibility

Go to Publish HTML Preview.

VERIFY:

same Master configuration renders.

============================================================
49. TEST — MASTER ASSIGNMENT
============================================================

Assign one topic to custom Master Page.

Rename the topic.

VERIFY:

assignment remains.

Rename Master Page.

VERIFY:

assignment remains.

============================================================
50. TEST — PUBLISH CONTENT
============================================================

In Author set paragraph:

"FINAL PIPELINE VALUE 98765"

Go to Publish.

VERIFY:

PDF Preview contains it.

Word Preview contains it.

HTML Preview contains it.

Generate outputs if generation is available.

VERIFY outputs contain:

FINAL PIPELINE VALUE 98765

============================================================
51. TEST — THEME SWITCH
============================================================

Switch Theme A → Theme B.

VERIFY:

content text remains identical.

TOC remains identical.

Sources remain identical.

Review references remain intact.

Presentation changes.

============================================================
52. TEST — NAVIGATION PERSISTENCE
============================================================

Move through every workflow stage forward and backward.

VERIFY:

no data disappears.

No component resets to demo/default values.

============================================================
53. TEST — PROJECT ISOLATION
============================================================

Create second project:

Pipeline QA 2

Change its Theme/Variables/Sources.

Switch between QA 1 and QA 2.

VERIFY:

no state leakage.

============================================================
54. REMOVE FALSE SUCCESS STATES
============================================================

Do not display:

Analysis Complete

Review Complete

Output Ready

when the underlying dependent state is stale or missing.

Status must derive from actual state/revisions.

============================================================
55. FAILURE RULE
============================================================

If any acceptance test reveals that two screens use separate data copies:

refactor them to use the central Project state.

Do not patch synchronization using one-off click handlers.

Fix the shared architecture.

============================================================
56. DO NOT REDESIGN
============================================================

During this pass:

do not redesign screens

do not add decorative features

do not refine typography

do not add additional toolbar functions

Focus entirely on:

state
relationships
data flow
persistence
dependency invalidation
cross-stage navigation

============================================================
57. COMPLETION REPORT
============================================================

Return a pipeline report:

PROJECT DETAILS → THEME
status

THEME → AUTHOR/PUBLISH
status

TEMPLATES → PREVIEW/PUBLISH
status

VARIABLES → CONTENT/PUBLISH
status

SOURCES → ANALYSIS
status

ANALYSIS → TOC
status

TOC → AUTHOR
status

AUTHOR → REVIEW
status

REVIEW → AUTHOR
status

AUTHOR/TOC → PUBLISH
status

MASTER PAGES → HTML
status

STATE PERSISTENCE
status

PROJECT ISOLATION
status

For each:

CONNECTED
PARTIALLY CONNECTED
NOT CONNECTED

List every problem fixed.

List anything still not validated.

============================================================
58. FINAL ARCHITECTURAL PRINCIPLE
============================================================

This must be ONE application pipeline.

Not a sequence of independent demos.

Every stage operates on the same Project.

Upstream changes propagate intentionally.

Human-approved downstream content is never silently overwritten.

Stable IDs preserve relationships.

Preview and Publish consume the same current project configuration.