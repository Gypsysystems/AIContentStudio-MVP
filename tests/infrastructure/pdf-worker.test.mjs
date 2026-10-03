import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"

const require = createRequire(import.meta.url)

function workerReference(source, label) {
  const match = source.match(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/s)
  assert.ok(match, `${label} must configure its PDF.js worker with a Vite URL import`)
  return match[1]
}

test("source and brand PDF extraction use the same packaged PDF.js worker", async () => {
  const [sourceExtractor, brandExtractor] = await Promise.all([
    readFile(new URL("../../src/sourceExtractor.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/brandExtractor.ts", import.meta.url), "utf8"),
  ])
  const sourceWorker = workerReference(sourceExtractor, "sourceExtractor")
  const brandWorker = workerReference(brandExtractor, "brandExtractor")

  assert.equal(sourceWorker, "pdfjs-dist/build/pdf.worker.min.mjs")
  assert.equal(brandWorker, sourceWorker)

  const pdfjsEntry = require.resolve("pdfjs-dist")
  const workerPath = join(dirname(pdfjsEntry), sourceWorker.split("/").at(-1))
  await assert.doesNotReject(readFile(workerPath), "the shared worker must exist in the installed pdfjs-dist package")
})