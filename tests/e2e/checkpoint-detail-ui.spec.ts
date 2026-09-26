import { expect, test } from '@playwright/test'

test('History inspects each immutable saved project and manifest without substituting current edits', async ({ page }) => {
  await page.goto('/')
  const projectId = `checkpoint-detail-${crypto.randomUUID()}`
  const before = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Initial project' })
    const oldFile = await repo.saveFile(id, new File(['archived first bytes'], 'old-source.txt', { type: 'text/plain' }))
    const firstRecord = await repo.saveProjectIfCurrent({
      ...project,
      projectName: 'First saved project',
      appToc: [
        { id: 1, topicId: 'alpha', title: 'Saved Alpha', level: 1, words: 0 },
        { id: 2, topicId: 'beta', title: 'Saved Beta', level: 2, words: 0 },
      ],
      sourceFileIds: [oldFile.fileId],
    }, project.recordRevision)
    const first = await repo.captureProjectCheckpoint(id, firstRecord.recordRevision, [oldFile.fileId], 'First saved snapshot')
    await repo.removeFile(oldFile.fileId)
    const newFile = await repo.saveFile(id, new File(['archived second bytes'], 'new-source.txt', { type: 'text/plain' }))
    const secondRecord = await repo.saveProjectIfCurrent({
      ...firstRecord,
      projectName: 'Second saved project',
      appToc: [{ id: 1, topicId: 'alpha', title: 'Renamed Alpha', level: 1, words: 0 }],
      sourceFileIds: [newFile.fileId],
    }, firstRecord.recordRevision)
    const second = await repo.captureProjectCheckpoint(id, secondRecord.recordRevision, [newFile.fileId], 'Second saved snapshot')
    await repo.saveProjectIfCurrent({
      ...secondRecord,
      projectName: 'Unsaved current name',
      appToc: [{ id: 3, topicId: 'current', title: 'Current-only topic', level: 1, words: 0 }],
    }, secondRecord.recordRevision)
    repo.setActiveProjectId(id)
    return { first, second }
  }, projectId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const firstRow = page.locator('section[aria-labelledby="history-list-title"] > ol > li').filter({ hasText: 'First saved snapshot' })
  await firstRow.getByRole('button', { name: 'Inspect saved checkpoint' }).click()
  const detail = page.getByTestId('checkpoint-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('First saved project')
  await expect(detail).toContainText(`Revision ${before.first.originatingRecordRevision}`)
  await expect(detail).toContainText(before.first.checkpointId)
  await expect(detail).toContainText(before.first.recordDigest)
  await expect(detail.getByTestId('saved-outline').locator('li')).toHaveCount(2)
  await expect(detail.getByTestId('saved-outline').locator('li').first()).toContainText('Saved Alpha')
  await expect(detail.getByTestId('saved-outline').locator('li').last()).toContainText('Saved Beta')
  await expect(detail.getByTestId('saved-file-manifest')).toContainText('old-source.txt')
  await expect(detail.getByTestId('saved-file-manifest')).toContainText(before.first.files[0].sha256)
  await expect(detail).toContainText('Archived file bytes were not downloaded or verified by this view')
  await expect(firstRow).toContainText('Integrity not verified')
  await expect(detail).not.toContainText('Current-only topic')
  await expect(detail).not.toContainText('Unsaved current name')
  await expect(detail).not.toContainText('new-source.txt')
  await expect(detail.getByTestId('checkpoint-changes')).toContainText('First checkpoint: no direct parent to summarize.')
  await firstRow.getByRole('button', { name: 'Verify integrity' }).click()
  await expect(firstRow).toContainText('Integrity verified')
  await expect(detail).toContainText('A separate full integrity verification passed')

  const secondRow = page.locator('section[aria-labelledby="history-list-title"] > ol > li').filter({ hasText: 'Second saved snapshot' })
  await secondRow.getByRole('button', { name: 'Inspect saved checkpoint' }).click()
  await expect(detail).toContainText('Second saved project')
  await expect(detail.getByTestId('saved-outline').locator('li')).toHaveCount(1)
  await expect(detail).toContainText('Renamed Alpha')
  await expect(detail.getByTestId('saved-file-manifest')).toContainText('new-source.txt')
  await expect(detail.getByTestId('saved-file-manifest')).not.toContainText('old-source.txt')
  await expect(detail).not.toContainText('Current-only topic')
  const changes = detail.getByTestId('checkpoint-changes')
  await expect(changes.getByTestId('topic-changes')).toContainText('Renamed: Saved Alpha → Renamed Alpha')
  await expect(changes.getByTestId('topic-changes')).toContainText('Removed: Saved Beta')
  await expect(changes.getByTestId('file-changes')).toContainText('Added: new-source.txt')
  await expect(changes.getByTestId('file-changes')).toContainText('Removed: old-source.txt')
  await expect(changes).toContainText('Archived file bytes are not downloaded or verified here')
  await expect(changes).not.toContainText('Current-only topic')

  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(detail).toContainText('Second saved project')
  await expect(detail.getByTestId('checkpoint-changes').getByTestId('topic-changes')).toContainText('Renamed Alpha')
  const after = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const checkpoints = await repo.listProjectCheckpoints(id)
    const current = await repo.loadProject(id)
    return { checkpoints: checkpoints.map(item => [item.checkpointId, item.integrityDigest]), projectName: current?.projectName }
  }, projectId)
  expect(after.checkpoints).toEqual([before.second, before.first].map(item => [item.checkpointId, item.integrityDigest]))
  expect(after.projectName).toBe('Unsaved current name')
})

test('refresh discards stale full verification and refuses a damaged saved record', async ({ page }) => {
  await page.goto('/')
  const projectId = `checkpoint-detail-verification-${crypto.randomUUID()}`
  const saved = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Verified project' })
    const checkpoint = await repo.captureProjectCheckpoint(id, project.recordRevision, [], 'Integrity baseline')
    repo.setActiveProjectId(id)
    return checkpoint
  }, projectId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const row = page.locator('section[aria-labelledby="history-list-title"] > ol > li').filter({ hasText: 'Integrity baseline' })
  await page.evaluate(() => {
    const subtle = crypto.subtle
    const original = subtle.digest.bind(subtle)
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    ;(window as unknown as { releaseVerification: () => void }).releaseVerification = release
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        await gate
        return original(algorithm, data)
      },
    })
  })
  await row.getByRole('button', { name: 'Verify integrity' }).click()
  await expect(row).toContainText('Verifying…')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(row).toContainText('Integrity not verified')
  await page.evaluate(() => (window as unknown as { releaseVerification: () => void }).releaseVerification())
  await page.waitForTimeout(300)
  await expect(row).toContainText('Integrity not verified')
  await row.getByRole('button', { name: 'Verify integrity' }).click()
  await expect(row).toContainText('Integrity verified')

  await page.evaluate(async checkpointId => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('projectCheckpoints', 'readwrite')
    const store = transaction.objectStore('projectCheckpoints')
    const row = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(checkpointId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    ;(row.record as Record<string, unknown>).projectName = 'Tampered saved name'
    store.put(row)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, saved.checkpointId)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(row).toContainText('Integrity not verified')
  await row.getByRole('button', { name: 'Inspect saved checkpoint' }).click()
  await expect(row.getByRole('alert')).toContainText('digest')
  await expect(page.getByTestId('checkpoint-detail')).toHaveCount(0)
})