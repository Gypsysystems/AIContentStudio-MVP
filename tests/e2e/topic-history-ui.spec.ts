import { expect, test } from '@playwright/test'

test('History shows only saved topic observations, including deleted and current-only topics', async ({ page }) => {
  await page.goto('/')
  const projectId = `topic-history-ui-${crypto.randomUUID()}`
  const before = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Topic history acceptance' })
    const first = await repo.saveProjectIfCurrent({
      ...project,
      appToc: [
        { id: 1, topicId: 'topic-a', title: 'Original title', level: 1, words: 0 },
        { id: 2, topicId: 'topic-b', title: 'Other topic', level: 1, words: 0 },
      ],
      topicContent: { 'topic-a': [{ id: 'block-a', type: 'para', content: 'Original saved paragraph' }] },
    }, project.recordRevision)
    await repo.captureProjectCheckpoint(id, first.recordRevision, [], 'First baseline')
    const second = await repo.saveProjectIfCurrent({
      ...first,
      appToc: [
        { id: 2, topicId: 'topic-b', title: 'Other topic', level: 1, words: 0 },
        { id: 1, topicId: 'topic-a', title: 'Renamed title', level: 1, words: 0 },
      ],
      topicContent: { 'topic-a': [{ id: 'block-a', type: 'para', content: 'Updated saved paragraph' }] },
    }, first.recordRevision)
    await repo.captureProjectCheckpoint(id, second.recordRevision, [], 'Second baseline')
    await repo.saveProjectIfCurrent({
      ...second,
      appToc: [
        { id: 2, topicId: 'topic-b', title: 'Other topic', level: 1, words: 0 },
        { id: 3, topicId: 'topic-new', title: 'Current only', level: 1, words: 0 },
      ],
      topicContent: { 'topic-new': [{ id: 'block-new', type: 'para', content: 'Never checkpointed' }] },
    }, second.recordRevision)
    repo.setActiveProjectId(id)
    return (await repo.listProjectCheckpoints(id)).map(item => [item.checkpointId, item.integrityDigest])
  }, projectId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open topic history' }).click()
  const topic = page.getByLabel('Topic', { exact: true })
  await expect(topic.locator('option[value="topic-a"]')).toBeAttached()
  await topic.selectOption('topic-a')
  await expect(page.getByText('Original title', { exact: true })).toBeVisible()
  await expect(page.getByText('Renamed title · Changed', { exact: true })).toBeVisible()
  await page.getByText('Saved topic content and metadata').first().click()
  await expect(page.getByText('Original saved paragraph', { exact: true })).toBeVisible()
  await expect(page.getByText('Never checkpointed', { exact: true })).toHaveCount(0)
  await topic.selectOption('topic-new')
  await expect(page.getByText('This topic is in the current outline, but has no checkpointed versions yet.')).toBeVisible()
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  await page.getByRole('button', { name: 'Open topic history' }).click()
  await page.getByLabel('Topic', { exact: true }).selectOption('topic-a')
  await expect(page.getByText('Renamed title · Changed', { exact: true })).toBeVisible()
  const after = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    return (await repo.listProjectCheckpoints(id)).map(item => [item.checkpointId, item.integrityDigest])
  }, projectId)
  expect(after).toEqual(before)
})

test('creating and refreshing checkpoints updates an open topic history without fabricating an earlier version', async ({ page }) => {
  await page.goto('/')
  const projectId = `topic-history-refresh-${crypto.randomUUID()}`
  await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    const project = await repo.createProject({ projectId: id, projectName: 'Topic history refresh' })
    await repo.saveProjectIfCurrent({
      ...project,
      appToc: [{ id: 1, topicId: 'saved-topic', title: 'Saved topic', level: 1, words: 0 }],
      topicContent: { 'saved-topic': [{ id: 'text', type: 'para', content: 'Captured content' }] },
    }, project.recordRevision)
    repo.setActiveProjectId(id)
  }, projectId)
  await page.reload()
  await page.getByTestId('topbar-project-history').click()
  await page.getByRole('button', { name: 'Open topic history' }).click()
  await expect(page.getByText('No checkpoints yet. Current topics have no saved history.')).toBeVisible()
  await expect(page.getByText('This topic is in the current outline, but has no checkpointed versions yet.')).toBeVisible()
  await page.getByLabel(/Checkpoint note/).fill('Captured from History')
  await page.getByRole('button', { name: 'Create checkpoint' }).click()
  await expect(page.getByText('Saved topic content and metadata')).toHaveCount(1)
  await expect(page.getByText('Captured from History').first()).toBeVisible()
  await expect(page.getByText('This topic is in the current outline, but has no checkpointed versions yet.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close topic history' }).click()
  await page.getByRole('button', { name: 'Open topic history' }).click()
  await expect(page.getByText('Captured from History').first()).toBeVisible()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Captured from History').first()).toBeVisible()
  const count = await page.evaluate(async id => {
    const { projectRepository: repo } = await import('/src/projectService.ts' as string)
    return (await repo.listProjectCheckpoints(id)).length
  }, projectId)
  expect(count).toBe(1)
})