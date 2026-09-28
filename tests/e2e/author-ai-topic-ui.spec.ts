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
      const incoming = command.record as Record<string, any>
      const incomingDraftId = incoming.authorTopicMetadata?.["stable-setup"]?.draft?.draftId
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft, recordRevision: projectRecord.recordRevision }),
    })
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
      appToc: [{
        ...source.appToc[0],
        supportingEvidenceIds: [requiredEvidenceId],
        proposalKind: "evidence-backed",
      }],
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
  await page.getByTestId("author-grounding-toggle").click()
  await page.getByTestId("refresh-author-grounding").click()
  await expect.poll(() => projectRecord?.authorTopicMetadata?.["stable-setup"]?.groundingContext?.contextId)
    .toMatch(/^grounding-/)
  await page.getByTestId("author-grounding-inspector").getByRole("button", { name: "Close grounding inspector" }).click()
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
})