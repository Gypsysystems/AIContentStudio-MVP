import { expect, test } from '@playwright/test'

test('an unreadable direct parent leaves selected checkpoint detail visible but changes unknown', async ({ page }) => {
  await page.goto('/')
  const projectId = `checkpoint-changes-unknown-${crypto.randomUUID()}`
  const parentId = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Change summary fixture' })
    const first = await repo.saveProjectIfCurrent({
      ...project, appToc: [{ id: 1, topicId: 'stable', title: 'Earlier title', level: 1, words: 0 }],
    }, project.recordRevision)
    const parent = await repo.captureProjectCheckpoint(id, first.recordRevision, [], 'Earlier checkpoint')
    const next = await repo.saveProjectIfCurrent({
      ...first, appToc: [{ id: 1, topicId: 'stable', title: 'Later title', level: 1, words: 0 }],
    }, first.recordRevision)
    await repo.captureProjectCheckpoint(id, next.recordRevision, [], 'Selected checkpoint')
    repo.setActiveProjectId(id)
    return parent.checkpointId
  }, projectId)
  await page.evaluate(async checkpointId => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('projectCheckpoints', 'readwrite')
    const store = transaction.objectStore('projectCheckpoints')
    const parent = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(checkpointId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    ;(parent.record as Record<string, unknown>).projectName = 'Corrupted parent'
    store.put(parent)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, parentId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const selected = page.locator('section[aria-labelledby="history-list-title"] > ol > li').filter({ hasText: 'Selected checkpoint' })
  await selected.getByRole('button', { name: 'Inspect saved checkpoint' }).click()
  const detail = selected.getByTestId('checkpoint-detail')
  await expect(detail).toContainText('Later title')
  const changes = detail.getByTestId('checkpoint-changes')
  await expect(changes).toContainText('Changes unknown')
  await expect(changes).toContainText('digest')
  await expect(changes.getByTestId('topic-changes')).toHaveCount(0)
  await expect(changes.getByTestId('file-changes')).toHaveCount(0)
  await expect(selected).toContainText('Integrity not verified')
})

test('malformed and ambiguous parent links display unknown, not a first-checkpoint claim', async ({ page }) => {
  await page.goto('/')
  const projectId = `checkpoint-changes-links-${crypto.randomUUID()}`
  const childId = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Link fixture' })
    await repo.captureProjectCheckpoint(id, project.recordRevision, [], 'Actual first')
    const next = await repo.saveProjectIfCurrent({ ...project, projectName: 'Selected snapshot' }, project.recordRevision)
    const child = await repo.captureProjectCheckpoint(id, next.recordRevision, [], 'Selected with bad link')
    repo.setActiveProjectId(id)
    return child.checkpointId
  }, projectId)
  const changeLink = async (link: string | null) => {
    await page.evaluate(async ({ checkpointId, parentLink }) => {
      const { checkpointIntegrityDigest } = await import('/src/projectCheckpoint.ts' as string)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('docflow-db')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const stored = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = db.transaction('projectCheckpoints', 'readonly')
        const request = transaction.objectStore('projectCheckpoints').get(checkpointId)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      stored.parentCheckpointId = parentLink
      const { integrityDigest: _oldDigest, ...content } = stored
      stored.integrityDigest = await checkpointIntegrityDigest(content)
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('projectCheckpoints', 'readwrite')
        transaction.objectStore('projectCheckpoints').put(stored)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
    }, { checkpointId: childId, parentLink: link })
  }
  await changeLink('')
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  const row = page.locator('section[aria-labelledby="history-list-title"] > ol > li').filter({ hasText: 'Selected with bad link' })
  await row.getByRole('button', { name: 'Inspect saved checkpoint' }).click()
  await expect(row.getByTestId('checkpoint-changes')).toContainText('Changes unknown')
  await expect(row.getByTestId('checkpoint-changes')).toContainText('missing or malformed')
  await expect(row).not.toContainText('None (first checkpoint)')
  await expect(row).toContainText('Unknown (missing or malformed link)')
  await changeLink(childId)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(row.getByTestId('checkpoint-changes')).toContainText('links to itself')
  await expect(row.getByTestId('checkpoint-changes').getByTestId('topic-changes')).toHaveCount(0)
  await changeLink(null)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(row.getByTestId('checkpoint-detail')).toContainText('Selected snapshot')
  await expect(row.getByTestId('checkpoint-changes')).toContainText('Changes unknown')
  await expect(row.getByTestId('checkpoint-changes')).toContainText('first checkpoint is ambiguous')
})