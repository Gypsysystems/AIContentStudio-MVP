PHASE 1 — REAL SOURCE EXTRACTION AND EVIDENCE LAYER

The P0 project-state and persistence architecture is now frozen.

Do NOT redesign the application.
Do NOT modify Project persistence architecture unless required for this feature.
Do NOT implement AI Analysis yet.
Do NOT implement Review or Publish improvements.
Do NOT use hard-coded project knowledge.

The goal of this phase is:

UPLOAD SOURCE
→ PARSE ACTUAL FILE
→ EXTRACT CONTENT
→ CREATE TRACEABLE EVIDENCE
→ PERSIST RESULTS

The uploaded document itself must be the only source of extracted information.

============================================================
1. SUPPORTED SOURCE TYPES FOR THIS PHASE
============================================================

Implement reliable extraction for:

DOCX
PDF
TXT
Markdown

If PPTX/image/video parsing is not reliable yet:

keep upload support if already present,

but clearly mark them:

"Extraction not yet supported"

Do not fake extraction.

============================================================
2. REAL DOCX EXTRACTION
============================================================

Use the existing Mammoth capability.

Extract actual document content including, where possible:

paragraphs
headings
lists
tables
hyperlinks
basic document order

Do not extract only one large unstructured text string.

Represent extracted content as structured blocks.

Conceptually:

ExtractedBlock {
  id
  sourceId
  type
  text
  order
  headingLevel?
  sectionPath?
  page?
  tableData?
}

Possible block types:

heading
paragraph
list-item
table
quote
other

============================================================
3. REAL PDF EXTRACTION
============================================================

Use the existing PDF.js / pdfjs-dist capability.

Extract:

page number
text
text order where reasonably possible

Represent each extracted text block with:

sourceId
page
text
order

Do not fabricate headings if they cannot be reliably identified.

If heading detection is heuristic:

mark it internally as inferred.

============================================================
4. TEXT / MARKDOWN
============================================================

TXT:

extract actual file text.

Markdown:

preserve useful structure such as:

headings
paragraphs
lists
code blocks
tables where supported

============================================================
5. SOURCE EXTRACTION STATUS
============================================================

Each ProjectSource must have extraction state.

Suggested:

Not Extracted
Extracting
Extracted
Partial
Failed
Unsupported

Store:

extractionStatus
extractionError if any
extractedAt
extractor/version if useful

The Sources UI should clearly display status.

============================================================
6. PERSIST EXTRACTED CONTENT
============================================================

Extraction results belong to the project.

Persist them.

Do not require the file to be reparsed every time the user navigates away.

Conceptually:

sourceExtractions: Record<fileId, SourceExtraction>

SourceExtraction {
  sourceId
  fileName
  fileType
  status
  blocks
  extractedText
  warnings
}

Use stable sourceId / fileId.

Never use filename as identity.

============================================================
7. CREATE AN EVIDENCE MODEL
============================================================

Create a reusable evidence layer from extracted source blocks.

Conceptually:

EvidenceItem {
  id
  sourceId
  blockId
  text
  location
  sectionPath?
  page?
}

This will later support:

Analysis
TOC generation
Author generation
Review
citations / provenance

Evidence must point back to the source block.

============================================================
8. SOURCE EVIDENCE VIEW
============================================================

Add a simple way to inspect extraction from the Sources or Analysis area.

For each source provide:

View Extracted Content

Display:

source filename
extraction status
number of extracted blocks

Then show extracted content in source order.

Where available show:

Heading / section
Page
Block type

Example display concept:

Page 4
Heading
User Management

Page 4
Paragraph
[actual extracted text]

Page 5
Table
[actual extracted table]

This is a diagnostic/review view, not a new major workspace.

============================================================
9. SEARCH EXTRACTED SOURCES
============================================================

Add a basic project-source search capability.

Search must operate on actual extracted text.

Search results should show:

matching text
source filename
section/page where available

This will help prove the extraction is real.

Do NOT use synthetic search results.

============================================================
10. EXTRACTION REVISION
============================================================

Sources already use sourcesRevision.

When sources change:

mark downstream Analysis stale.

Extraction should have a revision relationship to the current Sources revision.

Conceptually:

extractionRevision
sourcesRevision

Analysis must later know which source/extraction revision it used.

============================================================
11. SOURCE REMOVAL
============================================================

When a source is removed:

remove or invalidate:

its extraction
its evidence items

Do not leave orphaned evidence.

Increment source revision appropriately.

Downstream Analysis becomes stale.

============================================================
12. SOURCE REPLACEMENT
============================================================

If a source is replaced:

create/use the correct stable source relationship.

Re-run extraction.

Invalidate evidence from the previous content.

Do not silently retain evidence belonging to the old file content.

============================================================
13. DO NOT SUMMARIZE YET
============================================================

This phase is extraction only.

Do NOT generate:

concepts
gaps
conflicts
TOC
documentation content
AI summaries

Those belong to the next phase.

This separation is important because we first need to prove that source ingestion is correct.

============================================================
14. NO SYNTHETIC CONTENT
============================================================

Critical:

Do not include any hard-coded:

product names
feature names
source facts
expected headings
expected concepts
sample analysis results

Extraction must work with arbitrary uploaded documents.

Do not use Nexus or Asteria knowledge in extraction logic.

============================================================
15. FAILURE HANDLING
============================================================

If parsing fails:

show:

"Extraction failed"

with a useful technical reason where available.

Allow:

Retry Extraction

Do not silently mark a failed source as successfully analyzed.

============================================================
16. EXTRACTION DIAGNOSTICS
============================================================

For development/testing provide an expandable:

Extraction Diagnostics

Include:

filename
fileId
file type
file size
parser used
number of pages if known
number of extracted blocks
number of headings detected
number of tables detected
character count
warnings
status

Do not expose unnecessary developer complexity in the normal workflow.

============================================================
17. PROJECT PERSISTENCE
============================================================

Reload the application.

Reopen the project.

VERIFY:

sources remain
stable fileIds remain
extraction status remains
extracted blocks remain
Evidence items remain

Do not reparse automatically if the stored extraction is still valid.

============================================================
18. ACCEPTANCE TEST
============================================================

Create a normal non-demo project.

Upload several unrelated real source files.

Wait for extraction.

Open:

View Extracted Content

Compare extracted paragraphs/headings/tables against each original file.

Search for a distinctive sentence from one uploaded file.

PASS only if the exact matching source evidence appears.

Reload the application.

Repeat the search.

PASS only if the extraction/evidence still exists.

Remove one source.

Search for text unique to that removed source.

PASS only if it no longer appears.

============================================================
19. COMPLETION REPORT
============================================================

Report:

DOCX extraction
PASS / PARTIAL / FAIL

PDF extraction
PASS / PARTIAL / FAIL

TXT extraction
PASS / PARTIAL / FAIL

Markdown extraction
PASS / PARTIAL / FAIL

Structured blocks
PASS / FAIL

Table extraction
PASS / PARTIAL / FAIL

PDF page provenance
PASS / PARTIAL / FAIL

Stable evidence IDs
PASS / FAIL

Evidence → source linkage
PASS / FAIL

Source search
PASS / FAIL

Extraction persistence after reload
PASS / FAIL

Source removal cleans evidence
PASS / FAIL

Synthetic source content used
NONE / FOUND

Also state which parsing libraries are used.

============================================================
FINAL PRINCIPLE
============================================================

A source is not considered processed merely because it was uploaded.

The pipeline must be:

FILE
→ ACTUAL PARSER
→ STRUCTURED EXTRACTED CONTENT
→ TRACEABLE EVIDENCE

Only after this works should Analysis consume the source.