import { expect, test, type Page } from "@playwright/test"

type StoredEvidenceItem = {
  id: string
  sourceId: string
  fileId: string
  sourceFileName: string
  text: string
  location: string
}

type StoredEvidenceIndex = {
  items: StoredEvidenceItem[]
  sourcesRevision: number
  extractionRevision: string
}

type EvidenceReference = {
  evidenceId: string
  sourceId: string
  fileId: string
  sourceFileName: string
  location: string
}

type GroundedRecord = {
  id: string
  label?: string
  normalizedLabel?: string
  exactTerms: string[]
  occurrenceCount: number
  sourceCount: number
  evidenceIds: string[]
  evidenceRefs: EvidenceReference[]
}

type StoredConceptAnalysis = {
  method: string
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  concepts: GroundedRecord[]
  terminology: GroundedRecord[]
}

type StoredProject = {
  projectId: string
  projectName: string
  sourceFileIds: string[]
  evidenceIndex: StoredEvidenceIndex | null
  conceptAnalysis: StoredConceptAnalysis | null
  themes: unknown[]
  appToc: unknown[]
  topicContent: Record<string, unknown[]>
}

async function createProjectAtSources(page: Page, name: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
}

async function readProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result as StoredProject[])
      request.onerror = () => reject(request.error)
    })
  })
}

async function waitForCurrentEvidence(page: Page) {
  await expect(page.getByTestId("evidence-index-panel")).toBeVisible()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
}

async function openRealAnalysis(page: Page) {
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect(page.getByRole("heading", { name: "Source-backed Analysis" })).toBeVisible()
}

test("derives persisted concepts and terminology only from evidence with inspectable traceability", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Grounded Concepts ${Date.now()}`
  const exactSentence = "Orbital Access Control (OAC) protects each launch workspace."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "orbital-controls.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Orbital Access Control",
      "",
      exactSentence,
      "Orbital Access Control requires scheduled Token Rotation.",
      "",
      "## Token Rotation",
      "",
      "Token Rotation is reviewed by the Flight Security Team.",
    ].join("\n")),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)

  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByText("Conservative deterministic evidence heuristics", { exact: false })).toBeVisible()
  await expect(page.getByTestId("grounded-concept").filter({ hasText: "Orbital Access Control" })).toBeVisible()
  await expect(page.getByTestId("grounded-term").filter({ hasText: "OAC" })).toBeVisible()
  await expect(page.getByText("Coverage Gaps")).toHaveCount(0)
  await expect(page.getByText("Nexus Technical Spec", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Asteria", { exact: false })).toHaveCount(0)

  let project: StoredProject | undefined
  await expect.poll(async () => {
    project = (await readProjects(page)).find(candidate => candidate.projectName === projectName)
    return project?.conceptAnalysis?.concepts.some(concept => concept.label === "Orbital Access Control")
  }).toBe(true)
  if (!project?.evidenceIndex || !project.conceptAnalysis) throw new Error("Expected persisted analysis")

  const evidenceById = new Map(project.evidenceIndex.items.map(item => [item.id, item]))
  expect(project.conceptAnalysis.method).toBe("deterministic-evidence-heuristics-v1")
  expect(project.conceptAnalysis.evidenceSourcesRevision).toBe(project.evidenceIndex.sourcesRevision)
  expect(project.conceptAnalysis.evidenceExtractionRevision).toBe(project.evidenceIndex.extractionRevision)
  expect(project.conceptAnalysis.concepts.length).toBeGreaterThan(0)
  expect(project.conceptAnalysis.terminology.length).toBeGreaterThan(0)

  for (const record of [...project.conceptAnalysis.concepts, ...project.conceptAnalysis.terminology]) {
    expect(record.evidenceIds.length).toBeGreaterThan(0)
    expect(record.evidenceRefs.map(reference => reference.evidenceId)).toEqual(record.evidenceIds)
    for (const reference of record.evidenceRefs) {
      const evidence = evidenceById.get(reference.evidenceId)
      expect(evidence).toBeTruthy()
      expect(reference).toEqual({
        evidenceId: evidence!.id,
        sourceId: evidence!.sourceId,
        fileId: evidence!.fileId,
        sourceFileName: evidence!.sourceFileName,
        location: evidence!.location,
      })
    }
  }

  const orbitalConcept = project.conceptAnalysis.concepts.find(concept => concept.label === "Orbital Access Control")!
  expect(orbitalConcept.exactTerms).toContain("Orbital Access Control")
  const originalConceptId = orbitalConcept.id

  const conceptRow = page.getByTestId("grounded-concept").filter({ hasText: "Orbital Access Control" })
  await conceptRow.getByRole("button").first().click()
  await conceptRow.getByTestId("analysis-evidence-reference").filter({ hasText: exactSentence }).click()
  await expect(page.getByTestId("analysis-evidence-dialog")).toContainText(exactSentence)
  await page.getByTestId("analysis-evidence-dialog").getByRole("button").click()

  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  const reloaded = (await readProjects(page)).find(candidate => candidate.projectName === projectName)!
  expect(reloaded.conceptAnalysis!.concepts.find(concept => concept.label === "Orbital Access Control")!.id)
    .toBe(originalConceptId)
  expect(JSON.stringify(reloaded.conceptAnalysis)).not.toMatch(/Nexus|Asteria/)
})

test("marks analysis stale when evidence changes and replaces only concept and terminology results", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Concept Freshness ${Date.now()}`

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "primary.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Primary Flight Control\n\nPrimary Flight Control coordinates launch operations."),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")

  const before = (await readProjects(page)).find(project => project.projectName === projectName)!
  const preservedState = {
    themes: before.themes,
    appToc: before.appToc,
    topicContent: before.topicContent,
  }

  await page.getByRole("button", { name: /Sources$/ }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: "secondary.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Thermal Safety Protocol\n\nThermal Safety Protocol governs engine inspection."),
  })
  const secondRow = page.getByTestId("source-file-row").filter({ hasText: "secondary.md" })
  await expect(secondRow.getByTestId("extraction-status")).toContainText("Extracted")
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Stale")

  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("rebuild-concept-analysis")).toBeDisabled()
  await page.getByRole("button", { name: "Return to Sources" }).click()
  await page.getByTestId("rebuild-evidence-index").click()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")

  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Stale")
  await page.getByTestId("rebuild-concept-analysis").click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("grounded-concept").filter({ hasText: "Thermal Safety Protocol" })).toBeVisible()

  let rebuilt: StoredProject | undefined
  await expect.poll(async () => {
    rebuilt = (await readProjects(page)).find(project => project.projectName === projectName)
    return rebuilt?.conceptAnalysis?.concepts.some(concept => concept.label === "Thermal Safety Protocol")
  }).toBe(true)
  if (!rebuilt?.evidenceIndex || !rebuilt.conceptAnalysis) throw new Error("Expected rebuilt analysis")
  expect(rebuilt.conceptAnalysis.evidenceExtractionRevision).toBe(rebuilt.evidenceIndex.extractionRevision)
  expect({
    themes: rebuilt.themes,
    appToc: rebuilt.appToc,
    topicContent: rebuilt.topicContent,
  }).toEqual(preservedState)
})

test("duplicates grounded analysis with copied source references and stable analysis IDs", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Concept Duplicate ${Date.now()}`
  const duplicateName = `${projectName} Copy`

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "navigation.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Stellar Navigation Console\n\nStellar Navigation Console displays the Guidance Vector."),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")

  let original: StoredProject | undefined
  await expect.poll(async () => {
    original = (await readProjects(page)).find(project => project.projectName === projectName)
    return original?.conceptAnalysis?.concepts.length ?? 0
  }).toBeGreaterThan(0)
  if (!original?.conceptAnalysis) throw new Error("Expected original analysis")
  const originalFileId = original.sourceFileIds[0]
  const originalConceptIds = original.conceptAnalysis.concepts.map(concept => concept.id)
  const originalTermIds = original.conceptAnalysis.terminology.map(term => term.id)

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const projects = await readProjects(page)
  const duplicate = projects.find(project => project.projectName === duplicateName)!
  const originalAfter = projects.find(project => project.projectName === projectName)!
  const duplicateFileId = duplicate.sourceFileIds[0]
  expect(duplicateFileId).not.toBe(originalFileId)
  expect(duplicate.conceptAnalysis!.concepts.map(concept => concept.id)).toEqual(originalConceptIds)
  expect(duplicate.conceptAnalysis!.terminology.map(term => term.id)).toEqual(originalTermIds)
  for (const record of [...duplicate.conceptAnalysis!.concepts, ...duplicate.conceptAnalysis!.terminology]) {
    expect(record.evidenceRefs.every(reference =>
      reference.sourceId === duplicateFileId && reference.fileId === duplicateFileId)).toBe(true)
    expect(record.evidenceRefs.every(reference =>
      reference.sourceId !== originalFileId && reference.fileId !== originalFileId)).toBe(true)
  }
  expect(originalAfter.conceptAnalysis).toEqual(original.conceptAnalysis)

  await page.getByText(duplicateName, { exact: true }).click()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("grounded-concept").filter({ hasText: "Stellar Navigation Console" })).toBeVisible()
})