import { expect, test, type Page } from "@playwright/test"
import { searchAuthorTopicContent } from "../../src/authorSearch"

async function createProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
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
    store.put({ ...project, ...values, updatedAt: Date.now() })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, { name: projectName, values: patch })
}

async function readProject(page: Page, projectName: string): Promise<Record<string, any>> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
    const projects = await new Promise<Record<string, any>[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    return project
  }, projectName)
}

const persistedTopicContent = {
  "topic-alpha": [
    { id: "alpha-heading", type: "h1", content: "Operations" },
    { id: "alpha-list", type: "list", content: "", listItems: [{ id: "li-1", text: "Needle list entry", level: 1, type: "bullet" }] },
    { id: "alpha-procedure", type: "procedure", content: "Deploy", procedureSteps: ["Needle procedure step"] },
    { id: "alpha-table", type: "table", content: "", tableData: { hasHeader: true, rows: [["Key", "Value"], ["Search", "Needle table cell"]] } },
    { id: "alpha-callout", type: "callout", content: "Needle callout text", calloutVariant: "warning" },
    { id: "alpha-code", type: "code", content: "const needleCode = true" },
    { id: "alpha-media", type: "media", content: "", mediaType: "image", caption: "Needle image caption" },
  ],
  "topic-beta": [
    { id: "beta-heading", type: "h1", content: "Reference" },
    { id: "beta-quote", type: "quote", content: "Needle quote in another topic" },
  ],
}

test("indexes persisted textual fields by stable topic ID without mutating content", () => {
  const toc = [
    { id: 20, topicId: "topic-beta", title: "Beta renamed" },
    { id: 10, topicId: "topic-alpha", title: "Alpha renamed" },
  ]
  const before = structuredClone(persistedTopicContent)
  const results = searchAuthorTopicContent(toc, persistedTopicContent, "needle")

  expect(results).toHaveLength(7)
  expect(new Set(results.map(result => result.topicId))).toEqual(new Set(["topic-alpha", "topic-beta"]))
  expect(new Set(results.map(result => result.field))).toEqual(new Set([
    "list item",
    "procedure step",
    "table cell",
    "block text",
    "caption",
  ]))
  expect(results.find(result => result.blockId === "alpha-table")).toMatchObject({
    topicTitle: "Alpha renamed",
    blockIndex: 3,
    matchContext: "table cell · table · block 4",
  })
  expect(persistedTopicContent).toEqual(before)
})

test("searches all persisted topics after reload, uses renamed titles, navigates to blocks, and has no real-project fallback", async ({ page }) => {
  const projectName = `Author search ${Date.now()}`
  await createProject(page, projectName)
  await patchProject(page, projectName, {
    appToc: [
      { id: 20, topicId: "topic-beta", title: "Second topic renamed", level: 1, words: 10 },
      { id: 10, topicId: "topic-alpha", title: "First topic renamed", level: 1, words: 30 },
    ],
    topicContent: persistedTopicContent,
  })

  await page.reload()
  await page.locator("header").getByRole("button", { name: /^Author,/ }).click()
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("button", { name: "Find & Replace" }).click()
  await page.getByRole("button", { name: "All Topics" }).click()
  await page.getByPlaceholder("Search all topics…").fill("needle")

  const results = page.getByTestId("author-project-search-result")
  await expect(results).toHaveCount(7)
  await expect(results.filter({ hasText: "First topic renamed" })).toHaveCount(6)
  await expect(results.filter({ hasText: "Second topic renamed" })).toHaveCount(1)
  await expect(results.filter({ hasText: "table cell · table · block 4" })).toHaveCount(1)

  const beforeSearch = (await readProject(page, projectName)).topicContent
  await page.getByPlaceholder("Search all topics…").fill("Nexus Platform")
  await expect(results).toHaveCount(0)
  await expect(page.getByText("No results found across topics")).toBeVisible()
  expect((await readProject(page, projectName)).topicContent).toEqual(beforeSearch)

  await page.getByPlaceholder("Search all topics…").fill("quote in another")
  const betaResult = results.first()
  await expect(betaResult).toHaveAttribute("data-topic-id", "topic-beta")
  await expect(betaResult).toHaveAttribute("data-block-id", "beta-quote")
  await betaResult.click()

  await expect(page.locator("#beta-quote")).toBeVisible()
  await expect(page.getByTestId("author-outline").locator('[data-topic-id="topic-beta"]'))
    .toHaveAttribute("aria-current", "true")
  await expect.poll(() => page.evaluate(() =>
    document.activeElement?.closest("#beta-quote")?.id ?? null,
  )).toBe("beta-quote")
  expect((await readProject(page, projectName)).topicContent).toEqual(beforeSearch)
})