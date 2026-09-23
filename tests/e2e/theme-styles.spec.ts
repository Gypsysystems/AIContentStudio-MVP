import { expect, test, type Page } from "@playwright/test"

type StoredProject = {
  projectId: string
  projectName: string
  activeStyleProfileId?: string
  projectMeta?: Record<string, unknown>
  themes: Array<{
    styleProfiles: Array<Record<string, unknown>>
  }>
  pageLayouts: Array<Record<string, unknown>>
  htmlMasterPages: Array<Record<string, unknown>>
}

async function createProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await expect(
    page.getByRole("heading", { name: "Theme & Style Profiles" }),
  ).toBeVisible()
}

async function readOnlyProject(page: Page): Promise<StoredProject> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .getAll()
      request.onsuccess = () => {
        const projects = request.result as StoredProject[]
        resolve(projects.sort((a, b) =>
          a.projectName.localeCompare(b.projectName),
        )[0])
      }
      request.onerror = () => reject(request.error)
    })
  })
}

async function updateOnlyProject(
  page: Page,
  update: (project: StoredProject) => StoredProject,
) {
  const project = await readOnlyProject(page)
  const updated = update(project)
  await page.evaluate(async (record) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite")
      transaction.objectStore("projects").put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, updated)
}

async function chooseFont(page: Page, sectionName: string, font: string) {
  const section = page
    .getByText(sectionName, { exact: true })
    .locator("..")
    .locator("..")
  await section.getByRole("button").first().click()
  await section.getByPlaceholder("Search fonts…").fill(font)
  await section.getByRole("button", { name: font, exact: true }).click()
}

test("persists an applied style profile and output template edits", async ({
  page,
}) => {
  test.setTimeout(60_000)
  const projectName = `Theme Persistence ${Date.now()}`
  const profileName = `Rich Profile ${Date.now()}`

  await createProject(page, projectName)

  await page.getByRole("button", { name: "+ New" }).click()
  const createProfile = page.getByRole("heading", {
    name: "Create Brand & Style Profile",
  }).locator("..")
  await createProfile.getByRole("textbox").fill(profileName)
  await createProfile.getByRole("button", { name: "Create" }).click()

  await page.getByRole("button", { name: "Colors", exact: true }).click()
  const primaryRow = page.getByText("Primary", { exact: true }).locator("..")
  await primaryRow.getByRole("button").first().click()
  await primaryRow.locator("input").fill("#C2410C")
  await primaryRow.getByRole("button", { name: "Apply" }).click()
  await page.getByRole("button", { name: "Save Colors" }).click()

  await page.getByRole("button", { name: "Typography", exact: true }).click()
  await chooseFont(page, "Heading Font", "Georgia")
  await chooseFont(page, "Body Font", "Verdana")
  await page.getByRole("button", { name: "Save Typography" }).click()
  await page.getByRole("button", { name: "Apply to Project" }).click()
  await expect(
    page.getByRole("button", { name: "✓ Applied to Project" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Output Templates" }).click()
  const orientation = page.getByText("Orientation", { exact: true }).locator("..")
  await orientation.locator("select").selectOption("landscape")

  await page.getByRole("button", { name: "HTML Master Pages" }).click()
  const contentWidth = page.getByText("Content Width (px)", { exact: true }).locator("..")
  await contentWidth.locator("input").fill("1400")
  await contentWidth.locator("input").blur()
  await expect(page.getByText("✓ Saved").first()).toBeVisible()

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await page.getByText(projectName, { exact: true }).click()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible()

  const stored = await readOnlyProject(page)
  const profiles = stored.themes.flatMap((theme) => theme.styleProfiles)
  const profile = profiles.find((candidate) => candidate.name === profileName)
  expect(profile).toMatchObject({
    primaryColor: "#C2410C",
    headingFont: "Georgia",
    bodyFont: "Verdana",
  })
  expect(stored.activeStyleProfileId).toBe(profile?.id)
  expect(stored.projectMeta?.styleProfileId).toBe(profile?.id)
  expect(
    stored.pageLayouts.some((layout) => layout.orientation === "landscape"),
  ).toBe(
    true,
  )
  expect(
    stored.htmlMasterPages.some((master) => master.contentWidth === 1400),
  ).toBe(true)

  await page.getByRole("button", { name: /Theme$/ }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(
    profileName,
  )
  await expect(
    page.getByRole("button", { name: "✓ Applied to Project" }),
  ).toBeVisible()
})

test("falls back safely when the persisted style profile ID is missing or invalid", async ({
  page,
}) => {
  const projectName = `Style ID Fallback ${Date.now()}`
  const profileName = `Fallback Profile ${Date.now()}`
  await createProject(page, projectName)

  await page.getByRole("button", { name: "+ New" }).click()
  const createProfile = page.getByRole("heading", {
    name: "Create Brand & Style Profile",
  }).locator("..")
  await createProfile.getByRole("textbox").fill(profileName)
  await createProfile.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: "Apply to Project" }).click()
  await expect
    .poll(async () => {
      const stored = await readOnlyProject(page)
      return stored.themes
        .flatMap((theme) => theme.styleProfiles)
        .some((profile) => profile.name === profileName)
    })
    .toBe(true)
  await page.getByRole("button", { name: /Content Studio/ }).click()

  for (const persistedId of [undefined, "missing-style-profile"]) {
    await updateOnlyProject(page, (project) => ({
      ...project,
      activeStyleProfileId: persistedId,
      projectMeta: { ...project.projectMeta, styleProfileId: persistedId },
    }))
    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.getByRole("button", { name: /Theme$/ }).click()
    await expect(
      page.getByRole("heading", { name: "Theme & Style Profiles" }),
    ).toBeVisible()
    await expect(
      page.getByRole("textbox", { name: "Search profiles…" }),
    ).toHaveValue(profileName)
    await expect(
      page.getByRole("button", { name: "Apply to Project" }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Sources", exact: true }).click()
  }
})