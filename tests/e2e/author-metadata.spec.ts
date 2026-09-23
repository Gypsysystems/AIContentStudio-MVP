import { expect, test, type Page } from "@playwright/test"
import { buildTopicGroundingContext } from "../../src/authorGroundingContext"
import type { ConceptAnalysis } from "../../src/conceptAnalysis"
import type { EvidenceIndex } from "../../src/evidenceIndex"
import type { SourceExtraction } from "../../src/sourceExtractor"
import type {
  AuthorAppliedBaseline,
  AuthorBlockState,
  AuthorRegenerationProposal,
  AuthorTopicDraft,
} from "../../src/authorDraftGeneration"

test.describe.configure({ mode: "serial" })

type StoredTopic = {
  id: number
  topicId: string
  title: string
  level: 1 | 2 | 3 | 4
  words: number
  isNew?: boolean
}

type AuthorTopicMetadata = {
  topicId: string
  generationStatus: "not-generated" | "draft" | "generated" | "failed"
  contentOrigin: "manual" | "generated" | "mixed" | "approved"
  evidenceIds: string[]
  sourcePaths: string[][]
  sourceFileIds: string[]
  groundingContext: unknown | null
  draft: AuthorTopicDraft | null
  appliedBaseline: AuthorAppliedBaseline | null
  regenerationProposal: AuthorRegenerationProposal | null
  blockStates: Record<string, AuthorBlockState>
  provenance: {
    sourcesRevision: number | null
    evidenceExtractionRevision: string | null
    evidenceIndexBuiltAt: number | null
    analysisBuiltAt: number | null
    analysisRevision: number | null
    tocRevision: number | null
    contentType: string
    variableSnapshot: Record<string, string>
    variableFingerprint: string | null
    groundingContextId: string | null
    language: string
    styleProfileId: string | null
    styleFingerprint: string | null
  }
  generatedAt: number | null
  generatedFreshness: "not-applicable" | "current" | "stale" | "needs-grounding"
  generatedFreshnessReason: string | null
  manualEdited: boolean
  approved: boolean
  legacyHydrated: boolean
}

type StoredProject = {
  projectId: string
  projectName: string
  isDemoMode: boolean
  projectMeta: { contentType: string }
  appToc: StoredTopic[]
  topicContent: Record<string, unknown[]>
  authorTopicMetadata?: Record<string, AuthorTopicMetadata>
  sourceFileIds: string[]
  sourceExtractions: Record<string, SourceExtraction>
  sourcesRevision: number
  evidenceIndex: EvidenceIndex | null
  conceptAnalysis: ConceptAnalysis | null
  analysisRevision: number
  tocRevision?: number
}

function metadata(
  topicId: string,
  overrides: Partial<AuthorTopicMetadata> = {},
): AuthorTopicMetadata {
  return {
    topicId,
    generationStatus: "generated",
    contentOrigin: "generated",
    evidenceIds: [],
    sourcePaths: [],
    sourceFileIds: [],
    groundingContext: null,
    draft: null,
    appliedBaseline: null,
    regenerationProposal: null,
    blockStates: {},
    provenance: {
      sourcesRevision: null,
      evidenceExtractionRevision: null,
      evidenceIndexBuiltAt: null,
      analysisBuiltAt: null,
      analysisRevision: null,
      tocRevision: null,
      contentType: "user-guide",
      variableSnapshot: { product: "Orbital Console" },
      variableFingerprint: null,
      groundingContextId: null,
      language: "",
      styleProfileId: null,
      styleFingerprint: null,
    },
    generatedAt: 1_700_000_000_000,
    generatedFreshness: "current",
    generatedFreshnessReason: null,
    manualEdited: false,
    approved: false,
    legacyHydrated: false,
    ...overrides,
  }
}

async function createProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
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

async function patchProject(
  page: Page,
  projectName: string,
  patch: Partial<StoredProject>,
) {
  await page.evaluate(async ({ name, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction("projects", "readwrite")
    const store = transaction.objectStore("projects")
    const project = await new Promise<StoredProject>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const found = (request.result as StoredProject[]).find(candidate => candidate.projectName === name)
        if (!found) return reject(new Error(`Project not found: ${name}`))
        resolve(found)
      }
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ ...project, ...values })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { name: projectName, values: patch })
}

test("persists and reloads per-topic Author grounding metadata without changing topic content", async ({ page }) => {
  const projectName = `Author metadata persistence ${Date.now()}`
  await createProject(page, projectName)
  const toc: StoredTopic[] = [
    { id: 1, topicId: "topic-alpha", title: "Alpha", level: 1, words: 100 },
  ]
  const topicContent = {
    "topic-alpha": [{ id: "alpha-h1", type: "h1", content: "Alpha authored content" }],
  }
  const storedMetadata = metadata("topic-alpha", {
    contentOrigin: "mixed",
    evidenceIds: ["ev-alpha"],
    sourcePaths: [["Flight Operations", "Access Control"]],
    sourceFileIds: ["file-alpha"],
    manualEdited: true,
  })
  await patchProject(page, projectName, {
    appToc: toc,
    topicContent,
    authorTopicMetadata: { "topic-alpha": storedMetadata },
  })

  await page.reload()
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible()
  await expect.poll(async () => (await readProject(page, projectName)).authorTopicMetadata)
    .toEqual({ "topic-alpha": storedMetadata })
  expect((await readProject(page, projectName)).topicContent).toEqual(topicContent)

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-alpha"].contentOrigin,
  ).toBe("mixed")
})

test("hydrates legacy topic content as manual and does not infer demo or synthetic grounding", async ({ page }) => {
  const projectName = `Author legacy hydration ${Date.now()}`
  await createProject(page, projectName)
  const topicContent = {
    "1": [{ id: "legacy-h1", type: "h1", content: "Customer-authored legacy content" }],
  }
  await patchProject(page, projectName, {
    appToc: [{ id: 1, topicId: "topic-legacy", title: "Legacy", level: 1, words: 100 }],
    topicContent,
    authorTopicMetadata: null as unknown as Record<string, AuthorTopicMetadata>,
  })

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-legacy"],
  ).toBeTruthy()
  const project = await readProject(page, projectName)
  const legacy = project.authorTopicMetadata!["topic-legacy"]
  expect(legacy.generationStatus).toBe("not-generated")
  expect(legacy.contentOrigin).toBe("manual")
  expect(legacy.manualEdited).toBe(true)
  expect(legacy.legacyHydrated).toBe(true)
  expect(legacy.evidenceIds).toEqual([])
  expect(legacy.sourcePaths).toEqual([])
  expect(legacy.sourceFileIds).toEqual([])
  expect(legacy.generatedAt).toBeNull()
  expect(legacy.generatedFreshness).toBe("not-applicable")
  expect(project.topicContent).toEqual(topicContent)
  expect(JSON.stringify(legacy)).not.toMatch(/Nexus|Technical Spec|UX_Research/)
})

test("keeps metadata linked through rename and reorder, then removes only deleted topic metadata", async ({ page }) => {
  const projectName = `Author topic lifecycle ${Date.now()}`
  await createProject(page, projectName)
  const toc: StoredTopic[] = [
    { id: 1, topicId: "topic-alpha", title: "Alpha", level: 1, words: 100 },
    { id: 2, topicId: "topic-beta", title: "Beta", level: 1, words: 100 },
    { id: 3, topicId: "topic-gamma", title: "Gamma", level: 1, words: 100 },
  ]
  await patchProject(page, projectName, {
    appToc: toc,
    topicContent: {
      "1": [{ id: "a", type: "h1", content: "Alpha" }],
      "2": [{ id: "b", type: "h1", content: "Beta" }],
      "3": [{ id: "c", type: "h1", content: "Gamma" }],
    },
    authorTopicMetadata: {
      "topic-alpha": metadata("topic-alpha"),
      "topic-beta": metadata("topic-beta", { approved: true, contentOrigin: "approved" }),
      "topic-gamma": metadata("topic-gamma"),
    },
  })
  await page.reload()
  await page.getByRole("button", { name: "Author", exact: true }).click()

  const alpha = page.locator('[title="Alpha — double-click to open"]')
  await alpha.hover()
  await alpha.getByTitle("Rename").click()
  await alpha.locator("input").fill("Alpha renamed")
  await alpha.locator("input").press("Enter")
  await expect(page.locator('[title="Alpha renamed — double-click to open"]')).toBeVisible()

  const gamma = page.locator('[title="Gamma — double-click to open"]')
  await gamma.dragTo(page.locator('[title="Alpha renamed — double-click to open"]'))
  await expect.poll(async () => (await readProject(page, projectName)).appToc[0].topicId)
    .toBe("topic-gamma")
  expect(Object.keys((await readProject(page, projectName)).authorTopicMetadata!).sort())
    .toEqual(["topic-alpha", "topic-beta", "topic-gamma"])

  const beta = page.locator('[title="Beta — double-click to open"]')
  await beta.hover()
  await beta.getByTitle("Delete").click()
  await expect(beta).toHaveCount(0)
  await expect.poll(async () =>
    Object.keys((await readProject(page, projectName)).authorTopicMetadata!).sort(),
  ).toEqual(["topic-alpha", "topic-gamma"])

  const afterDelete = await readProject(page, projectName)
  expect(afterDelete.authorTopicMetadata!["topic-alpha"].topicId).toBe("topic-alpha")
  expect(afterDelete.authorTopicMetadata!["topic-gamma"].topicId).toBe("topic-gamma")
})

test("duplicates Author metadata and remaps copied source provenance consistently", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Author metadata duplicate ${Date.now()}`
  const duplicateName = `${projectName} Copy`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "author-grounding.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Author Grounding\n\nGrounded text for a future Author draft."),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current", { timeout: 15_000 })
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await expect.poll(async () => {
    const persisted = await readProject(page, projectName)
    return !!persisted.evidenceIndex && !!persisted.conceptAnalysis
  }).toBe(true)

  const original = await readProject(page, projectName)
  if (!original.evidenceIndex || !original.conceptAnalysis) {
    throw new Error("Expected evidence and concept analysis")
  }
  const originalFileId = original.sourceFileIds[0]
  const evidence = original.evidenceIndex.items[0]
  const generated = metadata("topic-grounded", {
    evidenceIds: [evidence.id],
    sourcePaths: [evidence.sectionPath ?? ["Author Grounding"]],
    sourceFileIds: [originalFileId],
    provenance: {
      sourcesRevision: original.evidenceIndex.sourcesRevision,
      evidenceExtractionRevision: original.evidenceIndex.extractionRevision,
      evidenceIndexBuiltAt: original.evidenceIndex.builtAt,
      analysisBuiltAt: original.conceptAnalysis.builtAt,
      analysisRevision: original.analysisRevision,
      tocRevision: original.tocRevision ?? 0,
      contentType: original.projectMeta.contentType,
      variableSnapshot: {},
      variableFingerprint: null,
      groundingContextId: null,
      language: "English",
      styleProfileId: "",
      styleFingerprint: null,
    },
  })
  generated.groundingContext = buildTopicGroundingContext({
    topic: {
      topicId: "topic-grounded",
      title: "Grounded",
      level: 1,
      rationale: "Evidence-backed test topic.",
      supportingEvidenceIds: [evidence.id],
      sourceSectionPaths: [evidence.sectionPath ?? ["Author Grounding"]],
      proposalKind: "evidence-backed",
    },
    evidenceIndex: original.evidenceIndex,
    sourceExtractions: original.sourceExtractions,
    sourcesRevision: original.sourcesRevision,
    conceptAnalysis: original.conceptAnalysis,
    analysisRevision: original.analysisRevision,
    tocRevision: original.tocRevision ?? 0,
    contentType: original.projectMeta.contentType,
    variables: [
      { id: "v1", name: "ProductName", value: "", description: "Full product name" },
      { id: "v2", name: "Version", value: "1.0", description: "Current version number" },
      { id: "v3", name: "CompanyName", value: "", description: "Company or organization name" },
      { id: "v4", name: "ReleaseDate", value: "", description: "Release date" },
      { id: "v5", name: "SupportEmail", value: "", description: "Support contact email" },
    ],
    selectedSourceFileIds: [originalFileId],
    writingGuidance: {
      language: (original.projectMeta as any).language ?? "en-US",
      styleProfileId: "legacy-rich-th1-bp1",
      styleProfileName: "Presight Brand",
      styleProfileScope: "project",
      brandNames: [],
    },
  })
  generated.provenance = {
    ...generated.provenance,
    sourcesRevision: generated.groundingContext.provenance.sourcesRevision,
    evidenceExtractionRevision: generated.groundingContext.provenance.evidenceExtractionRevision,
    evidenceIndexBuiltAt: generated.groundingContext.provenance.evidenceIndexBuiltAt,
    analysisBuiltAt: generated.groundingContext.provenance.analysisBuiltAt,
    analysisRevision: generated.groundingContext.provenance.analysisRevision,
    tocRevision: generated.groundingContext.provenance.tocRevision,
    contentType: generated.groundingContext.provenance.contentType,
    variableSnapshot: { ...generated.groundingContext.writingGuidance.variables },
    variableFingerprint: generated.groundingContext.provenance.variableFingerprint,
    groundingContextId: generated.groundingContext.contextId,
    language: generated.groundingContext.writingGuidance.language,
    styleProfileId: generated.groundingContext.writingGuidance.styleProfileId,
    styleFingerprint: generated.groundingContext.provenance.styleFingerprint,
  }
  await patchProject(page, projectName, {
    appToc: [{
      id: 1,
      topicId: "topic-grounded",
      title: "Grounded",
      level: 1,
      words: 100,
      rationale: "Evidence-backed test topic.",
      supportingEvidenceIds: [evidence.id],
      sourceSectionPaths: [evidence.sectionPath ?? ["Author Grounding"]],
      proposalKind: "evidence-backed",
    }],
    topicContent: {
      "topic-grounded": [{ id: "grounded-h1", type: "h1", content: "Existing content" }],
    },
    authorTopicMetadata: { "topic-grounded": generated },
  })
  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-grounded"]?.evidenceIds,
  ).toEqual([evidence.id])
  await expect.poll(async () => {
    const stored = (await readProject(page, projectName)).authorTopicMetadata!["topic-grounded"]
    return {
      freshness: stored.generatedFreshness,
      reason: stored.generatedFreshnessReason,
    }
  }).toEqual({ freshness: "current", reason: null })
  const originalWithMetadata = await readProject(page, projectName)

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const duplicate = await readProject(page, duplicateName)
  const copied = duplicate.authorTopicMetadata!["topic-grounded"]
  const copiedFileId = duplicate.sourceFileIds[0]
  expect(copiedFileId).not.toBe(originalFileId)
  expect(copied.sourceFileIds).toEqual([copiedFileId])
  expect(copied.evidenceIds).toEqual([evidence.id])
  expect(copied.sourcePaths).toEqual(generated.sourcePaths)
  expect(copied.provenance.sourcesRevision).toBe(duplicate.evidenceIndex!.sourcesRevision)
  expect(copied.provenance.evidenceExtractionRevision).toBe(duplicate.evidenceIndex!.extractionRevision)
  expect(copied.provenance.analysisBuiltAt).toBe(duplicate.conceptAnalysis!.builtAt)
  expect(copied.provenance.variableSnapshot).toEqual({
    ProductName: "",
    Version: "1.0",
    CompanyName: "",
    ReleaseDate: "",
    SupportEmail: "",
  })
  expect((copied.groundingContext as any).requiredEvidence[0].fileId).toBe(copiedFileId)
  expect((copied.groundingContext as any).sourceExtractions[0].fileId).toBe(copiedFileId)
  expect((copied.groundingContext as any).contextId).not.toBe((generated.groundingContext as any).contextId)
  expect({
    freshness: copied.generatedFreshness,
    reason: copied.generatedFreshnessReason,
  }).toEqual({ freshness: "current", reason: null })
  expect(duplicate.topicContent).toEqual(originalWithMetadata.topicContent)
  expect(duplicate.evidenceIndex!.items.every(item =>
    item.fileId === copiedFileId && item.sourceId === copiedFileId,
  )).toBe(true)
})

test("does not create Author grounding metadata from demo-only document content", async ({ page }) => {
  const projectName = `Author demo isolation ${Date.now()}`
  await createProject(page, projectName)
  await page.getByRole("button", { name: "Use demo project instead →" }).click()
  await expect(page.getByText(/Demo mode active/)).toBeVisible()
  await page.getByRole("button", { name: "Author", exact: true }).click()
  await expect(page.getByText("User Guide", { exact: true })).toBeVisible()

  await expect.poll(async () =>
    Object.keys((await readProject(page, projectName)).authorTopicMetadata ?? {}),
  ).toEqual([])
  const project = await readProject(page, projectName)
  expect(project.topicContent).toEqual({})
  expect(project.isDemoMode).toBe(true)
})

test("uses only persisted project sources and evidence in Author and reloads source selection by stable file ID", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Author real source context ${Date.now()}`
  await createProject(page, projectName)
  const sourceInput = page.locator('input[type="file"]')
  await sourceInput.setInputFiles({
    name: "access-control.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Access Control\n\nAdministrators must review privileged access every quarter."),
  })
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length)
    .toBe(1)
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect.poll(async () => (await readProject(page, projectName)).evidenceIndex?.items.length ?? 0)
    .toBeGreaterThan(0)

  const uploaded = await readProject(page, projectName)
  expect(uploaded.sourceFileIds).toHaveLength(1)
  const accessEvidence = uploaded.evidenceIndex!.items.find(item =>
    item.sourceFileName === "access-control.md")
  if (!accessEvidence) throw new Error("Expected extracted access-control evidence")

  await patchProject(page, projectName, {
    appToc: [{
      id: 1,
      topicId: "topic-real-sources",
      title: "Access requirements",
      level: 1,
      words: 0,
      isNew: true,
    }],
    topicContent: {
      "topic-real-sources": [{
        id: "real-source-heading",
        type: "h1",
        content: "Access requirements",
      }],
    },
    authorTopicMetadata: {
      "topic-real-sources": metadata("topic-real-sources", {
        generationStatus: "not-generated",
        contentOrigin: "manual",
        evidenceIds: [],
        sourcePaths: [],
        sourceFileIds: [],
        generatedAt: null,
        generatedFreshness: "not-applicable",
      }),
    },
  })

  await page.reload()
  await page.getByRole("button", { name: "Author", exact: true }).click()
  await page.locator('[title="Access requirements — double-click to open"]').dblclick()
  await page.getByRole("button", { name: /Generate with AI/ }).click()

  const sourceOptions = page.getByTestId("author-source-option")
  await expect(sourceOptions).toHaveCount(1)
  await expect(page.getByText("access-control.md", { exact: true })).toBeVisible()
  await expect(page.getByText("Nexus_Technical_Specification_v3.2.pdf", { exact: true })).toHaveCount(0)

  const accessSourceId = accessEvidence.fileId
  await page.locator(`[data-testid="author-source-option"][data-source-id="${accessSourceId}"]`).click()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-real-sources"].sourceFileIds,
  ).toEqual([accessSourceId])
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-real-sources"].evidenceIds,
  ).toContain(accessEvidence.id)

  await page.reload()
  await page.getByRole("button", { name: "Author", exact: true }).click()
  await page.locator('[title="Access requirements — double-click to open"]').dblclick()
  await page.getByRole("button", { name: /Generate with AI/ }).click()
  await expect(page.locator(`[data-testid="author-source-option"][data-source-id="${accessSourceId}"]`))
    .toContainText("✓")

  await page.getByRole("button", { name: "Back" }).click()
  await page.getByRole("button", { name: /Browse sources/ }).click()
  await expect(page.getByText(/Administrators must review privileged access every quarter/)).toBeVisible()
  await expect(page.getByText(/Source excerpt preview not yet available/)).toHaveCount(0)

  await page.getByRole("button", { name: "Sources", exact: true }).click()
  await expect(page.getByTestId("author-topic-source-context")).toContainText("access-control.md")
  await expect(page.getByTestId("author-topic-source-context")).toContainText(accessEvidence.location)

  await page.getByRole("button", { name: /AI/ }).click()
  await page.getByRole("button", { name: "Improve", exact: true }).click()
  await expect(page.getByText(/not available yet for real projects/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
})