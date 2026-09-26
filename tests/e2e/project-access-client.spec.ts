import { expect, test } from '@playwright/test'

test('app-facing project operations use server metadata while content remains local', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { authorizedProjectRepository: repo, createAuthorizedProjectBackup, restoreAuthorizedProjectBackup } =
      await import('/src/authorizedProjectService.ts' as string)
    const id = `api-client-${crypto.randomUUID()}`
    const created = await repo.createProject({ projectId: id, projectName: 'API-backed local project' })
    const file = await repo.saveFile(id, new File(['local bytes'], 'local.txt'))
    const saved = await repo.saveProjectIfCurrent({
      ...created, sourceFileIds: [file.fileId], projectName: 'Saved through the gate',
    }, created.recordRevision)
    const listed = await repo.listProjects()
    const loaded = await repo.loadProject(id)
    const backup = await createAuthorizedProjectBackup(id)
    const duplicate = await repo.duplicateProject(id, 'Duplicated through the gate')
    const restored = await restoreAuthorizedProjectBackup(backup, { mode: 'new' })
    const metadata = await (await fetch('/api/project-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    })).json()
    const files = await repo.loadProjectFiles(id)
    await repo.deleteProject(id)
    const afterDelete = await repo.listProjects()
    return {
      id, created, saved, loaded, listedIds: listed.map((p: { projectId: string }) => p.projectId),
      duplicate, restored, backupSize: backup.size,
      fileText: await files[0].blob.text(),
      metadata, afterDeleteIds: afterDelete.map((p: { projectId: string }) => p.projectId),
    }
  })
  expect(result.created).toMatchObject({ ownerUserId: 'local-user', workspaceId: 'local-workspace' })
  expect(result.saved).toMatchObject({ projectName: 'Saved through the gate', recordRevision: 1 })
  expect(result.loaded).toMatchObject({ projectName: 'Saved through the gate' })
  expect(result.listedIds).toContain(result.id)
  expect(result.fileText).toBe('local bytes')
  expect(result.backupSize).toBeGreaterThan(0)
  expect(result.duplicate).toMatchObject({ ownerUserId: 'local-user', workspaceId: 'local-workspace' })
  expect(result.duplicate.projectId).not.toBe(result.id)
  expect(result.restored).toMatchObject({ ownerUserId: 'local-user', workspaceId: 'local-workspace' })
  expect(result.restored.projectId).not.toBe(result.id)
  expect(result.metadata.projectIds).toContain(result.duplicate.projectId)
  expect(result.metadata.projectIds).toContain(result.restored.projectId)
  expect(JSON.stringify(result.metadata)).not.toContain('local bytes')
  expect(result.afterDeleteIds).not.toContain(result.id)
})

test('the app adapter rejects browser identity claims and fails closed without the API', async ({ page }) => {
  await page.goto('/')
  const seed = await page.evaluate(async () => {
    const { authorizedProjectRepository: repo } =
      await import('/src/authorizedProjectService.ts' as string)
    return repo.createProject({
      projectId: `api-denial-${crypto.randomUUID()}`, projectName: 'Original name',
    })
  })
  const claim = await page.evaluate(async id => {
    const { authorizedProjectRepository: repo } =
      await import('/src/authorizedProjectService.ts' as string)
    try {
      await repo.loadProject(id, {
        user: { id: 'local-user' }, workspace: { id: 'other-workspace' },
        membership: { userId: 'local-user', workspaceId: 'other-workspace', role: 'owner' },
      })
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  }, seed.projectId)
  expect(claim).toContain('does not accept browser identity or role claims')

  await page.route('**/api/project-access', route => route.abort())
  const offline = await page.evaluate(async record => {
    const { authorizedProjectRepository: repo } =
      await import('/src/authorizedProjectService.ts' as string)
    try {
      await repo.saveProjectIfCurrent({
        ...record, projectName: 'Must not persist',
      }, record.recordRevision)
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  }, seed)
  expect(offline).toContain('unavailable')
  await page.unroute('**/api/project-access')
  const after = await page.evaluate(async id => {
    const { authorizedProjectRepository: repo } =
      await import('/src/authorizedProjectService.ts' as string)
    return repo.loadProject(id)
  }, seed.projectId)
  expect(after).toMatchObject({ projectName: 'Original name', recordRevision: 0 })
})

test('existing local projects are enrolled in development only, without changing ownership', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  const result = await page.evaluate(async () => {
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { authorizedProjectRepository: repo } = await import('/src/authorizedProjectService.ts' as string)
    const id = `legacy-local-${crypto.randomUUID()}`
    await local.createProject({ projectId: id, projectName: 'Existing local record' })
    const loaded = await repo.loadProject(id)
    const listed = await repo.listProjects()
    const serverRead = await fetch('/api/project-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', projectId: id }),
    })
    return { id, loaded, listedIds: listed.map((p: { projectId: string }) => p.projectId),
      serverRead: serverRead.status }
  })
  expect(result.loaded).toMatchObject({
    projectName: 'Existing local record', ownerUserId: 'local-user', workspaceId: 'local-workspace',
  })
  expect(result.listedIds).toContain(result.id)
  expect(result.serverRead).toBe(200)
})

test('creating a project cannot advance past a denied or unavailable server gate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/i }).first().click()
  await page.getByPlaceholder(/Nexus Platform/).fill('Server-required project')
  await page.route('**/api/project-access', route => route.abort())
  await page.getByRole('button', { name: /Continue — Theme & Styles/i }).click()
  await expect(page.getByRole('alert')).toContainText('Could not create project')
  await expect(page.getByText('Step 1 — Project Details')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('docflow-active-project'))).toBeNull()
  await page.unroute('**/api/project-access')
  await page.getByRole('button', { name: /Continue — Theme & Styles/i }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('docflow-active-project'))).toBeTruthy()
})