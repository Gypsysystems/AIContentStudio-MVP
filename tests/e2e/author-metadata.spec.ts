import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ mode: "serial" })

type StoredTopic = {
  id: number
  topicId: string
  title: string
  level: 1 | 2 | 3 | 4
  words: number
}

type AuthorTopicMetadata = {
  topicId: string
  generationStatus: "not-generated" | "draft" | "generated" | "failed"
  contentOrigin: "manual" | "generated" | "mixed" | "approved"
  evidenceIds: string[]
  sourcePaths: string[][]
  sourceFileIds: string[]
  provenance: {
    sourcesRevision: number | null
    evidenceExtractionRevision: string | null
    analysisBuiltAt: number | null
    analysisRevision: number | null
    contentType: string
    variableSnapshot: Record<string, string>
  }
  generatedAt: number | null
  generatedFreshness: "not-applicable" | "current" | "stale"
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
  sourcesRevision: number
  evidenceIndex: {
    sourcesRevision: number
    extractionRevision: string
    items: Array<{ id: string; fileId: string; sourceId: string; sectionPath?: string[] }>
  } | null
  conceptAnalysis: { builtAt: number } | null
  analysisRevision: number
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
    provenance: {
      sourcesRevision: null,
      evidenceExtractionRevision: null,
      analysisBuiltAt: null,
      analysisRevision: null,
      contentType: "user-guide",
      variableSnapshot: { product: "Orbital Console" },
    },
    generatedAt: 1_700_000_000_000,
    generatedFreshness: "current",
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
      analysisBuiltAt: original.conceptAnalysis.builtAt,
      analysisRevision: original.analysisRevision,
      contentType: original.projectMeta.contentType,
      variableSnapshot: { product: "Orbital Console" },
    },
  })
  await patchProject(page, projectName, {
    appToc: [{ id: 1, topicId: "topic-grounded", title: "Grounded", level: 1, words: 100 }],
    topicContent: {
      "topic-grounded": [{ id: "grounded-h1", type: "h1", content: "Existing content" }],
    },
    authorTopicMetadata: { "topic-grounded": generated },
  })
  await page.reload()
  await expect.poll(async () =>
    (await readProject(page, projectName)).authorTopicMetadata?.["topic-grounded"]?.evidenceIds,
  ).toEqual([evidence.id])
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
  expect(copied.provenance.variableSnapshot).toEqual({ product: "Orbital Console" })
  expect(copied.generatedFreshness).toBe("current")
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