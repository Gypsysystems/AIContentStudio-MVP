import { expect, test, type Page } from '@playwright/test'

async function showSignedInProjects(page: Page, projects: Record<string, unknown>[]) {
  const session = {
    authenticated: true, mode: 'supabase', userId: 'projects-cta-user',
    activeWorkspaceId: 'projects-cta-workspace', activeRole: 'owner',
    activeOrganizationName: 'Workspace', activeWorkspaceName: 'Editorial',
  }
  await page.route('**/api/auth/session', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: session }))
  await page.route('**/api/cloud-projects', route => {
    const input = route.request().postDataJSON() as { action: string }
    if (input.action === 'ready') return route.fulfill({ json: { ready: true } })
    if (input.action === 'list') return route.fulfill({ json: { projects } })
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('signed-in empty Projects shows only its empty-state creation action', async ({ page }) => {
  await showSignedInProjects(page, [])
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByRole('button', { name: /New project/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /New Project/i })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible()
  await expect(page.getByText('Local browser projects', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '+ New Project' }).click()
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible()
  await expect(page.locator('header').getByRole('button', { name: /New project/i })).toHaveCount(0)
})

test('signed-in Projects with a saved project shows only its page-header creation action', async ({ page }) => {
  await showSignedInProjects(page, [{
    projectId: 'saved-cta-project', projectName: 'Existing project',
    ownerUserId: 'projects-cta-user', workspaceId: 'projects-cta-workspace',
    documentType: 'document', version: '1.0', createdAt: Date.now(), modifiedAt: Date.now(),
    recordRevision: 1,
  }])
  await expect(page.getByText('Existing project', { exact: true })).toBeVisible()
  await expect(page.getByText('No projects yet', { exact: true })).toHaveCount(0)
  await expect(page.locator('header').getByRole('button', { name: /New project/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /New Project/i })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible()
  await expect(page.getByText('Local browser projects', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New Project', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible()
})