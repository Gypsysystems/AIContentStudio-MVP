P0 COMPLETION REPAIR — FIX THE ITEMS THAT REMAIN LOCAL OR DISCONNECTED

This is a correction to the previous Project State repair.

Do NOT redesign the UI.
Do NOT work on Analysis, AI Review or output-generation quality.
Do NOT add new product features.

Several P0 items from the previous repair remain incomplete.

Fix the EXISTING implementation.

============================================================
1. AUTHOR — REMOVE LOCAL DOCUMENT OWNERSHIP
============================================================

StudioScreen still contains:

INITIAL_DOC_BLOCKS
docBlocks local initialization from INITIAL_DOC_BLOCKS
topicBlocks local state

This is incorrect for a real project.

Move authoritative per-topic content to App-level project state.

Use project-owned state conceptually like:

topicContent: Record<string, DocBlock[]>

Do not keep it only in a ref if Author changes need to trigger React rendering and persistence.

StudioScreen must receive:

topicContent
onTopicContentChange

When opening a topic:

load blocks using the stable topic ID.

If no content exists:

create only a minimal scaffold using the current topic title.

Example:

Heading 1 = current topic title

Do NOT populate real projects with Nexus content.

Nexus sample Author content may exist ONLY when explicit Demo Mode is enabled.

============================================================
2. SAVED AUTHOR HYDRATION
============================================================

When a project is reopened:

ProjectRecord.topicContent
→ App topicContent state
→ StudioScreen

must restore every topic exactly.

Do not initialize hard-coded blocks and then send them back to App.

Acceptance:

Create topic A:
ALPHA-TOPIC-CONTENT-98765

Create topic B:
SECOND-TOPIC-CONTENT-54321

Reload application.

Open both topics.

Both values must remain exactly.

============================================================
3. TOC AND AUTHOR MUST USE ONE TOC
============================================================

StudioScreen still creates:

studioToc

as an independent authoritative TOC.

Remove that architecture.

The Author outline must use the central appToc.

Pass:

toc
onTocChange

into StudioScreen.

Renaming, moving, adding or deleting a topic inside Author must update appToc using the same stable topic ID.

Do not regenerate IDs when renaming or moving.

Topic content must remain associated with the same ID.

============================================================
4. CENTRALIZE BRAND & STYLE PROFILES
============================================================

BrandingScreen still owns:

localProfiles

This violates project-state architecture.

Remove localProfiles as the authoritative store.

Style Profiles must live inside the central Theme/project state.

Add an App-level themes update callback.

Actions including:

Import Profile
Create Profile
Duplicate Profile
Rename Profile
Edit Profile

must update:

themes[].styleProfiles

in central project state.

The active Style Profile must be resolved by ID from central state.

Leaving Theme & Styles and returning must retain the profile.

Reload must retain it.

Publish must be able to resolve the same profile.

============================================================
5. PERSIST BRAND LOGOS
============================================================

logoDataUrls currently exists only inside BrandingScreen.

Persist the selected/uploaded logo as project-owned Brand Profile / Style Profile data.

For this prototype it is acceptable to store:

logoFileName
logoMimeType
logoDataUrl

inside the persisted profile.

Do not reduce an imported logo to filename initials.

Reload must restore the actual selected logo.

============================================================
6. HTML MASTER PAGE BUILDER
============================================================

Remove local-only ownership of:

masterBlocksMap
blockPropsMap

Extend HtmlMasterPage so each master stores its own composition.

Conceptually:

HtmlMasterPage {
  ...
  blocks: MasterBlock[]
}

Each MasterBlock may contain:

id
type
label
props

Block order and block properties must be stored inside the HtmlMasterPage itself.

Dragging/reordering/editing a block must call the central
onHtmlMasterPagesChange callback.

Reload must reproduce the exact master composition.

============================================================
7. PAGE LAYOUT AND MASTER AUTOSAVE
============================================================

App currently passes raw:

setPageLayouts
setHtmlMasterPages
setActiveStyleProfileId

to BrandingScreen.

Replace these with project-aware handlers such as:

handlePageLayoutsChange
handleHtmlMasterPagesChange
handleActiveStyleProfileChange
handleThemesChange

Each handler must:

update central state
trigger project autosave

Do not depend on another unrelated action to eventually cause persistence.

============================================================
8. FIX SOURCE FILE ID OWNERSHIP
============================================================

The current sourceFileIdMap is inconsistent.

Files are stored using filename as the map key when uploaded,
but hydration stores fileId as the map key.

This causes removal after reload to fail.

Do NOT use filename as the relationship key.

Represent project Sources using a stable model such as:

ProjectSource {
  fileId
  file
}

or equivalent.

The UI may still display File objects.

All persistence operations must use fileId.

After reload:

remove a source

VERIFY its IndexedDB StoredFile is deleted using its fileId.

============================================================
9. NAVIGATION SAVE SAFETY
============================================================

navigate() currently switches screen immediately.

Implement:

persistCurrentProject()

which:

clears any pending autosave timer
builds the latest ProjectRecord
saves it
returns success/failure

When moving between workflow stages:

if there is a pending project save,
flush it before completing navigation.

If persistence fails:

remain on the current stage
show:

"Your latest changes could not be saved."

Provide Retry.

Successful autosave must not show confirmation dialogs.

============================================================
10. CONDITIONS / SNIPPETS / COMMENTS
============================================================

These are currently project-owned concepts but remain local in StudioScreen.

Move implemented data to central project state:

conditions
snippets
comments

Persist them in ProjectRecord.

Remove Nexus-specific default snippets from real projects.

Demo defaults may exist only in Demo Mode.

============================================================
11. PUBLISH CONFIGURATION
============================================================

Persist the implemented project publishing selections:

selectedFormats
activeVariant

as:

publishConfig

in ProjectRecord.

Temporary generated Blob objects do NOT need persistence.

============================================================
12. SCHEMA VERSION
============================================================

The data model has changed.

Currently:

projectRepository.ts says SCHEMA_VERSION = 1

while App writes schemaVersion = 2.

Fix this inconsistency.

Use one schema version constant.

Update existing records safely by applying defaults for newly added fields.

Do not delete existing browser projects.

============================================================
13. VERIFY NO REAL-PROJECT NEXUS INJECTION
============================================================

Search the application for Nexus sample content.

Nexus data may remain only inside explicitly isolated Demo Mode fixtures.

It must NOT initialize:

Author
TOC
Snippets
Conditions
Sources
Preview
real project content

simply because a new project is created.

============================================================
14. ACCEPTANCE TEST
============================================================

Create:

PROJECT ALPHA

Create two TOC topics.

Topic 1:
ALPHA-CONTENT-98765

Topic 2:
ALPHA-CONTENT-SECOND-54321

Import/create:
Alpha Brand

Upload:
Alpha Logo

Modify:
one Page Layout

Modify:
one HTML Master Page by adding/reordering a block

Create:
one custom Condition
one Snippet
one Comment

Select a Publish format.

Upload one Source.

Reload application.

VERIFY every item remains.

Then create:

PROJECT BETA

Verify none of ALPHA's:

topics
content
brand profiles
logo
sources
layout modifications
master composition
conditions
snippets
comments

appear in BETA.

Switch:

ALPHA → BETA → ALPHA

and verify isolation again.

============================================================
15. COMPLETION REPORT
============================================================

Report:

Author per-topic central state
PASS / FAIL

Author reload hydration
PASS / FAIL

Nexus removed from real project initialization
PASS / FAIL

TOC ↔ Author shared state
PASS / FAIL

Brand Profile central persistence
PASS / FAIL

Actual logo persistence
PASS / FAIL

HTML Master block persistence
PASS / FAIL

Page Layout autosave
PASS / FAIL

Source stable file IDs
PASS / FAIL

Source removal after reload
PASS / FAIL

Navigation save flush
PASS / FAIL

Conditions persistence
PASS / FAIL

Snippets persistence
PASS / FAIL

Comments persistence
PASS / FAIL

Publish configuration persistence
PASS / FAIL

Schema version consistency
PASS / FAIL

Also identify any project-owned state that still exists only inside a screen component.

Do not mark an item PASS merely because it survives navigation in memory.

Persistence tests must survive a full browser reload.