PROJECT PERSISTENCE — REAL SCENARIO FOUNDATION

STOP FEATURE DEVELOPMENT.

The application pipeline is now largely connected, but newly created projects are not being saved.

This prevents realistic end-to-end testing.

Implement REAL PROJECT PERSISTENCE for the prototype before making any further UI or feature improvements.

Do not redesign existing screens.

============================================================
GOAL
============================================================

A user must be able to:

Create a project
Work through the complete workflow
Leave the project
Reload/close the application
Return later
Open the project
Continue exactly where they stopped

The following must persist:

Project Details
Theme selection
Brand & Style Profile
Theme overrides
Variables
Page Layouts
HTML Master Pages
Master Page assignments
Sources
Analysis
Analysis revisions
TOC
TOC revisions
Author content
Conditions
Source references
Review findings/status
Review revisions
Publish configuration
Output variants
Pipeline stale states

============================================================
1. PROJECT REPOSITORY
============================================================

Create a central ProjectRepository abstraction.

Do NOT let individual screens save independently.

Use methods conceptually like:

createProject()

saveProject()

loadProject()

listProjects()

deleteProject()

duplicateProject()

saveFile()

loadFile()

All screens continue to operate on shared active project state.

Persistence happens through the repository layer.

This is important because production storage can later replace browser storage without rewriting the application.

============================================================
2. BROWSER PERSISTENCE
============================================================

For this Figma Make prototype use browser persistence.

Use:

IndexedDB

for persistent project state and binary uploaded files.

Do not rely only on React state.

Do not rely only on sessionStorage.

Do not store uploaded File objects only in memory.

Do not use localStorage for large files.

Small settings may use localStorage if necessary, but IndexedDB should be the primary persistence layer.

============================================================
3. PROJECT ID
============================================================

Every project must receive a stable unique projectId when created.

Example:

project-<unique-id>

The ID must never change when:

project is renamed

Theme changes

TOC changes

content changes

Project names are display values, NOT relationship keys.

============================================================
4. CREATE PROJECT
============================================================

When the user creates a project:

immediately create its persisted project record.

Do not wait until Publish.

Initialize:

projectId
projectName
documentType
version
createdAt
modifiedAt
project schema version

Then open that saved project.

============================================================
5. AUTOSAVE
============================================================

Implement automatic saving.

When project state changes:

show briefly:

Saving…

then:

Saved

Use sensible debounce behavior so every keystroke does not cause expensive writes.

Example:

save approximately 500–1000 ms after the last change.

Important actions such as:

leaving a screen
uploading a source
changing Theme
approving TOC
running Analysis
completing Review

should ensure pending state is persisted.

============================================================
6. SAVE STATUS
============================================================

Add a subtle project save status in the application header:

Saving…
Saved
Save failed

Do not create intrusive notifications for every autosave.

If save fails:

show clear retry action.

Never display Saved unless persistence succeeded.

============================================================
7. PROJECT HOME / PROJECT LIST
============================================================

Add or fix the project home screen.

Show saved projects.

Each project card/list entry includes:

Project Name
Content Type
Version
Last Modified

Actions:

Open
Duplicate
Delete

Primary action:

+ New Project

Sort by:

Last Modified

most recent first.

============================================================
8. OPEN PROJECT
============================================================

When a saved project is opened:

load the COMPLETE project state.

Hydrate shared App state before rendering project workflow screens.

Do not initialize screens with sample/default state after loading.

Show a brief loading state:

Opening project…

============================================================
9. NAVIGATION
============================================================

Leaving one stage must not reset anything.

Example:

Theme
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

Backwards navigation must also preserve state.

============================================================
10. RELOAD TEST
============================================================

Create:

Project Name:
REAL-SCENARIO-TEST

Version:
1.0

Create Variable:

ProductName =
ORION-REAL-98765

Navigate through several screens.

Reload the browser/application.

PASS only if:

REAL-SCENARIO-TEST remains available.

Open it.

PASS only if ProductName remains:

ORION-REAL-98765

============================================================
11. FILE PERSISTENCE
============================================================

Uploaded source files must persist across reload.

Store:

file ID
filename
MIME type
size
upload timestamp
binary Blob/File data where browser environment permits

Analysis/source records reference sourceFileId.

Do not reference temporary browser object URLs as permanent storage.

Generate object URLs only when needed for viewing and revoke them appropriately.

============================================================
12. FILE RELOAD TEST
============================================================

Upload a real PDF or DOCX.

Navigate away.

Reload app.

Open project.

PASS only if:

source still appears
filename remains correct
file can still be accessed by the application

Do not report file persistence as working if only metadata survives.

============================================================
13. THEME PERSISTENCE
============================================================

Change:

Theme
Brand & Style Profile
Variable
Page Layout
HTML Master Page

Reload application.

Open project.

PASS only if all selections and modifications remain.

============================================================
14. PAGE LAYOUT PERSISTENCE
============================================================

Create:

Custom Content Layout

Change:

margins
background
logo placement

Reload application.

PASS only if:

layout exists
settings remain
layout remains assigned

============================================================
15. HTML MASTER PERSISTENCE
============================================================

Duplicate Home Page Master.

Rename:

REAL TEST HOME

Add/reorder components.

Reload.

PASS only if:

master exists
components remain
ordering remains
properties remain

============================================================
16. ANALYSIS PERSISTENCE
============================================================

Run Analysis.

Persist:

analysis results
analysisRevision
sourcesRevision used
analysis status

Reload.

PASS only if Analysis results remain.

Do not silently re-create a different mock result during load.

============================================================
17. ANALYSIS STALE STATE
============================================================

After saved Analysis:

add another Source.

Persist.

Reload.

PASS only if:

new source remains

AND

Analysis still shows:

Sources changed since last analysis

The stale state must survive reload.

============================================================
18. TOC PERSISTENCE
============================================================

Generate/approve TOC.

Modify:

rename topic
move topic
add topic

Reload.

PASS only if exact hierarchy returns.

Topic stable IDs must remain identical.

============================================================
19. AUTHOR CONTENT PERSISTENCE
============================================================

Enter this unique text:

REAL-AUTHOR-CONTENT-54321

Add:

paragraph
list
callout
table where available
Variable reference

Reload.

PASS only if content remains exactly.

Do not regenerate authored content on load.

============================================================
20. REVIEW PERSISTENCE
============================================================

Run Review.

Persist:

findings
finding IDs
topic/block references
status
reviewRevision

Resolve/dismiss one finding.

Reload.

PASS only if states remain.

============================================================
21. PUBLISH CONFIGURATION PERSISTENCE
============================================================

Save:

Output Variant
PDF Page Layout
Word Page Layout
HTML Home Master
HTML Topic Master
Conditions

Reload.

PASS only if Publish uses the same configuration.

============================================================
22. DUPLICATE PROJECT
============================================================

Duplicate:

REAL-SCENARIO-TEST

Create:

REAL-SCENARIO-TEST Copy

Deep copy project state.

Generate NEW:

projectId

Keep copied:

Theme
variables
sources
TOC
content
configuration

Changing copy must not modify original.

============================================================
23. DELETE PROJECT
============================================================

Delete requires confirmation.

Deleting one project must remove:

project record
associated persisted project data
associated stored files

Do not affect other projects.

============================================================
24. PROJECT ISOLATION
============================================================

This now becomes testable.

Create:

PROJECT A

ProductName:
ALPHA

Create:

PROJECT B

ProductName:
BETA

Switch A → B → A.

PASS only if:

A always shows ALPHA

B always shows BETA

No cross-project state leakage.

============================================================
25. CURRENT ACTIVE PROJECT
============================================================

Remember active project where practical.

If application reloads while a project is open:

either reopen that project automatically

OR

return to Project Home with the project available.

Do not silently create a blank project.

============================================================
26. SCHEMA VERSION
============================================================

Persist:

schemaVersion

Example:

1

This prepares for future project-data migrations as the prototype evolves.

Do not overengineer migrations yet.

============================================================
27. DEFAULT / DEMO DATA
============================================================

Demo data must never leak into a real project.

Use explicit distinction:

Demo Project

vs

User-created Project

A new user-created project must not silently inherit:

Nexus
Orion sample text
sample TOC
sample Sources
sample Review findings

unless intentionally selected as a template/sample project.

============================================================
28. ERROR HANDLING
============================================================

Handle:

IndexedDB unavailable
write failure
file write failure
project load failure
corrupted project record

Show useful messages.

Do not silently reset the project to defaults if loading fails.

============================================================
29. ACTUAL SCENARIO ACCEPTANCE TEST
============================================================

Create:

REAL PRODUCT USER GUIDE

Version:
1.0

Set:

ProductName =
REAL PRODUCT

Configure Theme.

Configure Page Layout.

Configure HTML Master Page.

Upload real source documents.

Run Analysis.

Generate TOC.

Approve TOC.

Author at least one topic.

Run Review.

Configure Publish.

Then:

reload the application.

Open:

REAL PRODUCT USER GUIDE

Verify every stage from:

Theme
→ Variables
→ Templates
→ Sources
→ Analysis
→ TOC
→ Author
→ Review
→ Publish

contains the saved project data.

============================================================
30. PIPELINE TEST AFTER RELOAD
============================================================

After reopening the project:

change ProductName:

REAL PRODUCT
→ REAL PRODUCT ENTERPRISE

VERIFY:

Author variable references update.

Cover preview updates.

HTML Home Master variable references update.

Publish preview uses latest value where implemented.

This proves loaded state remains connected.

============================================================
31. DO NOT FAKE PERSISTENCE
============================================================

Do NOT merely:

keep React components mounted

store everything in module globals

use temporary variables

claim persistence because navigation works

Real persistence must survive a full page reload.

============================================================
32. DO NOT REDESIGN
============================================================

Do not improve UI styling during this task.

Do not add unrelated features.

Focus on:

Project saving
Project loading
Autosave
Files
State hydration
Isolation
Persistence
Error handling

============================================================
33. COMPLETION REPORT
============================================================

Return:

PROJECT CREATE
PASS / FAIL

PROJECT AUTOSAVE
PASS / FAIL

RELOAD PERSISTENCE
PASS / FAIL

SOURCE FILE PERSISTENCE
PASS / FAIL

THEME/TEMPLATE PERSISTENCE
PASS / FAIL

VARIABLE PERSISTENCE
PASS / FAIL

ANALYSIS PERSISTENCE
PASS / FAIL

TOC PERSISTENCE
PASS / FAIL

AUTHOR CONTENT PERSISTENCE
PASS / FAIL

REVIEW PERSISTENCE
PASS / FAIL

PUBLISH CONFIGURATION PERSISTENCE
PASS / FAIL

PROJECT DUPLICATION
PASS / FAIL

PROJECT ISOLATION
PASS / FAIL

Also report any capability that could not be validated.

Do not mark PASS unless reload was actually tested.

============================================================
FINAL PRINCIPLE
============================================================

A Project is a persistent unit of work.

Users should never lose their work simply because they:

navigate
refresh
close
reopen

All workflow stages belong to the same persisted project.