import { expect, test } from '@playwright/test'
import { getAdministrationAccess } from '../../src/administrationAccess'
import { LOCAL_ACCESS_CONTEXT, type MembershipRole, type ProjectAccessContext } from '../../src/ownership'

function context(role: MembershipRole): ProjectAccessContext {
  return { ...LOCAL_ACCESS_CONTEXT, membership: { ...LOCAL_ACCESS_CONTEXT.membership, role } }
}

test('existing membership policy drives administration access; ownership is never a role override', () => {
  const ownership = { ownerUserId: LOCAL_ACCESS_CONTEXT.user.id, workspaceId: LOCAL_ACCESS_CONTEXT.workspace.id }
  const owner = getAdministrationAccess(context('owner'), ownership)
  const admin = getAdministrationAccess(context('admin'), ownership)
  const editor = getAdministrationAccess(context('editor'), ownership)
  const viewer = getAdministrationAccess(context('viewer'), ownership)
  expect(owner.role).toBe('owner')
  expect(Object.values(owner.workspace).every(Boolean)).toBe(true)
  expect(Object.values(admin.workspace).every(Boolean)).toBe(true)
  expect(editor.workspace).toMatchObject({ create: true, read: true, write: true, delete: false, replace: false })
  expect(viewer.workspace).toMatchObject({ create: false, read: true, write: false, backup: true })
  expect(viewer.project).toEqual({ read: true, write: false })
  expect(getAdministrationAccess(context('owner'), { ...ownership, workspaceId: 'foreign' }).project)
    .toEqual({ read: false, write: false })
  expect(getAdministrationAccess({
    ...context('admin'), membership: { ...context('admin').membership, userId: 'not-the-current-user' },
  }, ownership)).toMatchObject({ role: null, project: { read: false, write: false } })
})

test('administration is separate from workflow and saved project settings return without invented workspace writes', async ({ page }) => {
  await page.goto('/')
  const id = `admin-local-${crypto.randomUUID()}`
  await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    await repo.createProject({ projectId, projectName: 'Administration fixture' })
    repo.setActiveProjectId(projectId)
  }, id)
  await page.reload()
  await page.getByTestId('topbar-administration').click()
  const workspace = page.getByTestId('administration-workspace')
  await expect(workspace.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Content workflow' })).toHaveCount(0)
  await expect(workspace).toContainText('Local development')
  await expect(workspace).toContainText('Owner')
  await expect(workspace).toContainText('Current effective access')
  await expect(workspace).toContainText('Settings are unavailable')
  await expect(workspace).toContainText('Role assignments are read-only')
  await expect(workspace).toContainText('Administration fixture')
  await expect(workspace.getByRole('textbox')).toHaveCount(0)
  await expect(workspace.getByRole('button', { name: /save workspace|save role/i })).toHaveCount(0)

  await workspace.getByRole('button', { name: 'Open project settings' }).click()
  await expect(page.getByText('Update this project’s name and document details.')).toBeVisible()
  await page.locator('input[placeholder="e.g. 3.2"]').fill('2.4')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('administration-workspace')).toContainText('2.4')
  const persisted = await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    return (await repo.loadProject(projectId))?.version
  }, id)
  expect(persisted).toBe('2.4')
  await workspace.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByTestId('administration-workspace')).toHaveCount(0)
})

test('viewer and cross-workspace project controls stay unavailable in the administration UI', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('viewer', 'workspace', 'admin-role-fixture')
  })
  const root = page.locator('#admin-role-fixture')
  await expect(root).toContainText('Viewer')
  await expect(root).toContainText('Cloud access is reauthorized by the server')
  await expect(root).toContainText('Verified org')
  await expect(root).toContainText('Protected project')
  await expect(root.getByRole('button', { name: 'Project settings are read-only' })).toBeDisabled()
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('owner', 'foreign', 'admin-foreign-fixture')
  })
  const foreign = page.locator('#admin-foreign-fixture')
  await expect(foreign).toContainText('Project details are restricted')
  await expect(foreign).not.toContainText('Foreign private title')
  await expect(foreign).not.toContainText('Secret')
  await expect(foreign.getByRole('button', { name: 'Project settings unavailable' })).toBeDisabled()
})

test('administration entry and settings remain usable at narrow viewport widths', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByTestId('topbar-administration').click()
  const workspace = page.getByTestId('administration-workspace')
  await expect(workspace.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await expect(workspace).toContainText('No project selected')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await workspace.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByTestId('administration-workspace')).toHaveCount(0)
})

test('dashboard New project starts a new project even when an older project remains active', async ({ page }) => {
  await page.goto('/')
  const id = `admin-new-project-${crypto.randomUUID()}`
  await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    await repo.createProject({ projectId, projectName: 'Older active project' })
    repo.setActiveProjectId(projectId)
  }, id)
  await page.reload()
  await page.getByTestId('topbar-administration').click()
  await page.getByTestId('administration-workspace').getByRole('button', { name: 'Back to workspace' }).click()
  await page.getByRole('button', { name: 'Content Studio home' }).click()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByText('Step 1 — Project Details')).toBeVisible()
  await expect(page.getByText('Update this project’s name and document details.')).toHaveCount(0)
  expect(await page.evaluate(async () => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    return repo.getActiveProjectId()
  })).toBeNull()
})

test('lost access or a failed save offers explicit discard consent rather than trapping the user', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('owner', 'foreign', 'admin-revoked-fixture', 'error')
  })
  const root = page.locator('#admin-revoked-fixture')
  await expect(root).not.toContainText('Foreign private title')
  await expect(root).toContainText('Already saved changes are not undone')
  await root.getByRole('button', { name: 'Discard unsaved edits and leave project' }).click()
  await expect(root.getByRole('alertdialog')).toContainText('Edits not saved to this project will be lost')
  await root.getByRole('button', { name: 'Keep working' }).click()
  await expect(root.getByRole('alertdialog')).toHaveCount(0)
  expect(await page.evaluate(() => Boolean((window as unknown as { adminDiscardConfirmed?: boolean }).adminDiscardConfirmed))).toBe(false)
  await root.getByRole('button', { name: 'Discard unsaved edits and leave project' }).click()
  await root.getByRole('button', { name: 'Discard and leave' }).click()
  expect(await page.evaluate(() => Boolean((window as unknown as { adminDiscardConfirmed?: boolean }).adminDiscardConfirmed))).toBe(true)
})