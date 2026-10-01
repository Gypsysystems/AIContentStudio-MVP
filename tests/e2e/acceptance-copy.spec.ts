import { expect, test, type Page, type Route } from '@playwright/test'

type CloudRecord = Record<string, any> & {
  projectId: string
  projectName: string
  recordRevision: number
}

type NetworkError = { url: string; status: number }
type BrowserConsoleError = { url: string; text: string }

const workspaceId = 'acceptance-copy-workspace'
const userId = 'acceptance-copy-verified-test-user'
const catalogItemId = '123e4567-e89b-42d3-a456-426614174099'
const catalogVersion = 3
const destinationTopicId = 'destination-procedure'
const copiedTopicId = 'reused-source-procedure'
const remoteTopicId = 'remote-update-topic'
const sourceText = 'The source procedure remains owned by its original project.'
const destinationText = 'Destination-only baseline text.'
const reusedText = 'This exact paragraph is reused from the source catalog version.'

type MockCloud = {
  records: Map<string, CloudRecord>
  catalogLists: Record<string, unknown>[]
  catalogCopies: Record<string, unknown>[]
  projectReads: string[]
  raceNextCopy: boolean
  sourceProjectId: string
  destinationProjectId: string
  expectedConflictResponse: NetworkError | null
}

function jsonRoute(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  })
}

async function installMockCloud(page: Page, cloud: MockCloud) {
  // This is a browser-only synthetic session/role fixture, not a live login or
  // evidence of real authentication. All cloud and catalog requests are routed
  // to the in-memory test store below.
  const session = {
    authenticated: true,
    mode: 'supabase',
    userId,
    activeWorkspaceId: workspaceId,
    activeRole: 'owner',
    activeOrganizationName: 'Synthetic Acceptance Organization',
    activeWorkspaceName: 'Synthetic Acceptance Workspace',
  }
  await page.route('**/api/auth/session', route => jsonRoute(route, session))
  await page.route('**/api/auth/refresh', route => jsonRoute(route, session))
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, any>
    const projectId = String(input.projectId ?? '')
    if (input.action === 'ready') return jsonRoute(route, { ready: true })
    if (input.action === 'list') return jsonRoute(route, { projects: [...cloud.records.values()] })
    if (input.action === 'create') {
      const record = {
        ...(input.record as CloudRecord),
        projectId,
        ownerUserId: userId,
        workspaceId,
        recordRevision: 0,
      } as CloudRecord
      cloud.records.set(projectId, record)
      return jsonRoute(route, { record })
    }
    if (input.action === 'read' || input.action === 'backup') {
      cloud.projectReads.push(projectId)
      const record = cloud.records.get(projectId)
      return record
        ? jsonRoute(route, { record })
        : jsonRoute(route, { code: 'PROJECT_NOT_FOUND', error: 'Not found.' }, 404)
    }
    if (input.action === 'save') {
      const current = cloud.records.get(projectId)
      if (!current || current.recordRevision !== input.expectedRevision) {
        return jsonRoute(route, {
          code: 'PROJECT_CONFLICT',
          error: 'Project changed elsewhere.',
        }, 409)
      }
      const record = {
        ...(input.record as CloudRecord),
        projectId,
        ownerUserId: userId,
        workspaceId,
        recordRevision: Number(input.expectedRevision) + 1,
      } as CloudRecord
      cloud.records.set(projectId, record)
      return jsonRoute(route, { record })
    }
    if (input.action === 'load-files') return jsonRoute(route, { files: [] })
    return jsonRoute(route, {
      code: 'UNEXPECTED_ACTION',
      error: `Unexpected cloud action: ${String(input.action)}`,
    }, 400)
  })

  await page.route('**/api/content-catalog', async route => {
    const input = route.request().postDataJSON() as Record<string, any>
    if (input.action === 'list') {
      cloud.catalogLists.push(input)
      return jsonRoute(route, {
        items: input.projectId === cloud.sourceProjectId
          ? [{
              itemId: catalogItemId,
              projectId: cloud.sourceProjectId,
              assetType: 'topic',
              displayName: 'Source procedure for reuse',
              currentVersion: catalogVersion,
              updatedAt: '2026-10-01T12:00:00.000Z',
            }]
          : [],
      })
    }
    if (input.action === 'version') {
      expect(input).toEqual({
        action: 'version',
        workspaceId,
        itemId: catalogItemId,
        version: catalogVersion,
      })
      return jsonRoute(route, {
        item: {
          itemId: catalogItemId,
          projectId: cloud.sourceProjectId,
          assetType: 'topic',
          displayName: 'Source procedure for reuse',
          currentVersion: catalogVersion,
          updatedAt: '2026-10-01T12:00:00.000Z',
        },
        version: {
          version: catalogVersion,
          payload: {
            title: 'Reused source procedure',
            level: 1,
            order: 0,
            parentId: null,
            blocks: [{ id: 'source-catalog-block', type: 'para', content: reusedText }],
          },
        },
      })
    }
    if (input.action === 'copy') {
      cloud.catalogCopies.push(input)
      expect(input.workspaceId).toBe(workspaceId)
      expect(input.sourceItemId).toBe(catalogItemId)
      expect(input.sourceVersion).toBe(catalogVersion)
      expect(input.destinationProjectId).toBe(cloud.destinationProjectId)
      expect(input).not.toHaveProperty('payload')
      expect(input).not.toHaveProperty('content')

      const current = cloud.records.get(cloud.destinationProjectId!)
      if (!current) return jsonRoute(route, { code: 'PROJECT_NOT_FOUND', error: 'Not found.' }, 404)

      if (cloud.raceNextCopy) {
        cloud.raceNextCopy = false
        cloud.expectedConflictResponse = { url: route.request().url(), status: 409 }
        const remoteTopic = {
          id: 3,
          topicId: remoteTopicId,
          title: 'Remote session update',
          level: 1,
          words: 4,
        }
        cloud.records.set(cloud.destinationProjectId!, {
          ...current,
          recordRevision: current.recordRevision + 1,
          tocRevision: Number(current.tocRevision ?? 0) + 1,
          contentRevision: Number(current.contentRevision ?? 0) + 1,
          appToc: [...current.appToc, remoteTopic],
          topicContent: {
            ...current.topicContent,
            [remoteTopicId]: [{
              id: 'remote-session-block',
              type: 'para',
              content: 'Concurrent destination update retained after switching projects.',
            }],
          },
        })
        return jsonRoute(route, {
          code: 'PROJECT_CONFLICT',
          error: 'Destination changed in another session. Reload the project before copying again.',
        }, 409)
      }

      expect(input.expectedRevision).toBe(current.recordRevision)
      expect(input.insertion).toEqual({ afterTopicId: destinationTopicId })
      const afterIndex = current.appToc.findIndex(
        (topic: Record<string, any>) => topic.topicId === destinationTopicId,
      )
      expect(afterIndex).toBeGreaterThanOrEqual(0)
      const copiedTopic = {
        id: 2,
        topicId: copiedTopicId,
        title: 'Reused source procedure',
        level: 1,
        words: 12,
      }
      const record: CloudRecord = {
        ...current,
        recordRevision: current.recordRevision + 1,
        modifiedAt: Date.now(),
        tocRevision: Number(current.tocRevision ?? 0) + 1,
        contentRevision: Number(current.contentRevision ?? 0) + 1,
        appToc: [
          ...current.appToc.slice(0, afterIndex + 1),
          copiedTopic,
          ...current.appToc.slice(afterIndex + 1),
        ],
        topicContent: {
          ...current.topicContent,
          [copiedTopicId]: [{
            id: 'destination-copy-block',
            type: 'para',
            content: reusedText,
          }],
        },
        contentOrigins: {
          ...current.contentOrigins,
          topic: {
            ...current.contentOrigins.topic,
            [copiedTopicId]: {
              originItemId: catalogItemId,
              originProjectId: cloud.sourceProjectId,
              originVersion: catalogVersion,
            },
          },
        },
      }
      cloud.records.set(cloud.destinationProjectId!, record)
      return jsonRoute(route, {
        projectId: cloud.destinationProjectId,
        recordRevision: record.recordRevision,
        assetType: 'topic',
        asset: {
          id: copiedTopicId,
          topicId: copiedTopicId,
          title: copiedTopic.title,
          alreadyAvailable: false,
        },
      })
    }
    return jsonRoute(route, {
      code: 'INVALID_ACTION',
      error: `Unexpected catalog action: ${String(input.action)}`,
    }, 400)
  })
}

async function seedTwoProjects(page: Page, sourceProjectId: string, destinationProjectId: string) {
  await page.evaluate(async ({ sourceId, destinationId, user, workspace }) => {
    const [auth, mode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/cloudProjectRepository.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: user },
      workspace: { id: workspace, name: 'Synthetic Acceptance Workspace' },
      membership: { userId: user, workspaceId: workspace, role: 'owner' },
    })
    mode.setCloudProjectMode(true)
    const repo = repository.cloudProjectRepository
    await repo.createProject({
      projectId: sourceId,
      projectName: 'Acceptance Source Project',
      appToc: [{
        id: 1, topicId: 'source-procedure', title: 'Source procedure', level: 1, words: 8,
      }],
      topicContent: {
        'source-procedure': [{
          id: 'source-authored-block',
          type: 'para',
          content: 'The source procedure remains owned by its original project.',
        }],
      },
      contentRevision: 1,
    })
    await repo.createProject({
      projectId: destinationId,
      projectName: 'Acceptance Destination Project',
      projectMeta: { targetOnlyMarker: 'destination-context' },
      appToc: [{
        id: 1, topicId: 'destination-procedure', title: 'Destination procedure', level: 1, words: 4,
      }],
      topicContent: {
        'destination-procedure': [{
          id: 'destination-authored-block',
          type: 'para',
          content: 'Destination-only baseline text.',
        }],
      },
      contentRevision: 1,
    })
  }, {
    sourceId: sourceProjectId,
    destinationId: destinationProjectId,
    user: userId,
    workspace: workspaceId,
  })
}

async function openProject(page: Page, projectName: string) {
  await page.getByRole('button', { name: `Open project ${projectName}`, exact: true }).click()
  await expect(page.getByTestId('project-home')).toBeVisible()
}

async function openAuthor(page: Page) {
  await page.getByRole('navigation', { name: /Project (?:navigation|modules)/ })
    .getByRole('button', { name: 'Author', exact: true }).click()
  await expect(page.getByTestId('author-workspace')).toBeVisible()
}

async function selectTopic(page: Page, topicId: string) {
  const topic = page.getByTestId('author-outline').locator(`[data-topic-id="${topicId}"]`)
  await topic.click()
  await expect(topic).toHaveAttribute('aria-current', 'true')
}

async function loadProjectThroughAppRepository(page: Page, projectId: string) {
  return page.evaluate(async id => {
    const { cloudProjectRepository } = await import('/src/cloudProjectRepository.ts' as string)
    return cloudProjectRepository.loadProject(id)
  }, projectId)
}

async function setOutlineMode(page: Page, mode: 'topics' | 'explorer') {
  const shell = page.locator('.author-outline-shell')
  const explorer = shell.getByTestId('content-explorer-panel')
  const alreadyShowingExplorer = await explorer.count() > 0
  if ((mode === 'explorer') === alreadyShowingExplorer) return
  const options = shell.locator('details').first()
  if (await options.getAttribute('open') === null)
    await options.locator('summary').click()
  await options.getByRole('button', {
    name: mode === 'explorer' ? 'Browse existing content' : 'Back to topics',
  }).click()
}

async function openAndSelectSourceCatalogItem(page: Page, sourceProjectId: string) {
  await setOutlineMode(page, 'explorer')
  await page.getByTestId('content-explorer-reuse').click()
  const picker = page.getByRole('dialog', { name: 'Reuse content' })
  await expect(picker).toBeVisible()
  await picker.getByLabel('Filter by source project').selectOption(sourceProjectId)
  const item = picker.getByRole('option', { name: /Source procedure for reuse/ })
  await expect(item).toBeVisible()
  await item.click()
  await expect(picker).toContainText('Previewing exact current version')
  await expect(picker).toContainText(reusedText)
  return picker
}

test('mock-cloud Author explicitly reuses a source catalog topic into a target without project cross-talk', async ({ page }) => {
  const runtimeErrors: string[] = []
  const consoleErrors: BrowserConsoleError[] = []
  const failedResponses: NetworkError[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push({ url: message.location().url, text: message.text() })
    }
  })
  page.on('response', response => {
    if (response.status() >= 400)
      failedResponses.push({ url: response.url(), status: response.status() })
  })

  const sourceProjectId = `acceptance-source-${Date.now()}`
  const destinationProjectId = `acceptance-destination-${Date.now()}`
  const cloud: MockCloud = {
    records: new Map(),
    catalogLists: [],
    catalogCopies: [],
    projectReads: [],
    raceNextCopy: false,
    sourceProjectId,
    destinationProjectId,
    expectedConflictResponse: null,
  }
  await installMockCloud(page, cloud)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await seedTwoProjects(page, sourceProjectId, destinationProjectId)
  const originalSource = structuredClone(cloud.records.get(sourceProjectId))
  expect(originalSource).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  await openProject(page, 'Acceptance Destination Project')
  await openAuthor(page)
  await selectTopic(page, destinationTopicId)

  const targetReadsBeforeCopy = cloud.projectReads.filter(id => id === destinationProjectId).length
  const targetBeforePreview = structuredClone(cloud.records.get(destinationProjectId)!)
  const sourceCopiesBeforePreview = cloud.catalogCopies.length
  let picker = await openAndSelectSourceCatalogItem(page, sourceProjectId)
  expect(cloud.catalogCopies).toHaveLength(sourceCopiesBeforePreview)
  expect(cloud.catalogCopies).toHaveLength(0)
  expect(cloud.records.get(destinationProjectId)).toEqual(targetBeforePreview)
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)
  await picker.getByRole('button', { name: /Copy to this project/ }).click()
  await expect.poll(() => cloud.catalogCopies.length).toBe(sourceCopiesBeforePreview + 1)
  await expect.poll(() =>
    cloud.records.get(destinationProjectId)?.topicContent[copiedTopicId]?.[0]?.content,
  ).toBe(reusedText)

  const copiedRecord = cloud.records.get(destinationProjectId)!
  expect(cloud.catalogCopies[0]).toMatchObject({
    action: 'copy',
    workspaceId,
    sourceItemId: catalogItemId,
    sourceVersion: catalogVersion,
    destinationProjectId,
    insertion: { afterTopicId: destinationTopicId },
  })
  expect(cloud.catalogLists.some(request =>
    request.projectId === sourceProjectId && request.excludeProjectId === destinationProjectId,
  )).toBe(true)
  await expect.poll(() =>
    cloud.projectReads.filter(id => id === destinationProjectId).length,
  ).toBeGreaterThan(targetReadsBeforeCopy)
  expect(copiedRecord.appToc.map((topic: Record<string, any>) => topic.topicId))
    .toEqual([destinationTopicId, copiedTopicId])
  expect(copiedRecord.topicContent[copiedTopicId]).toEqual([{
    id: 'destination-copy-block',
    type: 'para',
    content: reusedText,
  }])
  expect(copiedRecord.contentOrigins.topic[copiedTopicId]).toEqual({
    originItemId: catalogItemId,
    originProjectId: sourceProjectId,
    originVersion: catalogVersion,
  })
  expect(copiedRecord.projectMeta.targetOnlyMarker).toBe('destination-context')
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)
  const appLoadedAfterCopy = await loadProjectThroughAppRepository(page, destinationProjectId)
  expect(appLoadedAfterCopy?.contentOrigins.topic[copiedTopicId]).toEqual({
    originItemId: catalogItemId,
    originProjectId: sourceProjectId,
    originVersion: catalogVersion,
  })

  await picker.getByRole('button', { name: 'Close', exact: true }).click()
  await setOutlineMode(page, 'topics')
  const targetAfterCopy = page.getByTestId('author-outline')
  await expect(targetAfterCopy.locator(`[data-topic-id="${destinationTopicId}"]`))
    .toHaveAttribute('aria-current', 'true')
  await expect(targetAfterCopy.locator(`[data-topic-id="${copiedTopicId}"]`)).toBeVisible()
  await expect(page.getByTestId('author-editor')).toContainText(destinationText)
  await expect(page.getByTestId('author-editor')).not.toContainText(sourceText)
  await selectTopic(page, copiedTopicId)
  await expect(page.getByTestId('author-editor')).toContainText(reusedText)

  // Switch project context in the real app and confirm source and destination
  // authoring state do not bleed into one another.
  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await openProject(page, 'Acceptance Source Project')
  await openAuthor(page)
  await selectTopic(page, 'source-procedure')
  await expect(page.getByTestId('author-editor')).toContainText(sourceText)
  await expect(page.getByTestId('author-editor')).not.toContainText(destinationText)
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)

  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await openProject(page, 'Acceptance Destination Project')
  await openAuthor(page)
  await selectTopic(page, destinationTopicId)
  await expect(page.getByTestId('author-editor')).toContainText(destinationText)
  await expect(page.getByTestId('author-editor')).not.toContainText(sourceText)
  await expect(page.getByTestId('author-outline').locator(`[data-topic-id="${copiedTopicId}"]`))
    .toBeVisible()
  await selectTopic(page, copiedTopicId)
  await expect(page.getByTestId('author-editor')).toContainText(reusedText)

  // Simulate a real concurrent destination revision at the copy CAS boundary.
  // The failed copy must retain the selected preview and stay in the target;
  // switching away and reopening then hydrates that server-side update.
  cloud.raceNextCopy = true
  const recordBeforeConflict = structuredClone(cloud.records.get(destinationProjectId)!)
  const copiesBeforeConflictPreview = cloud.catalogCopies.length
  picker = await openAndSelectSourceCatalogItem(page, sourceProjectId)
  expect(cloud.catalogCopies).toHaveLength(copiesBeforeConflictPreview)
  expect(cloud.records.get(destinationProjectId)).toEqual(recordBeforeConflict)
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)
  await picker.getByRole('button', { name: /Copy to this project/ }).click()
  await expect(picker.getByRole('alert')).toContainText('Destination changed in another session')
  expect(cloud.catalogCopies).toHaveLength(copiesBeforeConflictPreview + 1)
  await expect(page.getByTestId('author-workspace')).toBeVisible()
  await expect(picker).toContainText('Source procedure for reuse')
  expect(cloud.records.get(destinationProjectId)!.recordRevision)
    .toBe(recordBeforeConflict.recordRevision + 1)
  expect(cloud.records.get(destinationProjectId)!.topicContent[copiedTopicId])
    .toEqual(recordBeforeConflict.topicContent[copiedTopicId])
  expect(cloud.records.get(destinationProjectId)!.appToc
    .filter((topic: Record<string, any>) => topic.topicId === copiedTopicId)).toHaveLength(1)
  await expect(page.getByTestId(`content-explorer-item-topic-${remoteTopicId}`))
    .toHaveCount(0)
  await expect(page.getByTestId('author-editor')).toContainText(reusedText)
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)

  await picker.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await openProject(page, 'Acceptance Source Project')
  await openAuthor(page)
  await selectTopic(page, 'source-procedure')
  await expect(page.getByTestId('author-editor')).toContainText(sourceText)
  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await openProject(page, 'Acceptance Destination Project')
  await openAuthor(page)
  await selectTopic(page, destinationTopicId)
  await expect(page.getByTestId('author-outline').locator(`[data-topic-id="${remoteTopicId}"]`))
    .toBeVisible()
  await expect(page.getByTestId('author-outline').locator(`[data-topic-id="${copiedTopicId}"]`))
    .toBeVisible()
  await selectTopic(page, copiedTopicId)
  await expect(page.getByTestId('author-editor')).toContainText(reusedText)
  const reloadedProjectFromApp = await loadProjectThroughAppRepository(page, destinationProjectId)
  expect(reloadedProjectFromApp?.contentOrigins.topic[copiedTopicId]).toEqual({
    originItemId: catalogItemId,
    originProjectId: sourceProjectId,
    originVersion: catalogVersion,
  })
  expect(cloud.records.get(destinationProjectId)!.topicContent[copiedTopicId])
    .toEqual(recordBeforeConflict.topicContent[copiedTopicId])
  expect(cloud.records.get(sourceProjectId)).toEqual(originalSource)

  // A hard reload starts the saved cloud project on Sources; reopening Author
  // verifies the copied text and origin survive the app's normal hydration path.
  await page.reload()
  await expect(page.locator('header').getByText('Acceptance Destination Project', { exact: true }))
    .toBeVisible()
  await openAuthor(page)
  await selectTopic(page, copiedTopicId)
  await expect(page.getByTestId('author-editor')).toContainText(reusedText)
  const appLoadedAfterReload = await loadProjectThroughAppRepository(page, destinationProjectId)
  expect(appLoadedAfterReload?.contentOrigins.topic[copiedTopicId]).toEqual({
    originItemId: catalogItemId,
    originProjectId: sourceProjectId,
    originVersion: catalogVersion,
  })

  expect(runtimeErrors, `Unexpected page errors: ${runtimeErrors.join('\n')}`).toEqual([])
  expect(cloud.expectedConflictResponse).toMatchObject({ status: 409 })
  expect(failedResponses).toEqual([cloud.expectedConflictResponse])
  // Chromium's resource error for the deliberate conflict is expected only for
  // the exact catalog URL and status recorded by the mocked copy response.
  const expectedConflictUrl = cloud.expectedConflictResponse!.url
  const expectedConsoleErrors = consoleErrors.filter(error =>
    error.url === expectedConflictUrl
      && error.text === 'Failed to load resource: the server responded with a status of 409 (Conflict)',
  )
  const unexpectedConsoleErrors = consoleErrors.filter(error =>
    !expectedConsoleErrors.includes(error),
  )
  expect(unexpectedConsoleErrors, `Unexpected browser console errors: ${JSON.stringify(unexpectedConsoleErrors)}`)
    .toEqual([])
})