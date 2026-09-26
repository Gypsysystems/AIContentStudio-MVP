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
  return page.locator("header").getByRole("button", {
    name: new RegExp(`^${label}\\b`),
  })
}

test("shows five authoring stages and nests Analysis and TOC under Analyze & Structure", async ({ page }) => {
  await createProject(page, `UX workflow ${Date.now()}`)

  for (const stage of ["Sources", "Analyze & Structure", "Author", "Review", "Publish"]) {
    await expect(workflowStep(page, stage)).toBeVisible()
  }

  await workflowStep(page, "Analyze & Structure").click()
  const subNavigation = page.getByRole("group", { name: "Analyze and structure screens" })
  const analysis = subNavigation.getByRole("button", { name: /Analysis/ })
  const toc = subNavigation.getByRole("button", { name: /Table of contents/ })
  await expect(analysis).toBeVisible()
  await expect(toc).toBeVisible()

  await analysis.click()
  await expect(page.getByTestId("analysis-generate-toc")).toBeVisible()
  await toc.click()
  await expect(page.getByTestId("real-toc-screen")).toBeVisible()
})

test("opens project details and theme styling from the project header", async ({ page }) => {
  await createProject(page, `UX settings ${Date.now()}`)

  await page.locator("header").getByRole("button", { name: /Project Settings/ }).click()
  await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible()

  await page.locator("header").getByRole("button", { name: /Brand & Output/ }).click()
  await expect(page.getByRole("heading", { name: "Theme & Style Profiles" })).toBeVisible()
})

test("exposes the active stage and completed source state accessibly", async ({ page }) => {
  await createProject(page, `UX stage states ${Date.now()}`)

  const sources = workflowStep(page, "Sources")
  await expect(sources).toHaveAttribute("aria-current", "step")

  await page.locator('input[type="file"]').setInputFiles({
    name: "ux-navigation-source.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Navigation\n\nThe navigation provides a structured authoring workflow.\n"),
  })
  await expect(page.getByTestId("evidence-freshness")).toHaveText("Current", { timeout: 15_000 })
  await workflowStep(page, "Author").click()

  const completedSources = workflowStep(page, "Sources")
  await expect(completedSources).not.toHaveAttribute("aria-current", "step")
  const state = await completedSources.getAttribute("aria-label")
    ?? await completedSources.getAttribute("title")
  expect(state).toMatch(/complete/i)
})

test("keeps Review-to-Author navigation and direct stage navigation available", async ({ page }) => {
  await createProject(page, `UX direct navigation ${Date.now()}`)

  await workflowStep(page, "Review").click()
  await expect(page.getByRole("heading", { name: "Grounded Review" })).toBeVisible()
  await workflowStep(page, "Author").click()
  await expect(workflowStep(page, "Author")).toHaveAttribute("aria-current", "step")

  await workflowStep(page, "Publish").click()
  await expect(workflowStep(page, "Publish")).toHaveAttribute("aria-current", "step")
  await workflowStep(page, "Sources").click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})

test("keeps the workflow keyboard accessible and usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createProject(page, `UX responsive ${Date.now()}`)

  for (const name of ["Project Settings", "Brand & Output", "Diagnostics"]) {
    const bounds = await page.locator("header").getByRole("button", { name }).boundingBox()
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
  await expect(author).toHaveAttribute("aria-current", "step")

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
  await page.locator("header").getByRole("button", { name: "Project Settings" }).click()
  await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(renamed)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(workflowStep(page, "Author")).toHaveAttribute("aria-current", "step")
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
  await page.locator("header").getByRole("button", { name: "Project Settings" }).click()
  await page.locator("header").getByRole("button", { name: "Back to project" }).click()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
  expect(await revision()).toBe(before)
})