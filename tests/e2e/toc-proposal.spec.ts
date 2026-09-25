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
  topicContent: Record<string, Array<{ id: string; type: string; content: string }>>
  authorTopicMetadata: Record<string, {
    generationStatus: string
    generatedFreshness: string
    contentOrigin: string
    approved: boolean
    draft?: { draftId: string; method: string; evidenceIdsUsed: string[] }
    groundingContext?: { contextId: string }
    appliedBaseline?: { draftId: string; blocks: Array<{ sourceBlockId: string; appliedBlockId: string }> }
    provenance?: { tocRevision: number; groundingContextId: string }
    blockStates?: Record<string, string>
  }>
  tocRevision: number
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

test("turns the same internal headings into evidence-grounded, content-type-specific TOCs", async ({ page }) => {
  await page.goto("/")
  const result = await page.evaluate(async () => {
    const path = "/src/tocProposal.ts"
    const { buildTocProposal, isTocProposalFresh } = await import(path)
    const sections = [
      ["Internal operating model", "The platform organizes projects."],
      ["Workspace shell", "Users can navigate workspaces from the dashboard."],
      ["Search pipeline", "Users can search projects by title."],
      ["Review queue", "Users can review and approve drafts."],
      ["Delivery gateway", "Users can export completed reports."],
      ["Setup sequence", "Users can sign in with their account."],
      ["Export adapter", "The adapter stores internal archive metadata."],
    ]
    const items = sections.flatMap(([title, body], index) => {
      const sectionPath = index === 0 ? [title] : ["Internal operating model", title]
      const common = {
        sourceId: "source-1",
        fileId: "source-1",
        sourceFileName: "internal-notes.md",
        location: sectionPath.join(" › "),
        sectionPath,
      }
      return [
        { ...common, id: `h${index}`, blockId: `h${index}`, text: title, blockType: "heading" as const, headingLevel: index === 0 ? 1 : 2, order: index * 2 },
        { ...common, id: `p${index}`, blockId: `p${index}`, text: body, blockType: "paragraph" as const, order: index * 2 + 1 },
      ]
    })
    items.push(
      { ...items[4], id: "h-duplicate", blockId: "h-duplicate", sourceId: "source-2", fileId: "source-2", sourceFileName: "more-notes.md", order: 14, sectionPath: ["Appendix", "Search pipeline"], location: "Appendix › Search pipeline" },
      { ...items[5], id: "p-duplicate", blockId: "p-duplicate", sourceId: "source-2", fileId: "source-2", sourceFileName: "more-notes.md", order: 15, sectionPath: ["Appendix", "Search pipeline"], location: "Appendix › Search pipeline", text: "Users can search projects by ID." },
    )
    const evidenceIndex = { items, sourcesRevision: 4, extractionRevision: "extract-fixture", builtAt: 100 }
    const analysis = {
      version: 2 as const,
      method: "deterministic-evidence-heuristics-v1" as const,
      evidenceSourcesRevision: 4,
      evidenceExtractionRevision: "extract-fixture",
      builtAt: 200,
      concepts: [],
      terminology: [],
      conflicts: [],
      gaps: [],
    }
    const userGuide = buildTocProposal(evidenceIndex, analysis, "user-guide")
    const adminGuide = buildTocProposal(evidenceIndex, analysis, "admin-guide")
    const repeated = buildTocProposal(evidenceIndex, analysis, "user-guide")
    return {
      sourceTitles: sections.map(section => section[0]),
      userGuide,
      adminGuide,
      repeated,
      current: isTocProposalFresh(userGuide, evidenceIndex, analysis, "user-guide"),
      staleType: isTocProposalFresh(userGuide, evidenceIndex, analysis, "admin-guide"),
      staleEvidence: isTocProposalFresh(userGuide, { ...evidenceIndex, sourcesRevision: 5 }, analysis, "user-guide"),
    }
  })

  const userTopics = result.userGuide.items
  const adminTopics = result.adminGuide.items
  const userHeadings = userTopics.filter(topic => topic.topicId.startsWith("heading-"))
  const adminHeadings = adminTopics.filter(topic => topic.topicId.startsWith("heading-"))
  expect(userHeadings).toHaveLength(result.sourceTitles.length)
  expect(userHeadings.map(topic => topic.title).some(title => result.sourceTitles.includes(title))).toBe(false)
  expect(userHeadings.map(topic => topic.title)).toEqual(expect.arrayContaining([
    "Sign in with your account",
    "Navigate workspaces from the dashboard",
    "Search projects by title",
    "Review and approve drafts",
    "Export completed reports",
    "Understand Export adapter",
  ]))
  expect(userHeadings.find(topic => topic.title === "Understand Export adapter")?.parentTopicId)
    .toBe(userTopics.find(topic => topic.title === "Key concepts")?.topicId)
  expect(userTopics.filter(topic => topic.level === 1 && topic.proposalKind === "evidence-backed").map(topic => topic.title)).toEqual([
    "Getting started",
    "Navigate the product",
    "Search",
    "Review and approve",
    "Export",
    "Key concepts",
  ])
  expect(userTopics.some(topic => topic.title === "Troubleshooting" && topic.proposalKind === "evidence-backed")).toBe(false)
  expect(userTopics.find(topic => topic.title === "Troubleshooting")?.proposalKind).toBe("optional-structural")
  expect(adminTopics.some(topic => topic.title === "Workspace and navigation" && topic.proposalKind === "evidence-backed")).toBe(true)
  expect(adminTopics.map(topic => topic.title)).not.toEqual(userTopics.map(topic => topic.title))
  expect(adminHeadings.map(topic => topic.topicId)).toEqual(userHeadings.map(topic => topic.topicId))
  expect(result.repeated.items).toEqual(userTopics)
  const searchTopic = userHeadings.find(topic => topic.title === "Search projects by title")
  expect(searchTopic?.supportingEvidenceIds).toEqual(expect.arrayContaining(["h2", "p2", "h-duplicate", "p-duplicate"]))
  expect(searchTopic?.sourceSectionPaths).toContainEqual(["Appendix", "Search pipeline"])
  for (let index = 0; index < userHeadings.length; index++) {
    const topic = userHeadings.find(candidate => candidate.supportingEvidenceIds.includes(`h${index}`))
    expect(topic?.supportingEvidenceIds).toContain(`p${index}`)
    expect(topic?.sourceSectionPaths?.[0]).toEqual(index === 0
      ? ["Internal operating model"] : ["Internal operating model", result.sourceTitles[index]])
    expect(topic?.rationale).toContain(result.sourceTitles[index])
    const parent = userTopics.find(candidate => candidate.topicId === topic?.parentTopicId)
    expect(parent?.supportingEvidenceIds).toContain(`h${index}`)
  }
  expect(new Set(userTopics.map(topic => topic.topicId)).size).toBe(userTopics.length)
  expect(new Set(userTopics.map(topic => topic.id)).size).toBe(userTopics.length)
  expect(result.current).toBe(true)
  expect(result.staleType).toBe(false)
  expect(result.staleEvidence).toBe(false)
})

test("generates a grounded, reviewable TOC and persists review edits before commit", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Grounded TOC ${Date.now()}`
  await createGroundedProject(page, projectName)

  await page.getByTestId("generate-grounded-toc").click()
  await expect(page.getByTestId("toc-proposal-review")).toBeVisible()
  await expect(page.getByTestId("toc-proposal-freshness")).toHaveText("Current")
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Understand Flight Operations" })).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: /^H2Understand Access ControlEvidence-backed/ })).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Evidence-backed" }).first()).toBeVisible()
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Optional structure" }).first()).toBeVisible()
  await expect(page.getByText("Nexus", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Asteria", { exact: false })).toHaveCount(0)

  const flightTopic = page.getByTestId("toc-proposal-topic").filter({ hasText: "Understand Flight Operations" })
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
  await expect(page.getByTestId("committed-toc-panel")).toContainText("Understand Flight Operations")

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
  const beforeContent = structuredClone(before.topicContent)
  const beforeDrafts = Object.fromEntries(Object.entries(before.authorTopicMetadata)
    .map(([id, metadata]) => [id, metadata.draft?.draftId]))

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
  expect(after.appToc.filter(item => item.title === "Understand Flight Operations")).toHaveLength(1)
  expect(after.appToc.some(item => item.title === "Release validation")).toBe(true)
  expect(after.topicContent).toEqual(beforeContent)
  for (const [id, draftId] of Object.entries(beforeDrafts)) {
    expect(after.authorTopicMetadata[id]?.draft?.draftId).toBe(draftId)
  }
})

test("committing evidence-backed topics opens editable initial drafts without filling unsupported topics", async ({ page }) => {
  test.setTimeout(90_000)
  const projectName = `Initial grounded drafts ${Date.now()}`
  await createGroundedProject(page, projectName)
  await page.getByTestId("generate-grounded-toc").click()
  await page.getByTestId("manual-topic-title").fill("Operator checklist")
  await page.getByTestId("add-manual-topic").click()
  await page.getByTestId("commit-toc-proposal").click()
  await expect.poll(async () => (await readProject(page, projectName)).appToc.length).toBeGreaterThan(0)
  await expect.poll(async () => (await readProject(page, projectName)).tocProposal).toBeNull()

  let stored = await readProject(page, projectName)
  const supported = stored.appToc.find(topic =>
    topic.topicId && stored.authorTopicMetadata[topic.topicId]?.generationStatus === "generated")
  expect(supported, JSON.stringify(stored.appToc.map(topic => ({
    title: topic.title,
    id: topic.topicId,
    kind: topic.proposalKind,
    evidence: topic.supportingEvidenceIds,
    metadata: topic.topicId ? stored.authorTopicMetadata[topic.topicId]?.generationStatus : null,
  })))).toBeDefined()
  const topicId = supported!.topicId!
  const metadata = stored.authorTopicMetadata[topicId]
  const blocks = stored.topicContent[topicId]
  expect(blocks.some(block => block.type === "para"
    && /Flight Operations|Access Control|Token Rotation/.test(block.content))).toBe(true)
  expect(metadata).toMatchObject({
    generationStatus: "generated",
    generatedFreshness: "current",
    contentOrigin: "generated",
    approved: false,
    draft: { method: "deterministic-evidence-draft-v1" },
    provenance: { tocRevision: stored.tocRevision, groundingContextId: metadata.groundingContext!.contextId },
    appliedBaseline: { draftId: metadata.draft!.draftId },
  })
  expect(metadata.draft!.evidenceIdsUsed.length).toBeGreaterThan(0)
  expect(metadata.appliedBaseline!.blocks).toHaveLength(blocks.length)
  expect(Object.values(metadata.blockStates!)).toEqual(blocks.map(() => "generated"))

  const unsupported = stored.appToc.find(topic => topic.title === "Operator checklist")
  expect(unsupported?.topicId).toBeTruthy()
  expect(stored.topicContent[unsupported!.topicId!]).toBeUndefined()
  expect(stored.authorTopicMetadata[unsupported!.topicId!]?.generationStatus).toBe("not-generated")

  await page.getByRole("button", { name: /Author/ }).click()
  await page.locator(`[title="${supported!.title} — double-click to open"]`).dispatchEvent("dblclick")
  await expect(page.getByTestId("author-generated-freshness")).toContainText("Current")
  await expect(page.getByText(blocks.find(block => block.type === "para")!.content, { exact: true }).first()).toBeVisible()
  await page.locator(`[title="${unsupported!.title} — double-click to open"]`).dispatchEvent("dblclick")
  await expect(page.getByTestId("author-generated-freshness")).toContainText("Needs Grounding")
  await expect.poll(async () =>
    (await readProject(page, projectName)).topicContent[unsupported!.topicId!]?.filter(block => block.type !== "h1").length ?? 0,
  ).toBe(0)

  await page.reload()
  stored = await readProject(page, projectName)
  expect(stored.topicContent[topicId]).toEqual(blocks)
  expect(stored.authorTopicMetadata[topicId].draft?.draftId).toBe(metadata.draft?.draftId)
  expect(stored.authorTopicMetadata[topicId].generatedFreshness).toBe("current")

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  const duplicateName = `${projectName} Copy`
  await expect.poll(async () => (await readProject(page, duplicateName))
    .authorTopicMetadata[topicId]?.generatedFreshness).toBe("current")
  const duplicate = await readProject(page, duplicateName)
  expect(duplicate.topicContent[topicId]).toEqual(blocks)
  expect(duplicate.authorTopicMetadata[topicId].draft?.method).toBe("deterministic-evidence-draft-v1")
  expect(duplicate.authorTopicMetadata[topicId].draft?.evidenceIdsUsed).toEqual(metadata.draft?.evidenceIdsUsed)
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
  await expect(page.getByTestId("toc-proposal-topic").filter({ hasText: "Understand Release Validation" }).first()).toBeVisible()
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
  await expect(page.getByTestId("committed-toc-panel")).toContainText("Understand Flight Operations")
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