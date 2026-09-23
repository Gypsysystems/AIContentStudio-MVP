import { expect, test, type Page } from "@playwright/test"

type StoredBlock = {
  id: string
  sourceId: string
  type: string
  text: string
  order: number
  sectionPath?: string[]
  page?: number
  tableData?: string[][]
  links?: Array<{ text: string; url: string }>
  listLevel?: number
  orderedList?: boolean
}

type StoredExtraction = {
  sourceId: string
  fileName: string
  status: string
  blocks: StoredBlock[]
}

type StoredEvidenceItem = {
  id: string
  sourceId: string
  fileId: string
  blockId: string
  sourceFileName: string
  text: string
  blockType: string
  order: number
  location: string
  sectionPath?: string[]
  page?: number
  tableData?: string[][]
  links?: Array<{ text: string; url: string }>
  listLevel?: number
  orderedList?: boolean
}

type StoredEvidenceIndex = {
  items: StoredEvidenceItem[]
  sourcesRevision: number
  extractionRevision: string
  builtAt: number
}

type StoredProject = {
  projectId: string
  projectName: string
  sourcesRevision: number
  sourceFileIds: string[]
  sourceExtractions: Record<string, StoredExtraction>
  evidenceIndex: StoredEvidenceIndex | null
}

type StoredFile = {
  fileId: string
  projectId: string
  name: string
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
  projects: StoredProject[]
  files: StoredFile[]
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
    return {
      projects: await readAll<StoredProject>("projects"),
      files: await readAll<StoredFile>("files"),
    }
  })
}

async function waitForEvidence(
  page: Page,
  projectName: string,
  expectedCount?: number,
): Promise<StoredProject> {
  let project: StoredProject | undefined
  await expect.poll(async () => {
    project = (await readStoredState(page)).projects.find(candidate => candidate.projectName === projectName)
    if (!project?.evidenceIndex) return false
    return (expectedCount == null || project.evidenceIndex.items.length === expectedCount)
      && project.evidenceIndex.sourcesRevision === project.sourcesRevision
  }).toBe(true)
  if (!project) throw new Error(`Expected project ${projectName}`)
  return project
}

test("builds exact traceable evidence from real blocks and persists it across reload", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Evidence Traceability ${Date.now()}`
  const exactParagraph = "The cobalt-trace procedure uses the uploaded source wording exactly."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "evidence-guide.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Evidence Guide",
      "",
      `${exactParagraph} See [trace policy](https://example.com/trace).`,
      "",
      "- Preserve source language",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Mode | Exact |",
    ].join("\n")),
  })

  const panel = page.getByTestId("evidence-index-panel")
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId("evidence-freshness")).toHaveText("Current")
  await expect(panel.getByTestId("evidence-item")).toHaveCount(4)

  const project = await waitForEvidence(page, projectName, 4)
  const fileId = project.sourceFileIds[0]
  const extraction = project.sourceExtractions[fileId]
  const evidence = project.evidenceIndex!

  expect(Object.keys(project.sourceExtractions)).toEqual([fileId])
  expect(evidence.sourcesRevision).toBe(project.sourcesRevision)
  expect(evidence.extractionRevision).toMatch(/^extract-/)
  expect(evidence.items).toHaveLength(extraction.blocks.length)
  expect(evidence.items.map(item => item.text)).toEqual(extraction.blocks.map(block => block.text))

  for (const item of evidence.items) {
    const sourceBlock = extraction.blocks.find(block => block.id === item.blockId)
    expect(sourceBlock).toBeTruthy()
    expect(item).toMatchObject({
      sourceId: fileId,
      fileId,
      sourceFileName: "evidence-guide.md",
      text: sourceBlock!.text,
      blockType: sourceBlock!.type,
      order: sourceBlock!.order,
      sectionPath: sourceBlock!.sectionPath,
    })
  }

  const paragraphEvidence = evidence.items.find(item => item.blockType === "paragraph")!
  expect(paragraphEvidence.links).toEqual([
    { text: "trace policy", url: "https://example.com/trace" },
  ])
  const listEvidence = evidence.items.find(item => item.blockType === "list-item")!
  expect(listEvidence).toMatchObject({ listLevel: 1, orderedList: false })
  const tableEvidence = evidence.items.find(item => item.blockType === "table")!
  expect(tableEvidence.tableData).toEqual([
    ["Field", "Value"],
    ["Mode", "Exact"],
  ])

  await panel.getByTestId("evidence-search-input").fill("cobalt-trace")
  await expect(panel.getByTestId("evidence-item")).toHaveCount(1)
  await expect(panel.getByText(exactParagraph, { exact: false })).toBeVisible()
  await panel.getByTestId("evidence-source-filter").selectOption(fileId)
  await expect(panel.getByTestId("evidence-item")).toHaveCount(1)

  expect(JSON.stringify(evidence)).not.toMatch(/Nexus|Asteria/)

  await page.reload()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  await expect(page.getByTestId("evidence-item")).toHaveCount(4)
  await page.getByTestId("evidence-search-input").fill("cobalt-trace")
  await expect(page.getByTestId("evidence-item")).toHaveCount(1)
  await expect(page.getByText(exactParagraph, { exact: false })).toBeVisible()
})

test("marks evidence stale after source changes, rebuilds it, and removes deleted-source evidence", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Evidence Lifecycle ${Date.now()}`
  const firstText = "First-source indigo marker remains traceable."
  const secondText = "Second-source vermilion marker is added later."

  await createProjectAtSources(page, projectName)
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: "first-source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(firstText),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  const initial = await waitForEvidence(page, projectName, 1)
  const firstFileId = initial.sourceFileIds[0]

  await fileInput.setInputFiles({
    name: "second-source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(secondText),
  })
  const secondRow = page.getByTestId("source-file-row").filter({ hasText: "second-source.txt" })
  await expect(secondRow.getByTestId("extraction-status")).toContainText("Extracted")
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("evidence-index-panel")).not.toContainText(secondText)

  await page.getByTestId("rebuild-evidence-index").click()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  await expect(page.getByTestId("evidence-index-panel")).toContainText(secondText)

  let rebuilt: StoredProject | undefined
  await expect.poll(async () => {
    rebuilt = (await readStoredState(page)).projects.find(project => project.projectName === projectName)
    return rebuilt?.evidenceIndex?.items.some(item => item.text === secondText)
  }).toBe(true)
  if (!rebuilt) throw new Error("Expected rebuilt evidence project")
  const secondFileId = rebuilt.sourceFileIds.find(fileId => fileId !== firstFileId)!

  await secondRow.getByRole("button", { name: "Remove second-source.txt" }).click()
  await expect(secondRow).toHaveCount(0)
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("evidence-index-panel")).not.toContainText(secondText)

  await expect.poll(async () => {
    const stored = (await readStoredState(page)).projects.find(project => project.projectName === projectName)!
    return {
      sourceFileIds: stored.sourceFileIds,
      evidenceSourceIds: Array.from(new Set(stored.evidenceIndex?.items.map(item => item.sourceId) ?? [])),
      containsRemovedText: stored.evidenceIndex?.items.some(item => item.text === secondText),
    }
  }).toEqual({
    sourceFileIds: [firstFileId],
    evidenceSourceIds: [firstFileId],
    containsRemovedText: false,
  })
  expect(secondFileId).toBeTruthy()
})

test("duplicates persisted evidence onto copied file IDs without changing the original", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Evidence Duplicate ${Date.now()}`
  const duplicateName = `${projectName} Copy`
  const exactText = "The duplicate evidence contains the silver-comet marker."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "duplicate-evidence.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Copied Evidence\n\n${exactText}`),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  const originalBefore = await waitForEvidence(page, projectName, 2)
  const originalFileId = originalBefore.sourceFileIds[0]
  const originalEvidenceIds = originalBefore.evidenceIndex!.items.map(item => item.id)

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const afterDuplication = await readStoredState(page)
  const originalAfter = afterDuplication.projects.find(project => project.projectName === projectName)!
  const duplicate = afterDuplication.projects.find(project => project.projectName === duplicateName)!
  const duplicateFileId = duplicate.sourceFileIds[0]

  expect(duplicateFileId).not.toBe(originalFileId)
  expect(duplicate.evidenceIndex).toBeTruthy()
  expect(duplicate.evidenceIndex!.items.map(item => item.id)).toEqual(originalEvidenceIds)
  expect(duplicate.evidenceIndex!.items.every(item =>
    item.sourceId === duplicateFileId && item.fileId === duplicateFileId)).toBe(true)
  expect(duplicate.evidenceIndex!.items.every(item =>
    item.sourceId !== originalFileId && item.fileId !== originalFileId)).toBe(true)
  expect(originalAfter.sourceFileIds).toEqual(originalBefore.sourceFileIds)
  expect(originalAfter.sourceExtractions).toEqual(originalBefore.sourceExtractions)
  expect(originalAfter.evidenceIndex).toEqual(originalBefore.evidenceIndex)

  await page.getByText(duplicateName, { exact: true }).click()
  await page.reload()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  await page.getByTestId("evidence-search-input").fill("silver-comet")
  await expect(page.getByTestId("evidence-item")).toHaveCount(1)
  await expect(page.getByText(exactText, { exact: false })).toBeVisible()

  const reloaded = (await readStoredState(page)).projects
    .find(project => project.projectId === duplicate.projectId)!
  expect(reloaded.evidenceIndex!.items.every(item =>
    item.sourceId === duplicateFileId && item.fileId === duplicateFileId)).toBe(true)
  expect(JSON.stringify(reloaded.evidenceIndex)).not.toMatch(/Nexus|Asteria/)
})