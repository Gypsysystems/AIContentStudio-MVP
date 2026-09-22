FIX ONLY THE ANALYSIS → TOC PIPELINE CONNECTION

Do not redesign any screens.

Do not modify Theme, Templates, Variables, Author, Review, or Publish unless required to preserve the existing shared state.

The pipeline audit found:

Analysis → TOC = PARTIALLY CONNECTED

Reason:
Analysis calls onAnalysisDone() and records analysisRevision, but TOC still starts from hard-coded initial items.

This must be fixed.

============================================================
1. REMOVE HARDCODED TOC INITIALIZATION
============================================================

The TOC must no longer initialize from a fixed hard-coded topic list for a normal project.

Do not automatically show demo/example topics unless explicit Demo Mode is active.

For a new real project:

Before TOC generation:
show an empty/uninitialized TOC state.

Example:

No TOC has been generated yet.

Use the latest Source Analysis to propose a structure.

[Generate Proposed TOC]

============================================================
2. ANALYSIS IS THE INPUT TO TOC GENERATION
============================================================

Generate Proposed TOC from the CURRENT Analysis state.

Use available Analysis information such as:

detected concepts
features
procedures
roles
source coverage
evidence
gaps
conflicts where relevant
source relationships

The proposed structure must belong to the active project.

============================================================
3. PASS ANALYSIS STATE FROM APP
============================================================

Analysis data must live in or be accessible from shared App/project state.

StructureScreen / TOC must receive the current Analysis result by reference/state.

Do not create a second mock Analysis object inside TOC.

============================================================
4. ANALYSIS REVISION
============================================================

When Proposed TOC is generated, record:

tocGeneratedFromAnalysisRevision

Example:

analysisRevision = 4
tocGeneratedFromAnalysisRevision = 4

If Sources change and Analysis is refreshed to revision 5:

TOC remains intact.

Do NOT overwrite it automatically.

Instead show:

"Analysis has changed since this TOC was generated."

Actions:

Review Changes
Regenerate Proposal

============================================================
5. HUMAN-APPROVED TOC MUST BE PROTECTED
============================================================

Once the author modifies or approves a TOC:

the TOC becomes human-controlled.

Later Analysis changes must NOT silently replace:

renamed topics
new topics
deleted topics
moved topics
hierarchy changes

Never overwrite human edits automatically.

============================================================
6. GENERATE PROPOSED TOC
============================================================

Generate a realistic hierarchy from Analysis.

Support up to four levels.

Each proposed topic must receive a stable topic ID.

Example:

topic-001
topic-002
topic-003

Do not use the topic title as the ID.

============================================================
7. SOURCE SUPPORT
============================================================

Where Analysis provides evidence, TOC topics should retain references to supporting Analysis concepts/source evidence.

Conceptually:

topicId
title
level
parentId
analysisConceptIds
supportingSourceIds

This supports later:

Source Coverage
Review
Evidence
Author traceability

============================================================
8. PROPOSED TOC REVIEW
============================================================

Before accepting generated TOC, allow the author to:

rename
add
delete
move
promote
demote
reorder

Continue using the existing TOC editing interface.

Do not redesign it.

============================================================
9. ACCEPT TOC
============================================================

When author accepts/continues:

save the current TOC into shared appToc.

StudioScreen must continue using that SAME appToc.

Do not copy it into another outline model.

============================================================
10. REGENERATE SAFELY
============================================================

If TOC already exists and user clicks Regenerate:

DO NOT replace it immediately.

Show comparison options:

Keep Current TOC

Use New Proposal

Review Differences

For prototype, Review Differences can show:

Added
Removed
Potentially changed

The current TOC remains authoritative until the user explicitly accepts replacement.

============================================================
11. ANALYSIS STALE BEHAVIOR
============================================================

If:

sourcesRevision > analysisRevision

disable normal Generate Proposed TOC from stale Analysis OR clearly warn:

"Source Analysis is out of date."

Provide:

Re-analyze Sources

Do not pretend the TOC proposal uses the latest sources.

============================================================
12. NO DIRECT SOURCES → TOC SHORTCUT
============================================================

Normal flow must be:

Sources
→ Analysis
→ Proposed TOC

Do not bypass Analysis and independently generate TOC from a different mock source dataset.

============================================================
13. EMPTY ANALYSIS
============================================================

If no Analysis exists:

TOC must not generate fake structure.

Show:

"Run Source Analysis before generating a proposed TOC."

Link/action:
Go to Analysis

============================================================
14. ANALYSIS → TOC ACCEPTANCE TEST
============================================================

Create a clean test project.

Add sources containing concepts:

Authentication
User Management
Reports

Run Analysis.

VERIFY Analysis contains those concepts.

Generate Proposed TOC.

VERIFY proposed TOC meaningfully reflects current Analysis.

It must NOT display unrelated hard-coded demo topics.

============================================================
15. CHANGE ANALYSIS TEST
============================================================

Add a source containing:

Audit Logs

Re-analyze.

VERIFY:

analysisRevision increments.

Existing TOC remains unchanged.

Show:

Analysis changed since this TOC was generated.

Generate new proposal.

VERIFY:

new proposal can reflect Audit Logs.

Do not replace current TOC until explicitly accepted.

============================================================
16. TOC → AUTHOR REGRESSION TEST
============================================================

Accept Proposed TOC.

Open Author.

VERIFY:

Author outline uses the same topic IDs and hierarchy.

Rename a topic in TOC.

VERIFY:

Author updates without losing content.

============================================================
17. DIAGNOSTICS
============================================================

Update Project Diagnostics to show:

Analysis Revision

TOC Generated From Analysis Revision

TOC Status:

Not Generated
Current
Analysis Changed
Human Modified

============================================================
18. COMPLETION REPORT
============================================================

Report:

Analysis State Shared:
YES / NO

Hard-coded TOC Removed:
YES / NO

Analysis → Proposed TOC:
CONNECTED / PARTIAL / NOT CONNECTED

Analysis Revision Tracking:
YES / NO

Human TOC Protection:
YES / NO

TOC → Author Regression:
PASS / FAIL / NOT VALIDATED

Do not report CONNECTED unless the acceptance test succeeds.