import { expect, test, type Page } from "@playwright/test"

async function createProject(page: Page, name: string) {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("button", { name: "Continue — Sources" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
}

function workflowStep(page: Page, label: string) {
  return page.locator('nav[aria-label="Project navigation"], nav[aria-label="Project modules"]')
    .getByRole("button", { name: label === "Analyze & Structure" ? /^Structure/ : label, exact: label !== "Analyze & Structure" })
}

function authorModule(page: Page) {
  return page.getByRole("navigation", { name: "Project modules" })
    .getByRole("button", { name: "Author", exact: true })
}

test("shows six workflow destinations followed by project utilities in the rail", async ({ page }) => {
  await createProject(page, `UX workflow ${Date.now()}`)
  const rail = page.getByRole("navigation", { name: "Project navigation" })
  await expect(rail.locator("button")).toHaveText([
    "Project Home", "Sources", "Structure", "Author", "Review", "Publish",
    "History", "Project Settings", "Brand & Output", "Administration", "Diagnostics",
  ])
  await expect(page.locator("header").getByRole("button", { name: "Preview" })).toBeVisible()
  await expect(page.locator("header").getByRole("button", { name: "History" })).toHaveCount(0)
  await workflowStep(page, "Analyze & Structure").click()
  await expect(page.getByTestId("real-toc-screen")).toBeVisible()
})

test("opens project details and theme styling from the sidebar", async ({ page }) => {
  await createProject(page, `UX settings ${Date.now()}`)

  await workflowStep(page, "Project Settings").click()
  await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible()

  await workflowStep(page, "Brand & Output").click()
  await expect(page.getByRole("heading", { name: "Theme & Style Profiles" })).toBeVisible()
})

test("keeps History, Diagnostics, and Administration actions working from both rails", async ({ page }) => {
  await createProject(page, `UX rail actions ${Date.now()}`)
  const projectRail = page.getByRole("navigation", { name: "Project navigation" })
  await projectRail.getByRole("button", { name: "History" }).click()
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible()
  await expect(projectRail.getByRole("button", { name: "History" })).toHaveAttribute("aria-current", "page")
  await projectRail.getByRole("button", { name: "Diagnostics" }).click()
  await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await projectRail.getByRole("button", { name: "Author" }).click()
  const authorRail = page.getByRole("navigation", { name: "Project modules" })
  await authorRail.getByRole("button", { name: "History" }).click()
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible()
  await projectRail.getByRole("button", { name: "Author" }).click()
  await authorRail.getByRole("button", { name: "Administration" }).click()
  await expect(page.locator("header").getByText("Workspace access & settings")).toBeVisible()
})

test("exposes the active Author module after source material is ready", async ({ page }) => {
  await createProject(page, `UX stage states ${Date.now()}`)

  const sources = workflowStep(page, "Sources")
  await expect(sources).toHaveAttribute("aria-current", "page")

  await page.locator('input[type="file"]').setInputFiles({
    name: "ux-navigation-source.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Navigation\n\nThe navigation provides a structured authoring workflow.\n"),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current", { timeout: 15_000 })
  await workflowStep(page, "Author").click()

  await expect(authorModule(page)).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("navigation", { name: "Project modules" })
    .getByRole("button", { name: "Sources", exact: true })).toBeVisible()
})

test("keeps Review-to-Author navigation and direct stage navigation available", async ({ page }) => {
  await createProject(page, `UX direct navigation ${Date.now()}`)

  await workflowStep(page, "Review").click()
  await expect(page.getByRole("heading", { name: "Grounded Review" })).toBeVisible()
  await workflowStep(page, "Author").click()
  await expect(authorModule(page)).toHaveAttribute("aria-current", "page")

  await page.getByRole("navigation", { name: "Project modules" })
    .getByRole("button", { name: "Publish", exact: true }).click()
  await expect(workflowStep(page, "Publish")).toHaveAttribute("aria-current", "page")
  await workflowStep(page, "Sources").click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("keeps the workflow keyboard accessible and usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 420 })
  await createProject(page, `UX responsive ${Date.now()}`)

  const projectRail = page.locator(".studio-module-rail")
  expect(await projectRail.evaluate(rail => rail.scrollHeight > rail.clientHeight)).toBe(true)
  for (const name of ["Project Settings", "Brand & Output", "Diagnostics"]) {
    const action = workflowStep(page, name)
    await action.scrollIntoViewIfNeeded()
    const bounds = await action.boundingBox()
    expect(bounds, `${name} must be visible within the narrow viewport`).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376)
  }
  const firstStep = await workflowStep(page, "Sources").boundingBox()
  expect(firstStep).not.toBeNull()
  expect(firstStep!.x).toBeGreaterThanOrEqual(0)

  const author = workflowStep(page, "Author")
  await expect(author).toBeVisible()
  await author.focus()
  await expect(author).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(authorModule(page)).toHaveAttribute("aria-current", "page")
  const authorRail = page.locator(".author-module-rail")
  expect(await authorRail.evaluate(rail => rail.scrollHeight > rail.clientHeight)).toBe(true)
  await authorRail.getByRole("button", { name: "Diagnostics" }).scrollIntoViewIfNeeded()
  expect(await authorRail.evaluate(rail => rail.scrollTop)).toBeGreaterThan(0)

  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(documentWidth).toBeLessThanOrEqual(376)
})

test("reopens a persisted existing project without losing its project identity", async ({ page }) => {
  const projectName = `UX persisted project ${Date.now()}`
  await createProject(page, projectName)
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible()

  await page.locator("header").getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  await expect(page.locator("header").getByText(projectName, { exact: true })).toBeVisible()
})

test("project settings edits the same project and returns to the previous stage", async ({ page }) => {
  const originalName = `UX settings original ${Date.now()}`
  const renamed = `${originalName} updated`
  await createProject(page, originalName)
  await workflowStep(page, "Author").click()
  await page.getByRole("navigation", { name: "Project modules" })
    .getByRole("button", { name: "Project Settings" }).click()
  await expect(page.getByRole("heading", { name: "Project Settings" })).toBeVisible()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(renamed)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(authorModule(page)).toHaveAttribute("aria-current", "page")
  await page.locator("header").getByRole("button", { name: "Content Studio home" }).click()
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(1)
  await expect(page.getByText(originalName, { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
})

test("leaving unchanged project settings does not write a new project revision", async ({ page }) => {
  const name = `UX unchanged settings ${Date.now()}`
  await createProject(page, name)
  const revision = async () => page.evaluate(async projectName => {
    const { projectRepository } = await import("/src/projectService.ts" as string)
    const project = (await projectRepository.listProjects()).find(
      (item: { projectName: string; projectId: string }) => item.projectName === projectName,
    )
    if (!project) throw new Error("Created project was not found")
    return (await projectRepository.loadProject(project.projectId))?.recordRevision
  }, name)
  const before = await revision()
  await workflowStep(page, "Project Settings").click()
  await page.getByRole("button", { name: "Return to project" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  expect(await revision()).toBe(before)
})

test("project tiles and the shared module rail preserve primary and secondary destinations", async ({ page }) => {
  const name = `Studio shell ${Date.now()}`
  await createProject(page, name)
  await page.locator("header").getByRole("button", { name: "Content Studio home" }).click()

  const tile = page.getByRole("button", { name: `Open project ${name}`, exact: true })
  const tileContainer = page.locator(".studio-project-tile").filter({ has: tile })
  await expect(tile).toBeVisible()
  await expect(page.getByTestId("projects-page-actions").getByRole("button", { name: "New Project" })).toBeVisible()
  await tileContainer.getByLabel(`Project actions for ${name}`).click()
  for (const action of ["Open", "Duplicate", "Backup", "Delete"]) {
    await expect(tileContainer.getByRole("button", { name: action, exact: true })).toBeVisible()
  }
  await tileContainer.getByLabel(`Project actions for ${name}`).click()
  await tile.click()
  await expect(page.getByTestId("project-home")).toBeVisible()

  const rail = page.getByRole("navigation", { name: "Project navigation" })
  for (const [label, destination] of [
    ["Sources", "Add Source Material"],
    ["Review", "Grounded Review"],
  ]) {
    await rail.getByRole("button", { name: label, exact: true }).click()
    await expect(page.getByRole("heading", { name: destination })).toBeVisible()
  }
  await rail.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(rail.getByRole("button", { name: "Publish", exact: true })).toHaveAttribute("aria-current", "page")
  await rail.getByRole("button", { name: "Structure", exact: true }).click()
  await expect(page.getByTestId("real-toc-screen")).toBeVisible()
  await rail.getByRole("button", { name: "Author", exact: true }).click()
  await expect(page.getByTestId("author-workspace")).toBeVisible()
  const authorRail = page.getByRole("navigation", { name: "Project modules" })
  for (const utility of ["History", "Brand & Output", "Administration", "Diagnostics", "Project Settings"]) {
    await expect(authorRail.getByRole("button", { name: utility, exact: true })).toBeAttached()
  }
  await expect(authorRail.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0)
})

test("finalized brand assets render only in the header and favicon without clipping", async ({ page }) => {
  await page.goto("/")
  const headerLogo = page.locator("header .studio-header-logo")
  await expect(headerLogo).toBeVisible()
  await expect(headerLogo).toHaveAttribute("src", "/brand/header-logo.svg")
  expect(await headerLogo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  const favicon = await page.request.get("/favicon.svg")
  expect(favicon.ok()).toBe(true)
  expect(await favicon.text()).toContain('viewBox="0 0 32 32"')
  expect((await page.request.get("/favicon.ico")).ok()).toBe(true)
  expect((await page.request.get("/brand/header-logo-dark.svg")).ok()).toBe(true)

  await createProject(page, `Brand assets ${Date.now()}`)
  await expect(page.getByRole("navigation", { name: "Project navigation" }).locator("img")).toHaveCount(0)
  await workflowStep(page, "Author").click()
  await expect(page.getByRole("navigation", { name: "Project modules" }).locator("img")).toHaveCount(0)

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(headerLogo).toBeHidden()
  const compactMark = page.locator("header .studio-header-mark")
  await expect(compactMark).toBeVisible()
  expect(await compactMark.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const box = await compactMark.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(376)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)
})