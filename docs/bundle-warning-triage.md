# Bundle warning triage

## Scope and outcome

This is a focused assessment of the warnings in the supplied current Vite build
log, followed by one authorized PDF.js worker URL alignment. No dependencies,
chunk thresholds, build configuration, or import graphs were changed. The
supplied build log ends with `✓ built in 8.04s`; these messages are
warnings/information, not build failures.

## Warnings and import paths

### `projectService.ts`: dynamic import is not a chunk boundary

The warning identifies the dynamic import in
`cloudProjectRepository.ts` (`importLocalProjectToCloud`) and static imports
from `App.tsx`, `authorizedProjectService.ts`, and `projectBackup.ts`.
`projectService.ts` is therefore already in the static application graph, so
the dynamic import in the local-to-cloud import path cannot isolate it in
another chunk in this build.

This is not evidence of a circular module-initialization failure:
`projectService.ts` statically wraps `projectRepository.ts`, while
`cloudProjectRepository.ts` statically uses `projectRepository.ts` and
dynamically loads the local service only when importing a local project to
cloud. The service does not import the cloud repository. The current warning
is about chunk placement, not a broken import or failed operation.

**Deferred:** Replacing the dynamic import with a static one would merely hide
the warning while giving up its lazy-use intent. Making it a real boundary
would require removing or restructuring the other static service imports, or
changing the local-to-cloud helper to receive a repository. Those changes
cross the persistence/adapter boundary and are not justified solely to silence
this warning.

### JSZip: static consumers prevent the dynamic imports from isolating it

The log resolves every reference to the same installed JSZip module:

- `projectBackup.ts` statically imports JSZip for archive read/write.
- Mammoth's `lib/zipfile.js` statically imports JSZip to process DOCX files.
- `brandExtractor.ts` dynamically imports JSZip for DOCX XML tables and font
  metadata.
- `htmlPublisher.ts` dynamically imports JSZip when generating an HTML ZIP.

Because JSZip has static consumers in the app graph, the two dynamic imports
cannot place JSZip in independent lazy chunks. Their dynamic syntax remains
useful to express when those operations are called, but it does not provide
the requested dependency-level split in this graph. This is not a JSZip load
or archive failure.

**Deferred:** Making JSZip genuinely lazy would require revisiting the static
backup/Mammoth paths and their callers, not just changing either dynamic
import. That affects project backup/restore and document extraction, so it
should be evaluated as a separate bundle-architecture change rather than a
warning-only edit.

### PDF.js: static source extraction and dynamic brand extraction share one module

`sourceExtractor.ts` statically imports `pdfjs-dist`; `brandExtractor.ts`
dynamically imports the same package for PDF brand extraction. The static
source-extraction path prevents that dynamic import from splitting PDF.js
into a separate chunk. Switching the brand extractor to a static import could
remove this particular warning but would not meaningfully reduce the current
entry bundle; both extractors are already reachable from `App.tsx`.

Before the narrow follow-up, `sourceExtractor.ts` configured
`pdf.worker.min.mjs`, while `brandExtractor.ts` selected `pdf.worker.mjs`.
Both import the shared PDF.js module, so brand extraction changed the same
global `workerSrc` used by source extraction. The supplied pre-change build
emitted both worker assets (about 1,265.41 kB and 2,228.48 kB respectively).

The installed `pdfjs-dist` package is 6.3.289, and both worker files identify
the same `pdfjsVersion` (6.3.289) and `pdfjsBuild` (1c8020a7d). They are the
same release/build worker with the `.min.mjs` file as its minified counterpart;
the selected URL uses the same worker protocol and does not change extraction
logic. `brandExtractor.ts` now points to the existing `pdf.worker.min.mjs`
asset used by `sourceExtractor.ts`. Both consumers therefore leave the shared
global worker setting at the same URL.

The focused regression `tests/infrastructure/pdf-worker.test.mjs` checks that
both sources reference the same worker and that the referenced asset exists
in the installed package. It passed when run directly with Node. The batch's
production build passed and emitted only `pdf.worker.min-Dswkl-cV.mjs`
(1,265,413 bytes), with no separate unminified worker asset and no emitted
`.map` files. This alignment does not remove the ineffective
dynamic-import warning because source extraction still statically imports
PDF.js while brand extraction dynamically imports it.

## Other build messages

- **Chunk-size warning:** The application entry chunk is 2,009.67 kB
  minified (521.24 kB gzip), over the existing 500 kB warning limit. This is
  a size advisory, not a failed build. The supplied output also lists other
  chunks, including jsPDF and HTML canvas support. Do not raise the warning
  threshold to suppress this message.
- **Plugin timings:** Vite reports notable time in asset URL processing,
  Tailwind generation, and CSS processing. This is diagnostic timing
  information, not an error.
- **Node legacy-build notice:** `Please use the legacy build in Node.js
  environments.` is emitted as a warning, but the client production build
  completes successfully. No dependency or build-mode change is recommended
  from this notice alone.

## TODO scan and recommendation

A focused scan of the relevant import/extraction files found no stale TODO or
FIXME comments connected to these warnings. No low-risk change clearly fixes
the projectService, JSZip, or PDF.js ineffective-import warnings without
touching runtime architecture. Leave those imports as-is for now. The worker
URL alignment is limited to duplicate worker output and shared global
configuration; it does not claim to fix any dynamic-import warning.