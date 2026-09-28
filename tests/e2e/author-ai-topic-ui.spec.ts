import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

const fixture = JSON.parse(await readFile(
  new URL("../fixtures/project-record-v2.json", import.meta.url),
  "utf8",
)) as Record<string, any>
const sourceText = "# Field Manual\n\nConnect the Field Kit before calibration."

test("saves AI topic proposals, confirms replacements, and retains the prior proposal on save failure", async ({ page, context }) => {
  const projectId = `ai-topic-ui-${Date.now()}`
  let projectRecord: Record<string, any> | null = null
  let failSecondProposalSave = false
  let failNextBackgroundProposalSave = false
  let lastGeneratedDraft: Record<string, any> | null = null
  let backgroundWorkerAvailable = false
  let failNextBackgroundJob = false
  let backgroundJobSequence = 0
  const backgroundJobs: Record<string, any>[] = []
  const originalContent = fixture.topicContent["stable-setup"]
  const workflow = {
    workspaceId: "ai-topic-workspace",
    id: "workflow-generate-topic",
    kind: "workflow",
    version: 1,
    state: "published",
    name: "Grounded Topic",
    description: "",
    definition: {
      capability: " Generate_Topic ",
      model: { mode: "pinned", providerId: "openai", modelId: "test-topic-model" },
      promptPack: { id: "prompt-topic", version: 1 },
      referenceSet: { id: "reference-topic", version: 1 },
      blueprint: { id: "blueprint-topic", version: 1 },
      steps: [{ id: "generate", capability: "generate-topic" }],
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "topic-ui-test",
  }
  const requests: Record<string, unknown>[] = []

  const session = {
    authenticated: true,
    mode: "supabase",
    userId: "ai-topic-ui-owner",
    activeWorkspaceId: "ai-topic-workspace",
    activeRole: "owner",
    activeOrganizationName: "Topic UI workspace",
    activeWorkspaceName: "Topic UI workspace",
  }
  await context.route("**/api/auth/session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(session),
  }))
  await context.route("**/api/auth/refresh", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(session),
  }))
  await context.route("**/api/cloud-projects", async route => {
    const command = route.request().postDataJSON()
    if (command.action === "ready") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ready: true }) })
    } else if (command.action === "list") {
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
      const incoming = command.record as Record<string, any>
      const incomingDraftId = incoming.authorTopicMetadata?.["stable-setup"]?.draft?.draftId
      if (failNextBackgroundProposalSave && incomingDraftId?.startsWith("author-draft-ai-topic-background-")) {
        failNextBackgroundProposalSave = false
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SAVE_UNAVAILABLE", error: "Save unavailable" }),
        })
        return
      }
      if (failSecondProposalSave && incomingDraftId === "author-draft-ai-topic-ui-2") {
        failSecondProposalSave = false
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SAVE_UNAVAILABLE", error: "Save unavailable" }),
        })
        return
      }
      if (!projectRecord || command.expectedRevision !== projectRecord.recordRevision) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PROJECT_CONFLICT", error: "Project changed" }) })
      } else {
        projectRecord = {
          ...incoming,
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
              promptPack: { id: "prompt-topic", version: 1, name: "Topic prompt", state: "published" },
              referenceSet: { id: "reference-topic", version: 1, name: "Topic reference", state: "published" },
              blueprint: { id: "blueprint-topic", version: 1, name: "Topic blueprint", state: "published" },
            },
            model: { providerId: "openai", modelId: "test-topic-model" },
            checkedAt: "2026-10-01T00:00:00.000Z",
            blockers: [],
          },
        }),
      })
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID_ACTION", error: "Unsupported" }) })
    }
  })
  await context.route("**/api/generate-topic", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    expect(Object.keys(body).sort()).toEqual(["projectId", "topicId", "workflowId", "workflowVersion"])
    expect(body).toEqual({
      projectId,
      topicId: "stable-setup",
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    })
    if (!projectRecord) throw new Error("The cloud project was not created")
    const topicMetadata = projectRecord.authorTopicMetadata["stable-setup"]
    const groundingContext = topicMetadata.groundingContext
    const evidenceId = projectRecord.appToc[0].supportingEvidenceIds[0]
    const draft = {
      version: 1,
      draftId: `author-draft-ai-topic-ui-${requests.length}`,
      topicId: "stable-setup",
      method: "ai-grounded-topic-v1",
      modelLabel: "AI-generated · openai / test-topic-model",
      generatedAt: 1_800_000_000_000 + requests.length,
      groundingContextId: groundingContext.contextId,
      groundingRevision: groundingContext.contextId,
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
      blocks: [{
        id: "ai-topic-paragraph",
        type: "para",
        content: "Connect the Field Kit before starting calibration.",
        evidenceIds: [evidenceId],
      }],
      aiProvenance: {
        providerId: "openai",
        modelId: "test-topic-model",
        workflow: { id: workflow.id, version: 1 },
        promptPack: { id: "prompt-topic", version: 1 },
        referenceSet: { id: "reference-topic", version: 1 },
        blueprint: { id: "blueprint-topic", version: 1 },
      },
    }
    lastGeneratedDraft = draft
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft, recordRevision: projectRecord.recordRevision }),
    })
  })
  await context.route("**/api/generate-topic-jobs", async route => {
    const command = route.request().postDataJSON() as Record<string, unknown>
    if (command.action === "list") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobs: backgroundJobs.filter(job => job.projectId === command.projectId && job.topicId === command.topicId),
        }),
      })
      return
    }
    if (command.action === "enqueue") {
      expect(command).toEqual({
        action: "enqueue",
        projectId,
        topicId: "stable-setup",
        workflowId: workflow.id,
        workflowVersion: workflow.version,
      })
      if (!backgroundWorkerAvailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "WORKER_UNAVAILABLE",
            error: "Background Generate Topic is unavailable.",
          }),
        })
        return
      }
      if (!projectRecord || !lastGeneratedDraft) throw new Error("A project and grounded draft are required for the job fixture")
      backgroundJobSequence += 1
      const succeeded = !failNextBackgroundJob
      failNextBackgroundJob = false
      const job = {
        jobId: `topic-job-${backgroundJobSequence}`,
        projectId,
        topicId: "stable-setup",
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        inputRevision: projectRecord.recordRevision,
        status: succeeded ? "queued" : "failed",
        phase: succeeded ? "queued" : "provider-unavailable",
        attemptCount: succeeded ? 0 : 1,
        maxAttempts: 3,
        nextAttemptAt: null,
        createdAt: new Date(Date.now() + backgroundJobSequence).toISOString(),
        updatedAt: new Date(Date.now() + backgroundJobSequence).toISOString(),
        draft: {
          ...lastGeneratedDraft,
          draftId: `author-draft-ai-topic-background-${backgroundJobSequence}`,
          generatedAt: 1_800_000_000_000 + 100 + backgroundJobSequence,
        },
        ...(succeeded ? {} : {
          errorCode: "PROVIDER_UNAVAILABLE",
          errorMessage: "The provider is unavailable. Rerun after the worker is repaired.",
        }),
      }
      backgroundJobs.push(job)
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ job }) })
      return
    }
    expect(command.action).toBe("get")
    const job = backgroundJobs.find(candidate => candidate.jobId === command.jobId)
    if (!job) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "JOB_NOT_FOUND" }) })
      return
    }
    if (job.status === "queued") {
      job.status = "succeeded"
      job.phase = "complete"
      job.attemptCount = 1
      job.updatedAt = new Date(Date.now() + 10).toISOString()
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ job }) })
  })

  await page.goto("/")
  await page.evaluate(async ({ id, source }) => {
    const [auth, mode, repository, evidenceModule, analysisModule] = await Promise.all([
      import("/src/authSession.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/authorizedProjectService.ts" as string),
      import("/src/evidenceIndex.ts" as string),
      import("/src/conceptAnalysis.ts" as string),
    ])
    auth.setCloudAuthSession({
      user: { id: "ai-topic-ui-owner" },
      workspace: { id: "ai-topic-workspace", name: "Topic UI workspace" },
      membership: { userId: "ai-topic-ui-owner", workspaceId: "ai-topic-workspace", role: "owner" },
    })
    mode.setCloudProjectMode(true)
    const evidenceIndex = evidenceModule.buildEvidenceIndex(source.sourceExtractions, source.sourcesRevision)
    const conceptAnalysis = analysisModule.buildConceptAnalysis(evidenceIndex)
    const requiredEvidenceId = evidenceIndex.items.find(item => item.blockType !== "heading")?.id
    if (!requiredEvidenceId) throw new Error("The test fixture did not produce substantive evidence")
    const record = await repository.authorizedProjectRepository.createProject({
      ...source,
      projectId: id,
      projectName: "AI topic UI project",
      recordRevision: 0,
      themeVariables: {
        ...source.themeVariables,
        th1: source.themeVariables.theme,
      },
      evidenceIndex,
      conceptAnalysis,
      tocGeneratedFromEvidenceSourcesRevision: evidenceIndex.sourcesRevision,
      tocGeneratedFromEvidenceExtractionRevision: evidenceIndex.extractionRevision,
      tocGeneratedFromConceptBuiltAt: conceptAnalysis.builtAt,
      tocGeneratedFromContentType: source.projectMeta.contentType,
      appToc: [
        {
          ...source.appToc[0],
          supportingEvidenceIds: [requiredEvidenceId],
          proposalKind: "evidence-backed",
        },
        {
          ...source.appToc[0],
          id: 102,
          topicId: "other-topic",
          title: "Other topic",
          supportingEvidenceIds: [],
          sourceSectionPaths: [],
          rationale: "A separate topic for background-job scope checks.",
          proposalKind: "evidence-backed",
        },
      ],
      tocProposal: null,
      topicContent: source.topicContent,
    })
    await repository.authorizedProjectRepository.setActiveProjectId(record.projectId)
  }, { id: projectId, source: fixture })
  await page.getByTestId("topbar-administration").click()
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  const projectRow = page.locator("main div.group").filter({ has: page.getByText("AI topic UI project", { exact: true }) })
  await projectRow.getByRole("button", { name: "Open", exact: true }).click()

  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
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
  const controls = page.getByTestId("ai-topic-controls")
  await expect(controls).toContainText("Workflow ready")
  await controls.getByTestId("generate-ai-topic").click()

  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByTestId("ai-topic-not-applied")).toBeVisible()
  await expect(page.getByTestId("ai-topic-provenance")).toContainText("workflow-generate-topic")
  await expect.poll(() => projectRecord?.authorTopicMetadata?.["stable-setup"]?.draft?.method)
    .toBe("ai-grounded-topic-v1")
  const firstDraftId = projectRecord?.authorTopicMetadata?.["stable-setup"]?.draft?.draftId
  expect(projectRecord?.topicContent["stable-setup"]).toEqual(originalContent)
  expect(projectRecord?.authorTopicMetadata["stable-setup"].regenerationProposal).toBeTruthy()
  expect(requests).toEqual([{
    projectId,
    topicId: "stable-setup",
    workflowId: "workflow-generate-topic",
    workflowVersion: 1,
  }])

  await page.getByTestId("author-draft-inspector")
    .getByRole("button", { name: "Close draft inspector" }).click()
  await page.getByTestId("author-ai-assist").click()
  await controls.getByTestId("generate-ai-topic-background").click()
  await expect(controls.getByTestId("ai-topic-error")).toContainText("no worker is online")
  await expect(controls.getByTestId("generate-ai-topic")).toBeEnabled()
  expect(requests).toHaveLength(1)

  await controls.getByTestId("generate-ai-topic").click()
  await expect(controls.getByTestId("ai-topic-replacement-confirmation")).toBeVisible()
  expect(requests).toHaveLength(1)
  failSecondProposalSave = true
  await controls.getByTestId("confirm-ai-topic-proposal-replacement").click()
  await expect.poll(() => requests.length).toBe(2)
  await expect(page.getByTestId("topic-ai-warning")).toContainText("could not be durably saved")
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(firstDraftId)
  expect(projectRecord?.authorTopicMetadata["stable-setup"].regenerationProposal).toBeTruthy()
  expect(projectRecord?.topicContent["stable-setup"]).toEqual(originalContent)

  const retainedProposalId = projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId
  backgroundWorkerAvailable = true
  await controls.getByTestId("generate-ai-topic-background").click()
  await expect(controls.getByTestId("ai-topic-background-status")).toContainText("succeeded")
  const reloadedJobDraftId = backgroundJobs[0].draft.draftId
  expect(reloadedJobDraftId).not.toBe(retainedProposalId)
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(retainedProposalId)

  await page.reload()
  await page.getByTestId("topbar-administration").click()
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  const reopenedProjectRow = page.locator("main div.group").filter({ has: page.getByText("AI topic UI project", { exact: true }) })
  await reopenedProjectRow.getByRole("button", { name: "Open", exact: true }).click()
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByTestId("author-outline").locator('[data-topic-id="stable-setup"]')
    .getByText("Prepare the Field Kit", { exact: true }).click()
  await page.getByTestId("author-ai-assist").click()
  await page.getByTestId("author-context-tab-assist").click()
  const reopenedControls = page.getByTestId("ai-topic-controls")
  const closeDraftInspectorAndRestoreAssistIfOpen = async () => {
    const closeButton = page.getByTestId("author-draft-inspector")
      .getByRole("button", { name: "Close draft inspector" })
    if (await closeButton.isVisible()) {
      await closeButton.click()
      await page.getByTestId("author-ai-assist").click()
    }
  }
  await expect(reopenedControls.getByTestId("ai-topic-background-status")).toContainText("succeeded")
  await expect(reopenedControls.getByTestId("review-completed-ai-topic-job")).toBeVisible()
  await expect(page.getByTestId("author-draft-inspector")).toHaveCount(0)
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(retainedProposalId)

  await page.getByTestId("author-outline").locator('[data-topic-id="other-topic"]')
    .getByText("Other topic", { exact: true }).click()
  await expect(page.getByTestId("ai-topic-background-status")).toHaveCount(0)
  await expect(page.getByTestId("review-completed-ai-topic-job")).toHaveCount(0)
  await page.getByTestId("author-outline").locator('[data-topic-id="stable-setup"]')
    .getByText("Prepare the Field Kit", { exact: true }).click()
  await expect(page.getByTestId("ai-topic-background-status")).toContainText("succeeded")

  // Reopening and changing topic can advance the saved project revision. Use
  // a fresh job for the consent/replacement path so it is current at review.
  const jobsBeforeCurrentRevisionGeneration = backgroundJobs.length
  await closeDraftInspectorAndRestoreAssistIfOpen()
  await reopenedControls.getByTestId("generate-ai-topic-background").click()
  await expect.poll(() => backgroundJobs.length).toBe(jobsBeforeCurrentRevisionGeneration + 1)
  const currentRevisionJob = backgroundJobs[jobsBeforeCurrentRevisionGeneration]
  await expect(reopenedControls.getByTestId("ai-topic-background-status"))
    .toHaveAttribute("data-job-id", currentRevisionJob.jobId)
  await expect(reopenedControls.getByTestId("ai-topic-background-status")).toContainText("succeeded")
  let completedJobDraftId = currentRevisionJob.draft.draftId

  await reopenedControls.getByTestId("review-completed-ai-topic-job").click()
  await expect(reopenedControls.getByTestId("ai-topic-replacement-confirmation")).toBeVisible()
  await reopenedControls.getByTestId("cancel-ai-topic-proposal-replacement").click()
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(retainedProposalId)
  await reopenedControls.getByTestId("review-completed-ai-topic-job").click()
  await expect(reopenedControls.getByTestId("ai-topic-replacement-confirmation")).toBeVisible()
  failNextBackgroundProposalSave = true
  await reopenedControls.getByTestId("confirm-ai-topic-proposal-replacement").click()
  await expect.poll(() => failNextBackgroundProposalSave).toBe(false)
  await expect(page.getByTestId("topic-ai-warning")).toContainText("could not be durably saved")
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(retainedProposalId)

  // The failed durable save leaves the prior proposal intact, but retrying its
  // rollback may advance the project revision. Generate against that revision
  // rather than bypassing the review-time freshness check with an old job.
  const jobsBeforeFreshGeneration = backgroundJobs.length
  await closeDraftInspectorAndRestoreAssistIfOpen()
  await reopenedControls.getByTestId("generate-ai-topic-background").click()
  await expect.poll(() => backgroundJobs.length).toBe(jobsBeforeFreshGeneration + 1)
  const freshJob = backgroundJobs[jobsBeforeFreshGeneration]
  await expect(reopenedControls.getByTestId("ai-topic-background-status"))
    .toHaveAttribute("data-job-id", freshJob.jobId)
  await expect(reopenedControls.getByTestId("ai-topic-background-status")).toContainText("succeeded")
  completedJobDraftId = freshJob.draft.draftId
  await reopenedControls.getByTestId("review-completed-ai-topic-job").click()
  await expect(reopenedControls.getByTestId("ai-topic-replacement-confirmation")).toBeVisible()
  await reopenedControls.getByTestId("confirm-ai-topic-proposal-replacement").click()
  await expect.poll(() => projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId)
    .toBe(completedJobDraftId)
  expect(projectRecord?.topicContent["stable-setup"]).toEqual(originalContent)

  failNextBackgroundJob = true
  const jobsBeforeFailure = backgroundJobs.length
  await closeDraftInspectorAndRestoreAssistIfOpen()
  await reopenedControls.getByTestId("generate-ai-topic-background").click()
  await expect.poll(() => backgroundJobs.length).toBe(jobsBeforeFailure + 1)
  const failedJob = backgroundJobs[jobsBeforeFailure]
  await expect(reopenedControls.getByTestId("ai-topic-background-status"))
    .toHaveAttribute("data-job-id", failedJob.jobId)
  await expect(reopenedControls.getByTestId("ai-topic-background-status")).toContainText("failed")
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(completedJobDraftId)
  const jobsBeforeRerun = backgroundJobs.length
  await closeDraftInspectorAndRestoreAssistIfOpen()
  await reopenedControls.getByTestId("rerun-ai-topic-background").click()
  await expect.poll(() => backgroundJobs.length).toBe(jobsBeforeRerun + 1)
  const rerunJob = backgroundJobs[jobsBeforeRerun]
  await expect(reopenedControls.getByTestId("ai-topic-background-status"))
    .toHaveAttribute("data-job-id", rerunJob.jobId)
  await expect(reopenedControls.getByTestId("ai-topic-background-status")).toContainText("succeeded")
  expect(projectRecord?.authorTopicMetadata["stable-setup"].draft.draftId).toBe(completedJobDraftId)
})