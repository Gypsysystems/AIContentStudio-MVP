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
  await expect(workspace.getByTestId('my-settings')).toContainText('Display name is read-only in local development')
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

test('cloud My Settings loads, cancels by keyboard, and confirms only the signed-in display-name write', async ({ page }) => {
  const requests: unknown[] = []
  let profile = { displayName: 'Alice', updatedAt: '2026-09-26T12:00:00+00:00' }
  let finishSave!: () => void
  const saveGate = new Promise<void>(resolve => { finishSave = resolve })
  await page.route('**/api/auth/profile', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    if (body.action === 'update') {
      await saveGate
      profile = { displayName: 'Alice Cooper', updatedAt: '2026-09-26T12:05:00+00:00' }
    }
    await route.fulfill({ json: profile })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('viewer', 'workspace', 'my-settings-cloud')
  })
  const settings = page.locator('#my-settings-cloud').getByTestId('my-settings')
  await expect(settings).toContainText('Alice')
  await settings.getByRole('button', { name: 'Edit display name' }).click()
  const input = settings.getByRole('textbox', { name: 'Display name' })
  await input.fill('Unsaved')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(settings).toContainText('Alice')
  await settings.getByRole('button', { name: 'Edit display name' }).click()
  await settings.getByRole('textbox', { name: 'Display name' }).fill(' Alice Cooper ')
  await settings.getByRole('textbox', { name: 'Display name' }).press('Enter')
  await expect(settings.getByRole('status')).toContainText('Saving your display name')
  await expect(settings.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  finishSave()
  await expect(settings.getByRole('status')).toContainText('Display name saved')
  await expect(settings).toContainText('Alice Cooper')
  expect(requests).toEqual([
    { action: 'read' },
    { action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: '2026-09-26T12:00:00+00:00' },
  ])
})

test('cloud My Settings handles load errors, invalid drafts and denied saves without false success', async ({ page }) => {
  let failRead = true
  await page.route('**/api/auth/profile', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'read' && failRead) {
      failRead = false
      await route.fulfill({ status: 503, json: { error: 'Profile unavailable' } })
    } else if (body.action === 'update') {
      await route.fulfill({ status: 403, json: { error: 'Profile access is not authorized' } })
    } else {
      await route.fulfill({ json: { displayName: 'Alice', updatedAt: '2026-09-26T12:00:00+00:00' } })
    }
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('owner', 'workspace', 'my-settings-error')
  })
  const settings = page.locator('#my-settings-error').getByTestId('my-settings')
  await expect(settings.getByRole('alert')).toContainText('Profile unavailable')
  await settings.getByRole('button', { name: 'Retry loading' }).click()
  await expect(settings).toContainText('Alice')
  await settings.getByRole('button', { name: 'Edit display name' }).click()
  await settings.getByRole('textbox', { name: 'Display name' }).fill('   ')
  await expect(settings.getByRole('button', { name: 'Save display name' })).toBeDisabled()
  await settings.getByRole('textbox', { name: 'Display name' }).fill('Denied update')
  await settings.getByRole('button', { name: 'Save display name' }).click()
  await expect(settings.getByRole('alert')).toContainText('Profile access is not authorized')
  await expect(settings).not.toContainText('Display name saved')
  await settings.getByRole('button', { name: 'Cancel' }).click()
  await expect(settings).toContainText('Alice')
  await expect(settings).not.toContainText('Denied update')
})

test('profile conflict recovers by explicitly discarding the stale draft and loading the latest value', async ({ page }) => {
  let readCount = 0
  await page.route('**/api/auth/profile', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'update') {
      await route.fulfill({ status: 409, json: { code: 'PROFILE_CONFLICT', error: 'Profile changed since it was loaded.' } })
    } else {
      readCount++
      await route.fulfill({ json: { displayName: readCount === 1 ? 'Original' : 'Latest name',
        updatedAt: readCount === 1 ? '2026-09-26T12:00:00+00:00' : '2026-09-26T12:05:00+00:00' } })
    }
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountAdministration } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountAdministration('viewer', 'workspace', 'my-settings-conflict')
  })
  const settings = page.locator('#my-settings-conflict').getByTestId('my-settings')
  await expect(settings).toContainText('Original')
  await settings.getByRole('button', { name: 'Edit display name' }).click()
  await settings.getByRole('textbox', { name: 'Display name' }).fill('Stale edit')
  await settings.getByRole('button', { name: 'Save display name' }).click()
  await expect(settings.getByRole('alert')).toContainText('Profile changed')
  await settings.getByRole('button', { name: 'Reload latest profile' }).click()
  await settings.getByRole('button', { name: 'Keep editing' }).click()
  await expect(settings.getByRole('textbox', { name: 'Display name' })).toHaveValue('Stale edit')
  await settings.getByRole('button', { name: 'Reload latest profile' }).click()
  await settings.getByRole('button', { name: 'Discard draft and reload' }).click()
  await expect(settings).toContainText('Latest name')
  await expect(settings).not.toContainText('Stale edit')
  expect(readCount).toBe(2)
})

test('delayed save response from another identity never replaces the current profile', async ({ page }) => {
  let completeOldSave!: () => void
  const oldSave = new Promise<void>(resolve => { completeOldSave = resolve })
  let reads = 0
  await page.route('**/api/auth/profile', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'update') {
      await oldSave
      await route.fulfill({ json: { displayName: 'Old account update', updatedAt: '2026-09-26T12:05:00+00:00' } })
    } else {
      reads++
      await route.fulfill({ json: { displayName: reads === 1 ? 'Alice profile' : 'Bob profile',
        updatedAt: '2026-09-26T12:00:00+00:00' } })
    }
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountSwitchableMySettings } = await import('/tests/fixtures/administrationHarness.tsx' as string)
    mountSwitchableMySettings('switchable-settings')
  })
  const settings = page.locator('#switchable-settings')
  await settings.getByRole('button', { name: 'Edit display name' }).click()
  await settings.getByRole('textbox', { name: 'Display name' }).fill('Old account update')
  await settings.getByRole('button', { name: 'Save display name' }).click()
  await expect(settings.getByRole('status')).toContainText('Saving')
  await page.evaluate(() => (window as unknown as { switchSettingsUser: (id: string) => void }).switchSettingsUser('bob'))
  await expect(settings).toContainText('Bob profile')
  completeOldSave()
  await expect(settings).not.toContainText('Old account update')
  await expect(settings).not.toContainText('Display name saved')
  expect(reads).toBe(2)
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