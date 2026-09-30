import { expect, test, type Page } from '@playwright/test'

type CloudRecord = Record<string, unknown> & {
  projectId: string
  recordRevision: number
}

type CloudMock = {
  records: Map<string, CloudRecord>
  saves: CloudRecord[]
  conflictNextSave: boolean
  holdNextSave: (() => Promise<void>) | null
}

async function mockSignedInCloud(page: Page): Promise<CloudMock> {
  const session = {
    authenticated: true,
    mode: 'supabase',
    userId: 'save-test-user',
    activeWorkspaceId: 'save-test-workspace',
    activeRole: 'owner',
    activeOrganizationName: 'Save Test Org',
    activeWorkspaceName: 'Save Test Workspace',
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

  const cloud: CloudMock = {
    records: new Map(),
    saves: [],
    conflictNextSave: false,
    holdNextSave: null,
  }
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    const action = input.action

    if (action === 'ready') return route.fulfill({ json: { ready: true } })
    if (action === 'list') return route.fulfill({ json: { projects: [...cloud.records.values()] } })
    if (action === 'create') {
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId: String(input.projectId),
        ownerUserId: 'save-test-user',
        workspaceId: 'save-test-workspace',
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
      if (cloud.conflictNextSave) {
        cloud.conflictNextSave = false
        return route.fulfill({
          status: 409,
          json: { code: 'PROJECT_CONFLICT', error: 'Project changed elsewhere.' },
        })
      }
      if (!current || current.recordRevision !== input.expectedRevision) {
        return route.fulfill({
          status: 409,
          json: { code: 'PROJECT_CONFLICT', error: 'Project changed elsewhere.' },
        })
      }
      const record = {
        ...(input.record as Record<string, unknown>),
        projectId,
        ownerUserId: 'save-test-user',
        workspaceId: 'save-test-workspace',
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

async function createProject(page: Page, name: string) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(name)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect(page.getByRole('heading', { name: 'Theme & Style Profiles' })).toBeVisible()
}

async function openMasterPageSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('button', { name: /^Brand & Output/ }).click()
  await page.getByRole('button', { name: 'Output Templates' }).click()
  await page.getByRole('button', { name: 'HTML Master Pages', exact: true }).click()
  return page.getByText('Content Width (px)', { exact: true }).locator('..').locator('input')
}

test('ordinary section navigation stays responsive and quick edits coalesce during a delayed cloud save', async ({ page }) => {
  const cloud = await mockSignedInCloud(page)
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { signalSaveStarted = resolve })
  cloud.holdNextSave = () => {
    signalSaveStarted()
    return saveGate
  }

  await createProject(page, `Responsive save ${Date.now()}`)
  const width = await openMasterPageSettings(page)
  await width.fill('1300')
  await width.fill('1400')
  await width.fill('1500')
  await saveStarted

  // A cloud request is still outstanding, but changing workflow sections is local and immediate.
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('button', { name: 'Sources' }).click()
  await expect(page.getByRole('button', { name: 'Analyze Sources' })).toBeVisible()

  expect(cloud.saves).toHaveLength(0)
  releaseSave()
  await expect.poll(() => {
    const pages = cloud.saves.at(-1)?.htmlMasterPages as Array<{ contentWidth: number }> | undefined
    return pages?.[0]?.contentWidth
  }).toBe(1500)
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  expect(cloud.saves.length).toBeLessThanOrEqual(2)
  expect(cloud.saves.at(-1)?.htmlMasterPages).toEqual(
    expect.arrayContaining([expect.objectContaining({ contentWidth: 1500 })]),
  )
})

test('a stale-write conflict is visible and reload restores the last successful cloud save', async ({ page }) => {
  test.setTimeout(60_000)
  const cloud = await mockSignedInCloud(page)
  const projectName = `Conflict persistence ${Date.now()}`
  await createProject(page, projectName)

  let width = await openMasterPageSettings(page)
  await width.fill('1300')
  await expect.poll(() => {
    const pages = [...cloud.records.values()][0]?.htmlMasterPages as Array<{ contentWidth: number }> | undefined
    return pages?.[0]?.contentWidth
  }).toBe(1300)
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  const successfulSaves = cloud.saves.length

  cloud.conflictNextSave = true
  width = await openMasterPageSettings(page)
  await width.fill('1400')
  await expect(page.getByRole('button', { name: /Save failed\. Retry saving\./ })).toBeVisible()
  expect(cloud.saves).toHaveLength(successfulSaves)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Analyze Sources' })).toBeVisible()
  width = await openMasterPageSettings(page)
  await expect(width).toHaveValue('1300')
  expect([...cloud.records.values()][0].htmlMasterPages).toEqual(
    expect.arrayContaining([expect.objectContaining({ contentWidth: 1300 })]),
  )
})

test('opening a cloud project uses the latest revision without saving hydrated defaults', async ({ page }) => {
  const cloud = await mockSignedInCloud(page)
  const name = `Concurrent open ${Date.now()}`
  await createProject(page, name)
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  const current = [...cloud.records.values()][0]
  const topicId = 'cloud-open-task'
  const stale = {
    ...current,
    activeStyleProfileId: 'removed-style-profile',
    authorTopicMetadata: {},
    appToc: [{ id: 1, topicId, title: 'Review cases', level: 1, words: 0 }],
    topicContent: {
      [topicId]: [{ id: 'cloud-open-block', type: 'para', content: 'Users can open cases to review their details.' }],
    },
    projectMeta: {
      ...(current.projectMeta as Record<string, unknown>),
      styleProfileId: 'removed-style-profile',
    },
  }
  delete stale.reviewModel
  const latestName = `${name} updated elsewhere`
  const latest = { ...stale, projectName: latestName, recordRevision: stale.recordRevision + 1 }
  cloud.records.set(current.projectId, stale)
  const savesBeforeOpen = cloud.saves.length
  let reads = 0
  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action !== 'read' || input.projectId !== current.projectId) return route.fallback()
    reads++
    if (reads !== 1) return route.fallback()
    cloud.records.set(current.projectId, latest)
    return route.fulfill({ json: { record: stale } })
  })

  const row = page.locator('main div.group').filter({ has: page.getByText(name, { exact: true }) })
  await row.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('project-home')).toContainText(latestName)
  await expect(page.getByTestId('project-open-error')).toHaveCount(0)
  expect(reads).toBe(2)
  await page.waitForTimeout(900) // Open must not schedule a deferred autosave either.
  expect(cloud.saves).toHaveLength(savesBeforeOpen)
  expect(cloud.records.get(current.projectId)).toEqual(latest)

  // The reconciled state remains in memory and can be saved on a later user edit.
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('button', { name: 'Project Settings' }).click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(`${latestName} edited`)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => cloud.saves.length).toBe(savesBeforeOpen + 1)
  expect(cloud.saves.at(-1)).toMatchObject({
    recordRevision: latest.recordRevision + 1,
    projectName: `${latestName} edited`,
    reviewModel: expect.objectContaining({ projectId: current.projectId }),
  })
  expect(cloud.saves.at(-1)?.activeStyleProfileId).not.toBe('removed-style-profile')
  expect((cloud.saves.at(-1)?.authorTopicMetadata as Record<string, unknown>)[topicId]).toBeDefined()

  await page.locator('header').getByRole('button', { name: 'Content Studio home' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByText(`${latestName} edited`, { exact: true })).toBeVisible()

  await page.route('**/api/cloud-projects', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    if (input.action !== 'read' || input.projectId !== current.projectId) return route.fallback()
    return route.fulfill({
      status: 404,
      json: { code: 'PROJECT_NOT_FOUND', error: 'Not found.' },
    })
  })
  const updatedRow = page.locator('main div.group')
    .filter({ has: page.getByText(`${latestName} edited`, { exact: true }) })
  await updatedRow.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('project-open-error'))
    .toContainText('Project no longer exists or is not accessible.')
  await expect(updatedRow.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
})