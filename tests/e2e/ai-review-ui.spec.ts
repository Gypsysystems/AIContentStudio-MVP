import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const fixture = JSON.parse(await readFile(
  new URL("../fixtures/project-record-v2.json", import.meta.url),
  "utf8",
)) as Record<string, any>
const sourceText = "Setup\nConnect the Field Kit before starting calibration."

function publishedWorkflow() {
  return {
    workspaceId: "ai-review-workspace",
    id: "workflow-ai-review",
    kind: "workflow",
    version: 1,
    state: "published",
    name: "Grounded AI Review",
    description: "",
    definition: {
      capability: " AI_Review ",
      model: { mode: "pinned", providerId: "openai", modelId: "test-review-model" },
      promptPack: { id: "prompt-review", version: 2 },
      referenceSet: { id: "reference-review", version: 4 },
      blueprint: { id: "blueprint-review", version: 5 },
      steps: [{ id: "review", capability: "ai review" }],
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "ai-review-ui-test",
  }
}

async function prepareCloudProject(page: Page, context: BrowserContext, role: "owner" | "viewer") {
  const projectId = `ai-review-ui-${role}-${Date.now()}`
  const workflow = publishedWorkflow()
  let projectRecord: Record<string, any> | null = null
  let aiReviewRequests: Record<string, unknown>[] = []

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
      await route.fulfill({ status: 200, contentType: "text/plain", body: sourceText })
    } else {
      await route.continue()
    }
  })
  await context.route("**/api/ai-catalog", async route => {
    const command = route.request().postDataJSON()
    if (command.action === "list") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [workflow] }) })
    } else if (command.action === "history") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ versions: [workflow] }) })
    } else if (command.action === "readiness") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          readiness: {
            status: "ready",
            workflow: { id: workflow.id, version: workflow.version },
            dependencies: {
              promptPack: { id: "prompt-review", version: 2, name: "Pinned prompt", state: "published" },
              referenceSet: { id: "reference-review", version: 4, name: "Pinned reference", state: "published" },
              blueprint: { id: "blueprint-review", version: 5, name: "Pinned blueprint", state: "published" },
            },
            model: { providerId: "openai", modelId: "test-review-model" },
            checkedAt: "2026-10-01T00:00:00.000Z",
            blockers: [],
          },
        }),
      })
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID_ACTION" }) })
    }
  })
  await context.route("**/api/ai-review", async route => {
    const request = route.request().postDataJSON() as Record<string, unknown>
    aiReviewRequests.push(request)
    expect(Object.keys(request).sort()).toEqual(["inputSnapshotId", "projectId", "workflowId", "workflowVersion"])
    expect(request).toEqual({
      projectId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      inputSnapshotId: projectRecord?.reviewModel.inputSnapshot.snapshotId,
    })
    if (!projectRecord) throw new Error("The project disappeared before AI Review")
    const previousModel = projectRecord.reviewModel
    const snapshot = previousModel.inputSnapshot
    const priorRunIds = previousModel.runs.map((run: { reviewRunId: string }) => run.reviewRunId)
    const priorFindingIds = previousModel.findings.map((finding: { findingId: string }) => finding.findingId)
    const runId = "ai-review-run-ui"
    const findingId = "ai-review-finding-ui"
    const topic = snapshot.topics[0]
    const block = topic.blocks.find((item: { blockId: string }) => item.blockId === "authored-body")
    const source = snapshot.sources[0]
    const evidence = snapshot.evidence[0]
    const run = {
      reviewRunId: runId,
      inputSnapshotId: snapshot.snapshotId,
      projectId,
      findingIds: [findingId],
      inputProvenance: snapshot.provenance,
      status: "complete",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
      method: "ai-grounded-review-v1",
      aiProvenance: {
        providerId: "openai",
        modelId: "test-review-model",
        workflow: { id: workflow.id, version: workflow.version },
        promptPack: { id: "prompt-review", version: 2 },
        referenceSet: { id: "reference-review", version: 4 },
        blueprint: { id: "blueprint-review", version: 5 },
      },
    }
    const finding = {
      findingId,
      findingKey: "ai-review:advisory-ui",
      reviewRunId: runId,
      inputSnapshotId: snapshot.snapshotId,
      projectId,
      topicId: topic.topicId,
      blockId: block.blockId,
      category: "AI Review",
      severity: "suggestion",
      required: false,
      originalText: block.content,
      claimFingerprint: block.fingerprint,
      rationale: "Confirm the authored setup order against the cited source passage.",
      sourceReferences: [{
        projectId,
        sourceId: source.sourceId,
        fileId: source.fileId,
        sourceFileName: source.fileName,
      }],
      evidenceReferences: [{
        evidenceId: evidence.evidenceId,
        projectId,
        sourceId: evidence.sourceId,
        fileId: evidence.fileId,
        sourceFileName: evidence.sourceFileName,
        blockId: evidence.blockId,
        location: evidence.location,
      }],
      styleReferences: snapshot.style ? [{
        styleProfileId: snapshot.style.styleProfileId,
        label: snapshot.style.name,
        fingerprint: snapshot.style.fingerprint,
      }] : [],
      suggestion: null,
      status: "open",
      dismissalReason: null,
      resolutionHistory: [],
      inputProvenance: snapshot.provenance,
      freshness: { status: "current", reasons: [], checkedAt: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retiredAt: null,
      retirementReason: null,
    }
    const reviewModel = {
      ...previousModel,
      activeReviewRunId: previousModel.activeReviewRunId,
      runs: [...previousModel.runs, run],
      findings: [...previousModel.findings, finding],
      updatedAt: Date.now(),
    }
    for (const id of priorRunIds) expect(reviewModel.runs.some(item => item.reviewRunId === id)).toBe(true)
    for (const id of priorFindingIds) expect(reviewModel.findings.some(item => item.findingId === id)).toBe(true)
    const recordRevision = projectRecord.recordRevision + 1
    projectRecord = { ...projectRecord, reviewModel, recordRevision }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run, findings: [finding], reviewModel, recordRevision }),
    })
  })

  await page.goto("/")
  await page.evaluate(async ({ id, initialRecord, membershipRole }) => {
    const [auth, mode, repository, evidenceModule, analysisModule, unsupportedModule, reviewInputModule, reviewModule, appModule, authorModule] = await Promise.all([
      import("/src/authSession.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/evidenceIndex.ts" as string),
      import("/src/conceptAnalysis.ts" as string),
      import("/src/unsupportedAnalysis.ts" as string),
      import("/src/reviewInput.ts" as string),
      import("/src/reviewModel.ts" as string),
      import("/src/App.tsx" as string),
      import("/src/authorMetadata.ts" as string),
    ])
    const setSession = (role: string) => auth.setCloudAuthSession({
      user: { id: "ai-review-ui-user" },
      workspace: { id: "ai-review-workspace", name: "AI Review UI workspace" },
      membership: { userId: "ai-review-ui-user", workspaceId: "ai-review-workspace", role },
    })
    setSession("owner")
    mode.setCloudProjectMode(true)

    const record = {
      ...initialRecord,
      projectId: id,
      projectName: `AI Review UI ${membershipRole}`,
      authorTopicMetadata: {},
      aiReviewDone: false,
      reviewStage: 1,
      projectMeta: {
        themeId: "th1",
        styleProfileId: "",
        templatePackId: "tp1",
        language: "en-US",
        version: "",
        contentType: "user-guide",
        ...initialRecord.projectMeta,
      },
      contentRevision: 5,
      isDemoMode: false,
    }
    const evidenceIndex = evidenceModule.buildEvidenceIndex(record.sourceExtractions, record.sourcesRevision)
    const conceptAnalysis = analysisModule.buildConceptAnalysis(evidenceIndex)
    const topicContent = record.topicContent
    const contentItems: Record<string, unknown>[] = []
    for (const [topicId, blocks] of Object.entries(topicContent).sort(([left], [right]) => left.localeCompare(right))) {
      for (const block of blocks as Record<string, any>[]) {
        if (!["h1", "h2", "h3", "h4", "code", "divider", "media", "variable", "bookmark"].includes(block.type)
          && typeof block.content === "string" && block.content.trim()) {
          contentItems.push({
            id: `${block.id}-content`,
            text: block.content.trim(),
            contextType: "topic-block",
            location: `Topic ${topicId} · block ${block.id}`,
            blockId: block.id,
            topicId,
          })
        }
      }
    }
    for (const block of record.docBlocks as Record<string, any>[]) {
      if (typeof block.content === "string" && block.content.trim()) {
        contentItems.push({
          id: `${block.id}-content`,
          text: block.content.trim(),
          contextType: "document-block",
          location: `Document block ${block.id}`,
          blockId: block.id,
        })
      }
    }
    const unsupportedAnalysis = unsupportedModule.buildUnsupportedAnalysis(
      evidenceIndex,
      conceptAnalysis,
      record.contentRevision,
      contentItems,
    )
    const authorTopicMetadata = authorModule.hydrateAuthorTopicMetadata(
      record.authorTopicMetadata,
      record.topicContent,
      record.appToc,
      {
        contentType: record.projectMeta.contentType,
        variables: record.themeVariables?.[record.projectMeta.themeId] ?? [],
      },
    )
    record.authorTopicMetadata = authorTopicMetadata
    const styleProfile = appModule.resolveEffectiveStyleProfile({
      themes: record.themes,
      projectMeta: record.projectMeta,
      activeStyleProfileId: record.activeStyleProfileId,
    })
    const snapshot = reviewInputModule.buildReviewInputSnapshot({
      projectId: id,
      contentType: record.projectMeta.contentType,
      language: record.projectMeta.language,
      contentRevision: record.contentRevision,
      tocRevision: record.tocRevision,
      topics: record.appToc,
      topicContent: record.topicContent,
      sourcesRevision: record.sourcesRevision,
      sourceFileIds: record.sourceFileIds,
      sourceExtractions: record.sourceExtractions,
      evidenceIndex,
      evidenceFresh: true,
      conceptAnalysis,
      conceptAnalysisFresh: true,
      analysisRevision: record.analysisRevision,
      unsupportedAnalysis,
      unsupportedAnalysisFresh: true,
      styleProfile,
      authorTopicMetadata,
    })
    record.evidenceIndex = evidenceIndex
    record.conceptAnalysis = conceptAnalysis
    record.unsupportedAnalysis = unsupportedAnalysis
    const deterministicRunId = "grounded-run-ui"
    const deterministicFindingId = "grounded-finding-ui"
    const firstTopic = snapshot.topics[0]
    const authoredBlock = firstTopic.blocks.find((block: { blockId: string }) => block.blockId === "authored-body")
    const deterministicFinding = {
      findingId: deterministicFindingId,
      findingKey: "grounded-ui:required",
      reviewRunId: deterministicRunId,
      inputSnapshotId: snapshot.snapshotId,
      projectId: id,
      topicId: firstTopic.topicId,
      blockId: authoredBlock.blockId,
      category: "Unsupported Claim",
      severity: "warning",
      required: true,
      originalText: authoredBlock.content,
      claimFingerprint: authoredBlock.fingerprint,
      rationale: "Resolve this required deterministic Review finding before preview.",
      sourceReferences: [],
      evidenceReferences: [],
      styleReferences: [],
      suggestion: null,
      status: "open",
      dismissalReason: null,
      resolutionHistory: [],
      inputProvenance: snapshot.provenance,
      freshness: { status: "current", reasons: [], checkedAt: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retiredAt: null,
      retirementReason: null,
    }
    const deterministicRun = {
      reviewRunId: deterministicRunId,
      inputSnapshotId: snapshot.snapshotId,
      projectId: id,
      findingIds: [deterministicFindingId],
      inputProvenance: snapshot.provenance,
      status: "complete",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    }
    record.reviewModel = {
      ...reviewModule.createEmptyReviewModel(id),
      activeReviewRunId: deterministicRunId,
      inputSnapshot: snapshot,
      runs: [deterministicRun],
      findings: [deterministicFinding],
      updatedAt: snapshot.capturedAt,
    }
    const created = await repository.authorizedProjectRepository.createProject(record)
    setSession(membershipRole)
    await repository.authorizedProjectRepository.setActiveProjectId(created.projectId)
  }, { id: projectId, initialRecord: fixture, membershipRole: role })

  await page.reload()
  await page.evaluate(async membershipRole => {
    const [auth, mode] = await Promise.all([
      import("/src/authSession.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
    ])
    auth.setCloudAuthSession({
      user: { id: "ai-review-ui-user" },
      workspace: { id: "ai-review-workspace", name: "AI Review UI workspace" },
      membership: { userId: "ai-review-ui-user", workspaceId: "ai-review-workspace", role: membershipRole },
    })
    mode.setCloudProjectMode(true)
  }, role)
  await page.getByTestId("topbar-administration").click()
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await page.getByRole("button", { name: `Open project AI Review UI ${role}` }).click()
  await page.getByRole("navigation", { name: /Project (?:navigation|modules)/ })
    .getByRole("button", { name: 'Review', exact: true }).click()
  if (role === "owner") await page.getByTestId("ai-review-controls").locator("summary").click()
  return {
    projectId,
    workflow,
    getProject: () => projectRecord,
    getRequests: () => aiReviewRequests,
  }
}

test("AI Review persists advisory findings in Review history without adding an Apply path", async ({ page, context }) => {
  const state = await prepareCloudProject(page, context, "owner")
  await expect(page.getByTestId("ai-review-controls")).toBeVisible()
  await expect(page.getByTestId("ai-review-readiness")).toContainText("Workflow ready")
  await expect(page.getByTestId("run-ai-review")).toBeEnabled()
  await expect(page.getByTestId("run-grounded-review")).toBeEnabled()

  await page.getByTestId("run-ai-review").click()
  await expect(page.getByTestId("ai-review-completed")).toBeVisible()
  expect(state.getRequests()).toHaveLength(1)
  await expect(page.getByTestId("review-run-filter")).toHaveValue("ai-review-run-ui")
  await expect(page.getByTestId("review-preview-publish")).toBeDisabled()
  await expect(page.getByTestId("grounded-review-finding")).toHaveCount(1)
  const aiFinding = page.getByTestId("grounded-review-finding")
  await expect(aiFinding.getByTestId("ai-review-advisory-badge")).toContainText("verify evidence")
  await expect(aiFinding.getByTestId("review-open-in-author")).toBeEnabled()
  await aiFinding.getByRole("button", { name: "Inspect" }).click()
  await expect(page.getByTestId("ai-review-advisory-notice")).toContainText("not an authoritative fact")
  await expect(page.getByTestId("review-apply-spelling")).toHaveCount(0)
  await expect(page.getByTestId("ai-review-controls")).toContainText("Completed")

  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await expect.poll(() =>
    state.getProject()?.reviewModel.findings.find((finding: { findingId: string }) => finding.findingId === "ai-review-finding-ui")?.status,
  ).toBe("dismissed")
  await expect.poll(() =>
    state.getProject()?.reviewModel.findings.find((finding: { findingId: string }) => finding.findingId === "ai-review-finding-ui")?.resolutionHistory.length,
  ).toBe(1)
  expect(state.getProject()?.reviewModel.activeReviewRunId).toBe("grounded-run-ui")
  await expect(page.getByTestId("review-preview-publish")).toBeDisabled()
  expect(state.getProject()?.topicContent["stable-setup"]).toEqual(fixture.topicContent["stable-setup"])
})

test("AI Review Author navigation preserves content and grounding inputs", async ({ page, context }) => {
  const state = await prepareCloudProject(page, context, "owner")
  await expect(page.getByTestId("ai-review-controls")).toBeVisible()
  await page.getByTestId("run-ai-review").click()
  await expect(page.getByTestId("ai-review-completed")).toBeVisible()
  await expect(page.getByTestId("review-run-filter")).toHaveValue("ai-review-run-ui")

  const beforeNavigation = JSON.parse(JSON.stringify(state.getProject()))
  const aiFinding = page.getByTestId("grounded-review-finding")
  await aiFinding.getByTestId("review-open-in-author").click()
  await expect(page.getByTestId("real-review-author-context")).toBeVisible()
  await expect(page.locator('[data-author-block-id="authored-body"]')).toContainText("Connect the Field Kit before calibration.")
  await expect(page.getByText("All changes saved")).toBeVisible()
  const afterNavigation = state.getProject()
  expect(afterNavigation?.contentRevision).toBe(beforeNavigation.contentRevision)
  expect(afterNavigation?.topicContent).toEqual(beforeNavigation.topicContent)
  expect(afterNavigation?.unsupportedAnalysis).toEqual(beforeNavigation.unsupportedAnalysis)
  expect(afterNavigation?.conceptAnalysis).toEqual(beforeNavigation.conceptAnalysis)
  expect(afterNavigation?.reviewModel.inputSnapshot.snapshotId).toBe(beforeNavigation.reviewModel.inputSnapshot.snapshotId)
  await page.getByTestId("real-review-author-context").getByRole("button", { name: /Back to Review/ }).click()
  await expect(page.getByTestId("review-input-readiness")).toContainText("Ready")
  await expect(page.getByTestId("ai-review-controls")).toBeVisible()
})

test("AI Review workflow controls are unavailable to a workspace Viewer", async ({ page, context }) => {
  await prepareCloudProject(page, context, "viewer")
  await expect(page.getByTestId("real-review-findings")).toBeVisible()
  await expect(page.getByTestId("ai-review-controls")).toHaveCount(0)
  await expect(page.getByTestId("run-ai-review")).toHaveCount(0)
})