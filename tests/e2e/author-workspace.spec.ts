import { expect, test, type Page } from '@playwright/test'
import { createManualAuthorTopicMetadata, stableAuthorTopicId } from '../../src/authorMetadata'
import { createEmptyReviewModel } from '../../src/reviewModel'

type StoredTopic = Record<string, any> & {
  id: number
  topicId?: string
  title: string
}

type StoredProject = Record<string, any> & {
  projectId: string
  projectName: string
  appToc: StoredTopic[]
}

type CloudRecord = Record<string, unknown> & {
  projectId: string
  recordRevision: number
}

type CloudMock = {
  records: Map<string, CloudRecord>
  saves: CloudRecord[]
  holdNextSave: (() => Promise<void>) | null
}

async function mockSignedInCloud(page: Page): Promise<CloudMock> {
  const session = {
    authenticated: true,
    mode: 'supabase',
    userId: 'author-workspace-test-user',
    activeWorkspaceId: 'author-workspace-test-workspace',
    activeRole: 'owner',
    activeOrganizationName: 'Author Workspace Test',
    activeWorkspaceName: 'Author Workspace Test',
  }
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(session),
  }))
  await page.route('**/api/auth/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(session),
  }))

  const cloud: CloudMock = { records: new Map(), saves: [], holdNextSave: null }
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    const action = input.action
    if (action === 'ready') return route.fulfill({ json: { ready: true } })
    if (action === 'list') return route.fulfill({ json: { projects: [...cloud.records.values()] } })
    if (action === 'create') {
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId: String(input.projectId),
        ownerUserId: session.userId,
        workspaceId: session.activeWorkspaceId,
        recordRevision: 0,
      } as CloudRecord
      cloud.records.set(record.projectId, record)
      return route.fulfill({ json: { record } })
    }
    if (action === 'save') {
      if (cloud.holdNextSave) {
        const hold = cloud.holdNextSave
        cloud.holdNextSave = null
        await hold()
      }
      const projectId = String(input.projectId)
      const current = cloud.records.get(projectId)
      if (!current || current.recordRevision !== input.expectedRevision) {
        return route.fulfill({
          status: 409,
          json: { code: 'PROJECT_CONFLICT', error: 'Project changed elsewhere.' },
        })
      }
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId,
        ownerUserId: session.userId,
        workspaceId: session.activeWorkspaceId,
        recordRevision: Number(input.expectedRevision) + 1,
      } as CloudRecord
      cloud.saves.push(record)
      cloud.records.set(projectId, record)
      return route.fulfill({ json: { record } })
    }
    if (action === 'read' || action === 'backup') {
      const record = cloud.records.get(String(input.projectId))
      return record
        ? route.fulfill({ json: { record } })
        : route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' } })
    }
    if (action === 'load-files') return route.fulfill({ json: { files: [] } })
    return route.fulfill({
      status: 400,
      json: { code: 'UNEXPECTED_ACTION', error: `Unexpected cloud action: ${String(action)}` },
    })
  })
  return cloud
}

async function createProject(page: Page, projectName: string) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
}

async function addRealSource(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'workspace-operations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Workspace Operations\n\n## Access Reviews\n\nAdministrators review privileged access every quarter.\n\n'
        + '## Recovery\n\nOperators restore service from the verified recovery archive.\n',
    ),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
}

async function prepareAuthor(page: Page, projectName: string) {
  await createProject(page, projectName)
  await addRealSource(page)
  await page.getByTestId('analyze-sources').click()
  await expect(page.getByTestId('concept-analysis-freshness')).toHaveText('Current')
  await page.getByTestId('analysis-generate-toc').click()
  await expect(page.getByTestId('toc-proposal-review')).toBeVisible()
  await page.getByTestId('commit-toc-proposal').click()
  const project = await readProject(page, projectName)
  const evidenceIndex = project.evidenceIndex
  const accessEvidence = evidenceIndex?.items.find((item: { text: string }) =>
    item.text.includes('Administrators review privileged access every quarter'))
  const recoveryEvidence = evidenceIndex?.items.find((item: { text: string }) =>
    item.text.includes('Operators restore service from the verified recovery archive'))
  if (!accessEvidence || !recoveryEvidence) throw new Error('Expected source-derived evidence for both Author topics')
  await patchProject(page, projectName, {
    appToc: [
      {
        id: 1,
        topicId: 'topic-access-reviews',
        title: 'Access Reviews',
        level: 1,
        words: 0,
        supportingEvidenceIds: [accessEvidence.id],
        sourceSectionPaths: [accessEvidence.sectionPath],
        proposalKind: 'evidence-backed',
      },
      {
        id: 2,
        topicId: 'topic-recovery',
        title: 'Recovery',
        level: 1,
        words: 0,
        supportingEvidenceIds: [recoveryEvidence.id],
        sourceSectionPaths: [recoveryEvidence.sectionPath],
        proposalKind: 'evidence-backed',
      },
    ],
    tocRevision: (project.tocRevision ?? 0) + 1,
    topicContent: {
      'topic-access-reviews': [
        { id: 'author-access-heading', type: 'h1', content: 'Access Reviews' },
        { id: 'author-access-body', type: 'para', content: accessEvidence.text },
      ],
      'topic-recovery': [
        { id: 'author-recovery-heading', type: 'h1', content: 'Recovery' },
        { id: 'author-recovery-body', type: 'para', content: recoveryEvidence.text },
      ],
    },
  })
  await page.reload()
  await authorStep(page).click()
  await expect(page.getByTestId('author-workspace')).toBeVisible()
  await selectAuthorTopic(page, 'topic-access-reviews', 'Access Reviews')
}

async function readProject(page: Page, projectName: string): Promise<StoredProject> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll()
      request.onsuccess = () => resolve(request.result as StoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    return project
  }, projectName)
}

async function patchProject(page: Page, projectName: string, patch: Record<string, unknown>) {
  await page.evaluate(async ({ name, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const projects = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result as StoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ ...project, ...values })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { name: projectName, values: patch })
}

function authorStep(page: Page) {
  return page.locator('header').getByRole('button', { name: /^Author,/ })
}

function authorTopicRow(page: Page, topicId: string) {
  return page.getByTestId('author-outline').locator(`[data-topic-id="${topicId}"]`)
}

async function selectAuthorTopic(page: Page, topicId: string, title: string) {
  await authorTopicRow(page, topicId).getByText(title, { exact: true }).click()
}

async function topicTitle(row: ReturnType<Page['getByTestId']>) {
  const title = await row.getAttribute('title')
  if (!title) throw new Error('Author topic row has no accessible title')
  return title.split(' — ')[0]
}

test('desktop Author workspace presents the outline, editor, and source context with keyboard topic selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const projectName = `Author workspace desktop ${Date.now()}`
  await prepareAuthor(page, projectName)

  const outline = page.getByTestId('author-outline')
  const editor = page.getByTestId('author-editor')
  const context = page.getByTestId('author-context')
  await expect(outline).toBeVisible()
  await expect(editor).toBeVisible()
  await expect(context).toBeVisible()

  const [outlineBox, editorBox, contextBox] = await Promise.all([
    outline.boundingBox(),
    editor.boundingBox(),
    context.boundingBox(),
  ])
  expect(outlineBox).not.toBeNull()
  expect(editorBox).not.toBeNull()
  expect(contextBox).not.toBeNull()
  expect(outlineBox!.x + outlineBox!.width).toBeLessThanOrEqual(editorBox!.x + 2)
  expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(contextBox!.x + 2)

  const topicRows = outline.locator('[data-topic-id]')
  await expect.poll(() => topicRows.count()).toBeGreaterThanOrEqual(2)
  const firstTopic = topicRows.nth(0)
  const secondTopic = topicRows.nth(1)
  const secondTitle = await topicTitle(secondTopic)
  await secondTopic.getByText(secondTitle, { exact: true }).click()
  await expect(editor).toContainText(secondTitle)
  await expect(secondTopic).toHaveClass(/ring-1/)
  await expect(firstTopic).not.toHaveClass(/ring-1/)

  await firstTopic.focus()
  await page.keyboard.press('Enter')
  await expect(editor).toContainText(await topicTitle(firstTopic))
  await expect(firstTopic).toHaveClass(/ring-1/)

  const accessTopic = topicRows.filter({ hasText: 'Access Reviews' }).first()
  await accessTopic.getByText('Access Reviews', { exact: true }).click()
  await page.getByTestId('author-context-tab-evidence').click()
  await expect(context).toContainText('Administrators review privileged access every quarter')
  await page.getByTestId('author-context-tab-sources').click()
  await expect(context).toContainText('workspace-operations.md')
  await page.getByTestId('author-context-tab-review').click()
  await expect(page.getByTestId('author-review-finding')).toHaveCount(0)
  await page.getByTestId('author-context-tab-assist').click()
})

test('medium and narrow viewports collapse Author panels into explicitly opened drawers', async ({ page }) => {
  const projectName = `Author workspace responsive ${Date.now()}`
  await prepareAuthor(page, projectName)

  for (const viewport of [{ width: 1024, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByTestId('author-open-outline')).toBeVisible()
    await expect(page.getByTestId('author-open-context')).toBeVisible()
    await page.getByTestId('author-open-outline').click()
    await expect(page.getByTestId('author-outline')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('author-outline')).not.toBeVisible()
    await page.getByTestId('author-open-context').click()
    await expect(page.getByTestId('author-context')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width + 1)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('author-context')).toHaveCount(0)
  }
})

test('Review finding opens its exact Author topic and preserves manual and approved topic content', async ({ page }) => {
  test.setTimeout(90_000)
  const projectName = `Author workspace review handoff ${Date.now()}`
  await prepareAuthor(page, projectName)

  const initial = await readProject(page, projectName)
  const targetTopic = initial.appToc.find(topic => topic.topicId === 'topic-recovery')
  const otherTopic = initial.appToc.find(topic => topic.topicId === 'topic-access-reviews')
  if (!targetTopic || !otherTopic) throw new Error('Expected seeded source-backed Author topics')
  const targetTopicId = stableAuthorTopicId(targetTopic)
  const otherTopicId = stableAuthorTopicId(otherTopic)
  const claim = 'The workspace always recovers in five minutes.'
  const approvedText = 'Administrators review privileged access every quarter.'
  const metadata = createManualAuthorTopicMetadata(targetTopicId, {
    contentType: 'user-guide',
    variables: [],
  }, false)
  await patchProject(page, projectName, {
    topicContent: {
      [targetTopicId]: [{ id: 'author-workspace-claim', type: 'para', content: claim }],
      [otherTopicId]: [{ id: 'approved-manual-content', type: 'para', content: approvedText }],
    },
    authorTopicMetadata: {
      [targetTopicId]: metadata,
    },
    contentRevision: (initial.contentRevision ?? 0) + 1,
    analysisRevision: initial.evidenceIndex?.sourcesRevision ?? initial.analysisRevision,
    unsupportedAnalysis: null,
    reviewModel: createEmptyReviewModel(initial.projectId),
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Analysis/ }).click()
  await page.getByRole('button', { name: /Recheck Content|Check Content/ }).click()
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return project.unsupportedAnalysis?.findings?.length ?? 0
  }).toBeGreaterThan(0)
  const reviewSnapshot = (await readProject(page, projectName)).reviewModel?.inputSnapshot
  if (reviewSnapshot?.readiness !== 'ready') {
    throw new Error(`Review snapshot was not ready: ${JSON.stringify({
      readiness: reviewSnapshot?.readiness,
      issues: reviewSnapshot?.issues,
      provenance: reviewSnapshot?.provenance,
      unsupported: (await readProject(page, projectName)).unsupportedAnalysis,
    })}`)
  }

  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await expect(page.getByTestId('run-grounded-review')).toBeEnabled()
  await page.getByTestId('run-grounded-review').click()
  const unsupportedFinding = page.getByTestId('grounded-review-finding').filter({ hasText: 'Unsupported Claim' })
  await expect(unsupportedFinding).toBeVisible()
  await unsupportedFinding.getByTestId('review-open-in-author').click()
  await expect(page.getByTestId('real-review-author-context')).toHaveAttribute('data-focus-status', 'focused')
  await expect(page.getByTestId('author-workspace')).toBeVisible()
  await expect(page.getByTestId('author-editor')).toContainText(claim)
  await page.getByTestId('author-context-tab-review').click()
  await expect(page.getByTestId('author-review-finding').filter({ hasText: claim })).toBeVisible()
  await page.getByTestId('real-review-author-context').getByRole('button', { name: /Back to Review/ }).click()
  await expect(page.getByTestId('real-review-findings')).toBeVisible()

  const approvedMetadata = createManualAuthorTopicMetadata(otherTopicId, {
    contentType: 'user-guide',
    variables: [],
  }, false)
  await patchProject(page, projectName, {
    authorTopicMetadata: {
      ...((await readProject(page, projectName)).authorTopicMetadata ?? {}),
      [otherTopicId]: {
        ...approvedMetadata,
        generationStatus: 'generated',
        contentOrigin: 'approved',
        approved: true,
      },
    },
  })
  await page.reload()
  await authorStep(page).click()
  const outline = page.getByTestId('author-outline')
  const approvedRow = outline.locator(`[data-topic-id="${otherTopicId}"]`)
  await approvedRow.getByText('Access Reviews', { exact: true }).click()
  await expect(page.getByTestId('author-editor')).toContainText(approvedText)
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return project.topicContent[otherTopicId]
  }).toEqual([expect.objectContaining({ content: approvedText })])
  await outline.locator(`[data-topic-id="${targetTopicId}"]`)
    .getByText('Recovery', { exact: true }).click()
  await expect(page.getByTestId('author-editor')).toContainText(claim)
  await approvedRow.getByText('Access Reviews', { exact: true }).click()
  await expect(page.getByTestId('author-editor')).toContainText(approvedText)
  expect((await readProject(page, projectName)).authorTopicMetadata[otherTopicId])
    .toMatchObject({ approved: true, contentOrigin: 'approved' })
})

test('Author topic navigation remains available while its cloud save is outstanding', async ({ page }) => {
  const projectName = `Author workspace cloud save ${Date.now()}`
  await prepareAuthor(page, projectName)
  const seededProject = await readProject(page, projectName)
  const cloud = await mockSignedInCloud(page)
  cloud.records.set(seededProject.projectId, {
    ...seededProject,
    ownerUserId: 'author-workspace-test-user',
    workspaceId: 'author-workspace-test-workspace',
    recordRevision: 0,
  })
  await page.reload()
  const workspace = page.getByTestId('author-workspace')
  if (!(await workspace.isVisible().catch(() => false))) {
    await expect(page.getByText(projectName, { exact: true }).last()).toBeVisible()
    await page.getByText(projectName, { exact: true }).last().click()
    if (!(await workspace.isVisible().catch(() => false))) await authorStep(page).click()
  }
  await expect(workspace).toBeVisible()
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  const rows = page.getByTestId('author-outline').locator('[data-topic-id]')
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2)
  const previousSaveCount = cloud.saves.length

  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { signalSaveStarted = resolve })
  cloud.holdNextSave = () => {
    signalSaveStarted()
    return saveGate
  }
  const initialRow = rows.nth(0)
  await initialRow.focus()
  await page.keyboard.press('Enter')
  await expect(initialRow).toHaveClass(/ring-1/)
  const editor = page.getByTestId('author-editor')
  const activeTopicId = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-testid="author-topic-row"][class*="ring-1"]')
      ?.getAttribute('data-topic-id') ?? null,
  )
  if (!activeTopicId) throw new Error('Expected an active topic before editing')
  const activeRow = authorTopicRow(page, activeTopicId)
  const alternateTopicId = await rows.evaluateAll((elements, selectedId) =>
    elements.find(element => element.getAttribute('data-topic-id') !== selectedId)
      ?.getAttribute('data-topic-id') ?? null,
  activeTopicId)
  if (!alternateTopicId) throw new Error('Expected another topic for navigation during save')
  const alternateRow = authorTopicRow(page, alternateTopicId)
  const editable = page.locator('[data-author-block-id] [contenteditable="true"]').first()
  await expect(editable).toBeVisible()
  await editable.fill('A manually edited author paragraph remains intact.')
  await saveStarted

  const otherTitle = await topicTitle(alternateRow)
  await alternateRow.focus()
  await page.keyboard.press('Enter')
  await expect(editor).toContainText(otherTitle)
  expect(cloud.saves).toHaveLength(previousSaveCount)
  releaseSave()
  await expect.poll(() => cloud.saves.length).toBeGreaterThan(previousSaveCount)
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  await expect.poll(() => {
    const saved = cloud.records.get(seededProject.projectId)
    return JSON.stringify(saved?.topicContent).includes('A manually edited author paragraph remains intact.')
  }).toBe(true)
  await activeRow.focus()
  await page.keyboard.press('Enter')
  await expect(editor).toContainText('A manually edited author paragraph remains intact.')
})