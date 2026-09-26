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
  version: number
  method: string
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  concepts: GroundedRecord[]
  terminology: GroundedRecord[]
  conflicts: Array<{
    id: string
    subject: string
    kind: string
    summary: string
    rationale: string
    sides: Array<{
      id: string
      label: string
      claimText: string
      evidenceIds: string[]
      evidenceRefs: EvidenceReference[]
    }>
    evidenceIds: string[]
    evidenceRefs: EvidenceReference[]
  }>
  gaps: Array<{
    id: string
    category: string
    status: string
    title: string
    rationale: string
    evidenceIds: string[]
    evidenceRefs: EvidenceReference[]
  }>
}

type StoredUnsupportedAnalysis = {
  version: number
  method: string
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  groundedAnalysisBuiltAt: number
  contentRevision: number
  contentFingerprint: string
  status: string
  analyzedClaimCount: number
  supportedClaimCount: number
  findings: Array<{
    id: string
    claimText: string
    reason: string
    evidenceStatus: string
    context: {
      contextType: string
      location: string
      blockId: string
      topicId?: string
    }
    nearMatches: Array<EvidenceReference & {
      text: string
      similarity: number
      relationship: string
    }>
  }>
}

type StoredProject = {
  projectId: string
  projectName: string
  sourceFileIds: string[]
  evidenceIndex: StoredEvidenceIndex | null
  conceptAnalysis: StoredConceptAnalysis | null
  unsupportedAnalysis: StoredUnsupportedAnalysis | null
  docBlocks: Array<{ id: string; type: string; content: string }>
  contentRevision: number
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
  await expect.poll(async () => {
    const sources = await page.getByTestId("source-file-row").count()
    const extracted = await page.getByTestId("extraction-status")
      .filter({ hasText: /^(✓ Extracted|⚠ Partial)/ }).count()
    return sources > 0 && sources === extracted
  }, { timeout: 15_000 }).toBe(true)
  if (await page.getByTestId("evidence-freshness").textContent() === "Stale") {
    await page.getByTestId("rebuild-evidence-index").click()
  }
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
}

async function openRealAnalysis(page: Page) {
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect(page.getByRole("heading", { name: "Source-backed Analysis" })).toBeVisible()
}

async function seedAnalyzableContent(
  page: Page,
  projectName: string,
  blocks: Array<{ id: string; type: string; content: string }>,
  clearUnsupported = true,
) {
  await page.evaluate(async ({ name, nextBlocks, shouldClear }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => {
        const match = (request.result as Array<Record<string, unknown>>).find(candidate => candidate.projectName === name)
        if (!match) reject(new Error(`Project not found: ${name}`))
        else resolve(match)
      }
      request.onerror = () => reject(request.error)
    })
    project.docBlocks = nextBlocks
    project.topicContent = {}
    project.contentRevision = Number(project.contentRevision ?? 0) + 1
    if (shouldClear) project.unsupportedAnalysis = null
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("projects", "readwrite").objectStore("projects").put(project)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { name: projectName, nextBlocks: blocks, shouldClear: clearUnsupported })
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
  await expect(page.getByTestId("unsupported-no-content")).toBeVisible()
  await expect(page.getByTestId("unsupported-count")).toHaveText("0")
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
  expect(reloaded.unsupportedAnalysis?.status).toBe("no-analyzable-content")
  expect(reloaded.unsupportedAnalysis?.findings).toEqual([])
})

test("supports evidence-backed paraphrases and reports only genuinely unsupported content", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Unsupported Claims ${Date.now()}`
  const supportedParaphrase = "Audit logging needs to be turned on by administrators prior to launch."
  const unsupportedClaim = "The launch console provides quantum teleportation."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "audit-controls.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Audit Controls",
      "",
      "Administrators must enable audit logging before launch.",
      "The launch console uses secure channels.",
    ].join("\n")),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("unsupported-no-content")).toBeVisible()

  await seedAnalyzableContent(page, projectName, [
    { id: "claim-supported", type: "para", content: supportedParaphrase },
    { id: "claim-unsupported", type: "para", content: unsupportedClaim },
  ])
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)

  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("unsupported-count")).toHaveText("1")
  await expect(page.getByTestId("unsupported-finding")).toContainText(unsupportedClaim)
  await expect(page.getByTestId("unsupported-finding")).not.toContainText(supportedParaphrase)
  await expect(page.getByTestId("conflict-count")).toHaveText("0")
  await expect(page.getByTestId("gap-count")).toHaveText("0")
  await expect(page.getByText("Nexus Technical Spec", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Asteria", { exact: false })).toHaveCount(0)

  const findingRow = page.getByTestId("unsupported-finding")
  await findingRow.getByRole("button").first().click()
  await expect(findingRow).toContainText("Document block claim-unsupported")
  await expect(findingRow.getByText("Evidence candidates — not support")).toBeVisible()
  await findingRow.getByTestId("unsupported-evidence-candidate").click()
  await expect(page.getByTestId("analysis-evidence-dialog")).toContainText("launch console uses secure channels")
  await page.getByTestId("analysis-evidence-dialog").getByRole("button").click()

  let stored: StoredProject | undefined
  await expect.poll(async () => {
    stored = (await readProjects(page)).find(project => project.projectName === projectName)
    return stored?.unsupportedAnalysis?.findings.length
  }).toBe(1)
  if (!stored?.evidenceIndex || !stored.unsupportedAnalysis) throw new Error("Expected unsupported analysis")
  expect(stored.unsupportedAnalysis.method).toBe("deterministic-evidence-support-v1")
  expect(stored.unsupportedAnalysis.analyzedClaimCount).toBe(2)
  expect(stored.unsupportedAnalysis.supportedClaimCount).toBe(1)
  expect(stored.unsupportedAnalysis.findings[0].claimText).toBe(unsupportedClaim)
  expect(stored.unsupportedAnalysis.findings[0].evidenceStatus).toBe("unsupported")
  expect(stored.unsupportedAnalysis.findings[0].nearMatches.length).toBeGreaterThan(0)
  expect(stored.unsupportedAnalysis.findings[0].nearMatches[0].evidenceId).toBeTruthy()
  expect(stored.unsupportedAnalysis.findings[0].nearMatches[0].relationship).toBe("near-match")

  const findingId = stored.unsupportedAnalysis.findings[0].id
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  const reloaded = (await readProjects(page)).find(project => project.projectName === projectName)!
  expect(reloaded.unsupportedAnalysis!.findings[0].id).toBe(findingId)
})

test("marks unsupported analysis stale when analyzed content changes and refreshes only that result", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Unsupported Freshness ${Date.now()}`

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "controls.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Controls\n\nAdministrators enable audit logging before launch."),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await seedAnalyzableContent(page, projectName, [
    { id: "claim-one", type: "para", content: "Administrators turn on audit logging before launch." },
  ])
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("unsupported-count")).toHaveText("0")

  let before: StoredProject | undefined
  await expect.poll(async () => {
    before = (await readProjects(page)).find(project => project.projectName === projectName)
    return before?.unsupportedAnalysis?.status
  }).toBe("complete")
  await page.waitForTimeout(1_000)
  if (!before) throw new Error("Expected persisted project")
  const preservedGroundedAnalysis = before.conceptAnalysis
  await seedAnalyzableContent(page, projectName, [
    { id: "claim-one", type: "para", content: "Administrators turn on audit logging before launch." },
    { id: "claim-two", type: "para", content: "The system supports interplanetary transport." },
  ], false)
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("unsupported-count")).toHaveText("0")
  await page.getByTestId("rebuild-unsupported-analysis").click()
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("unsupported-count")).toHaveText("1")

  let rebuilt: StoredProject | undefined
  await expect.poll(async () => {
    rebuilt = (await readProjects(page)).find(project => project.projectName === projectName)
    return rebuilt?.unsupportedAnalysis?.findings.length
  }).toBe(1)
  expect(rebuilt!.conceptAnalysis).toEqual(preservedGroundedAnalysis)
})

test("detects only concrete cross-source conflicts and conservative source-backed gaps", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Grounded Findings ${Date.now()}`
  const positiveClaim = "Operators must enable audit logging."
  const negativeClaim = "Operators must not enable audit logging."
  const explicitGap = "Recovery prerequisites are TBD."

  await createProjectAtSources(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "operations-a.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Audit Operations",
      "",
      positiveClaim,
      "Administrators must review audit logs.",
      "Session timeout is 15 minutes.",
      "Step 1: Open the audit console.",
      "Step 3: Confirm the audit record.",
      explicitGap,
      'Refer to the section "Recovery Procedure".',
      "",
      "## Empty Checklist",
    ].join("\n")),
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: "operations-b.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Audit Operations",
      "",
      negativeClaim,
      "Administrators should review audit logs.",
      "Session timeout is 30 minutes.",
    ].join("\n")),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)

  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("conflict-count")).toHaveText("2")
  await expect(page.getByTestId("grounded-conflict").filter({ hasText: "Operators" })).toBeVisible()
  await expect(page.getByTestId("grounded-conflict").filter({ hasText: "Session timeout" })).toBeVisible()
  await expect(page.getByTestId("grounded-conflict").filter({ hasText: "Administrators" })).toHaveCount(0)
  await expect(page.getByTestId("grounded-gap").filter({ hasText: "Source explicitly identifies missing information" })).toBeVisible()
  await expect(page.getByTestId("grounded-gap").filter({ hasText: "Referenced topic not found: Recovery Procedure" })).toBeVisible()
  await expect(page.getByTestId("grounded-gap").filter({ hasText: "No source content under “Empty Checklist”" })).toBeVisible()
  await expect(page.getByTestId("grounded-gap").filter({ hasText: "Workflow step 2 not found in source" })).toBeVisible()
  await expect(page.getByText("Not found in sources", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Nexus Technical Spec", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Asteria", { exact: false })).toHaveCount(0)

  let stored: StoredProject | undefined
  await expect.poll(async () => {
    stored = (await readProjects(page)).find(project => project.projectName === projectName)
    return stored?.conceptAnalysis?.conflicts.length
  }).toBe(2)
  if (!stored?.evidenceIndex || !stored.conceptAnalysis) throw new Error("Expected persisted findings")
  expect(stored.conceptAnalysis.version).toBe(2)
  const evidenceById = new Map(stored.evidenceIndex.items.map(item => [item.id, item]))
  const operatorsConflict = stored.conceptAnalysis.conflicts.find(conflict => conflict.subject === "Operators")!
  expect(operatorsConflict.sides.map(side => side.claimText).sort()).toEqual([negativeClaim.slice(0, -1), positiveClaim.slice(0, -1)].sort())
  expect(operatorsConflict.sides.flatMap(side => side.evidenceRefs).map(reference => reference.sourceFileName).sort())
    .toEqual(["operations-a.md", "operations-b.md"])
  for (const finding of [...stored.conceptAnalysis.conflicts, ...stored.conceptAnalysis.gaps]) {
    expect(finding.evidenceIds.length).toBeGreaterThan(0)
    expect(finding.evidenceRefs.map(reference => reference.evidenceId)).toEqual(finding.evidenceIds)
    for (const reference of finding.evidenceRefs) {
      const evidence = evidenceById.get(reference.evidenceId)
      expect(reference).toEqual({
        evidenceId: evidence!.id,
        sourceId: evidence!.sourceId,
        fileId: evidence!.fileId,
        sourceFileName: evidence!.sourceFileName,
        location: evidence!.location,
      })
    }
  }

  const conflictRow = page.getByTestId("grounded-conflict").filter({ hasText: "Operators" })
  await conflictRow.getByRole("button").first().click()
  await conflictRow.getByTestId("analysis-evidence-reference").filter({ hasText: negativeClaim }).click()
  await expect(page.getByTestId("analysis-evidence-dialog")).toContainText(negativeClaim)
  await page.getByTestId("analysis-evidence-dialog").getByRole("button").click()

  const conflictIds = stored.conceptAnalysis.conflicts.map(conflict => conflict.id)
  const gapIds = stored.conceptAnalysis.gaps.map(gap => gap.id)
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("conflict-count")).toHaveText("2")
  const reloaded = (await readProjects(page)).find(project => project.projectName === projectName)!
  expect(reloaded.conceptAnalysis!.conflicts.map(conflict => conflict.id)).toEqual(conflictIds)
  expect(reloaded.conceptAnalysis!.gaps.map(gap => gap.id)).toEqual(gapIds)
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

  let before: StoredProject | undefined
  await expect.poll(async () => {
    before = (await readProjects(page)).find(project => project.projectName === projectName)
    return {
      conceptVersion: before?.conceptAnalysis?.version,
      unsupportedStatus: before?.unsupportedAnalysis?.status,
    }
  }).toEqual({ conceptVersion: 2, unsupportedStatus: "no-analyzable-content" })
  if (!before?.conceptAnalysis || !before.unsupportedAnalysis) throw new Error("Expected persisted analysis")
  const findingsBeforeStale = {
    conflicts: before.conceptAnalysis.conflicts,
    gaps: before.conceptAnalysis.gaps,
  }
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
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("rebuild-concept-analysis")).toBeDisabled()
  await expect(page.getByTestId("rebuild-unsupported-analysis")).toBeDisabled()
  const staleProject = (await readProjects(page)).find(project => project.projectName === projectName)!
  expect({
    conflicts: staleProject.conceptAnalysis!.conflicts,
    gaps: staleProject.conceptAnalysis!.gaps,
  }).toEqual(findingsBeforeStale)
  await page.getByRole("button", { name: /Sources$/ }).click()
  await page.getByTestId("rebuild-evidence-index").click()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")

  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Stale")
  await page.getByTestId("rebuild-concept-analysis").click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Stale")
  await page.getByTestId("rebuild-unsupported-analysis").click()
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
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
    buffer: Buffer.from([
      "# Stellar Navigation Console",
      "",
      "Stellar Navigation Console must display the Guidance Vector.",
      "Navigation timeout is 10 minutes.",
      "Recovery details are TBD.",
    ].join("\n")),
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: "navigation-policy.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Stellar Navigation Console",
      "",
      "Stellar Navigation Console must not display the Guidance Vector.",
      "Navigation timeout is 20 minutes.",
    ].join("\n")),
  })
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect.poll(async () => {
    const project = (await readProjects(page)).find(candidate => candidate.projectName === projectName)
    return project?.unsupportedAnalysis?.status
  }).toBe("no-analyzable-content")
  await page.waitForTimeout(1_000)
  await seedAnalyzableContent(page, projectName, [
    { id: "navigation-claim", type: "para", content: "Stellar Navigation Console supports teleportation." },
  ])
  await page.reload()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("unsupported-count")).toHaveText("1")

  let original: StoredProject | undefined
  await expect.poll(async () => {
    original = (await readProjects(page)).find(project => project.projectName === projectName)
    return original?.unsupportedAnalysis?.findings.length ?? 0
  }).toBe(1)
  if (!original?.conceptAnalysis || !original.unsupportedAnalysis) throw new Error("Expected original analysis")
  const originalFileIds = new Set(original.sourceFileIds)
  const originalConceptIds = original.conceptAnalysis.concepts.map(concept => concept.id)
  const originalTermIds = original.conceptAnalysis.terminology.map(term => term.id)

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const projects = await readProjects(page)
  const duplicate = projects.find(project => project.projectName === duplicateName)!
  const originalAfter = projects.find(project => project.projectName === projectName)!
  const duplicateFileIds = new Set(duplicate.sourceFileIds)
  expect([...duplicateFileIds].every(fileId => !originalFileIds.has(fileId))).toBe(true)
  expect(duplicate.conceptAnalysis!.concepts.map(concept => concept.id)).toEqual(originalConceptIds)
  expect(duplicate.conceptAnalysis!.terminology.map(term => term.id)).toEqual(originalTermIds)
  for (const record of [
    ...duplicate.conceptAnalysis!.concepts,
    ...duplicate.conceptAnalysis!.terminology,
    ...duplicate.conceptAnalysis!.conflicts,
    ...duplicate.conceptAnalysis!.gaps,
    ...duplicate.conceptAnalysis!.conflicts.flatMap(conflict => conflict.sides),
  ]) {
    expect(record.evidenceRefs.every(reference =>
      duplicateFileIds.has(reference.sourceId) && duplicateFileIds.has(reference.fileId))).toBe(true)
    expect(record.evidenceRefs.every(reference =>
      !originalFileIds.has(reference.sourceId) && !originalFileIds.has(reference.fileId))).toBe(true)
  }
  expect(duplicate.conceptAnalysis!.conflicts.map(conflict => conflict.id))
    .toEqual(original.conceptAnalysis.conflicts.map(conflict => conflict.id))
  expect(duplicate.conceptAnalysis!.gaps.map(gap => gap.id))
    .toEqual(original.conceptAnalysis.gaps.map(gap => gap.id))
  expect(duplicate.unsupportedAnalysis!.findings.map(finding => finding.id))
    .toEqual(original.unsupportedAnalysis.findings.map(finding => finding.id))
  for (const candidate of duplicate.unsupportedAnalysis!.findings.flatMap(finding => finding.nearMatches)) {
    expect(duplicateFileIds.has(candidate.sourceId)).toBe(true)
    expect(duplicateFileIds.has(candidate.fileId)).toBe(true)
    expect(originalFileIds.has(candidate.sourceId)).toBe(false)
    expect(originalFileIds.has(candidate.fileId)).toBe(false)
  }
  expect(originalAfter.conceptAnalysis).toEqual(original.conceptAnalysis)
  expect(originalAfter.unsupportedAnalysis).toEqual(original.unsupportedAnalysis)

  await page.getByText(duplicateName, { exact: true }).click()
  await waitForCurrentEvidence(page)
  await openRealAnalysis(page)
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  await expect(page.getByTestId("unsupported-count")).toHaveText("1")
  await expect(page.getByTestId("grounded-concept").filter({ hasText: "Stellar Navigation Console" })).toBeVisible()
})