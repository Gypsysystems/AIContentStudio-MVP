import { expect, test, type Page } from "@playwright/test"
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx"
import { jsPDF } from "jspdf"

type StoredExtraction = {
  sourceId: string
  fileName: string
  status: string
  extractedText: string
  sourceRevision: number
  extractionRevision: number
  blocks: Array<{
    id: string
    sourceId: string
    type: string
    text: string
    order: number
    headingLevel?: number
    sectionPath?: string[]
    tableData?: string[][]
    page?: number
    links?: Array<{ text: string; url: string }>
  }>
}

type StoredProject = {
  projectId: string
  projectName: string
  sourcesRevision: number
  sourceFileIds: string[]
  sourceExtractions: Record<string, StoredExtraction>
}

async function createProjectAtSources(page: Page, name: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
}

async function readStoredState(page: Page): Promise<{
  project: StoredProject
  storedFileIds: string[]
}> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const readAll = <T,>(storeName: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result as T[])
        request.onerror = () => reject(request.error)
      })
    const projects = await readAll<StoredProject>("projects")
    const files = await readAll<{ fileId: string }>("files")
    return {
      project: projects[0],
      storedFileIds: files.map(file => file.fileId),
    }
  })
}

async function openSearch(page: Page) {
  await page.getByRole("button", { name: "Search content" }).click()
  return page.getByPlaceholder("Search extracted content…")
}

test("persists real extraction, structured blocks, and search results across reload", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Source Extraction ${Date.now()}`
  const distinctive = "Quartz falcons calibrate the lunar compass at dawn."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "field-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([
        "OPERATING NOTES",
        "",
        distinctive,
        "",
        "- Verify the signal",
        "- Record the result",
      ].join("\n")),
    },
    {
      name: "reference.md",
      mimeType: "text/markdown",
      buffer: Buffer.from([
        "# Reference Manual",
        "",
        "This content came from the uploaded Markdown file.",
        "",
        "## Data Table",
        "",
        "| Key | Value |",
        "| --- | --- |",
        "| Mode | Safe |",
      ].join("\n")),
    },
  ])

  const rows = page.getByTestId("source-file-row")
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: "field-notes.txt" }).getByTestId("extraction-status"))
    .toContainText("Extracted")
  await expect(rows.filter({ hasText: "reference.md" }).getByTestId("extraction-status"))
    .toContainText("Extracted")

  await rows.filter({ hasText: "reference.md" }).getByRole("button", {
    name: "View Extracted Content",
  }).click()
  const extractedView = page.getByTestId("extracted-content-view")
  await expect(extractedView).toContainText("Reference Manual")
  await expect(extractedView).toContainText("H1")
  await expect(extractedView).toContainText("Data Table")
  await expect(extractedView).toContainText("Mode")
  await expect(extractedView).toContainText("Safe")

  let search = await openSearch(page)
  await search.fill("Quartz falcons")
  await expect(page.getByText("1 match across sources")).toBeVisible()
  await expect(page.getByText("field-notes.txt").last()).toBeVisible()
  await expect(page.getByText(distinctive, { exact: false })).toBeVisible()

  await search.fill("Nexus authentication")
  await expect(page.getByText("No matches found.")).toBeVisible()
  await expect(page.getByText("Nexus authentication", { exact: false })).toHaveCount(0)

  let beforeReload: StoredProject | undefined
  await expect.poll(async () => {
    beforeReload = (await readStoredState(page)).project
    return Object.values(beforeReload.sourceExtractions).map(extraction => extraction.status).sort()
  }).toEqual(["extracted", "extracted"])

  const fieldExtraction = Object.values(beforeReload!.sourceExtractions)
    .find(extraction => extraction.fileName === "field-notes.txt")!
  const markdownExtraction = Object.values(beforeReload!.sourceExtractions)
    .find(extraction => extraction.fileName === "reference.md")!
  expect(fieldExtraction.extractedText).toContain(distinctive)
  expect(fieldExtraction.blocks.map(block => block.type)).toEqual([
    "heading",
    "paragraph",
    "list-item",
    "list-item",
  ])
  expect(markdownExtraction.blocks.some(block => block.type === "table")).toBe(true)
  expect(new Set([
    ...fieldExtraction.blocks.map(block => block.id),
    ...markdownExtraction.blocks.map(block => block.id),
  ]).size).toBe(fieldExtraction.blocks.length + markdownExtraction.blocks.length)
  for (const extraction of Object.values(beforeReload!.sourceExtractions)) {
    expect(extraction.sourceId).toBeTruthy()
    expect(extraction.sourceRevision).toBeGreaterThan(0)
    expect(extraction.extractionRevision).toBe(extraction.sourceRevision)
    expect(extraction.blocks.every(block => block.sourceId === extraction.sourceId)).toBe(true)
  }

  const idsBeforeReload = Object.fromEntries(Object.entries(beforeReload!.sourceExtractions)
    .map(([fileId, extraction]) => [fileId, extraction.blocks.map(block => block.id)]))
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await expect(page.getByTestId("source-file-row")).toHaveCount(2)

  search = await openSearch(page)
  await search.fill("Quartz falcons")
  await expect(page.getByText("1 match across sources")).toBeVisible()
  await expect(page.getByText(distinctive, { exact: false })).toBeVisible()

  const afterReload = (await readStoredState(page)).project
  expect(Object.fromEntries(Object.entries(afterReload.sourceExtractions)
    .map(([fileId, extraction]) => [fileId, extraction.blocks.map(block => block.id)])))
    .toEqual(idsBeforeReload)
})

test("removing a source cleans its persisted extraction, file bytes, and search data", async ({ page }) => {
  test.setTimeout(60_000)
  const uniqueText = "Removal-only zephyr token 7319."
  await createProjectAtSources(page, `Source Removal ${Date.now()}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: "remove-me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(uniqueText),
  })

  const row = page.getByTestId("source-file-row").filter({ hasText: "remove-me.txt" })
  await expect(row.getByTestId("extraction-status")).toContainText("Extracted")
  let before: Awaited<ReturnType<typeof readStoredState>> | undefined
  await expect.poll(async () => {
    before = await readStoredState(page)
    const fileId = before.project.sourceFileIds[0]
    return before.project.sourceExtractions[fileId]?.status
  }).toBe("extracted")
  if (!before) throw new Error("Expected persisted source state")
  const fileId = before.project.sourceFileIds[0]
  expect(before.project.sourceExtractions[fileId]?.extractedText).toContain(uniqueText)
  expect(before.storedFileIds).toContain(fileId)

  await row.getByRole("button", { name: "Remove remove-me.txt" }).click()
  await expect(page.getByTestId("source-file-row")).toHaveCount(0)

  await expect.poll(async () => {
    const state = await readStoredState(page)
    return {
      sourceFileIds: state.project.sourceFileIds,
      extractionKeys: Object.keys(state.project.sourceExtractions),
      storedFileIds: state.storedFileIds,
    }
  }).toEqual({
    sourceFileIds: [],
    extractionKeys: [],
    storedFileIds: [],
  })

  await page.reload()
  await expect(page.getByTestId("source-file-row")).toHaveCount(0)
  await expect(page.getByText(uniqueText, { exact: false })).toHaveCount(0)
})

test("marks accepted but unsupported source formats without fabricating content", async ({ page }) => {
  await createProjectAtSources(page, `Unsupported Source ${Date.now()}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: "slides.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("not parsed and never treated as source text"),
  })

  const row = page.getByTestId("source-file-row").filter({ hasText: "slides.pptx" })
  await expect(row.getByTestId("extraction-status")).toContainText("Unsupported")
  await expect(row.getByRole("button", { name: "View Extracted Content" })).toHaveCount(0)

  await expect.poll(async () => {
    const extraction = Object.values((await readStoredState(page)).project.sourceExtractions)[0]
    return extraction && {
      fileName: extraction.fileName,
      status: extraction.status,
      extractedText: extraction.extractedText,
      blocks: extraction.blocks,
    }
  }).toEqual({
    fileName: "slides.pptx",
    status: "unsupported",
    extractedText: "",
    blocks: [],
  })

  await page.reload()
  await expect(page.getByTestId("source-file-row").filter({ hasText: "slides.pptx" })
    .getByTestId("extraction-status")).toContainText("Unsupported")
})

test("extracts structured DOCX content and page-provenance PDF text", async ({ page }) => {
  test.setTimeout(60_000)
  const docx = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Deployment Guide", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun("Read the "),
            new ExternalHyperlink({
              children: [new TextRun({ text: "release notes", style: "Hyperlink" })],
              link: "https://example.com/releases",
            }),
            new TextRun(" before deployment."),
          ],
        }),
        new Paragraph({ text: "Validate the environment", bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Check")] }),
                new TableCell({ children: [new Paragraph("Result")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Connectivity")] }),
                new TableCell({ children: [new Paragraph("Pass")] }),
              ],
            }),
          ],
        }),
      ],
    }],
  })
  const docxBuffer = await Packer.toBuffer(docx)

  const pdf = new jsPDF()
  pdf.text("First page calibration record", 20, 20)
  pdf.addPage()
  pdf.text("Second page verification record", 20, 20)
  const pdfBuffer = Buffer.from(pdf.output("arraybuffer"))

  await createProjectAtSources(page, `DOCX PDF Extraction ${Date.now()}`)
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "deployment.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    },
    {
      name: "calibration.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    },
  ])

  const rows = page.getByTestId("source-file-row")
  await expect(rows.filter({ hasText: "deployment.docx" }).getByTestId("extraction-status"))
    .toContainText("Extracted")
  await expect(rows.filter({ hasText: "calibration.pdf" }).getByTestId("extraction-status"))
    .toContainText("Extracted")

  let project: StoredProject | undefined
  await expect.poll(async () => {
    project = (await readStoredState(page)).project
    return Object.values(project.sourceExtractions).map(extraction => extraction.status).sort()
  }).toEqual(["extracted", "extracted"])

  const docxExtraction = Object.values(project!.sourceExtractions)
    .find(extraction => extraction.fileName === "deployment.docx")!
  expect(docxExtraction.blocks.map(block => block.type)).toEqual([
    "heading",
    "paragraph",
    "list-item",
    "table",
  ])
  expect(docxExtraction.blocks.find(block => block.type === "heading")).toMatchObject({
    text: "Deployment Guide",
    headingLevel: 1,
  })
  expect(docxExtraction.blocks.find(block => block.type === "paragraph")?.links).toEqual([
    { text: "release notes", url: "https://example.com/releases" },
  ])
  expect(docxExtraction.blocks.find(block => block.type === "table")?.tableData).toEqual([
    ["Check", "Result"],
    ["Connectivity", "Pass"],
  ])

  const pdfExtraction = Object.values(project!.sourceExtractions)
    .find(extraction => extraction.fileName === "calibration.pdf")!
  expect(pdfExtraction.extractedText).toContain("First page calibration record")
  expect(pdfExtraction.extractedText).toContain("Second page verification record")
  expect(pdfExtraction.blocks.map(block => block.page)).toEqual([1, 2])
  expect(pdfExtraction.blocks.every(block => block.type === "paragraph")).toBe(true)
  expect(pdfExtraction.blocks.some(block => block.headingLevel != null)).toBe(false)
})