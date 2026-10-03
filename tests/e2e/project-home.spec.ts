import { expect, test, type Page } from "@playwright/test"
import { summarizeProjectHome, type ProjectHomeInput } from "../../src/projectHomeModel"
import { createEmptyReviewModel, type ReviewFinding, type ReviewRun } from "../../src/reviewModel"
import type { ReviewInputSnapshot } from "../../src/reviewInput"
import type { SourceExtraction } from "../../src/sourceExtractor"

type CloudRecord = Record<string, unknown> & {
  projectId: string
  recordRevision: number
}

type HomeCloud = {
  records: Map<string, CloudRecord>
  holdNextSave: (() => Promise<void>) | null
  auth: { signedIn: boolean; userId: string; workspaceId: string }
}

type HomeStoredProject = {
  projectId: string
  projectName: string
  appToc: Array<{ id: string | number; topicId?: string; title: string; level: number }>
  topicContent: Record<string, Array<{ id: string; type: string; content: string }>>
  contentRevision: number
  reviewModel: {
    activeReviewRunId: string | null
    inputSnapshot: ReviewInputSnapshot | null
    runs: Array<{
      reviewRunId: string
      completedAt: number | null
      findingIds: string[]
      inputSnapshotId: string
    }>
  }
  [key: string]: unknown
}

function projectHomeModelFixture(): ProjectHomeInput {
  const snapshot = {
    snapshotId: "home-review-snapshot",
    readiness: "ready",
    issues: [],
    topics: [{
      topicId: "topic-home",
      title: "Workspace access",
      level: 1,
      parentTopicId: null,
      order: 0,
      blocks: [{
        blockId: "block-home",
        type: "para",
        content: "Operators configure workspace access.",
        fingerprint: "fingerprint-home",
      }],
    }],
  } as unknown as ReviewInputSnapshot
  const reviewModel = createEmptyReviewModel("project-home-model")
  const run = {
    reviewRunId: "run-home",
    inputSnapshotId: snapshot.snapshotId,
    projectId: reviewModel.projectId,
    findingIds: [],
    inputProvenance: {},
    status: "complete",
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
  } as unknown as ReviewRun
  reviewModel.activeReviewRunId = run.reviewRunId
  reviewModel.inputSnapshot = snapshot
  reviewModel.runs = [run]

  return {
    sources: [{ fileId: "source-home", name: "operations.md" }],
    sourceExtractions: {
      "source-home": { status: "extracted" } as SourceExtraction,
    },
    evidenceFresh: true,
    conceptAnalysisFresh: true,
    unsupportedAnalysisFresh: true,
    hasEvidenceIndex: true,
    hasConceptAnalysis: true,
    hasUnsupportedAnalysis: true,
    materialConflicts: [],
    committedTocStale: false,
    topics: [{ topicId: "topic-home", title: "Workspace access", hasContent: true }],
    topicMetadata: {},
    reviewSnapshot: snapshot,
    reviewModel,
    publishConfig: { selectedFormats: ["html"] },
    isDemoMode: false,
    reviewFindingEligibility: () => true,
  }
}

async function mockCloud(page: Page): Promise<HomeCloud> {
  const cloud: HomeCloud = {
    records: new Map(),
    holdNextSave: null,
    auth: { signedIn: true, userId: "project-home-user", workspaceId: "project-home-workspace" },
  }
  const session = {
    authenticated: true,
    mode: "supabase",
    userId: "project-home-user",
    activeWorkspaceId: "project-home-workspace",
    activeRole: "owner",
    activeOrganizationName: "Project Home Org",
    activeWorkspaceName: "Project Home Workspace",
  }
  await page.route("**/api/auth/session", route => route.fulfill(cloud.auth.signedIn ? {
    status: 200,
    json: { ...session, userId: cloud.auth.userId, activeWorkspaceId: cloud.auth.workspaceId },
  } : { status: 401, json: { authenticated: false } }))
  await page.route("**/api/auth/refresh", route => route.fulfill({
    status: cloud.auth.signedIn ? 200 : 401,
    json: { authenticated: cloud.auth.signedIn },
  }))
  await page.route("**/api/auth/logout", route => {
    cloud.auth.signedIn = false
    return route.fulfill({ json: { authenticated: false } })
  })
  await page.route("**/api/auth/login", route => {
    cloud.auth.signedIn = true
    return route.fulfill({ json: { authenticated: true } })
  })
  await page.route("**/api/cloud-projects", async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    const action = input.action
    if (action === "ready") return route.fulfill({ json: { ready: true } })
    if (action === "list") return route.fulfill({ json: { projects: [...cloud.records.values()] } })
    if (action === "create") {
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId: String(input.projectId),
        ownerUserId: "project-home-user",
        workspaceId: "project-home-workspace",
        recordRevision: 0,
      } as CloudRecord
      cloud.records.set(record.projectId, record)
      return route.fulfill({ json: { record } })
    }
    if (action === "save") {
      if (cloud.holdNextSave) {
        const hold = cloud.holdNextSave
        cloud.holdNextSave = null
        await hold()
      }
      const projectId = String(input.projectId)
      const current = cloud.records.get(projectId)
      if (!current || current.recordRevision !== input.expectedRevision) {
        return route.fulfill({
          status: 409,
          json: { code: "PROJECT_CONFLICT", error: "Project changed elsewhere." },
        })
      }
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId,
        ownerUserId: "project-home-user",
        workspaceId: "project-home-workspace",
        recordRevision: Number(input.expectedRevision) + 1,
      } as CloudRecord
      cloud.records.set(projectId, record)
      return route.fulfill({ json: { record } })
    }
    if (action === "read" || action === "backup") {
      const record = cloud.records.get(String(input.projectId))
      return record
        ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: "PROJECT_NOT_FOUND", error: "Not found." } })
    }
    if (action === "load-files") return route.fulfill({ json: { files: [] } })
    return route.fulfill({
      status: 400,
      json: { code: "UNEXPECTED_ACTION", error: `Unexpected cloud action: ${String(action)}` },
    })
  })
  return cloud
}

async function createProject(page: Page, name: string) {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
}

async function readStoredProject(page: Page, name: string): Promise<HomeStoredProject> {
  return page.evaluate(async projectName => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<HomeStoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result as HomeStoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === projectName)
    if (!project) throw new Error(`Project not found: ${projectName}`)
    return project
  }, name)
}

async function patchStoredProject(page: Page, name: string, patch: Record<string, unknown>) {
  await page.evaluate(async ({ projectName, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<HomeStoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result as HomeStoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === projectName)
    if (!project) throw new Error(`Project not found: ${projectName}`)
    const store = db.transaction("projects", "readwrite").objectStore("projects")
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ ...project, ...values })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { projectName: name, values: patch })
}

async function clearOneGeneratedTaskTopic(page: Page, name: string) {
  const project = await readStoredProject(page, name)
  const target = project.appToc.find((topic, index) => {
    if (index === 0 || topic.level < 2) return false
    const topicId = topic.topicId?.trim() || `legacy-${topic.id}`
    return project.topicContent[topicId]?.some(block => !/^h[1-6]$/.test(block.type))
      || project.topicContent[String(topic.id)]?.some(block => !/^h[1-6]$/.test(block.type))
  })
  if (!target) throw new Error("The generated outline must contain an authored nested task topic")
  const topicId = target.topicId?.trim() || `legacy-${target.id}`
  const topicContent = { ...project.topicContent }
  delete topicContent[topicId]
  delete topicContent[String(target.id)]
  await patchStoredProject(page, name, {
    topicContent,
    contentRevision: project.contentRevision + 1,
  })
}

async function fillMissingAuthorTopics(page: Page, name: string) {
  return page.evaluate(async projectName => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<HomeStoredProject[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result as HomeStoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === projectName)
    if (!project) throw new Error(`Project not found: ${projectName}`)

    const topicContent = { ...project.topicContent }
    let added = 0
    for (const topic of project.appToc) {
      const topicId = topic.topicId?.trim() || `legacy-${topic.id}`
      if (topicContent[topicId]?.length || topicContent[String(topic.id)]?.length) continue
      topicContent[topicId] = [{
        id: `project-home-review-${topicId}`,
        type: "para",
        content: `${topic.title} explains how workspace operators complete this task and verify the result.`,
      }]
      added++
    }
    const { hydrateAuthorTopicMetadata } = await import("/src/authorMetadata.ts" as string)
    const projectMeta = project.projectMeta as { contentType: string; themeId: string }
    const themeVariables = project.themeVariables as Record<string, Array<{ name: string; value: string }>>
    if (!projectMeta?.contentType || !projectMeta.themeId || !themeVariables) {
      throw new Error("Project is missing the metadata context required to hydrate Author topics")
    }
    const authorTopicMetadata = hydrateAuthorTopicMetadata(
      project.authorTopicMetadata as Parameters<typeof hydrateAuthorTopicMetadata>[0],
      topicContent,
      project.appToc,
      {
        contentType: projectMeta.contentType,
        variables: themeVariables[projectMeta.themeId] ?? [],
      },
    )
    const store = db.transaction("projects", "readwrite").objectStore("projects")
    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        ...project,
        topicContent,
        authorTopicMetadata,
        contentRevision: project.contentRevision + 1,
        modifiedAt: Date.now(),
      })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    return added
  }, name)
}

async function openProjectHome(page: Page, name: string) {
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  const projectTile = page.getByRole("button", { name: `Open project ${name}`, exact: true })
  await expect(projectTile).toHaveCount(1)
  await projectTile.click()
  await expect(page.getByTestId("project-home")).toBeVisible()
}

async function returnToProjectHome(page: Page) {
  await page.getByTestId("topbar-project-home").click()
  await expect(page.getByTestId("project-home")).toBeVisible()
}

function homeProjectHeading(page: Page, name: string) {
  return page.getByTestId("project-home").getByRole("heading", { name, exact: true })
}

function homeStage(page: Page, stage: "sources" | "analysis" | "studio" | "quality" | "publish") {
  return page.getByTestId(`project-home-stage-${stage}`)
}

async function continueWorking(page: Page) {
  const action = page.getByTestId("project-home-continue")
  await expect(action).toBeVisible()
  await expect(action).toBeEnabled()
  await action.click()
}

async function addSource(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "project-home-operations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Workspace Operations\n\nUsers can open the workspace dashboard.\n\n## Review workspace access\n\nUsers can review their workspace access.\n",
    ),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current", {
    timeout: 15_000,
  })
}

async function proposeAndAcceptToc(page: Page) {
  await page.getByTestId("analyze-sources").click()
  await expect(page.getByTestId("concept-analysis-freshness")).toHaveText("Current")
  await page.getByTestId("analysis-generate-toc").click()
  await expect(page.getByTestId("toc-proposal-review")).toBeVisible()
  await page.getByTestId("commit-toc-proposal").click()
  await expect(page.getByTestId("author-stage-heading")).toBeVisible()
}

async function clearClaimCheck(page: Page) {
  await page.getByTestId("author-review-next-step")
    .getByRole("button", { name: "Refresh Claim Check" })
    .click()
  await expect(page.getByTestId("analysis-next-step")).toContainText("claim check is stale")
  await page.getByTestId("analysis-next-step")
    .getByRole("button", { name: "Rebuild Claim Check" })
    .click()
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Author" }).click()
  await expect(page.getByTestId("author-run-review")).toBeEnabled()
}

async function createHomeProjectWithEmptyTopics(page: Page, name: string) {
  await createProject(page, name)
  await addSource(page)
  await proposeAndAcceptToc(page)
  await clearClaimCheck(page)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")
  await openProjectHome(page, name)
  await clearOneGeneratedTaskTopic(page, name)
  await page.reload()
  await openProjectHome(page, name)
}

async function completeRequiredReview(page: Page) {
  if (await page.getByTestId("review-preview-publish").isEnabled()) return
  await expect(page.getByTestId("review-next-step")).toContainText("required")
  await page.getByTestId("review-next-step")
    .getByRole("button", { name: "Open a required finding" })
    .click()
  await expect(page.getByTestId("review-finding-inspector")).toBeVisible()
  for (let i = 0; i < 30 && await page.getByTestId("review-preview-publish").isDisabled(); i++) {
    const finding = page.getByTestId("grounded-review-finding")
      .filter({ hasText: /Required.*(?:open|in-review)/ })
      .first()
    if (await finding.getByRole("button", { name: "Inspect" }).count()) {
      await finding.getByRole("button", { name: "Inspect" }).click()
    }
    await finding.getByRole("button", { name: "Mark resolved" }).click()
  }
  await expect(page.getByTestId("review-preview-publish")).toBeEnabled()
}

test("Home readiness keeps heading-only authored topics in Author even after a current Review run", () => {
  const input = projectHomeModelFixture()
  input.reviewSnapshot = {
    ...input.reviewSnapshot!,
    topics: [{
      topicId: "topic-home",
      title: "Workspace access",
      level: 1,
      parentTopicId: null,
      order: 0,
      blocks: [{
        blockId: "heading-only",
        type: "h2",
        content: "Workspace access",
        fingerprint: "fingerprint-heading",
      }],
    }],
  }
  input.reviewModel.inputSnapshot = input.reviewSnapshot

  expect(summarizeProjectHome(input).continueStage).toBe("studio")
})

test("Home readiness routes stale claim checks with stale TOC to Analysis", () => {
  const input = projectHomeModelFixture()
  input.unsupportedAnalysisFresh = false
  input.committedTocStale = true

  const summary = summarizeProjectHome(input)
  expect(summary.continueStage).toBe("analysis")
  expect(summary.continueLabel).toBe("Refresh claim check")
})

test("Home topic-content issues retain the exact Author topic target", () => {
  const input = projectHomeModelFixture()
  input.topics = [
    { topicId: "topic-complete", title: "Complete topic", hasContent: true },
    { topicId: "topic-target", title: "Target topic", hasContent: false },
  ]
  input.reviewSnapshot = {
    ...input.reviewSnapshot!,
    readiness: "missing-inputs",
    topics: [
      { topicId: "topic-complete", title: "Complete topic", level: 1, parentTopicId: null, order: 0, blocks: [{ blockId: "block", type: "para", content: "Text.", fingerprint: "f" }] },
      { topicId: "topic-target", title: "Target topic", level: 1, parentTopicId: null, order: 1, blocks: [] },
    ],
  }
  input.reviewModel.inputSnapshot = input.reviewSnapshot

  expect(summarizeProjectHome(input).issues).toContainEqual(expect.objectContaining({
    id: "content-topic-target",
    topicId: "topic-target",
    stage: "studio",
  }))
})

test("demo Home does not present demo Review history as real project progress", () => {
  const input = projectHomeModelFixture()
  input.isDemoMode = true

  const summary = summarizeProjectHome(input)
  expect(summary.recentRun).toBeNull()
  expect(summary.stages.quality).not.toBe("Complete")
  expect(summary.continueStage).not.toBe("publish")
})

test("style-profile issues route to Branding and ineligible Review findings fall back to Review", () => {
  const input = projectHomeModelFixture()
  input.reviewSnapshot = {
    ...input.reviewSnapshot!,
    readiness: "missing-inputs",
    issues: [{
      code: "style-profile-missing",
      severity: "missing",
      message: "No canonical style profile is available.",
    }],
  }
  input.reviewModel.inputSnapshot = input.reviewSnapshot
  input.reviewModel.findings = [{
    findingId: "finding-home",
    reviewRunId: "run-home",
    inputSnapshotId: input.reviewSnapshot.snapshotId,
    required: true,
    status: "open",
    severity: "warning",
    rationale: "Inspect this required finding.",
    freshness: { status: "current" },
  } as unknown as ReviewFinding]
  input.reviewModel.runs[0] = {
    ...input.reviewModel.runs[0],
    findingIds: ["finding-home"],
  }
  input.reviewFindingEligibility = () => false

  const summary = summarizeProjectHome(input)
  const styleIssue = summary.issues.find(issue => issue.id.includes("style-profile-missing"))
  expect(styleIssue?.stage as string).toBe("branding")
  expect(summary.issues).toContainEqual(expect.objectContaining({
    id: "finding-finding-home",
    stage: "quality",
    findingId: "finding-home",
    authorTargetEligible: false,
  }))
})

test("project-list reopen lands on Home while active-project reload preserves Sources", async ({ page }) => {
  const name = `Home persisted ${Date.now()}`
  await createProject(page, name)
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()

  await page.getByRole("button", { name: `Open project ${name}`, exact: true }).click()
  await expect(page.getByTestId("project-home")).toBeVisible()
  await expect(page.getByTestId("project-home-continue")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await openProjectHome(page, name)
  await expect(homeProjectHeading(page, name)).toBeVisible()
})

test("Projects refresh retains the active project without entering its workflow", async ({ page }) => {
  const cloud = await mockCloud(page)
  const name = `Dashboard refresh ${Date.now()}`
  await createProject(page, name)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")
  const before = JSON.stringify([...cloud.records.values()])
  const pointer = await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))
  expect(pointer).toBeTruthy()
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))).toBe(pointer)
  expect(JSON.stringify([...cloud.records.values()])).toBe(before)
  await page.getByRole("button", { name: `Open project ${name}`, exact: true }).click()
  await expect(page.getByTestId("project-home")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  expect(JSON.stringify([...cloud.records.values()])).toBe(before)
})

test("explicit logout/login lands on Projects despite a retained active project", async ({ page }) => {
  await page.clock.install()
  const cloud = await mockCloud(page)
  const name = `Fresh login ${Date.now()}`
  await createProject(page, name)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")
  const before = JSON.stringify([...cloud.records.values()])
  const pointer = await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))
  await page.locator("header").getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))).toBe(pointer)
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("navigation@example.test")
  await page.getByLabel("Password", { exact: true }).fill("synthetic-test-password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))).toBe(pointer)
  expect(JSON.stringify([...cloud.records.values()])).toBe(before)
  // A later verified workspace switch must not inherit the login marker.
  await page.evaluate(id => localStorage.setItem("docflow-active-project:login-other-workspace", id!), pointer)
  cloud.auth.workspaceId = "login-other-workspace"
  await page.clock.fastForward(60_001)
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  cloud.auth.workspaceId = "project-home-workspace"
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.getByRole("button", { name: `Open project ${name}`, exact: true }).click()
  await expect(page.getByTestId("project-home")).toBeVisible()
  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Sources", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("dashboard intent is scoped to the verified user and workspace", async ({ page }) => {
  const cloud = await mockCloud(page)
  await createProject(page, `Scoped navigation ${Date.now()}`)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")
  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  cloud.auth.userId = "another-navigation-user"
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  cloud.auth.userId = "project-home-user"
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  const pointer = await page.evaluate(() => localStorage.getItem("docflow-active-project:project-home-workspace"))
  cloud.auth.workspaceId = "another-navigation-workspace"
  await page.evaluate(id => localStorage.setItem("docflow-active-project:another-navigation-workspace", id!), pointer)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("stale and inaccessible active projects safely fall back to Projects", async ({ page }) => {
  await mockCloud(page)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.setItem("docflow-active-project:project-home-workspace", "missing-project")
  })
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.route("**/api/cloud-projects", async (route) => {
    const input = route.request().postDataJSON()
    if (input.action === "read") return route.fulfill({ status: 403, json: { code: "PROJECT_FORBIDDEN", error: "Project is not accessible." } })
    return route.fallback()
  })
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toHaveCount(0)
})

test("Home shows read-only workflow status while the rail and unique analysis action handle navigation", async ({ page }) => {
  const name = `Home stage links ${Date.now()}`
  await createProject(page, name)
  await openProjectHome(page, name)

  for (const stage of ["sources", "studio", "quality", "publish"] as const) {
    await expect(homeStage(page, stage)).toBeVisible()
    await expect(homeStage(page, stage).getByRole("button")).toHaveCount(0)
  }
  await expect(page.getByTestId("project-home").getByRole("button", { name: "Project Settings" })).toHaveCount(0)
  await expect(page.getByTestId("project-home").getByRole("button", { name: "Brand & Output" })).toHaveCount(0)
  await homeStage(page, "analysis").getByRole("button", { name: "Open analysis" }).click()
  await expect(page.getByTestId("analysis-generate-toc")).toBeVisible()
  await openProjectHome(page, name)
  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("a topic-content issue opens the exact Author topic named by Home", async ({ page }) => {
  const name = `Home exact topic issue ${Date.now()}`
  await createHomeProjectWithEmptyTopics(page, name)

  const stored = await readStoredProject(page, name)
  const targetIndex = stored.appToc.findIndex((topic, index) => {
    const topicId = topic.topicId?.trim() || `legacy-${topic.id}`
    return index > 0
      && !stored.topicContent[topicId]?.length
      && !stored.topicContent[String(topic.id)]?.length
  })
  expect(targetIndex, "the setup should preserve a non-default empty task topic").toBeGreaterThan(0)
  const target = stored.appToc[targetIndex]
  const issue = page.getByTestId("project-home-issue")
    .filter({ hasText: "Topic needs content" })
    .filter({ hasText: target.title })
  await expect(issue).toBeVisible()
  await issue.click()

  await expect(page.getByTestId("author-topic-row")
    .filter({ hasText: target.title })).toHaveAttribute("aria-current", "true")
})

test("Continue routes combined stale claim-check and TOC issues to Analysis", async ({ page }) => {
  const name = `Home stale analysis route ${Date.now()}`
  await createHomeProjectWithEmptyTopics(page, name)
  expect(await fillMissingAuthorTopics(page, name)).toBeGreaterThan(0)
  await patchStoredProject(page, name, { tocGeneratedFromEvidenceSourcesRevision: -1 })
  await page.reload()
  await returnToProjectHome(page)
  await expect(page.getByTestId("project-home-issue").filter({ hasText: "Claim check is stale" })).toBeVisible()
  await expect(page.getByTestId("project-home-issue").filter({ hasText: "Committed structure is out of date" })).toBeVisible()

  await continueWorking(page)
  await expect(page.getByTestId("analysis-generate-toc")).toBeVisible()
})

test("Continue Working follows five real readiness states through Sources, Analysis, Author, Review, and Publish", async ({ page }) => {
  test.setTimeout(120_000)
  const name = `Home readiness ${Date.now()}`
  await createProject(page, name)
  await openProjectHome(page, name)

  // An empty project is blocked on Sources.
  await expect(homeStage(page, "sources")).toContainText("Not started")
  await continueWorking(page)
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()

  // Real uploaded evidence makes Analysis the next work item.
  await addSource(page)
  await openProjectHome(page, name)
  await expect(homeStage(page, "sources")).toContainText("Complete")
  await expect(homeStage(page, "analysis")).toContainText("Needs attention")
  await continueWorking(page)
  await expect(page.getByTestId("analysis-generate-toc")).toBeVisible()

  // Build a current proposal and claim check to reach the actual Author state.
  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await proposeAndAcceptToc(page)
  await clearClaimCheck(page)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")
  await openProjectHome(page, name)
  await clearOneGeneratedTaskTopic(page, name)
  await page.reload()
  await openProjectHome(page, name)
  await continueWorking(page)
  // Accepting a TOC can refresh Author content and invalidate the claim check.
  if (await page.getByTestId("analysis-next-step").isVisible()) {
    await page.getByTestId("analysis-next-step")
      .getByRole("button", { name: "Rebuild Claim Check" }).click()
    await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
    await returnToProjectHome(page)
    await continueWorking(page)
  }
  await expect(page.getByTestId("author-stage-heading")).toBeVisible()

  // Complete the nested task left empty for Author so Review has real inputs,
  // then refresh the content-sensitive claim check before Review.
  expect(await fillMissingAuthorTopics(page, name)).toBeGreaterThan(0)
  await page.reload()
  await returnToProjectHome(page)
  await continueWorking(page)
  await expect(page.getByTestId("analysis-next-step")).toContainText("claim check is stale")
  await page.getByTestId("analysis-next-step")
    .getByRole("button", { name: "Rebuild Claim Check" })
    .click()
  await expect(page.getByTestId("unsupported-analysis-freshness")).toHaveText("Current")
  await expect.poll(async () =>
    (await readStoredProject(page, name)).reviewModel.inputSnapshot?.readiness ?? null,
  ).toBe("ready")
  await returnToProjectHome(page)
  await continueWorking(page)
  await expect(page.getByRole("heading", { name: "Grounded Review" })).toBeVisible()
  await expect(page.getByTestId("real-review-findings")).toBeVisible()
  await expect(page.getByTestId("run-grounded-review")).toBeEnabled()
  await page.getByTestId("run-grounded-review").click()
  await expect.poll(async () => {
    const stored = await readStoredProject(page, name)
    const activeRun = stored.reviewModel.runs.find(run =>
      run.reviewRunId === stored.reviewModel.activeReviewRunId)
    return activeRun?.completedAt ?? 0
  }).toBeGreaterThan(0)
  await completeRequiredReview(page)
  await expect(page.locator("header").getByRole("status")).toContainText("All changes saved")

  // Recent work is only truthful if its completed timestamp is in persisted
  // Review history; don't infer activity from visiting Review.
  const beforeReopen = await readStoredProject(page, name)
  const beforeReopenRun = beforeReopen.reviewModel.runs.find(run =>
    run.reviewRunId === beforeReopen.reviewModel.activeReviewRunId)
  expect(
    beforeReopenRun?.inputSnapshotId,
    `Review snapshot mismatch before Home reopen: ${JSON.stringify({
      runSnapshotId: beforeReopenRun?.inputSnapshotId,
      modelSnapshotId: beforeReopen.reviewModel.inputSnapshot?.snapshotId,
      provenance: beforeReopen.reviewModel.inputSnapshot?.provenance,
      topicBlockFingerprints: beforeReopen.reviewModel.inputSnapshot?.topics.map(topic => ({
        topicId: topic.topicId,
        blockFingerprints: topic.blocks.map(block => block.fingerprint),
      })),
    })}`,
  ).toBe(beforeReopen.reviewModel.inputSnapshot?.snapshotId)
  await returnToProjectHome(page)
  const recentWork = page.getByTestId("project-home-recent-work")
  const persisted = await readStoredProject(page, name)
  const persistedRun = persisted.reviewModel.runs.find(run =>
    run.reviewRunId === persisted.reviewModel.activeReviewRunId)
  expect(
    persistedRun?.inputSnapshotId,
    `Review snapshot changed across Home reopen: ${JSON.stringify({
      runSnapshotId: persistedRun?.inputSnapshotId,
      beforeReopenSnapshotId: beforeReopen.reviewModel.inputSnapshot?.snapshotId,
      reopenedSnapshotId: persisted.reviewModel.inputSnapshot?.snapshotId,
      beforeReopenProvenance: beforeReopen.reviewModel.inputSnapshot?.provenance,
      reopenedProvenance: persisted.reviewModel.inputSnapshot?.provenance,
      beforeReopenContentFingerprint: beforeReopen.reviewModel.inputSnapshot?.provenance.contentFingerprint,
      reopenedContentFingerprint: persisted.reviewModel.inputSnapshot?.provenance.contentFingerprint,
      beforeReopenTopics: beforeReopen.reviewModel.inputSnapshot?.topics.map(topic => ({
        topicId: topic.topicId,
        blockFingerprints: topic.blocks.map(block => block.fingerprint),
      })),
      reopenedTopics: persisted.reviewModel.inputSnapshot?.topics.map(topic => ({
        topicId: topic.topicId,
        blockFingerprints: topic.blocks.map(block => block.fingerprint),
      })),
    })}`,
  ).toBe(persisted.reviewModel.inputSnapshot?.snapshotId)
  if (persistedRun?.completedAt) {
    await expect(recentWork).toBeVisible()
    await expect(recentWork).toContainText("Review run completed")
    await expect(recentWork).toContainText(`${persistedRun.findingIds.length} findings recorded`)
    await expect(recentWork.locator("time")).toHaveAttribute(
      "dateTime",
      new Date(persistedRun.completedAt).toISOString(),
    )
  } else {
    await expect(recentWork).toHaveCount(0)
  }
  expect(persistedRun?.completedAt ?? 0).toBeGreaterThan(0)
  await continueWorking(page)
  await expect(page.getByTestId("publish-stage-status")).toBeVisible()
})

test("Home shows grounded stage summaries and actionable attention without invented progress", async ({ page }) => {
  const name = `Home truthful summary ${Date.now()}`
  await createProject(page, name)
  await openProjectHome(page, name)

  for (const stage of ["sources", "analysis", "studio", "quality", "publish"] as const) {
    await expect(homeStage(page, stage)).toBeVisible()
    await expect(homeStage(page, stage)).not.toBeEmpty()
  }
  const homeText = await page.getByTestId("project-home").innerText()
  expect(homeText).not.toMatch(/\b\d+\s*%|\b\d+\s+of\s+\d+\s+(?:steps|stages|tasks)\b/i)
  expect(homeText).not.toMatch(/recently edited|last worked on today|activity score/i)

  const issue = page.getByTestId("project-home-issue")
    .filter({ hasText: "Add project sources" })
  await expect(issue).toBeVisible()
  await expect(issue).toContainText("Open Sources")
  const issueAction = issue
  await issueAction.click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("Home settings and branding are reachable and return to the same project", async ({ page }) => {
  const name = `Home settings ${Date.now()}`
  await createProject(page, name)
  await openProjectHome(page, name)

  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Project Settings" }).click()
  await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible()
  await page.getByRole("button", { name: "Return to project" }).click()
  await expect(page.getByTestId("project-home")).toBeVisible()
  await expect(homeProjectHeading(page, name)).toBeVisible()

  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Brand & Output" }).click()
  await expect(page.getByRole("heading", { name: "Theme & Style Profiles" })).toBeVisible()
  await returnToProjectHome(page)
  await expect(homeProjectHeading(page, name)).toBeVisible()
})

test("Home is keyboard accessible and fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const name = `Home responsive ${Date.now()}`
  await createProject(page, name)
  await returnToProjectHome(page)

  const continueButton = page.getByTestId("project-home-continue")
  await continueButton.focus()
  await expect(continueButton).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)

  await openProjectHome(page, name)
  for (const stage of ["sources", "analysis", "studio", "quality", "publish"] as const) {
    const bounds = await homeStage(page, stage).boundingBox()
    expect(bounds, `${stage} stage action should be visible`).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376)
  }
})

test("Home navigation respects a pending project-settings save", async ({ page }) => {
  const cloud = await mockCloud(page)
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { signalSaveStarted = resolve })
  const name = `Home delayed save ${Date.now()}`
  await createProject(page, name)
  cloud.holdNextSave = () => {
    signalSaveStarted()
    return saveGate
  }

  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Project Settings" }).click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(`${name} renamed`)
  await page.getByRole("button", { name: "Save changes" }).click()
  await saveStarted

  // Settings guards an in-flight save; the header's ordinary Home action
  // cannot bypass that write barrier.
  await page.getByTestId("topbar-project-home").click()
  await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Saving changes…" })).toBeVisible()
  releaseSave()
  await expect(page.getByRole("button", { name: "Saving changes…" })).toHaveCount(0)
  if (!await page.getByTestId("project-home").count()) await page.getByTestId("topbar-project-home").click()
  await expect(page.getByTestId("project-home")).toBeVisible()
  await page.getByRole("navigation", { name: "Project navigation" }).getByRole("button", { name: "Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await expect(page.locator("header").getByText("All changes saved", { exact: true })).toBeVisible()
})

test("cloud account and sign-out controls never cover project header actions", async ({ page }) => {
  test.setTimeout(90_000)
  await mockCloud(page)
  await page.route("**/api/auth/logout", route => route.fulfill({
    json: { authenticated: false, mode: "supabase" },
  }))
  await createProject(page, `Account header ${Date.now()}`)
  const header = page.locator("header")
  await expect(header.getByRole("status")).toContainText("All changes saved")

  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 })
    const actions = [
      header.getByRole("button", { name: "Preview" }),
      header.getByRole("button", { name: "Sign out" }),
    ]
    const bounds = await Promise.all(actions.map(async action => {
      await expect(action).toBeVisible()
      const box = await action.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      return box!
    }))
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const overlapWidth = Math.min(bounds[i].x + bounds[i].width, bounds[j].x + bounds[j].width)
          - Math.max(bounds[i].x, bounds[j].x)
        const overlapHeight = Math.min(bounds[i].y + bounds[i].height, bounds[j].y + bounds[j].height)
          - Math.max(bounds[i].y, bounds[j].y)
        expect(overlapWidth <= 1 || overlapHeight <= 1, `Header actions overlap at ${width}px`).toBe(true)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)

    const rail = page.getByRole("navigation", { name: "Project navigation" })
    await rail.getByRole("button", { name: "Project Home" }).click()
    await expect(page.getByTestId("project-home")).toBeVisible()
    await rail.getByRole("button", { name: "Project Settings" }).click()
    await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible()
    await page.getByRole("button", { name: "Return to project" }).click()
    await expect(page.getByTestId("project-home")).toBeVisible()
    await rail.getByRole("button", { name: "Brand & Output" }).click()
    await expect(page.getByRole("heading", { name: "Theme & Style Profiles" })).toBeVisible()
    await rail.getByRole("button", { name: "Project Home" }).click()
    await rail.getByRole("button", { name: "Sources" }).click()
    await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  }

  await expect(page.getByTestId("header-account")).toBeVisible()
  await header.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByText("Sign in to your workspace.")).toBeVisible()
  await expect(page.getByTestId("header-account")).toHaveCount(0)
})