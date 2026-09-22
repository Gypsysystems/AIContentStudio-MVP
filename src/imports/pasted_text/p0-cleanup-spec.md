FINAL P0 CLEANUP — SOURCE IDS + AUTHOR CONTENT SYNCHRONIZATION

Do not redesign anything.
Do not work on Analysis, Review, Publish rendering or new AI features.

The previous architecture repair is mostly successful.

Fix only the remaining P0 defects below.

====================================================
1. USE STABLE SOURCE IDS AS THE DATA MODEL
====================================================

The current implementation still stores source identity as:

filename → fileId

inside sourceFileIdMapRef.

This is not a stable source model.

Replace this with an explicit project source structure.

For example:

type ProjectSource = {
  fileId: string
  file: File
}

or equivalent.

App-level source state must retain the stable fileId together with the browser File.

Do NOT use filename as:

identity
lookup key
relationship key
deletion key

Filename is display metadata only.

====================================================
2. SOURCE ADD
====================================================

When adding a source:

save the Blob using ProjectRepository.

Receive:

fileId

Then add:

{
  fileId,
  file
}

to project source state.

If the same filename is uploaded twice:

do not silently assume it is the same file.

Use fileId identity.

The UI may decide whether duplicate filenames are allowed or warn the user,
but persistence must not collide because of filename.

====================================================
3. SOURCE HYDRATION
====================================================

When reopening a project:

load StoredFile records from IndexedDB.

Reconstruct:

ProjectSource {
  fileId,
  file
}

Do not rebuild a separate filename → ID map.

====================================================
4. SOURCE REMOVE
====================================================

When removing a source:

use:

source.fileId

directly with:

removeFile(fileId)

Then remove that ProjectSource from App state.

Acceptance:

Upload two files with the same filename but different content if technically possible.

Removing one must not delete the other.

====================================================
5. SOURCE FILE IDS IN PROJECT RECORD
====================================================

ProjectRecord.sourceFileIds must derive directly from:

sources.map(source => source.fileId)

Do not derive IDs from Object.values of a filename map.

====================================================
6. AUTHOR ACTIVE TOPIC MUST SYNCHRONIZE CONTINUOUSLY
====================================================

The active Author topic currently maintains local:

docBlocks

while central project state contains:

topicContent

Ensure every committed document-block update also updates:

topicContent[activeTopicId]

Do not wait until the author switches topics.

Whenever docBlocks changes for an active topic:

synchronize the latest blocks to central topicContent.

Avoid infinite render loops.

A useEffect keyed to:

docBlocks
activeTopicId

is acceptable if implemented safely.

====================================================
7. CONTENT REVISION
====================================================

When actual Author content changes:

increment contentRevision once for the meaningful content update.

Do not increment contentRevision just because a topic was opened or hydrated.

Review stale detection must therefore reflect real edits.

====================================================
8. REMOVE SYNTHETIC NEXUS SOURCE GENERATION FROM REAL PROJECTS
====================================================

StudioScreen still contains hard-coded source generation data for:

Nexus Technical Specification
Nexus API
Nexus support
Nexus authentication
Nexus dashboard
etc.

This must never execute for a normal project.

For real projects:

"Generate content from sources"

must NOT fabricate content.

Until the real Sources/Analysis pipeline is implemented:

if no actual source-generation service is connected, show:

"Source-based content generation is not yet available for this project."

or:

"No supported source evidence is available for this topic."

Demo Mode may retain Nexus synthetic generation.

Move all Nexus synthetic sourceMap logic behind:

isDemoMode === true

====================================================
9. VERIFY OTHER NEXUS REAL-PROJECT PATHS
====================================================

Search for Nexus references.

Nexus data may remain only in explicitly isolated demo fixtures.

Do not allow Nexus content to appear in:

real Author AI suggestions
real source generation
real Preview
real Publish
real Review

unless Demo Mode is active.

====================================================
10. ACCEPTANCE TEST
====================================================

Create a non-demo project.

Upload a source.

Verify source has a stable fileId.

Reload.

Verify same fileId relationship is restored.

Remove it.

Verify correct StoredFile is deleted.

Then create two Author topics.

Write:

TOPIC-A-NEW-CONTENT-111

and immediately navigate to Review without switching topics.

Reload project.

Return to Topic A.

PASS only if:

TOPIC-A-NEW-CONTENT-111

is still present.

Finally create a topic named:

Authentication

Use any current source-generation control.

PASS only if Nexus content does NOT appear.

====================================================
COMPLETION REPORT
====================================================

Report:

Stable ProjectSource model
PASS / FAIL

Filename no longer used as identity
PASS / FAIL

Source removal by fileId
PASS / FAIL

Author active-topic continuous sync
PASS / FAIL

contentRevision tracks real edits
PASS / FAIL

Nexus source generation isolated to Demo Mode
PASS / FAIL