import { expect, test } from '@playwright/test'

test('cloud repository persists records and binary files without touching IndexedDB', async ({ page }) => {
  await page.goto('/')
  const files = new Map<string, { projectId: string; name: string; type: string; size: number; uploadedAt: number; bytes: Buffer }>()
  const records = new Map<string, Record<string, unknown>>()

  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    const action = input.action
    if (action === 'ready') return route.fulfill({ json: { ready: true } })
    if (action === 'create') {
      const record = input.record as Record<string, unknown>
      const saved = { ...record, projectId: input.projectId, ownerUserId: 'verified-user',
        workspaceId: 'verified-workspace', recordRevision: 0 }
      records.set(String(input.projectId), saved)
      return route.fulfill({ json: { record: saved } })
    }
    if (action === 'save') {
      const current = records.get(String(input.projectId))
      if (!current || current.recordRevision !== input.expectedRevision)
        return route.fulfill({ status: 409, json: { code: 'PROJECT_CONFLICT', error: 'Project changed.' } })
      const saved = { ...(input.record as Record<string, unknown>), projectId: input.projectId,
        ownerUserId: 'verified-user', workspaceId: 'verified-workspace',
        recordRevision: Number(input.expectedRevision) + 1 }
      records.set(String(input.projectId), saved)
      return route.fulfill({ json: { record: saved } })
    }
    if (action === 'read' || action === 'backup') {
      const record = records.get(String(input.projectId))
      return record
        ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' } })
    }
    if (action === 'load-files') {
      const found = [...files.entries()].filter(([, file]) => file.projectId === input.projectId)
        .map(([fileId, file]) => ({ fileId, projectId: file.projectId, name: file.name,
          type: file.type, size: file.size, uploadedAt: file.uploadedAt }))
      return route.fulfill({ json: { files: found } })
    }
    if (action === 'list')
      return route.fulfill({ json: { projects: [...records.values()] } })
    return route.fulfill({ status: 400, json: { code: 'INVALID_ACTION', error: String(action) } })
  })

  await page.route('**/api/cloud-files?fileId=*', async route => {
    const url = new URL(route.request().url())
    const fileId = url.searchParams.get('fileId')!
    if (route.request().method() === 'POST') {
      const bytes = route.request().postDataBuffer() ?? Buffer.alloc(0)
      const projectId = route.request().headers()['x-project-id']
      const name = decodeURIComponent(route.request().headers()['x-file-name'])
      const type = route.request().headers()['content-type']
      const uploadedAt = Date.now()
      files.set(fileId, { projectId, name, type, size: bytes.length, uploadedAt, bytes })
      return route.fulfill({ status: 201, json: { file: { fileId, projectId, name, type, size: bytes.length, uploadedAt } } })
    }
    const file = files.get(fileId)
    return file
      ? route.fulfill({ status: 200, contentType: file.type, body: file.bytes })
      : route.fulfill({ status: 404, json: { code: 'FILE_NOT_FOUND', error: 'Not found.' } })
  })

  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    setCloudAuthSession({
      user: { id: 'verified-user' },
      workspace: { id: 'verified-workspace', name: 'Verified workspace' },
      membership: { userId: 'verified-user', workspaceId: 'verified-workspace', role: 'owner' },
    })
    const id = `cloud-client-${crypto.randomUUID()}`
    const created = await repo.createProject({ projectId: id, projectName: 'Cloud record' })
    const stored = await repo.saveFile(id, new File(['cloud bytes'], 'my source.txt', { type: 'text/plain' }))
    const saved = await repo.saveProjectIfCurrent({ ...created, sourceFileIds: [stored.fileId] }, created.recordRevision)
    const snapshot = await repo.loadProjectSnapshot(id)
    const stillLocal = await local.loadProject(id, LOCAL_ACCESS_CONTEXT)
    return {
      id, savedRevision: saved.recordRevision, projectName: snapshot?.record.projectName,
      fileName: snapshot?.files[0]?.name, fileContents: await snapshot?.files[0]?.blob.text(),
      stillLocal: !!stillLocal,
    }
  })
  expect(result).toMatchObject({
    savedRevision: 1, projectName: 'Cloud record', fileName: 'my source.txt',
    fileContents: 'cloud bytes', stillLocal: false,
  })
  await page.reload()
  const reloaded = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'verified-user' },
      workspace: { id: 'verified-workspace', name: 'Verified workspace' },
      membership: { userId: 'verified-user', workspaceId: 'verified-workspace', role: 'owner' },
    })
    return (await repo.listProjects()).map((project: { projectId: string }) => project.projectId)
  })
  expect(reloaded).toContain(result.id)
})

test('explicit local import stages and verifies every blob without deleting the original', async ({ page }) => {
  await page.goto('/')
  const records = new Map<string, Record<string, unknown>>()
  const files = new Map<string, { projectId: string; name: string; type: string; size: number; uploadedAt: number; bytes: Buffer }>()
  let corruptDownloads = false
  const staged = new Map<string, { projectId: string; record: Record<string, unknown>; fileIds: string[] }>()
  let stageSequence = 0
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'restore-new') {
      const stageId = `stage-local-copy-${++stageSequence}`
      staged.set(stageId, { projectId: String(input.projectId),
        record: input.record as Record<string, unknown>, fileIds: input.fileIds as string[] })
      return route.fulfill({ json: { ready: false, stageId,
        projectId: input.projectId, expectedFileIds: input.fileIds } })
    }
    if (input.action === 'finalize-restore') {
      const stage = staged.get(String(input.stageId))
      if (!stage || JSON.stringify([...stage.fileIds].sort()) !== JSON.stringify([...(input.fileIds as string[])].sort()))
        return route.fulfill({ status: 409, json: { code: 'FILE_SET_CONFLICT', error: 'Wrong staged file set.' } })
      const saved = { ...stage.record, ownerUserId: 'cloud-user', workspaceId: 'cloud-workspace', recordRevision: 0 }
      records.set(stage.projectId, saved)
      staged.delete(String(input.stageId))
      return route.fulfill({ json: { ready: true, record: saved } })
    }
    if (input.action === 'abandon-restore') {
      const existed = staged.delete(String(input.stageId))
      return route.fulfill({ json: { abandoned: existed } })
    }
    if (input.action === 'read' || input.action === 'backup') {
      const record = records.get(String(input.projectId))
      return record ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' } })
    }
    if (input.action === 'load-files') {
      const found = [...files.entries()].filter(([, file]) => file.projectId === input.projectId)
        .map(([fileId, file]) => ({ fileId, projectId: file.projectId, name: file.name,
          type: file.type, size: file.size, uploadedAt: file.uploadedAt }))
      return route.fulfill({ json: { files: found } })
    }
    return route.fulfill({ json: { projects: [...records.values()] } })
  })
  await page.route('**/api/cloud-files?fileId=*', async route => {
    const url = new URL(route.request().url())
    const fileId = url.searchParams.get('fileId')!
    if (route.request().method() === 'POST') {
      const bytes = route.request().postDataBuffer() ?? Buffer.alloc(0)
      const projectId = route.request().headers()['x-project-id']
      const name = decodeURIComponent(route.request().headers()['x-file-name'])
      const type = route.request().headers()['content-type']
      const uploadedAt = Date.now()
      files.set(fileId, { projectId, name, type, size: bytes.length, uploadedAt, bytes })
      return route.fulfill({ status: 201, json: { file: { fileId, projectId, name, type, size: bytes.length, uploadedAt } } })
    }
    const file = files.get(fileId)
    if (!file) return route.fulfill({ status: 404, json: { code: 'FILE_NOT_FOUND', error: 'Not found.' } })
    if (corruptDownloads) {
      const corrupt = Buffer.from(file.bytes)
      if (corrupt.length) corrupt[0] ^= 1
      return route.fulfill({ status: 200, contentType: file.type, body: corrupt })
    }
    return route.fulfill({ status: 200, contentType: file.type, body: file.bytes })
  })

  const imported = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    const { importLocalProjectToCloud } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'cloud-user' }, workspace: { id: 'cloud-workspace' },
      membership: { userId: 'cloud-user', workspaceId: 'cloud-workspace', role: 'owner' },
    })
    const localId = `local-import-${crypto.randomUUID()}`
    const created = await local.createProject({ projectId: localId, projectName: 'Local original' }, LOCAL_ACCESS_CONTEXT)
    const source = await local.saveFile(localId, new File(['kept original'], 'original.txt', { type: 'text/plain' }), LOCAL_ACCESS_CONTEXT)
    await local.saveProject({ ...created, sourceFileIds: [source.fileId] }, LOCAL_ACCESS_CONTEXT)
    const cloud = await importLocalProjectToCloud(localId)
    const original = await local.loadProjectSnapshot(localId, LOCAL_ACCESS_CONTEXT)
    return { localId, cloudId: cloud.projectId, originalStillExists: !!original,
      originalBytes: await original?.files[0]?.blob.text(), newSourceId: cloud.sourceFileIds[0] }
  })
  expect(imported.cloudId).not.toBe(imported.localId)
  expect(imported.newSourceId).not.toBeUndefined()
  expect(imported).toMatchObject({ originalStillExists: true, originalBytes: 'kept original' })

  corruptDownloads = true
  const corruption = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    const { importLocalProjectToCloud } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'cloud-user' }, workspace: { id: 'cloud-workspace' },
      membership: { userId: 'cloud-user', workspaceId: 'cloud-workspace', role: 'owner' },
    })
    const localId = `local-digest-${crypto.randomUUID()}`
    await local.createProject({ projectId: localId, projectName: 'Digest check' }, LOCAL_ACCESS_CONTEXT)
    const file = await local.saveFile(localId, new File(['unchanged size'], 'digest.txt'), LOCAL_ACCESS_CONTEXT)
    const record = await local.loadProject(localId, LOCAL_ACCESS_CONTEXT)
    await local.saveProject({ ...record!, sourceFileIds: [file.fileId] }, LOCAL_ACCESS_CONTEXT)
    try {
      await importLocalProjectToCloud(localId)
      return { message: 'unexpected success' }
    } catch (error) {
      const retained = await local.loadProject(localId, LOCAL_ACCESS_CONTEXT)
      return { message: (error as Error).message, retained: !!retained }
    }
  })
  expect(corruption.message).toContain('does not match its source bytes')
  expect(corruption.retained).toBe(true)
})

test('failed staged upload abandons the stage, retains the local source, and surfaces cleanup errors', async ({ page }) => {
  await page.goto('/')
  let stageSequence = 0
  let failAbandon = false
  let deleteRequests = 0
  const activeStages = new Set<string>()
  const abandonedStages: string[] = []
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'list') return route.fulfill({ json: { projects: [] } })
    if (input.action === 'restore-new') {
      const stageId = `failing-stage-${++stageSequence}`
      activeStages.add(stageId)
      return route.fulfill({ json: {
        ready: false, stageId, projectId: input.projectId, expectedFileIds: input.fileIds,
      } })
    }
    if (input.action === 'abandon-restore') {
      const stageId = String(input.stageId)
      abandonedStages.push(stageId)
      if (failAbandon)
        return route.fulfill({ status: 503, json: { code: 'ABANDON_FAILED', error: 'Stage cleanup unavailable.' } })
      activeStages.delete(stageId)
      return route.fulfill({ json: { abandoned: true } })
    }
    if (input.action === 'delete') {
      deleteRequests++
      return route.fulfill({ json: { projects: [] } })
    }
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: String(input.action) } })
  })
  await page.route('**/api/cloud-files?fileId=*', route => route.fulfill({
    status: 500, json: { code: 'FILE_UPLOAD_FAILED', error: 'Injected upload failure.' },
  }))
  const firstFailure = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    const { importLocalProjectToCloud } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'abandon-user' }, workspace: { id: 'abandon-workspace' },
      membership: { userId: 'abandon-user', workspaceId: 'abandon-workspace', role: 'owner' },
    })
    const id = `abandon-source-${crypto.randomUUID()}`
    await local.createProject({ projectId: id, projectName: 'Preserve source' }, LOCAL_ACCESS_CONTEXT)
    await local.saveFile(id, new File(['source remains'], 'source.txt'), LOCAL_ACCESS_CONTEXT)
    try {
      await importLocalProjectToCloud(id, 'Preserve source Copy')
      return { error: 'Unexpected import success.', retained: false }
    } catch (error) {
      return {
        error: (error as Error).message,
        retained: !!(await local.loadProject(id, LOCAL_ACCESS_CONTEXT)),
      }
    }
  })
  expect(firstFailure.error).toContain('Injected upload failure.')
  expect(firstFailure.retained).toBe(true)
  expect(abandonedStages).toHaveLength(1)
  expect(activeStages.size).toBe(0)

  failAbandon = true
  const cleanupFailure = await page.evaluate(async () => {
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    const { importLocalProjectToCloud } = await import('/src/cloudProjectRepository.ts' as string)
    const id = `abandon-cleanup-source-${crypto.randomUUID()}`
    await local.createProject({ projectId: id, projectName: 'Retain after cleanup error' }, LOCAL_ACCESS_CONTEXT)
    await local.saveFile(id, new File(['still local'], 'local.txt'), LOCAL_ACCESS_CONTEXT)
    try {
      await importLocalProjectToCloud(id, 'Retain after cleanup error Copy')
      return { error: 'Unexpected import success.', retained: false }
    } catch (error) {
      return {
        error: (error as Error).message,
        retained: !!(await local.loadProject(id, LOCAL_ACCESS_CONTEXT)),
      }
    }
  })
  expect(cleanupFailure.error).toContain('Injected upload failure.')
  expect(cleanupFailure.error).toContain('Staged restore cleanup also failed')
  expect(cleanupFailure.error).toContain('Stage cleanup unavailable.')
  expect(cleanupFailure.retained).toBe(true)
  expect(abandonedStages).toHaveLength(2)
  expect(activeStages.size).toBe(1)
  expect(deleteRequests).toBe(0)
})

test('AuthGate keeps a verified cloud user pending until cloud storage readiness', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, json: {
      authenticated: true, mode: 'supabase', userId: 'user-ready',
      activeWorkspaceId: 'workspace-ready', activeOrganizationName: 'Acme',
      activeWorkspaceName: 'Editorial',
    },
  }))
  let ready = false
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as { action: string }
    if (input.action === 'ready') return route.fulfill({ json: { ready } })
    return route.fulfill({ json: { projects: [] } })
  })
  await page.goto('/')
  await expect(page.getByText(/Cloud project storage is not ready yet/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry readiness' })).toBeVisible()
  ready = true
  await page.getByRole('button', { name: 'Retry readiness' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
  const role = await page.evaluate(async () => {
    const { getAccessContext } = await import('/src/authSession.ts' as string)
    return getAccessContext().membership.role
  })
  expect(role).toBe('viewer')
  const deniedWrite = await page.evaluate(async () => {
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    try {
      await repo.createProject({ projectId: 'viewer-write', projectName: 'Should be denied' })
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  })
  expect(deniedWrite).toContain('cannot create')
})

test('cloud active project selection is isolated by verified workspace ID', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    const useWorkspace = (workspaceId: string) => setCloudAuthSession({
      user: { id: 'workspace-user' }, workspace: { id: workspaceId },
      membership: { userId: 'workspace-user', workspaceId, role: 'owner' },
    })
    useWorkspace('workspace-one')
    repo.setActiveProjectId('project-one')
    useWorkspace('workspace-two')
    const secondWorkspaceInitially = repo.getActiveProjectId()
    repo.setActiveProjectId('project-two')
    useWorkspace('workspace-one')
    return { secondWorkspaceInitially, firstWorkspaceAfterReturn: repo.getActiveProjectId() }
  })
  expect(result).toEqual({ secondWorkspaceInitially: null, firstWorkspaceAfterReturn: 'project-one' })
})

test('cloud replacement restore keeps backup file IDs and provenance unchanged', async ({ page }) => {
  await page.goto('/')
  const seeded = await page.evaluate(async () => {
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    const projectId = `replace-identity-${crypto.randomUUID()}`
    const initial = await local.createProject({ projectId, projectName: 'Existing' }, LOCAL_ACCESS_CONTEXT)
    const file = await local.saveFile(projectId, new File(['preserved bytes'], 'source.txt', { type: 'text/plain' }), LOCAL_ACCESS_CONTEXT)
    const record = await local.saveProject({
      ...initial,
      projectName: 'Backup record',
      sourceFileIds: [file.fileId],
      sourceExtractions: { [file.fileId]: { fileId: file.fileId, sourceId: file.fileId, marker: 'preserve-me' } },
    }, LOCAL_ACCESS_CONTEXT)
    return { projectId, record, file: { ...file, blob: undefined }, fileText: await file.blob.text() }
  })
  const expectedFileId = seeded.file.fileId
  let current = {
    ...seeded.record,
    ownerUserId: 'replace-user', workspaceId: 'replace-workspace', recordRevision: 4,
  } as Record<string, unknown>
  const replacementRequest: { value: Record<string, unknown> | null } = { value: null }
  const bytes = new Map([[expectedFileId, Buffer.from(seeded.fileText)]])
  let metadata = {
    fileId: expectedFileId, projectId: seeded.projectId, name: seeded.file.name,
    type: seeded.file.type, size: seeded.file.size, uploadedAt: seeded.file.uploadedAt,
  }

  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'backup' || input.action === 'read')
      return route.fulfill({ json: { record: current } })
    if (input.action === 'load-files')
      return route.fulfill({ json: { files: metadata.projectId === input.projectId ? [metadata] : [] } })
    if (input.action === 'restore-replace') {
      replacementRequest.value = input
      return route.fulfill({ json: { ready: false, stageId: 'replace-stage',
        projectId: input.projectId, expectedFileIds: input.fileIds } })
    }
    if (input.action === 'finalize-restore') {
      const stagedRecord = replacementRequest.value!.record as Record<string, unknown>
      current = { ...stagedRecord, ownerUserId: 'replace-user', workspaceId: 'replace-workspace', recordRevision: 5 }
      return route.fulfill({ json: { ready: true, record: current } })
    }
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: String(input.action) } })
  })
  await page.route('**/api/cloud-files?fileId=*', async route => {
    const id = new URL(route.request().url()).searchParams.get('fileId')!
    if (route.request().method() === 'POST') {
      const content = route.request().postDataBuffer() ?? Buffer.alloc(0)
      bytes.set(id, content)
      metadata = { fileId: id, projectId: seeded.projectId,
        name: decodeURIComponent(route.request().headers()['x-file-name']), type: 'text/plain',
        size: content.length, uploadedAt: Date.now() }
      return route.fulfill({ status: 201, json: { file: metadata } })
    }
    const content = bytes.get(id)
    return content ? route.fulfill({ status: 200, contentType: 'text/plain', body: content })
      : route.fulfill({ status: 404, json: { code: 'FILE_NOT_FOUND', error: 'Not found.' } })
  })

  const result = await page.evaluate(async ({ record, file, fileText, projectId }) => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'replace-user' }, workspace: { id: 'replace-workspace' },
      membership: { userId: 'replace-user', workspaceId: 'replace-workspace', role: 'owner' },
    })
    const remoteRecord = { ...record, ownerUserId: 'replace-user', workspaceId: 'replace-workspace' }
    const snapshot = { record: remoteRecord, files: [{ ...file, projectId,
      blob: new Blob([fileText], { type: file.type }) }] }
    const restored = await repo.restoreProjectSnapshot(snapshot, {
      mode: 'replace', expectedRevision: 4, expectedFileIds: [file.fileId],
    })
    return {
      projectId: restored.projectId, sourceFileIds: restored.sourceFileIds,
      sourceExtractions: restored.sourceExtractions,
    }
  }, { record: seeded.record, file: seeded.file, fileText: seeded.fileText, projectId: seeded.projectId })
  expect((replacementRequest.value?.fileIds as string[])).toEqual([expectedFileId])
  expect(result.projectId).toBe(seeded.projectId)
  expect(result.sourceFileIds).toEqual([expectedFileId])
  expect(result.sourceExtractions).toEqual({
    [expectedFileId]: { fileId: expectedFileId, sourceId: expectedFileId, marker: 'preserve-me' },
  })
})

test('cloud source-file lifecycle, duplication, and deletion use cloud storage only', async ({ page }) => {
  await page.goto('/')
  const projects = new Map<string, Record<string, unknown>>()
  const files = new Map<string, { projectId: string; name: string; type: string; size: number; uploadedAt: number; bytes: Buffer }>()
  const stages = new Map<string, { projectId: string; record: Record<string, unknown>; fileIds: string[] }>()
  let stageSequence = 0
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'create') {
      const record = { ...(input.record as Record<string, unknown>), projectId: input.projectId,
        ownerUserId: 'lifecycle-user', workspaceId: 'lifecycle-workspace', recordRevision: 0 }
      projects.set(String(input.projectId), record)
      return route.fulfill({ json: { record } })
    }
    if (input.action === 'save') {
      const current = projects.get(String(input.projectId))
      if (!current || current.recordRevision !== input.expectedRevision)
        return route.fulfill({ status: 409, json: { code: 'PROJECT_CONFLICT', error: 'Project changed.' } })
      const record = { ...(input.record as Record<string, unknown>), projectId: input.projectId,
        ownerUserId: 'lifecycle-user', workspaceId: 'lifecycle-workspace',
        recordRevision: Number(input.expectedRevision) + 1 }
      projects.set(String(input.projectId), record)
      return route.fulfill({ json: { record } })
    }
    if (input.action === 'read' || input.action === 'backup') {
      const record = projects.get(String(input.projectId))
      return record ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' } })
    }
    if (input.action === 'load-files') {
      const result = [...files.entries()].filter(([, file]) => file.projectId === input.projectId)
        .map(([fileId, file]) => ({ fileId, projectId: file.projectId, name: file.name,
          type: file.type, size: file.size, uploadedAt: file.uploadedAt }))
      return route.fulfill({ json: { files: result } })
    }
    if (input.action === 'load-file') {
      const item = files.get(String(input.fileId))
      return item
        ? route.fulfill({ json: { files: [{ fileId: input.fileId, projectId: item.projectId, name: item.name,
          type: item.type, size: item.size, uploadedAt: item.uploadedAt }] } })
        : route.fulfill({ status: 404, json: { code: 'FILE_NOT_FOUND', error: 'Not found.' } })
    }
    if (input.action === 'remove-file') {
      files.delete(String(input.fileId))
      return route.fulfill({ json: { files: [] } })
    }
    if (input.action === 'delete') {
      projects.delete(String(input.projectId))
      for (const [id, file] of files) if (file.projectId === input.projectId) files.delete(id)
      return route.fulfill({ json: { projects: [] } })
    }
    if (input.action === 'restore-new') {
      const stageId = `stage-${++stageSequence}`
      stages.set(stageId, { projectId: String(input.projectId),
        record: input.record as Record<string, unknown>, fileIds: input.fileIds as string[] })
      return route.fulfill({ json: { ready: false, stageId, projectId: input.projectId, expectedFileIds: input.fileIds } })
    }
    if (input.action === 'finalize-restore') {
      const stage = stages.get(String(input.stageId))
      if (!stage || JSON.stringify([...stage.fileIds].sort()) !== JSON.stringify([...(input.fileIds as string[])].sort()))
        return route.fulfill({ status: 409, json: { code: 'FILE_SET_CONFLICT', error: 'Wrong file set.' } })
      const record = { ...stage.record, ownerUserId: 'lifecycle-user',
        workspaceId: 'lifecycle-workspace', recordRevision: 0 }
      projects.set(stage.projectId, record)
      return route.fulfill({ json: { ready: true, record } })
    }
    if (input.action === 'list') return route.fulfill({ json: { projects: [...projects.values()] } })
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: String(input.action) } })
  })
  await page.route('**/api/cloud-files?fileId=*', async route => {
    const id = new URL(route.request().url()).searchParams.get('fileId')!
    if (route.request().method() === 'POST') {
      const bytes = route.request().postDataBuffer() ?? Buffer.alloc(0)
      const projectId = route.request().headers()['x-project-id']
      const name = decodeURIComponent(route.request().headers()['x-file-name'])
      const type = route.request().headers()['content-type']
      const uploadedAt = Date.now()
      files.set(id, { projectId, name, type, size: bytes.length, uploadedAt, bytes })
      return route.fulfill({ status: 201, json: { file: { fileId: id, projectId, name, type, size: bytes.length, uploadedAt } } })
    }
    const item = files.get(id)
    return item ? route.fulfill({ status: 200, contentType: item.type, body: item.bytes })
      : route.fulfill({ status: 404, json: { code: 'FILE_NOT_FOUND', error: 'Not found.' } })
  })

  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    setCloudAuthSession({
      user: { id: 'lifecycle-user' }, workspace: { id: 'lifecycle-workspace' },
      membership: { userId: 'lifecycle-user', workspaceId: 'lifecycle-workspace', role: 'owner' },
    })
    const id = `lifecycle-${crypto.randomUUID()}`
    const created = await repo.createProject({ projectId: id, projectName: 'Lifecycle source' })
    const file = await repo.saveFile(id, new File(['source contents'], 'source.bin', { type: 'application/octet-stream' }))
    const saved = await repo.saveProjectIfCurrent({ ...created, sourceFileIds: [file.fileId] }, created.recordRevision)
    const loadedFile = await repo.loadFile(file.fileId)
    const duplicate = await repo.duplicateProject(id, 'Lifecycle duplicate')
    const duplicateFiles = await repo.loadProjectFiles(duplicate!.projectId)
    const duplicateRecord = await repo.loadProject(duplicate!.projectId)
    await repo.removeFile(file.fileId)
    const removedFile = await repo.loadFile(file.fileId)
    const remainingOriginalFiles = await repo.loadProjectFiles(id)
    await repo.deleteProject(duplicate!.projectId)
    await repo.deleteProject(id)
    const listedAfterDelete = await repo.listProjects()
    const localRecord = await local.loadProject(id, LOCAL_ACCESS_CONTEXT)
    return {
      id, savedRevision: saved.recordRevision, loadedText: await loadedFile?.blob.text(),
      duplicateId: duplicate?.projectId, duplicateSourceIds: duplicateRecord?.sourceFileIds,
      duplicateFileIds: duplicateFiles.map((item: { fileId: string }) => item.fileId),
      sourceFileId: file.fileId, removedFile: removedFile === null,
      remainingOriginalFiles: remainingOriginalFiles.length,
      deletedFromCloudList: !listedAfterDelete.some((item: { projectId: string }) => item.projectId === id),
      localFallbackCreated: !!localRecord,
    }
  })
  expect(result).toMatchObject({
    savedRevision: 1, loadedText: 'source contents', removedFile: true,
    remainingOriginalFiles: 0, deletedFromCloudList: true, localFallbackCreated: false,
  })
  expect(result.duplicateId).not.toBe(result.id)
  expect(result.duplicateFileIds).toHaveLength(1)
  expect(result.duplicateFileIds[0]).not.toBe(result.sourceFileId)
  expect(result.duplicateSourceIds).toEqual(result.duplicateFileIds)
})

test('stale cloud saves surface an optimistic revision conflict', async ({ page }) => {
  await page.goto('/')
  const records = new Map<string, Record<string, unknown>>()
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'create') {
      const record = { ...(input.record as Record<string, unknown>), projectId: input.projectId,
        ownerUserId: 'conflict-user', workspaceId: 'conflict-workspace', recordRevision: 0 }
      records.set(String(input.projectId), record)
      return route.fulfill({ json: { record } })
    }
    if (input.action === 'list') return route.fulfill({ json: { projects: [...records.values()] } })
    if (input.action === 'save') {
      const current = records.get(String(input.projectId))
      if (!current || current.recordRevision !== input.expectedRevision)
        return route.fulfill({ status: 409, json: { code: 'PROJECT_CONFLICT', error: 'Project changed.' } })
      const record = { ...(input.record as Record<string, unknown>), ownerUserId: 'conflict-user',
        workspaceId: 'conflict-workspace', recordRevision: Number(input.expectedRevision) + 1 }
      records.set(String(input.projectId), record)
      return route.fulfill({ json: { record } })
    }
    if (input.action === 'read') {
      const record = records.get(String(input.projectId))
      return record ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' } })
    }
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: String(input.action) } })
  })
  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'conflict-user' }, workspace: { id: 'conflict-workspace' },
      membership: { userId: 'conflict-user', workspaceId: 'conflict-workspace', role: 'owner' },
    })
    const created = await repo.createProject({ projectId: `stale-${crypto.randomUUID()}`, projectName: 'Conflict test' })
    await repo.saveProjectIfCurrent({ ...created, projectName: 'newer version' }, 0)
    try {
      await repo.saveProjectIfCurrent({ ...created, projectName: 'stale version' }, 0)
      return { accepted: true, error: '' }
    } catch (error) {
      return {
        accepted: false,
        error: (error as Error).message,
        expected: (error as { expectedRevision?: number }).expectedRevision,
        actual: (error as { actualRevision?: number }).actualRevision,
      }
    }
  })
  expect(result).toMatchObject({ accepted: false, expected: 0, actual: 1 })
  expect(result.error).toContain('changed')
})

test('cloud records survive explicit logout and login against the same workspace store', async ({ page }) => {
  await page.goto('/')
  let authenticated = true
  const records = new Map<string, Record<string, unknown>>()
  const sessionBody = () => ({
    authenticated, mode: 'supabase',
    ...(authenticated ? {
      userId: 'session-user', activeWorkspaceId: 'session-workspace', activeRole: 'owner',
      activeOrganizationName: 'Session Org', activeWorkspaceName: 'Session Workspace',
    } : {}),
  })
  await page.route('**/api/auth/session', route => route.fulfill({ status: authenticated ? 200 : 401, json: sessionBody() }))
  await page.route('**/api/auth/logout', route => {
    authenticated = false
    return route.fulfill({ status: 200, json: sessionBody() })
  })
  await page.route('**/api/auth/login', route => {
    authenticated = true
    return route.fulfill({ status: 200, json: sessionBody() })
  })
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action === 'ready') return route.fulfill({ json: { ready: true } })
    if (input.action === 'create') {
      const record = { ...(input.record as Record<string, unknown>), projectId: input.projectId,
        ownerUserId: 'session-user', workspaceId: 'session-workspace', recordRevision: 0 }
      records.set(String(input.projectId), record)
      return route.fulfill({ json: { record } })
    }
    if (input.action === 'list') return route.fulfill({ json: { projects: [...records.values()] } })
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: String(input.action) } })
  })
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  const projectId = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    setCloudAuthSession({
      user: { id: 'session-user' }, workspace: { id: 'session-workspace' },
      membership: { userId: 'session-user', workspaceId: 'session-workspace', role: 'owner' },
    })
    const project = await repo.createProject({
      projectId: `session-${crypto.randomUUID()}`, projectName: 'Remote session project',
    })
    return project.projectId
  })
  await page.reload()
  await expect(page.getByText('Remote session project')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out.')).toBeVisible()
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email' }).fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByText('Remote session project')).toBeVisible()
  expect([...records.keys()]).toContain(projectId)
})

test('viewer role hides cloud mutation controls while retaining read and backup access', async ({ page }) => {
  await page.goto('/')
  const seed = await page.evaluate(async () => {
    const { indexedDbProjectRepository: local } = await import('/src/projectService.ts' as string)
    const { LOCAL_ACCESS_CONTEXT } = await import('/src/ownership.ts' as string)
    return local.createProject({
      projectId: `viewer-ui-${crypto.randomUUID()}`, projectName: 'Remote viewer record',
    }, LOCAL_ACCESS_CONTEXT)
  })
  const viewerRecord = { ...seed, ownerUserId: 'viewer-user', workspaceId: 'viewer-workspace' }
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, json: {
      authenticated: true, mode: 'supabase', userId: 'viewer-user',
      activeWorkspaceId: 'viewer-workspace', activeRole: 'viewer',
      activeOrganizationName: 'Viewer Org', activeWorkspaceName: 'Read Only',
    },
  }))
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as { action: string }
    if (input.action === 'ready') return route.fulfill({ json: { ready: true } })
    if (input.action === 'list') return route.fulfill({ json: { projects: [viewerRecord] } })
    return route.fulfill({ status: 403, json: { code: 'FORBIDDEN', error: 'Read-only role.' } })
  })
  await page.reload()
  await expect(page.getByText('Remote viewer record')).toBeVisible()
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Duplicate' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Backup' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review local projects to import' })).toHaveCount(0)
})