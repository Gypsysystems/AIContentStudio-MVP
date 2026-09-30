import { expect, test, type Page } from '@playwright/test'

async function showSignedInProjects(page: Page, projects: Record<string, unknown>[]) {
  const session = {
    authenticated: true, mode: 'supabase', userId: 'projects-cta-user',
    activeWorkspaceId: 'projects-cta-workspace', activeRole: 'owner',
    activeOrganizationName: 'Workspace', activeWorkspaceName: 'Editorial',
  }
  await page.route('**/api/auth/session', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/logout', route => route.fulfill({ json: { authenticated: false, mode: 'supabase' } }))
  await page.route('**/api/cloud-projects', route => {
    const input = route.request().postDataJSON() as { action: string }
    if (input.action === 'ready') return route.fulfill({ json: { ready: true } })
    if (input.action === 'list') return route.fulfill({ json: { projects } })
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('signed-in empty Projects keeps a compact ordered action row and header controls', async ({ page }) => {
  await showSignedInProjects(page, [])
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()
  await expect(page.getByTestId('projects-page-actions').getByRole('button')).toHaveText([
    'Import Project', 'Restore backup', 'New Project',
  ])
  await expect(page.locator('header').getByRole('button')).toHaveText([
    '', 'Create project', 'Administration', 'Sign out',
  ])
  await expect(page.locator('header .studio-header-logo')).toBeVisible()
  await expect(page.locator('header')).not.toContainText('Workspace')
  await expect(page.locator('header')).not.toContainText('Editorial')
  await expect(page.getByText('Local browser projects', { exact: true })).toHaveCount(0)
  await expect(page.getByText('WORKSPACE', { exact: true })).toHaveCount(0)
  await page.locator('header').getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible()
})

test('signed-in Projects with a saved project retains the page New Project action', async ({ page }) => {
  await showSignedInProjects(page, [{
    projectId: 'saved-cta-project', projectName: 'Existing project',
    ownerUserId: 'projects-cta-user', workspaceId: 'projects-cta-workspace',
    documentType: 'document', version: '1.0', createdAt: Date.now(), modifiedAt: Date.now(),
    recordRevision: 1,
  }])
  await expect(page.getByText('Existing project', { exact: true })).toBeVisible()
  await expect(page.getByText('No projects yet', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('projects-page-actions').getByRole('button')).toHaveText([
    'Import Project', 'Restore backup', 'New Project',
  ])
  await page.getByTestId('projects-page-actions').getByRole('button', { name: 'New Project' }).click()
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible()
})

test('Import Project opens the opt-in local copy flow, and Restore backup keeps its file chooser', async ({ page }) => {
  await showSignedInProjects(page, [])
  await page.evaluate(async () => {
    const { indexedDbProjectRepository } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    await indexedDbProjectRepository.createProject({
      projectId: `import-ui-${crypto.randomUUID()}`, projectName: 'Browser original',
    }, LOCAL_ACCESS_CONTEXT)
  })
  await page.getByRole('button', { name: 'Import Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import local project' })
  await expect(dialog.getByText('Browser original')).toBeVisible()
  await expect(dialog).toContainText('Originals are never deleted or moved automatically.')
  await dialog.getByRole('button', { name: 'Import copy' }).click()
  await expect(dialog.getByRole('heading', { name: 'Import project copy' })).toBeVisible()
  await expect(dialog.getByLabel('Name for imported copy')).toHaveValue('Browser original Copy')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByText('Browser original')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Restore backup' }).click()
  expect((await chooser).isMultiple()).toBe(false)
})

test('Administration and Sign out remain available on the far right of the Projects header', async ({ page }) => {
  await showSignedInProjects(page, [])
  const header = page.locator('header')
  await header.getByRole('button', { name: 'Administration' }).click()
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await header.getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await header.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out.')).toBeVisible()
})

test('Projects header and action row fit a narrow viewport without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await showSignedInProjects(page, [])
  for (const label of ['Create project', 'Administration', 'Sign out']) {
    const box = await page.locator('header').getByRole('button', { name: label }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(376)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)
})