import { expect, test } from '@playwright/test'

test('cloud direct-parent metadata reads avoid archive bytes and denied parents cannot yield a change summary', async ({ page }) => {
  await page.goto('/')
  const fixtures = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `changes-cloud-${crypto.randomUUID()}`
    const project = await repo.createProject({ projectId, projectName: 'Cloud parent fixture' })
    const source = await repo.saveFile(projectId, new File(['private archive bytes'], 'source.txt', { type: 'text/plain' }))
    const firstRecord = await repo.saveProjectIfCurrent({
      ...project, sourceFileIds: [source.fileId],
      appToc: [{ id: 1, topicId: 'stable', title: 'Before', level: 1, words: 0 }],
    }, project.recordRevision)
    const parent = await repo.captureProjectCheckpoint(projectId, firstRecord.recordRevision, [source.fileId], 'Parent')
    const secondRecord = await repo.saveProjectIfCurrent({
      ...firstRecord, appToc: [{ id: 1, topicId: 'stable', title: 'After', level: 1, words: 0 }],
    }, firstRecord.recordRevision)
    const child = await repo.captureProjectCheckpoint(projectId, secondRecord.recordRevision, [source.fileId], 'Child')
    return { parent, child }
  })
  let denyParent = false
  let archiveDownloads = 0
  const actions: string[] = []
  await page.route('**/api/cloud-projects', async route => {
    const body = route.request().postDataJSON() as { action: string; checkpointId: string }
    actions.push(body.action)
    if (body.action !== 'get-checkpoint') {
      await route.fulfill({ status: 400, json: { error: 'Unexpected cloud action' } })
    } else if (denyParent && body.checkpointId === fixtures.parent.checkpointId) {
      await route.fulfill({ status: 403, json: { error: 'Read access denied' } })
    } else {
      await route.fulfill({ json: { checkpoint: body.checkpointId === fixtures.child.checkpointId ? fixtures.child : fixtures.parent } })
    }
  })
  await page.route('**/api/cloud-files?*', async route => {
    archiveDownloads++
    await route.fulfill({ status: 500, body: 'Archived file download was not expected' })
  })
  const allowed = await page.evaluate(async ({ parent, child }) => {
    const { cloudProjectRepository } = await import('/src/cloudProjectRepository.ts' as string)
    const { readValidatedCheckpointRecord } = await import('/src/checkpointRecordRead.ts' as string)
    const { buildCheckpointChangeSummary } = await import('/src/checkpointChanges.ts' as string)
    const { record: _childRecord, ...childSummary } = child
    const { record: _parentRecord, ...parentSummary } = parent
    const selected = await readValidatedCheckpointRecord(child.projectId, childSummary, cloudProjectRepository.getProjectCheckpointRecord)
    const directParent = await readValidatedCheckpointRecord(child.projectId, parentSummary, cloudProjectRepository.getProjectCheckpointRecord)
    return buildCheckpointChangeSummary(selected, directParent)
  }, fixtures)
  expect(allowed).toMatchObject({
    status: 'ready',
    topics: { status: 'ready', changes: [{ kind: 'renamed', topicId: 'stable', before: 'Before', after: 'After' }] },
    files: { status: 'ready', changes: [] },
  })
  expect(archiveDownloads).toBe(0)
  expect(actions).toEqual(['get-checkpoint', 'get-checkpoint'])

  denyParent = true
  const denied = await page.evaluate(async ({ parent, child }) => {
    const { cloudProjectRepository } = await import('/src/cloudProjectRepository.ts' as string)
    const { readValidatedCheckpointRecord } = await import('/src/checkpointRecordRead.ts' as string)
    const { unknownCheckpointChanges } = await import('/src/checkpointChanges.ts' as string)
    const { record: _childRecord, ...childSummary } = child
    const { record: _parentRecord, ...parentSummary } = parent
    const selected = await readValidatedCheckpointRecord(child.projectId, childSummary, cloudProjectRepository.getProjectCheckpointRecord)
    try {
      await readValidatedCheckpointRecord(child.projectId, parentSummary, cloudProjectRepository.getProjectCheckpointRecord)
      return { selected: selected.checkpointId, changes: 'incorrectly available' }
    } catch (error) {
      return { selected: selected.checkpointId, changes: unknownCheckpointChanges(`Direct parent unavailable: ${(error as Error).message}`) }
    }
  }, fixtures)
  expect(denied.selected).toBe(fixtures.child.checkpointId)
  expect(denied.changes).toMatchObject({ status: 'unknown' })
  expect(archiveDownloads).toBe(0)
  expect(actions).toEqual(['get-checkpoint', 'get-checkpoint', 'get-checkpoint', 'get-checkpoint'])
})