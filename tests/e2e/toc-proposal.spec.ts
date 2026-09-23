import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ mode: "serial" })

type StoredTopic = {
  id: number
  topicId?: string
  title: string
  proposalKind?: string
  supportingEvidenceIds?: string[]
}

type StoredProject = {
  projectId: string
  projectName: string
  projectMeta: { contentType: string }
  appToc: StoredTopic[]
  tocProposal: {
    contentType: string
    evidenceSourcesRevision: number
    evidenceExtractionRevision: string
    groundedAnalysisBuiltAt: number
    items: StoredTopic[]
  } | null
  evidenceIndex: {
    sourcesRevision: number
    extractionRevision: string
  } | null
  conceptAnalysis: {
    builtAt: number
  } | null
  tocGeneratedFromEvidenceSourcesRevision: number
  tocGeneratedFromEvidenceExtractionRevision: string
  tocGeneratedFromConceptBuiltAt: number
  tocGeneratedFromContentType: string
}

async function createGroundedProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: "flight-operations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Flight Operations",
      "",
      "Flight Operations coordinates orbital launch workspaces.",
      "",
      "## Access Control",
      "",
      "Orbital Access Control protects every launch workspace.",
      "",
      "## Token Rotation",
      "",
      "Token Rotation is reviewed by the Flight Security Team.",
    ].join("\n")),
  })
  await expect(
    page.getByTestId("source-file-row").getByText("flight-operations.md", { exact: true }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current", { timeout: 15_000 })
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await page.getByRole("button", { name: "TOC" }).click()
  await expect(page.getByTestId("real-toc-screen")).toBeVisible()
}

async function readProject(page: Page, projectName: string): Promise<StoredProject> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result as StoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    return project
  }, projectName)
}

test("generates a grounded, reviewable TOC and persists review edits before commit", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Grounded TOC ${Date.now()}`
  await createGroundedProject(page, projectName)

  await page.getByTestId("generate-grounded-toc").click()
  await expect(page.getByTestId("toc-proposal-review")).toBeVisible()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Current")
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Flight Operations" })).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: /^H2Access ControlEvidence-backed/ })).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Evidence-backed" }).first()).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Optional structure" }).first()).toBeVisible()
  await expect(page.getByText("Nexus", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Asteria", { exact: false })).toHaveCount(0)

  const flightTopic = page.getByTestId("toc-proposal-topic").filter({ hasText: "Flight Operations" })
  await flightTopic.click()
  await page.getByTestId("toc-supporting-evidence").first().click()
  await expect(page.getByTestId("toc-evidence-dialog")).toContainText("flight-operations.md")
  await page.getByRole("button", { name: "Close" }).click()

  await page.getByTestId("manual-topic-title").fill("Operator checklist")
  await page.getByTestId("add-manual-topic").click()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Operator checklist" })).toBeVisible()

  await expect.poll(async () => (await readProject(page, projectName)).tocProposal?.items.some(item => item.title === "Operator checklist")).toBe(true)
  await page.reload()
  await page.getByRole("button", { name: "TOC" }).click()
  await expect(page.getByTestId("toc-proposal-review")).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Operator checklist" })).toBeVisible()

  await page.getByTestId("commit-toc-proposal").click()
  await expect(page.getByTestId("real-toc-screen")).toBeVisible()
  await expect(page.getByTestId("committed-toc-panel")).toContainText("Flight Operations")

  await expect.poll(async () => (await readProject(page, projectName)).tocProposal).toBeNull()
  const stored = await readProject(page, projectName)
  expect(stored.tocProposal).toBeNull()
  expect(stored.appToc.some(item => item.title === "Operator checklist" && item.proposalKind === "manual")).toBe(true)
  expect(stored.appToc.every(item => typeof item.topicId === "string" && item.topicId.length > 0)).toBe(true)
  expect(stored.tocGeneratedFromEvidenceSourcesRevision).toBeGreaterThanOrEqual(0)
  expect(stored.tocGeneratedFromEvidenceExtractionRevision).toMatch(/^extract-/)
  expect(stored.tocGeneratedFromConceptBuiltAt).toBeGreaterThan(0)
})

test("requires confirmation and preserves committed topics when merging a later proposal", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `TOC Merge ${Date.now()}`
  await createGroundedProject(page, projectName)
  await page.getByTestId("generate-grounded-toc").click()
  await page.getByTestId("commit-toc-proposal").click()
  await expect.poll(async () => (await readProject(page, projectName)).appToc.length).toBeGreaterThan(0)
  const before = await readProject(page, projectName)
  const beforeIds = before.appToc.map(item => `${item.id}:${item.topicId}:${item.title}`)

  await page.getByTestId("generate-grounded-toc").click()
  await page.getByTestId("manual-topic-title").fill("Release validation")
  await page.getByTestId("add-manual-topic").click()
  await page.getByTestId("commit-toc-proposal").click()
  await expect(page.getByTestId("toc-merge-confirmation")).toBeVisible()
  await expect(page.getByTestId("committed-toc-panel")).toHaveCount(0)
  await page.getByTestId("confirm-toc-merge").click()

  await expect(page.getByTestId("committed-toc-panel")).toContainText("Release validation")
  await expect.poll(async () => (await readProject(page, projectName)).appToc.some(item => item.title === "Release validation")).toBe(true)
  const after = await readProject(page, projectName)
  expect(after.appToc.slice(0, beforeIds.length).map(item => `${item.id}:${item.topicId}:${item.title}`)).toEqual(beforeIds)
  expect(after.appToc.filter(item => item.title === "Flight Operations")).toHaveLength(1)
  expect(after.appToc.some(item => item.title === "Release validation")).toBe(true)
})

test("marks an uncommitted proposal stale after source evidence changes", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `TOC Freshness ${Date.now()}`
  await createGroundedProject(page, projectName)
  await page.getByTestId("generate-grounded-toc").click()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Current")

  await page.getByRole("button", { name: "Sources" }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: "release-validation.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([
      "# Release Validation",
      "",
      "Release validation requires a signed operator checklist.",
    ].join("\n")),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Stale", { timeout: 15_000 })
  await page.getByTestId("rebuild-evidence-index").click()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  await page.getByRole("button", { name: "TOC" }).click()

  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Stale")
  await expect(page.getByText("Regenerate before committing.", { exact: false })).toBeVisible()
  await expect(page.getByTestId("commit-toc-proposal")).toBeDisabled()
  await expect(page.getByTestId("regenerate-grounded-toc")).toBeDisabled()
  await page.getByRole("button", { name: "Analysis" }).click()
  await page.getByTestId("rebuild-concept-analysis").click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await page.getByRole("button", { name: "TOC" }).click()
  await page.getByTestId("regenerate-grounded-toc").click()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Current")
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Release Validation" }).first()).toBeVisible()
})

test("marks a committed TOC stale after the project content type changes without replacing it", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `TOC Content Type ${Date.now()}`
  await createGroundedProject(page, projectName)
  await page.getByTestId("generate-grounded-toc").click()
  await page.getByTestId("commit-toc-proposal").click()
  await expect(page.getByTestId("committed-toc-panel")).toBeVisible()
  await expect.poll(async () => (await readProject(page, projectName)).tocGeneratedFromContentType).toBe("user-guide")

  const before = await readProject(page, projectName)
  const committedTopics = before.appToc.map(item => `${item.id}:${item.topicId}:${item.title}`)

  await page.getByRole("button", { name: /Details/ }).click()
  await page.getByRole("button", { name: /Admin Guide/ }).click()
  await expect.poll(async () => (await readProject(page, projectName)).projectMeta.contentType).toBe("admin-guide")
  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByText(projectName, { exact: true }).click()
  await page.getByRole("button", { name: "TOC" }).click()

  await expect(page.getByTestId("committed-toc-stale")).toBeVisible()
  await expect(page.getByTestId("committed-toc-panel")).toContainText("Flight Operations")
  const after = await readProject(page, projectName)
  expect(after.tocGeneratedFromContentType).toBe("user-guide")
  expect(after.appToc.map(item => `${item.id}:${item.topicId}:${item.title}`)).toEqual(committedTopics)
})

test("keeps a stale TOC proposal stale when the project is duplicated", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `TOC Stale Duplicate ${Date.now()}`
  const duplicateName = `${projectName} Copy`
  await createGroundedProject(page, projectName)
  await page.getByTestId("generate-grounded-toc").click()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Current")

  await page.getByRole("button", { name: "Sources" }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: "changed-evidence.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Changed Evidence\n\nThis source changes the frozen evidence revision."),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Stale", { timeout: 15_000 })
  await page.getByTestId("rebuild-evidence-index").click()
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current")
  await page.getByRole("button", { name: "TOC" }).click()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Stale")

  const original = await readProject(page, projectName)
  if (!original.tocProposal || !original.evidenceIndex) throw new Error("Expected a stale persisted proposal")
  expect(original.tocProposal.evidenceExtractionRevision).not.toBe(original.evidenceIndex.extractionRevision)
  const originalProposalProvenance = {
    evidenceSourcesRevision: original.tocProposal.evidenceSourcesRevision,
    evidenceExtractionRevision: original.tocProposal.evidenceExtractionRevision,
    groundedAnalysisBuiltAt: original.tocProposal.groundedAnalysisBuiltAt,
  }
  const originalTopicIds = original.tocProposal.items.map(item => item.topicId)

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()
  const duplicate = await readProject(page, duplicateName)
  if (!duplicate.tocProposal || !duplicate.evidenceIndex) throw new Error("Expected copied proposal and evidence")

  expect({
    evidenceSourcesRevision: duplicate.tocProposal.evidenceSourcesRevision,
    evidenceExtractionRevision: duplicate.tocProposal.evidenceExtractionRevision,
    groundedAnalysisBuiltAt: duplicate.tocProposal.groundedAnalysisBuiltAt,
  }).toEqual(originalProposalProvenance)
  expect(duplicate.tocProposal.evidenceExtractionRevision).not.toBe(duplicate.evidenceIndex.extractionRevision)
  expect(duplicate.tocProposal.items.map(item => item.topicId)).toEqual(originalTopicIds)

  await page.getByText(duplicateName, { exact: true }).click()
  await page.getByRole("button", { name: "TOC" }).click()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("commit-toc-proposal")).toBeDisabled()
})