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
  await page.locator('header').getByRole('button', { name: /Theme/ }).click()
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
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Analyze Sources' })).toBeVisible()

  expect(cloud.saves).toHaveLength(0)
  releaseSave()
  await expect.poll(() => {
    const pages = cloud.saves.at(-1)?.htmlMasterPages as Array<{ contentWidth: number }> | undefined
    return pages?.[0]?.contentWidth
  }).toBe(1500)
  await expect(page.locator('header').getByText('✓ Saved', { exact: true })).toBeVisible()
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
  await expect(page.locator('header').getByText('✓ Saved', { exact: true })).toBeVisible()
  const successfulSaves = cloud.saves.length

  cloud.conflictNextSave = true
  width = await openMasterPageSettings(page)
  await width.fill('1400')
  await expect(page.getByRole('button', { name: /Save failed — Retry/ })).toBeVisible()
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