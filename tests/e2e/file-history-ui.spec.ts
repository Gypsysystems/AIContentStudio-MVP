import { expect, test } from '@playwright/test'

test('History shows saved file presence and unchanged hashes without reading bytes or changing checkpoints', async ({ page }) => {
  await page.goto('/')
  const id = `file-timeline-${crypto.randomUUID()}`
  const saved = await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const initial = await repo.createProject({ projectId, projectName: 'First saved name' })
    await repo.captureProjectCheckpoint(projectId, initial.recordRevision, [], 'Before file')
    const file = await repo.saveFile(projectId, new File(['saved archived bytes'], 'saved-source.txt', { type: 'text/plain' }))
    const second = await repo.saveProjectIfCurrent({ ...initial, sourceFileIds: [file.fileId] }, initial.recordRevision)
    const added = await repo.captureProjectCheckpoint(projectId, second.recordRevision, [file.fileId], 'File added')
    const third = await repo.saveProjectIfCurrent({ ...second, projectName: 'Third saved name' }, second.recordRevision)
    const unchanged = await repo.captureProjectCheckpoint(projectId, third.recordRevision, [file.fileId], 'Same file hash')
    await repo.removeFile(file.fileId)
    const fourth = await repo.saveProjectIfCurrent({ ...third, sourceFileIds: [] }, third.recordRevision)
    await repo.captureProjectCheckpoint(projectId, fourth.recordRevision, [], 'After file')
    await repo.saveProjectIfCurrent({ ...fourth, projectName: 'Current unsaved name' }, fourth.recordRevision)
    repo.setActiveProjectId(projectId)
    return { fileId: file.fileId, hash: added.files[0].sha256, unchangedHash: unchanged.files[0].sha256,
      revision: added.originatingRecordRevision,
      digests: (await repo.listProjectCheckpoints(projectId)).map(item => item.integrityDigest) }
  }, id)
  expect(saved.unchangedHash).toBe(saved.hash)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const panel = page.getByTestId('file-history')
  await panel.getByLabel('Saved file ID').selectOption(saved.fileId)
  const timeline = panel.getByTestId('file-history-timeline')
  await expect(timeline.getByTestId('file-history-entry')).toHaveCount(4)
  const entries = timeline.getByTestId('file-history-entry')
  await expect(entries.nth(0)).toContainText('After file')
  await expect(entries.nth(0)).toContainText('Absent')
  await expect(entries.nth(1)).toContainText('Same file hash')
  await expect(entries.nth(1)).toContainText(`Saved SHA-256: ${saved.hash}`)
  await expect(entries.nth(2)).toContainText('File added')
  await expect(entries.nth(2)).toContainText(`Saved SHA-256: ${saved.hash}`)
  await expect(entries.nth(2)).toContainText(`Revision ${saved.revision}`)
  await expect(entries.nth(3)).toContainText('Before file')
  await expect(entries.nth(3)).toContainText('Absent')
  await expect(panel).not.toContainText('Current unsaved name')
  await expect(panel).toContainText('do not verify archived file bytes')
  await expect(page.locator('section[aria-labelledby="history-list-title"]')).toContainText('Integrity not verified')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(timeline.getByTestId('file-history-entry')).toHaveCount(4)
  const after = await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    return (await repo.listProjectCheckpoints(projectId)).map(item => item.integrityDigest)
  }, id)
  expect(after).toEqual(saved.digests)
})

test('a damaged saved checkpoint is unknown instead of being shown as file absence', async ({ page }) => {
  await page.goto('/')
  const id = `file-timeline-damage-${crypto.randomUUID()}`
  const saved = await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const initial = await repo.createProject({ projectId, projectName: 'File fixture' })
    const file = await repo.saveFile(projectId, new File(['private bytes'], 'private.txt'))
    const record = await repo.saveProjectIfCurrent({ ...initial, sourceFileIds: [file.fileId] }, initial.recordRevision)
    const checkpoint = await repo.captureProjectCheckpoint(projectId, record.recordRevision, [file.fileId], 'Corrupted manifest')
    repo.setActiveProjectId(projectId)
    return { checkpointId: checkpoint.checkpointId, fileId: file.fileId }
  }, id)
  await page.evaluate(async checkpointId => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('projectCheckpoints', 'readwrite')
    const store = tx.objectStore('projectCheckpoints')
    const checkpoint = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(checkpointId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    ;(checkpoint.record as Record<string, unknown>).projectName = 'Tampered record'
    store.put(checkpoint)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, saved.checkpointId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const panel = page.getByTestId('file-history')
  await panel.getByLabel('Saved file ID').selectOption(saved.fileId)
  const entry = panel.getByTestId('file-history-entry')
  await expect(entry).toContainText('Unknown')
  await expect(entry).toContainText('digest')
  await expect(entry).not.toContainText('Absent')
  await expect(entry).not.toContainText('Saved SHA-256:')
})

test('switching file IDs while metadata is loading cannot show the old file timeline', async ({ page }) => {
  await page.goto('/')
  const id = `file-timeline-switch-${crypto.randomUUID()}`
  const saved = await page.evaluate(async projectId => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const initial = await repo.createProject({ projectId, projectName: 'Two files' })
    const first = await repo.saveFile(projectId, new File(['first bytes'], 'first.txt'))
    const second = await repo.saveFile(projectId, new File(['second bytes'], 'second.txt'))
    const record = await repo.saveProjectIfCurrent({
      ...initial, sourceFileIds: [first.fileId, second.fileId],
    }, initial.recordRevision)
    const checkpoint = await repo.captureProjectCheckpoint(projectId, record.recordRevision, [first.fileId, second.fileId], 'Both files')
    repo.setActiveProjectId(projectId)
    return {
      firstId: first.fileId, secondId: second.fileId,
      firstHash: checkpoint.files.find((file: { fileId: string }) => file.fileId === first.fileId)!.sha256,
      secondHash: checkpoint.files.find((file: { fileId: string }) => file.fileId === second.fileId)!.sha256,
    }
  }, id)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle)
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    ;(window as unknown as { releaseFileHistoryReads: () => void }).releaseFileHistoryReads = release
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        await gate
        return original(algorithm, data)
      },
    })
  })
  const panel = page.getByTestId('file-history')
  await panel.getByLabel('Saved file ID').selectOption(saved.firstId)
  await expect(panel).toContainText('Reading authorized checkpoint metadata')
  await panel.getByLabel('Saved file ID').selectOption(saved.secondId)
  await page.evaluate(() => (window as unknown as { releaseFileHistoryReads: () => void }).releaseFileHistoryReads())
  await expect(panel.getByTestId('file-history-entry')).toContainText(saved.secondHash)
  await expect(panel.getByTestId('file-history-entry')).not.toContainText(saved.firstHash)
  await expect(panel.getByLabel('Saved file ID')).toHaveValue(saved.secondId)
})