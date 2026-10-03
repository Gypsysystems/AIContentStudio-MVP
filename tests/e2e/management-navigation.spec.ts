import { expect, test, type Page } from '@playwright/test'

async function createProject(page: Page, name: string) {
  if (page.url() === 'about:blank') await page.goto('/')
  if (!await page.getByRole('heading', { name: 'Projects' }).isVisible())
    await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
}

async function projects(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

function management(page: Page, label: string) {
  return page.getByRole('navigation', { name: 'Workspace management' }).getByRole('button', { name: label, exact: true })
}

test('Home management starts at cross-project and workspace defaults', async ({ page }) => {
  const name = `Management home ${Date.now()}`
  await createProject(page, name)
  await projects(page)

  await management(page, 'History').click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('all')
  await expect(page.getByRole('button', { name: `Open history for ${name}` })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search projects and activity' }).fill('no matching project')
  await expect(page.getByText('No project history matches these filters.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search projects and activity' }).fill('')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: name })
  await expect(page.getByTestId('project-history')).toBeVisible()
  await page.getByRole('combobox', { name: 'Project' }).selectOption('all')
  await expect(page.getByTestId('project-history')).toHaveCount(0)
  await page.getByRole('button', { name: 'Return to Projects' }).click()

  await management(page, 'Project Settings').click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('')
  await expect(page.getByText('Select a project to edit its settings.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: name })
  await expect(page.locator('input[placeholder^="e.g. Nexus Platform"]')).toHaveValue(name)
  await page.getByRole('button', { name: 'Return to Projects' }).click()

  await management(page, 'Brand & Output').click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: name })
  await expect(page.getByRole('heading', { name: 'Theme & Style Profiles' })).toBeVisible()
  await page.getByRole('button', { name: 'Return to Projects' }).click()

  await management(page, 'Diagnostics').click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('all')
  await expect(page.getByTestId('all-projects-diagnostics')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search diagnostics' }).fill('no matching project')
  await expect(page.getByText('No projects match this search.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search diagnostics' }).fill('')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: name })
  await expect(page.getByRole('searchbox', { name: 'Search diagnostics' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Diagnostic component' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Diagnostic component' }).selectOption('Review')
  await page.getByRole('combobox', { name: 'Diagnostic status' }).selectOption('info')
  await expect(page.getByText('Review Status')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByTestId('topbar-administration').click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('')
  await expect(page.getByTestId('administration-workspace').getByText('No project selected').first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: name })
  await expect(page.getByText('Current project', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Return to Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
})

test('project entry preselects context, switching refreshes views, and Back restores origin', async ({ page }) => {
  const first = `Management first ${Date.now()}`
  const second = `Management second ${Date.now()}`
  await createProject(page, first)
  await projects(page)
  await createProject(page, second)
  await projects(page)
  await page.getByRole('button', { name: `Open project ${first}` }).click()
  await expect(page.getByTestId('project-home')).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Project navigation' })
  await rail.getByRole('button', { name: 'History' }).click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(
    await page.evaluate(async name => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      return (await projectRepository.listProjects()).find((item: { projectName: string }) => item.projectName === name)?.projectId
    }, first),
  )
  const note = `Checkpoint for ${first}`
  await page.getByLabel('Checkpoint note').fill(note)
  await page.getByRole('button', { name: 'Create checkpoint' }).click()
  await expect(page.getByText(note, { exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search notes, actors, or IDs' }).fill('no matching checkpoint')
  await expect(page.getByText('No checkpoints match these filters.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search notes, actors, or IDs' }).fill('')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await expect(page.getByTestId('project-history')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search notes, actors, or IDs' })).toHaveValue('')
  await expect(page.getByText(note, { exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: first })
  await expect(page.getByText(note, { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await expect(page.getByRole('combobox', { name: 'Project' })).toBeEnabled()
  await expect(page.locator('header').getByText(second, { exact: true })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Publish' })).toBeVisible()
  const selected = await page.getByRole('combobox', { name: 'Project' }).inputValue()
  await rail.getByRole('button', { name: 'Project Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Project Settings', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Project Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(selected)
  await page.getByRole('button', { name: 'Return to project' }).click()
  await expect(page.getByTestId('project-history')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(selected)
  await page.reload()
  await expect(page.getByTestId('project-history')).toBeVisible()
  await page.getByRole('button', { name: 'Return to project' }).click()
  await expect(page.getByTestId('project-home')).toBeVisible()
  await expect(page.locator('header').getByText(first, { exact: true })).toBeVisible()

  await rail.getByRole('button', { name: 'Project Settings' }).click()
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(
    await page.evaluate(async name => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      return (await projectRepository.listProjects()).find((item: { projectName: string }) => item.projectName === name)?.projectId
    }, first),
  )
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await expect(page.locator('input[placeholder^="e.g. Nexus Platform"]')).toHaveValue(second)
  await page.getByRole('button', { name: 'Return to project' }).click()
  await expect(page.getByTestId('project-home')).toBeVisible()
  await expect(page.locator('header').getByText(first, { exact: true })).toBeVisible()

  await rail.getByRole('button', { name: 'Diagnostics' }).click()
  await expect(page.getByRole('combobox', { name: 'Project' })).not.toHaveValue('all')
  await page.getByRole('combobox', { name: 'Diagnostic component' }).selectOption('Review')
  await page.getByRole('combobox', { name: 'Diagnostic status' }).selectOption('warn')
  await page.getByRole('searchbox', { name: 'Search diagnostics' }).fill('review')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await expect(page.getByRole('combobox', { name: 'Diagnostic component' })).toHaveValue('all')
  await expect(page.getByRole('combobox', { name: 'Diagnostic status' })).toHaveValue('all')
  await expect(page.getByRole('searchbox', { name: 'Search diagnostics' })).toHaveValue('')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('header').getByText(first, { exact: true })).toBeVisible()
  await rail.getByRole('button', { name: 'Administration' }).click()
  await expect(page.getByText('Current project', { exact: true })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Publish' })).toBeVisible()
})

test('workflow exits return to the originating project while Brand Continue opens the selected project', async ({ page }) => {
  const first = `Management exit first ${Date.now()}`
  const second = `Management exit second ${Date.now()}`
  await createProject(page, first)
  await projects(page)
  await createProject(page, second)
  await projects(page)
  await page.getByRole('button', { name: `Open project ${first}` }).click()
  const rail = page.getByRole('navigation', { name: 'Project navigation' })
  await rail.getByRole('button', { name: 'History' }).click()
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await rail.getByRole('button', { name: 'Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
  await expect(page.locator('header').getByText(first, { exact: true })).toBeVisible()

  await rail.getByRole('button', { name: 'Brand & Output' }).click()
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: second })
  await expect(page.getByRole('combobox', { name: 'Project' })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
  await expect(page.locator('header').getByText(second, { exact: true })).toBeVisible()
  await expect(page.getByTestId('management-project-picker')).toHaveCount(0)
})