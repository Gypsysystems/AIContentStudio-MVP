import { expect, test } from "@playwright/test"

test("creates a project and reopens it after a reload", async ({ page }) => {
  const projectName = `Smoke Test Project ${Date.now()}`

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await expect(page.getByText("No projects yet", { exact: true })).toBeVisible()

  await page
    .getByRole("button", { name: /New Project/ })
    .first()
    .click()
  await expect(
    page.getByRole("heading", { name: "Project Details" }),
  ).toBeVisible()
  await page
    .locator('input[placeholder^="e.g. Nexus Platform"]')
    .fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()

  await expect(
    page.getByText(projectName, { exact: true }).first(),
  ).toBeVisible()
  await page.getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()

  await page.getByText(projectName, { exact: true }).click()
  await expect(page.getByTestId("project-home")).toBeVisible()

  await page.reload()
  await expect(
    page.getByText(projectName, { exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "Add Source Material" })).toBeVisible()
})
