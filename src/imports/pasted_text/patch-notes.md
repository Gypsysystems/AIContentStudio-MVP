FINAL P0 PATCH — SOURCE ID SAFETY, CONTENT REVISION, AND DEMO ISOLATION

Do NOT redesign the application.
Do NOT implement real Analysis, Review AI, or final publishing yet.
Do NOT change the established central project architecture.

Fix only the remaining issues below.

============================================================
1. SOURCES SCREEN MUST USE PROJECTSOURCE
============================================================

The App correctly has:

ProjectSource {
  fileId
  file
}

but SourcesScreen still works primarily with File[].

Fix this.

SourcesScreen must receive the project's ProjectSource[].

Do not reconstruct ProjectSource objects later by matching File object references.

The source UI entry must retain its stable fileId.

============================================================
2. FILE IS READY ONLY AFTER PERSISTENCE
============================================================

Currently the UI can mark a file Ready before saveFile() has completed.

Fix this race.

When adding a file:

1. show Adding
2. await IndexedDB saveFile()
3. receive fileId
4. add ProjectSource { fileId, file }
5. only then show Ready

The Analyze button must not become available while any source is still being persisted.

============================================================
3. ANALYZE MUST NOT REBUILD SOURCES
============================================================

When the user selects Analyze:

do NOT call setSources() using File[].

Do NOT create:

fileId: ''

Do NOT look up source identity by File object equality.

Sources are already centrally persisted.

Analyze should use the existing ProjectSource state and navigate.

============================================================
4. REMOVE SOURCE BY FILEID DIRECTLY
============================================================

SourcesScreen must call removal using:

fileId

not only:

File

Change the callback conceptually to:

onFileRemove(fileId)

Then:

removeFile(fileId)

and:

setSources(prev =>
  prev.filter(source => source.fileId !== fileId)
)

No filename lookup.
No File-reference lookup.

============================================================
5. DUPLICATE FILENAMES
============================================================

Filename is display metadata only.

It must never be source identity.

If the UI does not allow two files with the same filename,
show a clear duplicate-file warning.

Do not silently discard the second file.

============================================================
6. AUTHOR — ALL REAL CONTENT MUTATIONS MUST MARK CONTENT CHANGED
============================================================

The active-topic synchronization is now correct.

Keep it.

However, several direct setDocBlocks() operations change authored content without notifying:

onContentEdit

Fix this systematically.

Create a shared mutation approach so every USER content change:

updates docBlocks
and
calls onContentEdit exactly as appropriate.

Cover at least:

insert block
delete block
convert block
undo
redo
find/replace
topic title edits
suggested title application
manual content editing
AI content insertion
source excerpt insertion
list conversions
selected-block deletion
table/list/procedure structural edits

Do NOT increment contentRevision when:

opening a topic
hydrating saved content
switching topics
loading the project

============================================================
7. KEEP HYDRATION SEPARATE FROM EDITS
============================================================

Opening an existing topic and loading:

topicContent[topicId]

must not make Review stale.

Creating/loading the initial H1 scaffold alone should not create repeated revision increments.

Only meaningful user modifications should mark content changed.

============================================================
8. REMOVE NEXUS FROM NON-DEMO AUTHOR UI
============================================================

Search all Author/Studio code for Nexus fixtures.

Nexus data may remain only inside explicit:

isDemoMode === true

paths.

For a normal project:

the All Topics heading must use current project/document information,
not "Nexus Platform v3.2".

Project-wide Find/Search must search:

current TOC
current topicContent

not a hard-coded PROJECT_CONTENT Nexus array.

============================================================
9. REMOVE NEXUS FROM NON-DEMO REVIEW
============================================================

Review still contains Nexus topics, excerpts and source names.

Do not implement the real AI Review pipeline in this patch.

Instead:

if real review data is not connected yet,
show a neutral real-project state such as:

"AI Review has not been run for this project."

Never show Nexus findings or Nexus source evidence in a normal project.

Nexus review fixtures may remain only in Demo Mode.

============================================================
10. REMOVE NEXUS FROM NON-DEMO PREVIEW
============================================================

Preview currently contains hard-coded Nexus content.

For a real project, Preview must not show it.

Where practical, use:

projectName
current TOC
current topicContent
active Theme

If the full live Preview is not yet implemented,
show a neutral:

"Full document preview is not yet available for this project."

Do NOT display Nexus as fallback data.

Nexus Preview is permitted only in Demo Mode.

============================================================
11. VERIFY ALL NEXUS REFERENCES
============================================================

Search App.tsx for:

Nexus

Every remaining Nexus reference must either:

A. be inside an explicit Demo Mode data path

or

B. be harmless placeholder/example text in a form field

It must never be rendered as actual data for a normal project.

============================================================
12. ACCEPTANCE TEST
============================================================

Create a non-demo project:

Asteria Operations Hub User Guide

Upload one source.

Verify:

Adding
→ IndexedDB save completes
→ stable fileId assigned
→ Ready

Immediately select Analyze.

Verify the source still has the same non-empty fileId.

Return to Sources.

Remove the source.

Verify the StoredFile is removed by that exact ID.

Then create a topic and edit it.

Verify contentRevision changes.

Reload.

Verify the topic content remains.

Simply opening that topic again must NOT increment contentRevision.

Finally visit:

Author
Review
Preview

and search the visible UI for:

Nexus

PASS only if no Nexus project content appears.

============================================================
COMPLETION REPORT
============================================================

Report:

SourcesScreen uses ProjectSource
PASS / FAIL

Ready only after persistence
PASS / FAIL

Analyze preserves fileId
PASS / FAIL

Removal passes fileId directly
PASS / FAIL

Duplicate filename handling
PASS / FAIL

All Author mutations notify content edit
PASS / FAIL

Hydration does not increment contentRevision
PASS / FAIL

Author Nexus isolation
PASS / FAIL

Review Nexus isolation
PASS / FAIL

Preview Nexus isolation
PASS / FAIL