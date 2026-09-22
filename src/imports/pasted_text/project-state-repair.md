P0 REPAIR PASS — PROJECT STATE, PERSISTENCE AND PROJECT ISOLATION

Perform an architecture repair only.

Do NOT redesign the UI.
Do NOT add new features.
Do NOT work on AI Analysis, Review or Publish fidelity yet.

The exported application has several critical project-state problems that must be fixed before real-scenario testing.

============================================================
1. CENTRAL PROJECT STATE MUST BE AUTHORITATIVE
============================================================

Anything that belongs to a project must have one authoritative project-level state.

Screen-local state may be used for:

open/closed modal
hover
temporary draft input
current selected tab

but NOT as the only storage for project data.

Project-owned information includes:

Project Details
Theme
Brand & Style Profiles
brand assets
Variables
Page Layouts
HTML Master Pages
Master Page blocks/properties
Sources
Analysis results
TOC
all topic content
Conditions
Snippets
Comments where applicable
Review state
Publish configuration

============================================================
2. FIX NEW PROJECT CREATION
============================================================

Clicking + New Project from the Projects dashboard must start a CLEAN project.

Currently an existing projectId can cause project creation to return without creating another project.

Implement:

startNewProject()

It must reset active project-specific state BEFORE displaying Project Details.

Set:

projectId = null
projectName = ''
isDemoMode = false

reset analysis
reset TOC
reset Author content
reset review
reset Sources
reset Theme project selections
reset project-specific variables/layouts/master assignments

Do not carry project A state into project B.

Do not delete reusable global platform defaults if they are intentionally global.

============================================================
3. PROJECT ISOLATION
============================================================

When opening a saved project:

replace ALL project-scoped state with the loaded project's state.

Do not use logic such as:

"only replace this array when saved array has items"

because an intentionally empty array is valid project state.

Project A → Project B → Project A must restore each independently.

============================================================
4. FIX SOURCE FILE PERSISTENCE
============================================================

Initial files uploaded in Sources must be saved through ProjectRepository.

Do not wait until a file is added from Analysis.

When a real source file is added:

create StoredFile
persist Blob
store stable fileId
associate fileId with projectId
increment sourcesRevision

When removed:

remove it from project source state
remove its stored file/blob where appropriate
increment sourcesRevision

Do not use filename as the relationship key.

Use fileId.

============================================================
5. SOURCES SCREEN MUST BE CONTROLLED BY PROJECT STATE
============================================================

SourcesScreen must receive the active project's current source files.

Returning:

Analysis → Sources

must show the same uploaded files.

Reloading the application and reopening the project must show the same files.

Do not initialize Sources as an empty independent local file list.

============================================================
6. REPLACE FRAGILE AUTOSAVE
============================================================

The current pattern can call autosave immediately after setState and save the previous render's value.

Refactor autosave so it always saves the LATEST project state.

Preferred architecture:

central project state / reducer

plus

latestProjectRef

or a useEffect-based debounced persistence layer that reacts to committed project state.

Do not create a timer that closes over an obsolete ProjectRecord snapshot.

============================================================
7. NAVIGATION SAVE SAFETY
============================================================

Before switching workflow stages:

flush any pending project save when necessary.

Normal successful autosave should keep navigation immediate.

If the save fails:

do not silently lose the change.

Show Save failed and allow Retry.

============================================================
8. AUTHOR CONTENT MODEL
============================================================

Remove the assumption that one docBlocks array represents the whole document.

Persist content by stable topic ID.

Use a structure conceptually like:

contentTopics = {
  topicId: {
    blocks: [...]
  }
}

Every TOC topic has one stable topicId.

Author opening another topic switches the displayed blocks but does NOT destroy other topic content.

All topics persist after:

navigation
refresh
close/reopen
project switching

============================================================
9. REMOVE NEXUS INITIAL AUTHOR CONTENT FROM REAL PROJECTS
============================================================

A real newly-created project must NOT automatically load Nexus documentation in Author.

Demo/sample content may exist only when explicit Demo Mode is active.

When a real TOC topic has no authored content:

show an empty topic/scaffold based on that topic's title.

Do not inject Nexus paragraphs, tables, procedures or warnings.

============================================================
10. RESTORE SAVED AUTHOR CONTENT
============================================================

When a saved project is loaded:

Author must hydrate from the saved topic content.

Do not initialize hard-coded blocks and then overwrite the restored ProjectRecord.

Test using unique text:

PERSISTENCE-AUTHOR-98765

Reload.

It must remain exactly.

============================================================
11. TOC AND AUTHOR MUST USE THE SAME TOC
============================================================

Remove the independent Author studioToc copy as the authoritative TOC.

Author Outline edits must update shared appToc using stable topic IDs.

Rename a topic in Author:

TOC screen must show new name.

Move a topic:

TOC screen and Publish navigation must reflect it.

Content associated with the topic ID must remain intact.

============================================================
12. BRAND & STYLE PROFILES MUST BE PROJECT STATE
============================================================

BrandingScreen currently maintains localProfiles separately from themes/project state.

Fix this.

Creating, importing, editing, renaming or duplicating a profile must update central project Theme/Profile state.

After leaving Theme & Styles and returning:

profile must remain.

After reload:

profile must remain.

Publish must be able to resolve the active profile by ID.

============================================================
13. BRAND ASSETS
============================================================

Persist accepted/uploaded logo assets as project data/file references.

Do not reduce an accepted logo to initials generated from the filename.

============================================================
14. HTML MASTER PAGE BUILDER STATE
============================================================

masterBlocksMap and blockPropsMap must not exist only locally inside BrandingScreen.

Persist the visual Master Page definition as part of the HtmlMasterPage model.

Each Master Page should persist:

blocks
order
component type
component properties
layout properties
responsive properties
visibility

Reload and verify exact composition remains.

============================================================
15. PAGE LAYOUT / HTML MASTER AUTOSAVE
============================================================

Changing:

Page Layout
HTML Master Page
Theme
active Style Profile

must trigger real project persistence.

Do not depend on an unrelated later action to happen to save them.

============================================================
16. EXTEND PROJECT RECORD
============================================================

Update ProjectRecord so it can persist the project data actually used by the app.

At minimum include the newly centralized:

topicContent
conditions
snippets if implemented
comments if project-owned
brand/style profiles
brand asset references
HTML master blocks/properties
publish configuration where already implemented

Do not keep critical project data only inside component state.

Increment schemaVersion if the stored model changes.

============================================================
17. CLEAN PROJECT ACCEPTANCE TEST
============================================================

Create:

PROJECT ALPHA

Variable:
ProductName = ALPHA PRODUCT

Upload:
AlphaSource.docx

Create TOC topic:
Alpha Topic

Author text:
ALPHA-CONTENT-98765

Create/import Style Profile:
Alpha Brand

Modify one Page Layout.

Modify one HTML Master Page.

Reload app.

PASS only if all items remain.

============================================================
18. PROJECT ISOLATION ACCEPTANCE TEST
============================================================

Then create:

PROJECT BETA

Variable:
ProductName = BETA PRODUCT

Topic:
Beta Topic

Author text:
BETA-CONTENT-54321

Switch:

ALPHA → BETA → ALPHA → BETA

VERIFY:

no variables leak
no TOC leaks
no content leaks
no Sources leak
no Theme/Profile changes leak
no Master Page changes leak

============================================================
19. DO NOT FIX THESE YET
============================================================

Do not redesign:

Analysis
Review
Knowledge Map
PDF generation
DOCX generation
HTML generation

except where required to stop those screens from corrupting central project state.

Those will be separate repair passes.

============================================================
20. COMPLETION REPORT
============================================================

Report:

New Project clean initialization
PASS / FAIL

Project A/B isolation
PASS / FAIL

Initial Source persistence
PASS / FAIL

Source reload
PASS / FAIL

Autosave latest-state correctness
PASS / FAIL

Author multi-topic persistence
PASS / FAIL

Saved Author hydration
PASS / FAIL

TOC ↔ Author shared IDs/state
PASS / FAIL

Imported profile persistence
PASS / FAIL

Brand asset persistence
PASS / FAIL

HTML Master composition persistence
PASS / FAIL

Page Layout persistence
PASS / FAIL

Also list any project-owned state that remains local-only.

Do not claim PASS because navigation worked in memory.

Persistence tests must survive a full reload.