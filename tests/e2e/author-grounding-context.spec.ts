import { expect, test, type Page } from "@playwright/test"
import {
  buildTopicGroundingContext,
  isTopicGroundingContextFresh,
  remapTopicGroundingContext,
  type TopicGroundingBuildInput,
} from "../../src/authorGroundingContext"
import { buildEvidenceIndex } from "../../src/evidenceIndex"
import type { ConceptAnalysis } from "../../src/conceptAnalysis"
import type { SourceExtraction } from "../../src/sourceExtractor"

function fixture() {
  const sourceExtractions: Record<string, SourceExtraction> = {
    "file-real": {
      sourceId: "file-real",
      fileName: "operations.md",
      fileType: "md",
      status: "extracted",
      extractedText: "Access Control\nAccess Control is enabled.\nAccess Control is disabled.",
      warnings: [],
      sourceRevision: 1,
      extractionRevision: 1,
      blocks: [
        {
          id: "block-required",
          sourceId: "file-real",
          type: "paragraph",
          text: "Access Control is enabled.",
          order: 0,
          sectionPath: ["Operations", "Access Control"],
        },
        {
          id: "block-optional",
          sourceId: "file-real",
          type: "paragraph",
          text: "Administrators review Access Control every quarter.",
          order: 1,
          sectionPath: ["Operations", "Access Control"],
        },
      ],
    },
  }
  const evidenceIndex = buildEvidenceIndex(sourceExtractions, 1)
  const [required, optional] = evidenceIndex.items
  const conceptAnalysis: ConceptAnalysis = {
    version: 2,
    method: "deterministic-evidence-heuristics-v1",
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    builtAt: 1_700_000_000_000,
    concepts: [{
      id: "concept-access",
      label: "Access Control",
      exactTerms: ["Access Control"],
      occurrenceCount: 2,
      sourceCount: 1,
      evidenceIds: [required.id, optional.id],
      evidenceRefs: [],
    }],
    terminology: [{
      id: "term-access",
      normalizedLabel: "Access Control",
      exactTerms: ["Access Control"],
      occurrenceCount: 2,
      sourceCount: 1,
      evidenceIds: [required.id, optional.id],
      evidenceRefs: [],
    }],
    conflicts: [{
      id: "conflict-access",
      subject: "Access Control",
      kind: "polarity",
      summary: "Sources disagree about whether Access Control is enabled.",
      rationale: "Resolve the enabled state before drafting.",
      evidenceIds: [required.id],
      evidenceRefs: [],
      sides: [],
    }],
    gaps: [{
      id: "gap-access",
      category: "insufficient-coverage",
      status: "insufficiently-covered",
      title: "Access Control exceptions are missing",
      rationale: "No current evidence describes exceptions.",
      evidenceIds: [required.id],
      evidenceRefs: [],
    }],
  }
  const input: TopicGroundingBuildInput = {
    topic: {
      topicId: "topic-access",
      title: "Access Control",
      level: 1,
      rationale: "Committed from the grounded TOC proposal.",
      supportingEvidenceIds: [required.id],
      sourceSectionPaths: [["Operations", "Access Control"]],
      proposalKind: "evidence-backed",
      hasGap: true,
    },
    evidenceIndex,
    sourceExtractions,
    sourcesRevision: 1,
    conceptAnalysis,
    analysisRevision: 4,
    tocRevision: 3,
    contentType: "runbook",
    variables: [{ name: "ProductName", value: "Orbital Console" }],
    selectedSourceFileIds: ["file-real"],
    writingGuidance: {
      language: "English",
      styleProfileId: "style-1",
      styleProfileName: "Operations style",
      styleProfileScope: "project",
      brandNames: ["Orbital Console"],
    },
  }
  return { sourceExtractions, evidenceIndex, conceptAnalysis, required, optional, input }
}

async function createProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
}

async function readProject(page: Page, projectName: string): Promise<Record<string, any>> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<Record<string, any>[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    return project
  }, projectName)
}

async function patchProject(page: Page, projectName: string, patch: Record<string, unknown>) {
  await page.evaluate(async ({ name, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction("projects", "readwrite")
    const store = transaction.objectStore("projects")
    const projects = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ ...project, ...values })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { name: projectName, values: patch })
}

test("builds deterministic required/optional topic context with conflicts, gaps, variables, and content type", () => {
  const { required, optional, input } = fixture()
  const context = buildTopicGroundingContext(input)
  const rebuilt = buildTopicGroundingContext(input)

  expect(rebuilt).toEqual(context)
  expect(context.evidenceStatus).toBe("available")
  expect(context.requiredEvidence.map(item => item.evidenceId)).toEqual([required.id])
  expect(context.optionalSupportingEvidence.map(item => item.evidenceId)).toEqual([optional.id])
  expect(context.conflicts.map(item => item.id)).toEqual(["conflict-access"])
  expect(context.gaps.map(item => item.id)).toEqual(["gap-access"])
  expect(context.writingGuidance.contentType).toBe("runbook")
  expect(context.writingGuidance.variables).toEqual({ ProductName: "Orbital Console" })
  expect(context.provenance.contentType).toBe("runbook")
  expect(isTopicGroundingContextFresh(context, input)).toBe(true)
  expect(isTopicGroundingContextFresh(context, {
    ...input,
    variables: [{ name: "ProductName", value: "Changed Product" }],
  })).toBe(false)
  expect(isTopicGroundingContextFresh(context, {
    ...input,
    contentType: "api-reference",
  })).toBe(false)
})

test("marks no-evidence and stale-evidence conditions without synthesizing support", () => {
  const { input } = fixture()
  const noEvidence = buildTopicGroundingContext({
    ...input,
    topic: {
      topicId: "topic-manual",
      title: "Manual appendix",
      level: 1,
      proposalKind: "manual",
      supportingEvidenceIds: [],
    },
    selectedSourceFileIds: [],
  })
  expect(noEvidence.evidenceStatus).toBe("no-supporting-evidence")
  expect(noEvidence.requiredEvidence).toEqual([])
  expect(noEvidence.unavailableInformation).toContain("This committed topic has no supporting evidence.")

  const stale = buildTopicGroundingContext({ ...input, sourcesRevision: 2 })
  expect(stale.evidenceStatus).toBe("unavailable")
  expect(stale.requiredEvidence).toEqual([])
  expect(stale.optionalSupportingEvidence).toEqual([])
  expect(stale.unavailableInformation[0]).toMatch(/Evidence Index is missing or stale/)
  expect(JSON.stringify(stale)).not.toMatch(/Nexus|Technical Spec|UX_Research/)
})

test("remaps grounding source references for duplicated projects", () => {
  const { input, evidenceIndex, conceptAnalysis } = fixture()
  const context = buildTopicGroundingContext(input)
  const copiedExtractions = {
    "file-copy": {
      ...input.sourceExtractions["file-real"],
      sourceId: "file-copy",
      blocks: input.sourceExtractions["file-real"].blocks.map(block => ({
        ...block,
        sourceId: "file-copy",
      })),
    },
  }
  const copiedIndex = buildEvidenceIndex(copiedExtractions, 1)
  const copiedContext = remapTopicGroundingContext(
    context,
    { "file-real": "file-copy" },
    copiedIndex,
    { ...conceptAnalysis, evidenceExtractionRevision: copiedIndex.extractionRevision },
  )

  expect(copiedContext).not.toBeNull()
  expect(copiedContext!.requiredEvidence[0].fileId).toBe("file-copy")
  expect(copiedContext!.optionalSupportingEvidence[0].fileId).toBe("file-copy")
  expect(copiedContext!.sourceExtractions[0].fileId).toBe("file-copy")
  expect(copiedContext!.contextId).not.toBe(context.contextId)
})

test("persists the read-only Author inspector, shows no-evidence topics, and marks changed context stale", async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Author grounding inspector ${Date.now()}`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "operations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Access Control\n\nAccess Control is enabled.\n\nAdministrators review Access Control every quarter."),
  })
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length)
    .toBe(1)
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect.poll(async () => (await readProject(page, projectName)).evidenceIndex?.items.length ?? 0)
    .toBeGreaterThan(1)
  const original = await readProject(page, projectName)
  const evidenceIndex = original.evidenceIndex
  const required = evidenceIndex.items.find((item: { text: string }) =>
    item.text.includes("Access Control is enabled"))
  if (!required) throw new Error("Expected uploaded Access Control evidence")
  const conceptAnalysis: ConceptAnalysis = {
    version: 2,
    method: "deterministic-evidence-heuristics-v1",
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    builtAt: 1_700_000_000_000,
    concepts: [{
      id: "concept-access",
      label: "Access Control",
      exactTerms: ["Access Control"],
      occurrenceCount: 2,
      sourceCount: 1,
      evidenceIds: [required.id],
      evidenceRefs: [],
    }],
    terminology: [],
    conflicts: [{
      id: "conflict-access",
      subject: "Access Control",
      kind: "polarity",
      summary: "The enabled state requires confirmation.",
      rationale: "Resolve the enabled state before drafting.",
      evidenceIds: [required.id],
      evidenceRefs: [],
      sides: [],
    }],
    gaps: [{
      id: "gap-access",
      category: "insufficient-coverage",
      status: "insufficiently-covered",
      title: "Access Control exceptions are missing",
      rationale: "No current evidence describes exceptions.",
      evidenceIds: [required.id],
      evidenceRefs: [],
    }],
  }
  const topicContent = {
    "topic-access": [{ id: "access-heading", type: "h1", content: "Authored access content" }],
    "topic-manual": [{ id: "manual-heading", type: "h1", content: "Authored manual content" }],
  }
  await patchProject(page, projectName, {
    conceptAnalysis,
    analysisRevision: 4,
    tocRevision: 3,
    appToc: [
      {
        id: 1,
        topicId: "topic-access",
        title: "Access Control",
        level: 1,
        words: 0,
        rationale: "Committed from the grounded TOC proposal.",
        supportingEvidenceIds: [required.id],
        sourceSectionPaths: [["Operations", "Access Control"]],
        proposalKind: "evidence-backed",
        hasGap: true,
      },
      {
        id: 2,
        topicId: "topic-manual",
        title: "Manual appendix",
        level: 1,
        words: 0,
        rationale: "User-added structural topic.",
        supportingEvidenceIds: [],
        proposalKind: "manual",
      },
    ],
    topicContent,
    authorTopicMetadata: {},
    projectMeta: { ...original.projectMeta, contentType: "runbook" },
  })

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.groundingContext?.contextId,
  ).toMatch(/^grounding-/)
  const firstContextId = (await readProject(page, projectName))
    .authorTopicMetadata["topic-access"].groundingContext.contextId

  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access Control", { exact: true }).click()
  await expect(page.getByTestId("author-grounding-toggle")).toHaveAttribute("data-topic-id", "topic-access")
  await expect(page.getByTestId("author-grounding-toggle")).toHaveAttribute("data-context-id", firstContextId)
  await page.getByTestId("author-grounding-toggle").click()
  await expect(page.getByTestId("author-grounding-freshness")).toHaveText("Current")
  await expect(page.getByTestId("grounding-required-evidence")).toContainText("operations.md")
  await expect(page.getByTestId("grounding-required-evidence")).toContainText("Access Control is enabled")
  await expect(page.getByTestId("grounding-conflicts")).toContainText("Resolve the enabled state")
  await expect(page.getByTestId("grounding-gaps")).toContainText("exceptions are missing")
  await expect(page.getByTestId("grounding-writing-guidance")).toContainText("runbook")

  await page.getByTestId("author-outline").locator('[data-topic-id="topic-manual"]')
    .getByText("Manual appendix", { exact: true }).click()
  await expect(page.getByTestId("grounding-required-evidence")).toContainText("No supporting evidence is committed")
  await expect(page.getByTestId("grounding-unavailable")).toContainText("no supporting evidence")

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.groundingContext?.contextId,
  ).toBe(firstContextId)
  expect((await readProject(page, projectName)).topicContent).toEqual(topicContent)

  const beforeContentTypeChange = await readProject(page, projectName)
  await patchProject(page, projectName, {
    projectMeta: { ...beforeContentTypeChange.projectMeta, contentType: "api-reference" },
  })
  await page.reload()
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access Control", { exact: true }).click()
  await page.getByTestId("author-grounding-toggle").click()
  await expect(page.getByTestId("author-grounding-freshness")).toHaveText("Stale")
  await page.getByTestId("refresh-author-grounding").click()
  await expect(page.getByTestId("author-grounding-freshness")).toHaveText("Current")
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata["topic-access"].groundingContext.provenance.contentType,
  ).toBe("api-reference")
  expect((await readProject(page, projectName)).topicContent).toEqual(topicContent)
})