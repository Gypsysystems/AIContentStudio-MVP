import { expect, test } from '@playwright/test'

test('checkpoint metadata reads match full local reads and retain project authorization', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const authorized = await import('/src/authorizedProjectService.ts' as string)
    const projectId = `metadata-local-${crypto.randomUUID()}`
    await repo.createProject({ projectId, projectName: 'Metadata-only history' })
    const file = await repo.saveFile(projectId, new File(['retained checkpoint bytes'], 'source.txt'))
    let record = await repo.loadProject(projectId)
    if (!record) throw new Error('Project missing before checkpoint capture')
    record = await repo.saveProjectIfCurrent({
      ...record, sourceFileIds: [file.fileId],
    }, record.recordRevision)
    const checkpoint = await repo.captureProjectCheckpoint(
      projectId, record.recordRevision, [file.fileId], 'Metadata regression baseline',
    )
    const metadata = await repo.getProjectCheckpointRecord(projectId, checkpoint.checkpointId)
    const full = await repo.getProjectCheckpoint(projectId, checkpoint.checkpointId)
    if (!metadata || !full) throw new Error('Checkpoint read returned no result')
    const verifiedBefore = await repo.verifyProjectCheckpoint(projectId, checkpoint.checkpointId)
    const authorizedMetadata = await authorized.authorizedProjectRepository
      .getProjectCheckpointRecord(projectId, checkpoint.checkpointId)
    const unauthorized = await repo.getProjectCheckpointRecord(projectId, checkpoint.checkpointId, {
      user: { id: 'different-user' },
      workspace: { id: 'different-workspace' },
      membership: { userId: 'different-user', workspaceId: 'different-workspace', role: 'owner' },
    }).then(() => 'accepted', (error: Error) => error.message)
    return {
      projectId, checkpointId: checkpoint.checkpointId, metadata, full: full.checkpoint,
      authorizedMetadata, verifiedBefore, unauthorized,
    }
  })

  expect(result.metadata).toEqual(result.full)
  expect(result.authorizedMetadata).toEqual(result.metadata)
  expect(result.metadata.files).toHaveLength(1)
  expect(result.metadata.record.sourceFileIds).toHaveLength(1)
  expect(result.verifiedBefore).toMatchObject({ valid: true, issues: [] })
  expect(result.unauthorized).toContain('across workspaces')
})

test('cloud metadata reads avoid archived bytes while full checkpoint verification still downloads them', async ({ page }) => {
  await page.goto('/')
  const checkpoint = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `metadata-cloud-source-${crypto.randomUUID()}`
    await repo.createProject({ projectId, projectName: 'Cloud metadata fixture' })
    const file = await repo.saveFile(projectId, new File(['cloud checkpoint bytes'], 'source.txt', { type: 'text/plain' }))
    let record = await repo.loadProject(projectId)
    if (!record) throw new Error('Project missing before checkpoint capture')
    record = await repo.saveProjectIfCurrent({
      ...record, sourceFileIds: [file.fileId],
    }, record.recordRevision)
    return repo.captureProjectCheckpoint(projectId, record.recordRevision, [file.fileId], 'Cloud metadata fixture')
  })

  let archiveDownloads = 0
  let cloudActions: string[] = []
  await page.route('**/api/cloud-projects', async route => {
    const body = route.request().postDataJSON() as { action: string }
    cloudActions.push(body.action)
    await route.fulfill({ json: { checkpoint } })
  })
  await page.route('**/api/cloud-files?*', async route => {
    archiveDownloads++
    await route.fulfill({ status: 200, body: 'cloud checkpoint bytes' })
  })
  const metadata = await page.evaluate(async value => {
    const { cloudProjectRepository } = await import('/src/cloudProjectRepository.ts' as string)
    return cloudProjectRepository.getProjectCheckpointRecord(
      value.projectId, value.checkpointId,
    )
  }, checkpoint)
  expect(metadata).toEqual(checkpoint)
  expect(archiveDownloads).toBe(0)

  const fullVerification = await page.evaluate(async value => {
    const { cloudProjectRepository } = await import('/src/cloudProjectRepository.ts' as string)
    return cloudProjectRepository.verifyProjectCheckpoint(
      value.projectId, value.checkpointId,
    )
  }, checkpoint)

  expect(archiveDownloads).toBe(1)
  expect(cloudActions).toEqual(['get-checkpoint', 'get-checkpoint'])
  expect(fullVerification).toMatchObject({ valid: true, issues: [], usable: true })
})