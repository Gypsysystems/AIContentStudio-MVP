import { expect, test, type Page } from "@playwright/test"
import {
  buildDeterministicAuthorDraft,
  isAuthorDraftFresh,
} from "../../src/authorDraftGeneration"
import type { TopicGroundingContext } from "../../src/authorGroundingContext"
import type { ConceptAnalysis } from "../../src/conceptAnalysis"

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
      const request = indexedDB.open("docflow-db", 2)
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
      const request = indexedDB.open("docflow-db", 2)
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
  await page.getByRole("button", { name: /Author/ }).click()
  await page.locator('[title="Access operations — double-click to open"]').dispatchEvent("dblclick")
  await page.getByTestId("author-draft-toggle").click()
  await page.getByTestId("generate-author-draft").click()

  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.draft?.draftId,
  ).toMatch(/^author-draft-/)
  let persisted = await readProject(page, projectName)
  expect(persisted.topicContent).toEqual(manualContent)
  expect(persisted.authorTopicMetadata["topic-access"]).toMatchObject({
    generationStatus: "draft",
    generatedFreshness: "current",
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

  await page.getByRole("button", { name: /Author/ }).click()
  await page.locator('[title="Access operations — double-click to open"]').dispatchEvent("dblclick")
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
  expect(persisted.topicContent["topic-access"].map((block: { content: string }) => block.content).join(" "))
    .toContain("Administrators must review privileged access every quarter.")
  expect(persisted.authorTopicMetadata["topic-access"]).toMatchObject({
    generationStatus: "generated",
    generatedFreshness: "current",
    approved: true,
  })
  expect(JSON.stringify(persisted.authorTopicMetadata["topic-access"].draft))
    .not.toMatch(/Nexus|Technical_Specification|api\.nexus/)

  await patchProject(page, projectName, {
    projectMeta: { ...persisted.projectMeta, contentType: "api-reference" },
  })
  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-access"]?.generatedFreshness,
  ).toBe("stale")
  await page.getByRole("button", { name: /Author/ }).click()
  await page.locator('[title="Access operations — double-click to open"]').dispatchEvent("dblclick")
  await page.getByTestId("author-draft-toggle").click()
  await expect(page.getByTestId("author-draft-freshness")).toHaveText("Stale")
  await expect(page.getByTestId("apply-author-draft")).toBeDisabled()
})