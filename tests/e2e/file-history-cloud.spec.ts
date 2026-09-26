import { expect, test } from '@playwright/test'

test('cloud file history uses authorized metadata only; denied and foreign checkpoint reads cannot show saved hashes', async ({ page }) => {
  await page.goto('/')
  const fixtures = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `file-history-cloud-${crypto.randomUUID()}`
    const project = await repo.createProject({ projectId, projectName: 'Cloud file history fixture' })
    const root = await repo.captureProjectCheckpoint(projectId, project.recordRevision, [], 'Before file')
    const file = await repo.saveFile(projectId, new File(['private archived bytes'], 'cloud-source.txt'))
    const next = await repo.saveProjectIfCurrent({ ...project, sourceFileIds: [file.fileId] }, project.recordRevision)
    const child = await repo.captureProjectCheckpoint(projectId, next.recordRevision, [file.fileId], 'File saved')
    return { root, child, fileId: file.fileId }
  })
  const before = structuredClone(fixtures)
  let denyRoot = false
  let archiveDownloads = 0
  const actions: string[] = []
  await page.route('**/api/cloud-projects', async route => {
    const body = route.request().postDataJSON() as { action: string; checkpointId?: string }
    actions.push(body.action)
    if (body.action === 'list-checkpoints') {
      await route.fulfill({ json: { checkpoints: [fixtures.child, fixtures.root] } })
    } else if (body.action === 'get-checkpoint' && body.checkpointId === fixtures.root.checkpointId && denyRoot) {
      await route.fulfill({ status: 403, json: { error: 'Access denied' } })
    } else if (body.action === 'get-checkpoint') {
      await route.fulfill({ json: { checkpoint: body.checkpointId === fixtures.child.checkpointId ? fixtures.child : fixtures.root } })
    } else {
      await route.fulfill({ status: 400, json: { error: 'Unexpected action' } })
    }
  })
  await page.route('**/api/cloud-files?*', async route => {
    archiveDownloads++
    await route.fulfill({ status: 500, body: 'Archive read not expected' })
  })
  const allowed = await page.evaluate(async ({ child, fileId }) => {
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    const { loadProjectFileHistory } = await import('/src/fileHistory.ts' as string)
    const list = await repo.listProjectCheckpoints(child.projectId)
    return loadProjectFileHistory(child.projectId, fileId, list, repo.getProjectCheckpointRecord)
  }, fixtures)
  expect(allowed.map(row => row.status)).toEqual(['present', 'absent'])
  expect(allowed[0].sha256).toBe(fixtures.child.files[0].sha256)
  expect(allowed[0].ancestryIssue).toBeUndefined()
  expect(archiveDownloads).toBe(0)
  expect(actions).toEqual(['list-checkpoints', 'get-checkpoint', 'get-checkpoint'])

  denyRoot = true
  const denied = await page.evaluate(async ({ child, fileId }) => {
    const { cloudProjectRepository: repo } = await import('/src/cloudProjectRepository.ts' as string)
    const { loadProjectFileHistory } = await import('/src/fileHistory.ts' as string)
    const list = await repo.listProjectCheckpoints(child.projectId)
    return loadProjectFileHistory(child.projectId, fileId, list, repo.getProjectCheckpointRecord)
  }, fixtures)
  expect(denied[0]).toMatchObject({ status: 'unknown', ancestryIssue: expect.stringContaining('could not be read') })
  expect(denied[0].sha256).toBeUndefined()
  expect(denied[1]).toMatchObject({ status: 'unknown' })
  expect(denied[1].sha256).toBeUndefined()
  expect(archiveDownloads).toBe(0)
  expect(fixtures).toEqual(before)
  expect(actions.filter(action => action === 'get-checkpoint')).toHaveLength(4)
})