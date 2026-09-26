import { expect, test } from "@playwright/test"

test("project creation checks case-insensitive whitespace-normalized names before submitting", async ({ page }) => {
  const projectId = `name-validation-${Date.now()}`
  await page.goto("/")
  await page.evaluate(async ({ projectId }) => {
    const { projectRepository } = await import("/src/projectService.ts" as string)
    await projectRepository.createProject({ projectId, projectName: "Asteria 2" })
  }, { projectId })

  await page.getByRole("button", { name: /New Project/ }).first().click()
  const nameInput = page.locator('input[placeholder^="e.g. Nexus Platform"]')
  await nameInput.fill(" asteria   2 ")
  await expect(page.getByRole("alert")).toContainText(/already exists in this workspace/i)

  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await expect(page.getByRole("heading", { name: "Project Details" })).toBeVisible()
  const projectNames = await page.evaluate(async () => {
    const { projectRepository } = await import("/src/projectService.ts" as string)
    return (await projectRepository.listProjects()).map(project => project.projectName)
  })
  expect(projectNames).toEqual(["Asteria 2"])
})

test("duplicate flow asks the user to confirm its suggested unique copy name", async ({ page }) => {
  const projectId = `name-duplicate-${Date.now()}`
  const projectName = `Asteria ${Date.now()}`
  await page.goto("/")
  await page.evaluate(async ({ projectId, projectName }) => {
    const { projectRepository } = await import("/src/projectService.ts" as string)
    await projectRepository.createProject({ projectId, projectName })
    await projectRepository.createProject({
      projectId: `${projectId}-copy`,
      projectName: `${projectName} Copy`,
    })
  }, { projectId, projectName })
  await page.reload()

  const sourceCard = page.getByText(projectName, { exact: true }).locator("xpath=../../..")
  await sourceCard.hover()
  await sourceCard.getByRole("button", { name: "Duplicate", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Duplicate project" })
  await expect(dialog).toBeVisible()
  const suggested = page.getByLabel("Name for copy")
  await expect(suggested).toHaveValue(`${projectName} Copy (2)`)
  await page.getByRole("button", { name: /Create copy as/ }).click()
  await expect(dialog).not.toBeVisible()

  const names = await page.evaluate(async () => {
    const { projectRepository } = await import("/src/projectService.ts" as string)
    return (await projectRepository.listProjects()).map(project => project.projectName)
  })
  expect(names).toContain(`${projectName} Copy (2)`)
  expect(names).toContain(`${projectName} Copy`)
})