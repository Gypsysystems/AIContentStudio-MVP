import { expect, test, type Page } from "@playwright/test"
import {
  buildAuthorRegenerationProposal,
  buildDeterministicAuthorDraft,
  isAuthorDraftFresh,
  type AuthorAppliedBaseline,
} from "../../src/authorDraftGeneration"
import type { TopicGroundingContext } from "../../src/authorGroundingContext"
import type { EvidenceIndex } from "../../src/evidenceIndex"
import { initializeAcceptedTopicDrafts } from "../../src/authorInitialDraft"
import type { ConceptAnalysis } from "../../src/conceptAnalysis"
import {
  createManualAuthorTopicMetadata,
  evaluateAuthorGeneratedFreshness,
  type AuthorTopicMetadata,
} from "../../src/authorMetadata"

function grounding(overrides: Partial<TopicGroundingContext> = {}): TopicGroundingContext {
  return {
    version: 1,
    contextId: "grounding-current",
    topic: {
      topicId: "topic-access",
      title: "Access operations",
      level: 1,
      rationale: "Evidence-backed operations topic.",
      proposalKind: "evidence-backed",
      sourcePaths: [["Operations", "Access"]],
    },
    evidenceStatus: "available",
    requiredEvidence: [{
      evidenceId: "evidence-required",
      fileId: "file-real",
      sourceId: "file-real",
      sourceFileName: "operations.md",
      location: "Operations › Access",
      sectionPath: ["Operations", "Access"],
      text: "{{ProductName}} requires quarterly access reviews.",
    }],
    optionalSupportingEvidence: [{
      evidenceId: "evidence-optional",
      fileId: "file-real",
      sourceId: "file-real",
      sourceFileName: "operations.md",
      location: "Operations › Access",
      sectionPath: ["Operations", "Access"],
      text: "Administrators record the review outcome.",
    }],
    concepts: [],
    terminology: [],
    conflicts: [{
      id: "conflict-enabled",
      title: "Access enforcement",
      rationale: "Current sources disagree about whether enforcement is enabled.",
      evidenceIds: ["evidence-required"],
    }],
    gaps: [{
      id: "gap-exceptions",
      title: "Exception handling is unavailable",
      rationale: "No evidence describes the exception workflow.",
      evidenceIds: ["evidence-required"],
    }],
    unavailableInformation: ["Escalation ownership is not available in current evidence."],
    sourceExtractions: [{
      fileId: "file-real",
      fileName: "operations.md",
      status: "extracted",
      sourceRevision: 1,
      extractionRevision: 1,
    }],
    writingGuidance: {
      contentType: "runbook",
      language: "English",
      variables: { ProductName: "Orbital Console" },
      styleProfileId: "style-operations",
      styleProfileName: "Operations",
      styleProfileScope: "project",
      brandNames: ["Orbital Console"],
      instructions: ["Use procedural structure."],
    },
    provenance: {
      sourcesRevision: 1,
      evidenceExtractionRevision: "extract-1",
      evidenceIndexBuiltAt: 1_690_000_000_000,
      analysisBuiltAt: 1_700_000_000_000,
      analysisRevision: 4,
      tocRevision: 3,
      contentType: "runbook",
      variableFingerprint: "variables-1",
      styleFingerprint: "style-1",
    },
    ...overrides,
  }
}

test("initial drafts write only new empty topics with substantive required evidence", () => {
  const topics = [
    { id: 1, topicId: "fresh", title: "Fresh", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 2, topicId: "manual", title: "Manual", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 3, topicId: "legacy", title: "Legacy", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 4, topicId: "approved", title: "Approved", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 5, topicId: "mixed", title: "Mixed", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 6, topicId: "existing", title: "Existing", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"] },
    { id: 7, topicId: "heading-only", title: "Heading", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["heading"] },
    { id: 8, topicId: "missing", title: "Missing", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["missing-evidence"] },
    { id: 9, topicId: "structural", title: "Structural", proposalKind: "optional-structural" as const, supportingEvidenceIds: [] },
    { id: 10, topicId: "gap", title: "Gap", proposalKind: "evidence-backed" as const, supportingEvidenceIds: ["evidence-required"], hasGap: true },
  ]
  const content = {
    manual: [{ id: "manual-body", type: "para", content: "Writer's content." }],
    "3": [{ id: "legacy-body", type: "para", content: "Legacy content." }],
  }
  const base = createManualAuthorTopicMetadata("approved", { contentType: "runbook", variables: [] }, false)
  const metadata = {
    approved: { ...base, generationStatus: "generated" as const, contentOrigin: "approved" as const, approved: true },
    mixed: { ...base, topicId: "mixed", contentOrigin: "mixed" as const },
  }
  const evidenceIndex = {
    items: [
      { id: "evidence-required", fileId: "file-real", sourceId: "file-real", blockId: "block-1", sourceFileName: "operations.md", text: "Quarterly access reviews are required.", blockType: "paragraph" as const, order: 1, location: "Access" },
      { id: "heading", fileId: "file-real", sourceId: "file-real", blockId: "block-2", sourceFileName: "operations.md", text: "Access", blockType: "heading" as const, order: 2, location: "Access" },
    ],
    sourcesRevision: 1, extractionRevision: "extract-1", builtAt: 1,
  } satisfies EvidenceIndex
  const result = initializeAcceptedTopicDrafts({
    topics,
    previousTopicIds: new Set(["existing"]),
    topicContent: content,
    authorMetadata: metadata,
    metadataContext: { contentType: "runbook", variables: [] },
    evidenceIndex,
    canGenerate: true,
    contextFor: topic => grounding({
      contextId: `context-${topic.topicId}`,
      topic: { ...grounding().topic, topicId: topic.topicId, title: topic.title },
      evidenceStatus: topic.topicId === "missing" ? "unavailable" : topic.topicId === "structural" ? "no-supporting-evidence" : "available",
      requiredEvidence: topic.topicId === "heading-only"
        ? [{ ...grounding().requiredEvidence[0], evidenceId: "heading" }]
        : topic.topicId === "missing" || topic.topicId === "structural"
          ? []
          : grounding().requiredEvidence,
    }),
    toBlock: (block, id) => ({ id, type: block.type, content: block.content }),
  })
  expect(result.generatedCount).toBe(1)
  expect(result.topicContent.fresh.some(block => block.type === "para"
    && block.content.includes("quarterly access reviews"))).toBe(true)
  expect(result.authorMetadata.fresh).toMatchObject({
    generationStatus: "generated",
    contentOrigin: "generated",
    approved: false,
    generatedFreshness: "current",
    appliedBaseline: { groundingContextId: "context-fresh" },
  })
  expect(result.topicContent.manual).toEqual(content.manual)
  expect(result.topicContent["3"]).toEqual(content["3"])
  for (const topicId of ["legacy", "approved", "mixed", "existing", "heading-only", "missing", "structural", "gap"]) {
    expect(result.topicContent[topicId]).toBeUndefined()
  }
  expect(result.authorMetadata.approved).toEqual(metadata.approved)
  expect(result.authorMetadata.mixed).toEqual(metadata.mixed)
  expect(result.authorMetadata["heading-only"].groundingContext).toBeTruthy()
  expect(result.authorMetadata.missing.generationStatus).toBe("not-generated")
})

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

test("builds an evidence-only deterministic draft with generation provenance and uncertainty warnings", () => {
  const context = grounding()
  const draft = buildDeterministicAuthorDraft(context, 1_710_000_000_000)

  expect(draft.method).toBe("deterministic-evidence-draft-v1")
  expect(draft.modelLabel).toContain("No external model")
  expect(draft.groundingContextId).toBe(context.contextId)
  expect(draft.contentType).toBe("runbook")
  expect(draft.language).toBe("English")
  expect(draft.variableSnapshot).toEqual({ ProductName: "Orbital Console" })
  expect(draft.styleProvenance).toMatchObject({
    styleProfileId: "style-operations",
    styleFingerprint: "style-1",
  })
  expect(draft.requiredEvidenceIdsUsed).toEqual(["evidence-required"])
  expect(draft.optionalEvidenceIdsUsed).toEqual(["evidence-optional"])
  expect(draft.evidenceIdsUsed).toEqual(["evidence-required", "evidence-optional"])
  expect(draft.blocks.map(block => block.content).join(" ")).toContain("Orbital Console requires quarterly access reviews.")
  expect(draft.warnings.map(warning => warning.kind)).toEqual([
    "conflict",
    "gap",
    "unavailable",
  ])
  expect(draft.warnings.find(warning => warning.kind === "conflict")?.message)
    .toContain("does not choose a side")
  expect(JSON.stringify(draft)).not.toMatch(/Nexus|Technical_Specification|api\.nexus/)
  expect(isAuthorDraftFresh(draft, context, true)).toBe(true)
  expect(isAuthorDraftFresh(draft, { ...context, contextId: "grounding-new" }, true)).toBe(false)
  expect(isAuthorDraftFresh(draft, context, false)).toBe(false)
})

function generatedMetadata(context: TopicGroundingContext): AuthorTopicMetadata {
  const metadata = createManualAuthorTopicMetadata(
    context.topic.topicId,
    { contentType: context.writingGuidance.contentType, variables: [] },
    false,
  )
  return {
    ...metadata,
    generationStatus: "generated",
    contentOrigin: "mixed",
    groundingContext: context,
    generatedFreshness: "current",
    generatedFreshnessReason: null,
    provenance: {
      sourcesRevision: context.provenance.sourcesRevision,
      evidenceExtractionRevision: context.provenance.evidenceExtractionRevision,
      evidenceIndexBuiltAt: context.provenance.evidenceIndexBuiltAt,
      analysisBuiltAt: context.provenance.analysisBuiltAt,
      analysisRevision: context.provenance.analysisRevision,
      tocRevision: context.provenance.tocRevision,
      contentType: context.provenance.contentType,
      variableSnapshot: { ...context.writingGuidance.variables },
      variableFingerprint: context.provenance.variableFingerprint,
      groundingContextId: context.contextId,
      language: context.writingGuidance.language,
      styleProfileId: context.writingGuidance.styleProfileId,
      styleFingerprint: context.provenance.styleFingerprint,
    },
  }
}

test("evaluates every major generated-content staleness trigger without flagging manual-only content", () => {
  const applied = grounding()
  const metadata = generatedMetadata(applied)
  expect(evaluateAuthorGeneratedFreshness(metadata, applied)).toEqual({
    status: "current",
    reason: null,
  })

  const triggers: Array<[string, TopicGroundingContext, string]> = [
    ["sources", grounding({ contextId: "sources", provenance: { ...applied.provenance, sourcesRevision: 2 } }), "sources-changed"],
    ["extraction", grounding({ contextId: "extraction", provenance: { ...applied.provenance, evidenceExtractionRevision: "extract-2" } }), "extraction-changed"],
    ["evidence index", grounding({ contextId: "index", provenance: { ...applied.provenance, evidenceIndexBuiltAt: 1_700_000_000_001 } }), "evidence-index-changed"],
    ["analysis", grounding({ contextId: "analysis", provenance: { ...applied.provenance, analysisBuiltAt: 1_700_000_000_001 } }), "analysis-changed"],
    ["TOC", grounding({ contextId: "toc", provenance: { ...applied.provenance, tocRevision: 4 } }), "toc-changed"],
    ["content type", grounding({ contextId: "content-type", provenance: { ...applied.provenance, contentType: "api-reference" } }), "content-type-changed"],
    ["variables", grounding({ contextId: "variables", provenance: { ...applied.provenance, variableFingerprint: "variables-2" } }), "variables-changed"],
    ["language", grounding({ contextId: "language", writingGuidance: { ...applied.writingGuidance, language: "Arabic" } }), "language-changed"],
    ["style", grounding({ contextId: "style", provenance: { ...applied.provenance, styleFingerprint: "style-2" } }), "style-guidance-changed"],
  ]
  for (const [label, expectedContext, reason] of triggers) {
    expect(evaluateAuthorGeneratedFreshness(metadata, expectedContext), label).toEqual({
      status: "stale",
      reason,
    })
  }

  const manual = createManualAuthorTopicMetadata(
    "topic-manual",
    { contentType: "runbook", variables: [] },
    true,
  )
  expect(evaluateAuthorGeneratedFreshness(manual, triggers[0][1])).toEqual({
    status: "not-applicable",
    reason: null,
  })
  expect(evaluateAuthorGeneratedFreshness({
    ...metadata,
    provenance: { ...metadata.provenance, groundingContextId: null },
  }, applied)).toEqual({
    status: "needs-grounding",
    reason: "grounding-missing",
  })
})

test("creates warning-only output when a current topic has no supporting evidence", () => {
  const context = grounding({
    evidenceStatus: "no-supporting-evidence",
    requiredEvidence: [],
    optionalSupportingEvidence: [],
    conflicts: [],
    gaps: [],
    unavailableInformation: ["This committed topic has no supporting evidence."],
  })
  const draft = buildDeterministicAuthorDraft(context, 1_710_000_000_000)

  expect(draft.evidenceIdsUsed).toEqual([])
  expect(draft.blocks.filter(block => block.type === "para")).toEqual([])
  expect(draft.warnings).toEqual([expect.objectContaining({
    kind: "no-evidence",
    message: expect.stringContaining("No factual draft detail was generated"),
  })])
})

test("regeneration protects approved and manually edited blocks while selecting safe additions", () => {
  const originalDraft = buildDeterministicAuthorDraft(grounding(), 1_710_000_000_000)
  const proposedDraft = buildDeterministicAuthorDraft(grounding({
    conflicts: [],
    gaps: [],
    unavailableInformation: [],
    writingGuidance: {
      ...grounding().writingGuidance,
      contentType: "api-reference",
    },
    requiredEvidence: [{
      ...grounding().requiredEvidence[0],
      text: "{{ProductName}} requires monthly access reviews.",
    }],
    optionalSupportingEvidence: [
      ...grounding().optionalSupportingEvidence,
      {
        evidenceId: "evidence-new",
        fileId: "file-real",
        sourceId: "file-real",
        sourceFileName: "operations.md",
        location: "Operations › Escalation",
        sectionPath: ["Operations", "Escalation"],
        text: "Escalations are recorded in the operations log.",
      },
    ],
  }), 1_720_000_000_000)
  const appliedBlocks = originalDraft.blocks.map((block, index) => ({
    ...block,
    id: `applied-${index}`,
  }))
  const editedEvidence = appliedBlocks.find(block => block.id === "applied-2")
  if (!editedEvidence) throw new Error("Expected evidence block")
  editedEvidence.content = "A writer manually changed this approved evidence paragraph."
  const baseline: AuthorAppliedBaseline = {
    draftId: originalDraft.draftId,
    groundingContextId: originalDraft.groundingContextId,
    contentFingerprint: "baseline",
    blocks: originalDraft.blocks.map((block, index) => ({
      sourceBlockId: block.id,
      appliedBlockId: `applied-${index}`,
      block,
    })),
  }
  const proposal = buildAuthorRegenerationProposal(
    proposedDraft,
    [
      ...appliedBlocks,
      { id: "manual-note", type: "para", content: "Legacy manual note." },
    ],
    baseline,
    true,
    {
      "applied-0": "approved",
      "applied-1": "approved",
      "applied-2": "manually-edited",
      "manual-note": "legacy",
    },
  )

  expect(proposal.diffs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceBlockId: "draft-evidence-heading",
      status: "protected",
      protection: "approved",
      selected: false,
    }),
    expect.objectContaining({
      sourceBlockId: "draft-evidence-1",
      status: "manually-edited",
      protection: "manual",
      selected: false,
    }),
    expect.objectContaining({
      sourceBlockId: "draft-evidence-3",
      status: "added",
      selected: true,
    }),
    expect.objectContaining({
      status: "removed",
      protection: "approved",
      selected: false,
    }),
    expect.objectContaining({
      currentBlock: expect.objectContaining({ id: "manual-note" }),
      status: "manually-edited",
      protection: "legacy",
      selected: false,
    }),
  ]))
})

test("persists a reviewable draft without overwriting manual content and applies only after confirmation", async ({ page }) => {
  test.setTimeout(90_000)
  const projectName = `Grounded draft ${Date.now()}`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: "access-operations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Access Operations\n\nAdministrators must review privileged access every quarter.\n\nReview outcomes are recorded."),
  })
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length).toBe(1)
  await page.getByRole("button", { name: "Analyze Sources" }).click()
  await expect.poll(async () => (await readProject(page, projectName)).evidenceIndex?.items.length ?? 0)
    .toBeGreaterThan(1)

  const original = await readProject(page, projectName)
  const required = original.evidenceIndex.items.find((item: { text: string }) =>
    item.text.includes("review privileged access"))
  if (!required) throw new Error("Expected required access evidence")
  const conceptAnalysis: ConceptAnalysis = {
    version: 2,
    method: "deterministic-evidence-heuristics-v1",
    evidenceSourcesRevision: original.evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: original.evidenceIndex.extractionRevision,
    builtAt: 1_700_000_000_000,
    concepts: [],
    terminology: [],
    conflicts: [{
      id: "conflict-access",
      subject: "Access review status",
      kind: "polarity",
      summary: "The current status is disputed.",
      rationale: "Confirm the current status before publication.",
      evidenceIds: [required.id],
      evidenceRefs: [],
      sides: [],
    }],
    gaps: [{
      id: "gap-escalation",
      category: "insufficient-coverage",
      status: "insufficiently-covered",
      title: "Escalation ownership is missing",
      rationale: "No evidence identifies the escalation owner.",
      evidenceIds: [required.id],
      evidenceRefs: [],
    }],
  }
  const manualContent = {
    "topic-access": [
      { id: "manual-heading", type: "h1", content: "Manual access operations" },
      { id: "manual-paragraph", type: "para", content: "Keep this manual content until explicit approval." },
    ],
  }
  await patchProject(page, projectName, {
    conceptAnalysis,
    analysisRevision: 4,
    tocRevision: 2,
    appToc: [{
      id: 1,
      topicId: "topic-access",
      title: "Access operations",
      level: 1,
      words: 0,
      rationale: "Document the evidence-backed access review process.",
      supportingEvidenceIds: [required.id],
      sourceSectionPaths: [required.sectionPath],
      proposalKind: "evidence-backed",
      hasGap: true,
    }],
    topicContent: manualContent,
    authorTopicMetadata: {},
    projectMeta: { ...original.projectMeta, contentType: "runbook" },
  })

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.groundingContext?.contextId,
  ).toMatch(/^grounding-/)
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access operations", { exact: true }).click()
  await page.getByTestId("author-draft-toggle").click()
  await page.getByTestId("generate-author-draft").click()

  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.draft?.draftId,
  ).toMatch(/^author-draft-/)
  let persisted = await readProject(page, projectName)
  expect(persisted.topicContent).toEqual(manualContent)
  expect(persisted.authorTopicMetadata["topic-access"]).toMatchObject({
    generationStatus: "draft",
    generatedFreshness: "not-applicable",
    approved: false,
    evidenceIds: [required.id],
    draft: {
      method: "deterministic-evidence-draft-v1",
      modelLabel: "No external model — deterministic evidence builder",
      contentType: "runbook",
      evidenceIdsUsed: [required.id],
    },
  })
  await expect(page.getByTestId("author-draft-method")).toContainText("deterministic evidence builder")
  await expect(page.getByTestId("author-draft-preview")).toContainText("Administrators must review privileged access")
  await expect(page.getByTestId("author-draft-warnings")).toContainText("does not choose a side")
  await expect(page.getByTestId("author-draft-warnings")).toContainText("Escalation ownership is missing")
  await expect(page.getByTestId("author-draft-evidence").locator(`[data-evidence-id="${required.id}"]`))
    .toContainText("access-operations.md")

  const draftId = persisted.authorTopicMetadata["topic-access"].draft.draftId
  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.draft?.draftId,
  ).toBe(draftId)
  expect((await readProject(page, projectName)).topicContent).toEqual(manualContent)

  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access operations", { exact: true }).click()
  await page.getByTestId("author-draft-toggle").click()
  await expect(page.getByTestId("author-draft-freshness")).toHaveText("Current")
  await page.getByTestId("apply-author-draft").click()
  await expect(page.getByTestId("confirm-author-draft-apply")).toBeVisible()
  expect((await readProject(page, projectName)).topicContent).toEqual(manualContent)
  await page.getByTestId("confirm-apply-author-draft").click()

  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.approved,
  ).toBe(true)
  persisted = await readProject(page, projectName)
  expect(persisted.topicContent["topic-access"]).not.toEqual(manualContent["topic-access"])
  const appliedText = persisted.topicContent["topic-access"].map((block: { content: string }) => block.content).join(" ")
  expect(appliedText).toContain("Keep this manual content until explicit approval.")
  expect(appliedText).toContain("Administrators must review privileged access every quarter.")
  expect(persisted.authorTopicMetadata["topic-access"]).toMatchObject({
    generationStatus: "generated",
    generatedFreshness: "current",
    approved: true,
    contentOrigin: "mixed",
    manualEdited: true,
    regenerationProposal: null,
  })
  expect(JSON.stringify(persisted.authorTopicMetadata["topic-access"].draft))
    .not.toMatch(/Nexus|Technical_Specification|api\.nexus/)

  const generatedEvidenceBlock = persisted.topicContent["topic-access"].find((block: { content: string }) =>
    block.content.includes("review privileged access"))
  if (!generatedEvidenceBlock) throw new Error("Expected applied generated evidence block")
  const manuallyEditedText = "A writer manually changed the generated access-review paragraph."
  const changedTopicContent = {
    ...persisted.topicContent,
    "topic-access": [
      ...persisted.topicContent["topic-access"].map((block: { id: string; content: string }) =>
        block.id === generatedEvidenceBlock.id
          ? { ...block, content: manuallyEditedText }
          : block),
      { id: "manual-appendix", type: "para", content: "Manual escalation notes must remain." },
    ],
  }
  await patchProject(page, projectName, {
    topicContent: changedTopicContent,
    projectMeta: { ...persisted.projectMeta, contentType: "api-reference" },
  })
  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.generatedFreshness,
  ).toBe("stale")
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access operations", { exact: true }).click()
  await page.getByTestId("author-draft-toggle").click()
  await expect(page.getByTestId("author-draft-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("apply-author-draft")).toBeDisabled()
  await expect(page.getByTestId("author-generated-freshness")).toContainText("Stale")
  await expect(page.getByTestId("author-generated-freshness-reason")).toContainText("content type changed")
  expect((await readProject(page, projectName)).topicContent).toEqual(changedTopicContent)

  await page.getByTestId("author-draft-inspector").getByRole("button", { name: "Close draft inspector" }).click()
  await page.getByTestId("author-grounding-toggle").click()
  await page.getByTestId("refresh-author-grounding").click()
  await expect(page.getByTestId("author-grounding-freshness")).toHaveText("Current")
  await page.getByTestId("author-grounding-inspector").getByRole("button", { name: "Close grounding inspector" }).click()
  await page.getByTestId("author-draft-toggle").click()
  await page.getByTestId("regenerate-author-draft").click()

  await expect(page.getByTestId("author-regeneration-diff")).toBeVisible()
  await expect(page.getByTestId("author-generated-freshness")).toContainText("Stale")
  await expect(page.locator('[data-diff-status="manually-edited"]').filter({ hasText: manuallyEditedText }))
    .toBeVisible()
  await expect(page.locator('[data-diff-status="protected"]').filter({ hasText: "Reference details" }))
    .toBeVisible()
  await expect(page.locator('[data-diff-status="manually-edited"] input[type="checkbox"]').first()).toBeDisabled()
  expect((await readProject(page, projectName)).topicContent).toEqual(changedTopicContent)
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.regenerationProposal?.proposalId,
  ).toMatch(/^author-proposal-/)
  const proposalId = (await readProject(page, projectName))
    .authorTopicMetadata["topic-access"].regenerationProposal.proposalId

  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.regenerationProposal?.proposalId,
  ).toBe(proposalId)
  expect((await readProject(page, projectName)).topicContent).toEqual(changedTopicContent)
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="topic-access"]')
    .getByText("Access operations", { exact: true }).click()
  await page.getByTestId("author-draft-toggle").click()
  const protectedRow = page.locator('[data-diff-status="protected"]').filter({ hasText: "Reference details" })
  await protectedRow.locator('input[type="checkbox"]').check()
  await page.getByTestId("apply-author-draft").click()
  await expect(page.getByTestId("confirm-author-draft-apply")).toBeVisible()
  expect((await readProject(page, projectName)).topicContent).toEqual(changedTopicContent)
  await page.getByTestId("confirm-apply-author-draft").click()

  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.regenerationProposal,
  ).toBeNull()
  persisted = await readProject(page, projectName)
  const regeneratedText = persisted.topicContent["topic-access"]
    .map((block: { content: string }) => block.content)
    .join(" ")
  expect(regeneratedText).toContain(manuallyEditedText)
  expect(regeneratedText).toContain("Keep this manual content until explicit approval.")
  expect(regeneratedText).toContain("Manual escalation notes must remain.")
  expect(regeneratedText).toContain("Reference details")
  expect(regeneratedText).not.toContain("Administrators must review privileged access every month.")
  expect(persisted.authorTopicMetadata["topic-access"]).toMatchObject({
    generationStatus: "generated",
    generatedFreshness: "current",
    contentOrigin: "mixed",
    manualEdited: true,
    regenerationProposal: null,
  })
  expect(persisted.authorTopicMetadata["topic-access"].blockStates[generatedEvidenceBlock.id])
    .toBe("manually-edited")
})