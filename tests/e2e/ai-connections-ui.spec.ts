import { expect, test, type Page } from '@playwright/test'

const workspaceId = 'ui-connection-workspace'
async function enter(page: Page, role: 'owner' | 'admin' | 'editor' | 'viewer') {
  await page.evaluate(async ({ workspaceId, role }) => {
    const [auth, projects] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'connection-ui-user' },
      workspace: { id: workspaceId, name: 'UI workspace' },
      membership: { userId: 'connection-ui-user', workspaceId, role },
    })
    projects.setCloudProjectMode(true)
  }, { workspaceId, role })
  await page.getByTestId('topbar-administration').click()
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible()
}
function metadata(providerId: string, revision: number, state: string) {
  return { workspaceId, providerId, revision, state, testedAt: state === 'untested' ? null : '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z', updatedBy: 'connection-ui-user' }
}

test('cloud Connections manage lifecycle without ever rendering credentials or assuming verified status', async ({ page }) => {
  let current: ReturnType<typeof metadata> | null = null
  const actions: Record<string, unknown>[] = []
  await page.route('**/api/ai-connections', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    actions.push(input)
    if (input.action === 'list') return route.fulfill({ json: { connections: current ? [current] : [] } })
    if (input.action === 'delete') {
      current = null
      return route.fulfill({ json: { deleted: true, providerId: input.providerId, revision: input.expectedRevision } })
    }
    current = metadata(String(input.providerId), input.action === 'create' ? 1 : input.action === 'replace' ? 2 : 1,
      input.action === 'test' ? 'unavailable' : 'untested')
    return route.fulfill({ json: { connection: current } })
  })
  await page.goto('/')
  await enter(page, 'owner')
  await expect(page.getByText('No connection record', { exact: false })).toBeVisible()
  await page.getByLabel('Provider ID').fill('neutral-test')
  await page.getByLabel('Credential').fill('browser-fixture-secret')
  await page.getByRole('button', { name: 'Save connection' }).click()
  await expect(page.getByText('Configured · untested')).toBeVisible()
  await expect(page.getByLabel('Credential')).toHaveValue('')
  await expect(page.getByTestId('ai-control-center')).not.toContainText('browser-fixture-secret')
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('Test unavailable', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Replace credential' }).click()
  await page.getByLabel('Credential').fill('replacement-fixture-secret')
  await page.getByRole('button', { name: 'Save replacement' }).click()
  await expect(page.getByText('Configured · untested', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('revision 2', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByText('Revoke the key separately at the provider', { exact: false })).toBeVisible()
  expect(actions.filter(item => item.action !== 'list').map(item => item.action))
    .toEqual(['create', 'test', 'replace', 'delete'])
  expect(actions.find(item => item.action === 'test')).toEqual({ action: 'test', workspaceId, providerId: 'neutral-test', expectedRevision: 1 })
  expect(actions.find(item => item.action === 'delete')).toEqual({ action: 'delete', workspaceId, providerId: 'neutral-test', expectedRevision: 2 })
})

test('cloud editor and viewer only see safe metadata; a failed load is not an empty list', async ({ page }) => {
  let fail = false
  await page.route('**/api/ai-connections', route => route.fulfill(fail
    ? { status: 503, json: { code: 'SCHEMA_UNAVAILABLE', error: 'not installed' } }
    : { json: { connections: [metadata('neutral-test', 1, 'untested')] } }))
  await page.goto('/')
  await enter(page, 'editor')
  await expect(page.getByText('Configured · untested', { exact: false }).first()).toBeVisible()
  for (const name of ['Save connection', 'Test connection', 'Replace credential', 'Delete']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(page.getByLabel('Credential')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await enter(page, 'viewer')
  await expect(page.getByText('Read-only access.', { exact: false })).toBeVisible()
  fail = true
  await page.getByRole('button', { name: 'Refresh connections' }).click()
  await expect(page.getByRole('alert')).toContainText('Connections could not be loaded')
  await expect(page.getByText('No connection record', { exact: false })).toHaveCount(0)
})