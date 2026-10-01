import { expect, test } from "@playwright/test"
import {
  buildAuthorRegenerationProposal,
  composeAuthorRewriteDraftBlocks,
  eligibleAuthorRewriteSourceBlockIds,
  authorRewriteProtectionFingerprint,
  type AuthorAppliedBaseline,
  type AuthorDraftBlock,
} from "../../src/authorDraftGeneration"
import { preserveAuthorBlockStateOnUnchangedContent } from "../../src/authorMetadata"
import { readFile } from "node:fs/promises"

const fixture = JSON.parse(await readFile(
  new URL("../fixtures/project-record-v2.json", import.meta.url),
  "utf8",
)) as Record<string, any>
const sourceText = "# Field Manual\n\nConnect the Field Kit before calibration."

const baseline: AuthorAppliedBaseline = {
  draftId: "base-draft",
  groundingContextId: "grounding-current",
  contentFingerprint: "saved-content",
  blocks: [
    {
      sourceBlockId: "source-generated-a",
      appliedBlockId: "applied-generated-a",
      block: {
        id: "source-generated-a",
        type: "para",
        content: "Generated paragraph A.",
        evidenceIds: ["evidence-a"],
      },
    },
    {
      sourceBlockId: "source-generated-b",
      appliedBlockId: "applied-generated-b",
      block: {
        id: "source-generated-b",
        type: "para",
        content: "Generated paragraph B.",
        evidenceIds: ["evidence-a"],
      },
    },
    {
      sourceBlockId: "source-protected",
      appliedBlockId: "applied-protected",
      block: {
        id: "source-protected",
        type: "para",
        content: "Approved but protected paragraph.",
        evidenceIds: ["evidence-a"],
      },
    },
    {
      sourceBlockId: "source-manually-edited",
      appliedBlockId: "applied-manually-edited",
      block: {
        id: "source-manually-edited",
        type: "para",
        content: "Original generated paragraph.",
        evidenceIds: ["evidence-a"],
      },
    },
  ],
}

const currentBlocks = [
  { id: "applied-generated-a", type: "para", content: "Generated paragraph A.", evidenceIds: ["evidence-a"] },
  { id: "applied-generated-b", type: "para", content: "Generated paragraph B.", evidenceIds: ["evidence-a"] },
  { id: "applied-protected", type: "para", content: "Approved but protected paragraph.", evidenceIds: ["evidence-a"] },
  { id: "applied-manually-edited", type: "para", content: "Human-edited paragraph.", evidenceIds: ["evidence-a"] },
  { id: "unmapped-manual", type: "para", content: "Unmapped manual paragraph.", evidenceIds: [] },
]

const states = {
  "applied-generated-a": "generated",
  "applied-generated-b": "approved",
  "applied-protected": "mixed",
  "applied-manually-edited": "manually-edited",
} as const

test("Rewrite Topic diffs rewrite only eligible generated blocks and retain protected/manual content", () => {
  const eligible = eligibleAuthorRewriteSourceBlockIds(baseline, currentBlocks, states)
  expect(eligible).toEqual(["source-generated-a", "source-generated-b"])

  const replacements: AuthorDraftBlock[] = eligible.map((sourceBlockId, index) => ({
    id: sourceBlockId,
    sourceBlockId,
    type: "para",
    content: `Rewritten paragraph ${index + 1}.`,
    evidenceIds: ["evidence-a"],
  }))
  const blocks = composeAuthorRewriteDraftBlocks(baseline, eligible, replacements)
  expect(blocks.map(block => block.id)).toEqual([
    "source-generated-a",
    "source-generated-b",
    "source-protected",
    "source-manually-edited",
  ])
  expect(blocks[2].content).toBe("Approved but protected paragraph.")
  expect(blocks[3].content).toBe("Original generated paragraph.")

  const draft = {
    version: 1 as const,
    draftId: "rewrite-draft",
    topicId: "topic-1",
    method: "ai-grounded-rewrite-topic-v1" as const,
    rewriteSourceBlockIds: eligible,
    modelLabel: "AI rewrite",
    generatedAt: 1,
    groundingContextId: "grounding-current",
    groundingRevision: "grounding-revision",
    contentType: "guide",
    language: "en",
    variableSnapshot: {},
    styleProvenance: {
      styleProfileId: "",
      styleProfileName: "Default",
      styleProfileScope: "project",
      styleFingerprint: "style",
      brandNames: [],
    },
    evidenceIdsUsed: ["evidence-a"],
    requiredEvidenceIdsUsed: ["evidence-a"],
    optionalEvidenceIdsUsed: [],
    warnings: [],
    blocks,
  }
  const proposal = buildAuthorRegenerationProposal(draft, currentBlocks, baseline, true, states)
  expect(proposal.diffs.find(diff => diff.sourceBlockId === "source-generated-a"))
    .toMatchObject({ status: "changed", selected: true })
  expect(proposal.diffs.find(diff => diff.sourceBlockId === "source-generated-b"))
    .toMatchObject({ status: "changed", selected: true })
  expect(proposal.diffs.find(diff => diff.sourceBlockId === "source-protected"))
    .toMatchObject({ status: "protected", selected: false })
  expect(proposal.diffs.find(diff => diff.sourceBlockId === "source-manually-edited"))
    .toMatchObject({ status: "manually-edited", selected: false })
  expect(proposal.diffs.find(diff => diff.currentBlock?.id === "unmapped-manual"))
    .toMatchObject({ status: "manually-edited", selected: false })
})

test("Rewrite Topic rejects incomplete or duplicate source mappings", () => {
  expect(() => composeAuthorRewriteDraftBlocks(
    baseline,
    ["source-generated-a", "source-generated-b"],
    [{
      id: "source-generated-a",
      sourceBlockId: "source-generated-a",
      type: "para",
      content: "Only one rewrite returned.",
      evidenceIds: ["evidence-a"],
    }],
  )).toThrow("does not match the eligible source blocks")

  expect(() => composeAuthorRewriteDraftBlocks(
    baseline,
    ["source-generated-a"],
    [
      { id: "source-generated-a", type: "para", content: "First.", evidenceIds: ["evidence-a"] },
      { id: "source-generated-a", type: "para", content: "Duplicate.", evidenceIds: ["evidence-a"] },
    ],
  )).toThrow("unknown or duplicate source block")
})

test("unchanged blocks preserve protected states and fail closed for unknown states", () => {
  expect(preserveAuthorBlockStateOnUnchangedContent("generated", false)).toBe("generated")
  expect(preserveAuthorBlockStateOnUnchangedContent("approved", false)).toBe("approved")
  expect(preserveAuthorBlockStateOnUnchangedContent("mixed", false)).toBe("mixed")
  expect(preserveAuthorBlockStateOnUnchangedContent("legacy", false)).toBe("legacy")
  expect(preserveAuthorBlockStateOnUnchangedContent("manually-edited", false)).toBe("manually-edited")
  expect(preserveAuthorBlockStateOnUnchangedContent("future-state", false)).toBe("manually-edited")
  expect(preserveAuthorBlockStateOnUnchangedContent("future-state", true)).toBe("legacy")
  expect(authorRewriteProtectionFingerprint(baseline, states))
    .not.toBe(authorRewriteProtectionFingerprint(baseline, { ...states, "applied-protected": "approved" }))
  expect(authorRewriteProtectionFingerprint(baseline, states))
    .not.toBe(authorRewriteProtectionFingerprint({ ...baseline, draftId: "new-baseline" }, states))
})

test("Author Rewrite Topic saves a review-only proposal and applies only selected eligible changes", async ({ page, context }) => {
  test.setTimeout(90_000)
  const projectId = `ai-rewrite-ui-${Date.now()}`
  let projectRecord: Record<string, any> | null = null
  const originalBlocks = [
    { id: "authored-heading", type: "h1", content: "Prepare the Field Kit" },
    { id: "applied-generated-a", type: "para", content: "Generated paragraph A.", evidenceIds: [] },
    { id: "applied-generated-b", type: "para", content: "Generated paragraph B.", evidenceIds: [] },
    { id: "applied-protected", type: "para", content: "Approved but protected paragraph.", evidenceIds: [] },
    { id: "applied-manually-edited", type: "para", content: "Human-edited paragraph.", evidenceIds: [] },
    { id: "unmapped-manual", type: "para", content: "Unmapped manual paragraph.", evidenceIds: [] },
  ]
  const rewriteWorkflow = {
    workspaceId: "ai-rewrite-workspace",
    id: "workflow-rewrite-topic",
    kind: "workflow",
    version: 1,
    state: "published",
    name: "Grounded Rewrite",
    description: "",
    definition: {
      capability: " Rewrite_Topic ",
      model: { mode: "pinned", providerId: "openai", modelId: "test-rewrite-model" },
      promptPack: { id: "prompt-rewrite", version: 2 },
      referenceSet: { id: "reference-rewrite", version: 4 },
      blueprint: { id: "blueprint-rewrite", version: 5 },
      steps: [{ id: "rewrite", capability: "rewrite-topic" }],
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "rewrite-ui-test",
  }
  const generateWorkflow = {
    ...rewriteWorkflow,
    id: "workflow-generate-topic",
    name: "Grounded Generate",
    definition: {
      ...rewriteWorkflow.definition,
      capability: "Generate Topic",
      steps: [{ id: "generate", capability: "generate-topic" }],
    },
  }
  const rewriteRequests: Record<string, unknown>[] = []
  let pauseNextRewriteResponse = false
  let resolvePausedRewriteRequest: (() => void) | null = null
  let releasePausedRewriteResponse: (() => void) | null = null
  let pausedRewriteRequestArrived: Promise<void> = Promise.resolve()
  const pauseRewriteResponse = () => {
    pauseNextRewriteResponse = true
    pausedRewriteRequestArrived = new Promise(resolve => { resolvePausedRewriteRequest = resolve })
    return {
      arrived: () => pausedRewriteRequestArrived,
      release: () => releasePausedRewriteResponse?.(),
    }
  }

  await context.route("**/api/cloud-projects", async route => {
    const command = route.request().postDataJSON()
    if (command.action === "list") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: projectRecord ? [projectRecord] : [] }),
      })
    } else if (command.action === "create") {
      projectRecord = command.record as Record<string, any>
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: projectRecord }) })
    } else if (command.action === "read") {
      await route.fulfill(projectRecord
        ? { status: 200, contentType: "application/json", body: JSON.stringify({ record: projectRecord }) }
        : { status: 404, contentType: "application/json", body: JSON.stringify({ code: "PROJECT_NOT_FOUND", error: "Not found" }) })
    } else if (command.action === "save") {
      if (!projectRecord || command.expectedRevision !== projectRecord.recordRevision) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PROJECT_CONFLICT", error: "Project changed" }) })
      } else {
        projectRecord = {
          ...(command.record as Record<string, any>),
          recordRevision: Number(command.expectedRevision) + 1,
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: projectRecord }) })
      }
    } else if (command.action === "load-files") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          files: [{
            fileId: "fixture-source-a",
            projectId,
            name: "field-manual.md",
            type: "text/markdown",
            size: sourceText.length,
            uploadedAt: 1_700_000_000_000,
          }],
        }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
    }
  })
  await context.route("**/api/cloud-files*", async route => {
    if (route.request().url().includes("fileId=fixture-source-a")) {
      await route.fulfill({ status: 200, contentType: "text/markdown", body: sourceText })
    } else {
      await route.continue()
    }
  })
  await context.route("**/api/ai-catalog", async route => {
    const command = route.request().postDataJSON()
    const workflows = [rewriteWorkflow, generateWorkflow]
    if (command.action === "list") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: workflows }) })
    } else if (command.action === "history") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ versions: workflows.filter(item => item.id === command.id) }) })
    } else if (command.action === "readiness") {
      const workflow = workflows.find(item => item.id === command.id)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          readiness: {
            status: "ready",
            workflow: { id: workflow?.id, version: workflow?.version },
            dependencies: {
              promptPack: { id: workflow?.definition.promptPack.id, version: workflow?.definition.promptPack.version, name: "Pinned prompt", state: "published" },
              referenceSet: { id: workflow?.definition.referenceSet.id, version: workflow?.definition.referenceSet.version, name: "Pinned reference", state: "published" },
              blueprint: { id: workflow?.definition.blueprint.id, version: workflow?.definition.blueprint.version, name: "Pinned blueprint", state: "published" },
            },
            model: { providerId: "openai", modelId: "test-rewrite-model" },
            checkedAt: "2026-10-01T00:00:00.000Z",
            blockers: [],
          },
        }),
      })
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID_ACTION", error: "Unsupported" }) })
    }
  })
  await context.route("**/api/rewrite-topic", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    rewriteRequests.push(body)
    expect(Object.keys(body).sort()).toEqual(["projectId", "topicId", "workflowId", "workflowVersion"])
    expect(body).toEqual({
      projectId,
      topicId: "stable-setup",
      workflowId: rewriteWorkflow.id,
      workflowVersion: rewriteWorkflow.version,
    })
    if (!projectRecord) throw new Error("The cloud project was not created")
    const topicMetadata = projectRecord.authorTopicMetadata["stable-setup"]
    const evidenceId = projectRecord.appToc[0].supportingEvidenceIds[0]
    const draft = {
      version: 1,
      draftId: "rewrite-proposal-1",
      topicId: "stable-setup",
      method: "ai-grounded-rewrite-topic-v1",
      rewriteSourceBlockIds: ["source-generated-a", "source-generated-b"],
      modelLabel: "AI rewrite · openai / test-rewrite-model",
      generatedAt: 1_800_000_000_001,
      groundingContextId: topicMetadata.groundingContext.contextId,
      groundingRevision: topicMetadata.groundingContext.contextId,
      contentType: "user-guide",
      language: "English",
      variableSnapshot: {},
      styleProvenance: {
        styleProfileId: "",
        styleProfileName: "Default",
        styleProfileScope: "project",
        styleFingerprint: "style-test",
        brandNames: [],
      },
      evidenceIdsUsed: [evidenceId],
      requiredEvidenceIdsUsed: [evidenceId],
      optionalEvidenceIdsUsed: [],
      warnings: [],
      blocks: [
        {
          id: "source-generated-a",
          sourceBlockId: "source-generated-a",
          type: "para",
          content: "Rewritten paragraph A.",
          evidenceIds: [evidenceId],
        },
        {
          id: "source-generated-b",
          sourceBlockId: "source-generated-b",
          type: "para",
          content: "Rewritten paragraph B.",
          evidenceIds: [evidenceId],
        },
      ],
      aiProvenance: {
        providerId: "openai",
        modelId: "test-rewrite-model",
        workflow: { id: rewriteWorkflow.id, version: rewriteWorkflow.version },
        promptPack: { id: "prompt-rewrite", version: 2 },
        referenceSet: { id: "reference-rewrite", version: 4 },
        blueprint: { id: "blueprint-rewrite", version: 5 },
      },
    }
    if (pauseNextRewriteResponse) {
      pauseNextRewriteResponse = false
      resolvePausedRewriteRequest?.()
      await new Promise<void>(resolve => { releasePausedRewriteResponse = resolve })
      releasePausedRewriteResponse = null
      resolvePausedRewriteRequest = null
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft, recordRevision: projectRecord.recordRevision }),
    })
  })

  const reloadAndOpenAuthor = async () => {
    await page.reload()
    await page.evaluate(async () => {
      const [auth, mode] = await Promise.all([
        import("/src/authSession.ts" as string),
        import("/src/authorizedProjectService.ts" as string),
      ])
      auth.setCloudAuthSession({
        user: { id: "ai-rewrite-ui-owner" },
        workspace: { id: "ai-rewrite-workspace", name: "Rewrite UI workspace" },
        membership: { userId: "ai-rewrite-ui-owner", workspaceId: "ai-rewrite-workspace", role: "owner" },
      })
      mode.setCloudProjectMode(true)
    })
    await page.getByTestId("topbar-administration").click()
    await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
    await page.getByRole("button", { name: "Open project Grounded Rewrite project", exact: true }).click()
    await page.getByRole("navigation", { name: /Project (?:navigation|modules)/ })
      .getByRole("button", { name: "Author", exact: true }).click()
    await page.getByTestId("author-outline").locator('[data-topic-id="stable-setup"]')
      .getByText("Prepare the Field Kit", { exact: true }).click()
  }

  await page.goto("/")
  await page.evaluate(async ({ id, source, blocks }) => {
    const [auth, mode, repository, evidenceModule, analysisModule, authorModule, metadataModule] = await Promise.all([
      import("/src/authSession.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/evidenceIndex.ts" as string),
      import("/src/conceptAnalysis.ts" as string),
      import("/src/authorDraftGeneration.ts" as string),
      import("/src/authorMetadata.ts" as string),
    ])
    auth.setCloudAuthSession({
      user: { id: "ai-rewrite-ui-owner" },
      workspace: { id: "ai-rewrite-workspace", name: "Rewrite UI workspace" },
      membership: { userId: "ai-rewrite-ui-owner", workspaceId: "ai-rewrite-workspace", role: "owner" },
    })
    mode.setCloudProjectMode(true)
    const evidenceIndex = evidenceModule.buildEvidenceIndex(source.sourceExtractions, source.sourcesRevision)
    const conceptAnalysis = analysisModule.buildConceptAnalysis(evidenceIndex)
    const requiredEvidenceId = evidenceIndex.items.find((item: { blockType: string }) => item.blockType !== "heading")?.id
    if (!requiredEvidenceId) throw new Error("The test fixture did not produce substantive evidence")
    const topicContent = blocks.map((block: Record<string, unknown>) => ({
      ...block,
      evidenceIds: ["applied-generated-a", "applied-generated-b"].includes(String(block.id))
        ? [requiredEvidenceId]
        : (block.evidenceIds ?? []),
    }))
    const metadata = metadataModule.createManualAuthorTopicMetadata("stable-setup", {
      contentType: source.projectMeta.contentType,
      variables: [],
    }, false)
    metadata.generationStatus = "generated"
    metadata.contentOrigin = "mixed"
    metadata.approved = true
    metadata.manualEdited = true
    metadata.evidenceIds = [requiredEvidenceId]
    metadata.appliedBaseline = {
      draftId: "rewrite-base-draft",
      groundingContextId: "grounding-before-refresh",
      contentFingerprint: authorModule.authorContentFingerprint(topicContent),
      blocks: [
        { sourceBlockId: "source-generated-a", appliedBlockId: "applied-generated-a", block: { id: "source-generated-a", type: "para", content: "Generated paragraph A.", evidenceIds: [requiredEvidenceId] } },
        { sourceBlockId: "source-generated-b", appliedBlockId: "applied-generated-b", block: { id: "source-generated-b", type: "para", content: "Generated paragraph B.", evidenceIds: [requiredEvidenceId] } },
        { sourceBlockId: "source-protected", appliedBlockId: "applied-protected", block: { id: "source-protected", type: "para", content: "Approved but protected paragraph.", evidenceIds: [] } },
        { sourceBlockId: "source-manually-edited", appliedBlockId: "applied-manually-edited", block: { id: "source-manually-edited", type: "para", content: "Original generated paragraph.", evidenceIds: [] } },
      ],
    }
    metadata.blockStates = {
      "applied-generated-a": "generated",
      "applied-generated-b": "approved",
      "applied-protected": "mixed",
      "applied-manually-edited": "manually-edited",
    }
    const record = await repository.authorizedProjectRepository.createProject({
      ...source,
      projectId: id,
      projectName: "Grounded Rewrite project",
      recordRevision: 0,
      themeVariables: { ...source.themeVariables, th1: source.themeVariables.theme },
      evidenceIndex,
      conceptAnalysis,
      tocGeneratedFromEvidenceSourcesRevision: evidenceIndex.sourcesRevision,
      tocGeneratedFromEvidenceExtractionRevision: evidenceIndex.extractionRevision,
      tocGeneratedFromConceptBuiltAt: conceptAnalysis.builtAt,
      tocGeneratedFromContentType: source.projectMeta.contentType,
      appToc: [{
        ...source.appToc[0],
        supportingEvidenceIds: [requiredEvidenceId],
        proposalKind: "evidence-backed",
      }],
      tocProposal: null,
      topicContent: { "stable-setup": topicContent },
      authorTopicMetadata: { "stable-setup": metadata },
    })
    await repository.authorizedProjectRepository.setActiveProjectId(record.projectId)
  }, { id: projectId, source: fixture, blocks: originalBlocks })

  await page.getByTestId("topbar-administration").click()
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: "Open project Grounded Rewrite project", exact: true }).click()
  await page.getByRole("navigation", { name: /Project (?:navigation|modules)/ })
    .getByRole("button", { name: "Author", exact: true }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="stable-setup"]')
    .getByText("Prepare the Field Kit", { exact: true }).click()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-grounding-toggle").click()
  const groundingInspector = page.getByTestId("author-grounding-inspector")
  await expect(groundingInspector).toBeVisible()
  const refreshGrounding = groundingInspector.getByTestId("refresh-author-grounding")
  await expect(refreshGrounding).toBeVisible()
  await expect(refreshGrounding).toBeEnabled()
  await refreshGrounding.click()
  await expect.poll(() => projectRecord?.authorTopicMetadata?.["stable-setup"]?.groundingContext?.contextId)
    .toMatch(/^grounding-/)
  await groundingInspector.getByRole("button", { name: "Close grounding inspector" }).click()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-context-tab-assist").click()

  await expect(page.getByTestId("ai-topic-controls").getByTestId("generate-ai-topic")).toBeVisible()
  const rewriteControls = page.getByTestId("ai-topic-rewrite-controls")
  await expect(rewriteControls).toContainText("Workflow ready")
  await expect(rewriteControls.getByTestId("rewrite-ai-topic")).toBeEnabled()
  const pausedRewrite = pauseRewriteResponse()
  await rewriteControls.getByTestId("rewrite-ai-topic").click()
  await pausedRewrite.arrived()
  if (!projectRecord) throw new Error("The cloud project disappeared during the rewrite request")
  projectRecord.authorTopicMetadata["stable-setup"].blockStates["applied-generated-a"] = "manually-edited"
  pausedRewrite.release()
  await expect(page.getByTestId("topic-ai-warning")).toContainText("changed during rewriting")
  expect(projectRecord.authorTopicMetadata["stable-setup"].draft).toBeNull()
  expect(projectRecord.topicContent["stable-setup"]).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "applied-generated-a", content: "Generated paragraph A." }),
  ]))

  projectRecord.authorTopicMetadata["stable-setup"].blockStates["applied-generated-a"] = "generated"
  await reloadAndOpenAuthor()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-context-tab-assist").click()
  await expect(page.getByTestId("ai-topic-rewrite-controls")).toContainText("Workflow ready")
  await page.getByTestId("ai-topic-rewrite-controls").getByTestId("rewrite-ai-topic").click()
  await expect.poll(() => rewriteRequests.length).toBe(2)
  await expect(page.getByTestId("ai-rewrite-topic-not-applied")).toBeVisible()
  await expect(page.getByTestId("ai-topic-provenance")).toContainText("workflow-rewrite-topic")
  await expect(page.getByTestId("ai-topic-provenance")).toContainText("prompt-rewrite v2")
  await expect(page.getByTestId("ai-topic-provenance")).toContainText("reference-rewrite v4")
  await expect(page.getByTestId("ai-topic-provenance")).toContainText("blueprint-rewrite v5")
  await expect.poll(() => projectRecord?.authorTopicMetadata?.["stable-setup"]?.draft?.method)
    .toBe("ai-grounded-rewrite-topic-v1")
  expect(projectRecord?.topicContent["stable-setup"]).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "applied-generated-a", content: "Generated paragraph A." }),
    expect.objectContaining({ id: "applied-generated-b", content: "Generated paragraph B." }),
    expect.objectContaining({ id: "applied-protected", content: "Approved but protected paragraph." }),
    expect.objectContaining({ id: "applied-manually-edited", content: "Human-edited paragraph." }),
    expect.objectContaining({ id: "unmapped-manual", content: "Unmapped manual paragraph." }),
  ]))

  await expect(page.getByTestId("author-regeneration-diff").locator('[data-diff-status="changed"]')).toHaveCount(2)
  await expect(page.getByTestId("author-regeneration-diff").locator('[data-diff-status="protected"]')).toHaveCount(1)
  await expect(page.getByTestId("author-regeneration-diff").locator('[data-diff-status="manually-edited"]')).toHaveCount(3)
  const secondChanged = page.getByTestId("author-regeneration-diff").locator('[data-diff-status="changed"]').nth(1)
  await secondChanged.getByRole("checkbox").uncheck()
  await expect.poll(() => projectRecord?.authorTopicMetadata?.["stable-setup"]?.regenerationProposal?.diffs
    .find((diff: { sourceBlockId: string }) => diff.sourceBlockId === "source-generated-b")?.selected).toBe(false)
  const protectedCheckbox = page.getByTestId("author-regeneration-diff").locator('[data-diff-status="protected"] input[type="checkbox"]')
  await expect(protectedCheckbox).toBeDisabled()
  const manualCheckbox = page.getByTestId("author-regeneration-diff").locator('[data-diff-status="manually-edited"] input[type="checkbox"]').first()
  await expect(manualCheckbox).toBeDisabled()

  if (!projectRecord) throw new Error("The cloud project disappeared before Apply")
  projectRecord.authorTopicMetadata["stable-setup"].blockStates["applied-generated-a"] = "manually-edited"
  await reloadAndOpenAuthor()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-draft-toggle").click()
  await page.getByTestId("apply-author-draft").click()
  await page.getByTestId("confirm-apply-author-draft").click()
  await page.getByTestId("author-draft-inspector")
    .getByRole("button", { name: "Close draft inspector" }).click()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-context-tab-assist").click()
  await expect(page.getByTestId("topic-ai-warning"))
    .toContainText("Rewrite protection or source-block mapping changed")
  expect(projectRecord.topicContent["stable-setup"]).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "applied-generated-a", content: "Generated paragraph A." }),
  ]))

  projectRecord.authorTopicMetadata["stable-setup"].blockStates["applied-generated-a"] = "generated"
  await reloadAndOpenAuthor()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-draft-toggle").click()
  await page.getByTestId("apply-author-draft").click()
  await expect(page.getByTestId("confirm-author-draft-apply")).toBeVisible()
  await page.getByTestId("confirm-apply-author-draft").click()
  await expect.poll(() => projectRecord?.topicContent?.["stable-setup"]?.find((block: { id: string }) =>
    block.id === "applied-generated-a")?.content).toBe("Rewritten paragraph A.")
  expect(projectRecord?.topicContent["stable-setup"]).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "applied-generated-b", content: "Generated paragraph B." }),
    expect.objectContaining({ id: "applied-protected", content: "Approved but protected paragraph." }),
    expect.objectContaining({ id: "applied-manually-edited", content: "Human-edited paragraph." }),
    expect.objectContaining({ id: "unmapped-manual", content: "Unmapped manual paragraph." }),
  ]))

  await reloadAndOpenAuthor()
  await expect(page.getByTestId("author-workspace")).toContainText("Rewritten paragraph A.")
  await expect(page.getByTestId("author-workspace")).toContainText("Generated paragraph B.")
  await expect(page.getByTestId("author-workspace")).toContainText("Human-edited paragraph.")
  expect(rewriteRequests).toHaveLength(2)
})