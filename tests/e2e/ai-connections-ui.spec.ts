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
  for (const name of ['Save connection', 'Test connection', 'Discover models', 'Replace credential', 'Delete']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(page.getByLabel('Credential')).toHaveCount(0)
  await page.getByRole('button', { name: 'Return to Projects' }).click()
  await enter(page, 'viewer')
  await expect(page.getByText('Read-only access.', { exact: false })).toBeVisible()
  fail = true
  await page.getByRole('button', { name: 'Refresh connections' }).click()
  await expect(page.getByText('Connections could not be loaded', { exact: false })).toBeVisible()
  await expect(page.getByText('No connection record', { exact: false })).toHaveCount(0)
})

test('owners discover ephemeral models, see loading and safe states, without rendering credentials', async ({ page }) => {
  const requests: Record<string, unknown>[] = []
  let state: 'available' | 'unsupported' | 'unavailable' = 'available'
  let release: (() => void) | undefined
  let signalStarted: (() => void) | undefined
  const started = new Promise<void>(resolve => { signalStarted = resolve })
  let hold = true
  await page.route('**/api/ai-connections', async route => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    requests.push(input)
    if (input.action === 'list') return route.fulfill({ json: { connections: [metadata('openai', 1, 'untested')] } })
    if (input.action === 'discover') {
      if (hold) await new Promise<void>(resolve => { release = resolve; signalStarted?.() })
      return route.fulfill({ json: { providerId: 'openai', revision: 1, discovery: state === 'available'
        ? { state, models: [{ providerId: 'openai', id: 'gpt-4.1', label: 'GPT 4.1' }], discoveredAt: '2026-09-26T12:00:00.000Z' }
        : { state, models: [], discoveredAt: null } } })
    }
    return route.abort()
  })
  await page.goto('/')
  await enter(page, 'owner')
  await page.getByRole('button', { name: 'Discover models' }).click()
  await started
  await expect(page.getByText('Discovering models for openai…')).toBeVisible()
  release?.()
  await expect(page.getByText('1 model discovered', { exact: false })).toBeVisible()
  await expect(page.getByText('GPT 4.1')).toBeVisible()
  await expect(page.getByText('(gpt-4.1)')).toBeVisible()
  expect(requests.find(request => request.action === 'discover')).toEqual({
    action: 'discover', workspaceId, providerId: 'openai', expectedRevision: 1,
  })
  await expect(page.getByTestId('ai-control-center')).not.toContainText('fixture-private-key')
  hold = false
  state = 'unsupported'
  await page.getByRole('button', { name: 'Discover models' }).click()
  await expect(page.getByText('Built-in discovery is not configured for this provider.')).toBeVisible()
  await expect(page.getByText('GPT 4.1')).toHaveCount(0)
  state = 'unavailable'
  await page.getByRole('button', { name: 'Discover models' }).click()
  await expect(page.getByText('Models could not be retrieved. No credential was exposed.')).toBeVisible()
})

test('browser rejects unsafe, foreign, duplicate and malformed discovery responses', async ({ page }) => {
  let response: unknown = null
  await page.route('**/api/ai-connections', route => {
    const input = route.request().postDataJSON() as { action: string }
    return route.fulfill({ json: input.action === 'list'
      ? { connections: [metadata('openai', 1, 'untested')] } : response })
  })
  await page.goto('/')
  await enter(page, 'admin')
  const valid = { providerId: 'openai', revision: 1, discovery: { state: 'available',
    discoveredAt: '2026-09-26T12:00:00.000Z',
    models: [{ providerId: 'openai', id: 'gpt-4.1', label: 'GPT 4.1' }] } }
  const invalid = [
    { ...valid, credential: 'fixture-private-key' },
    { ...valid, providerId: 'anthropic' },
    { ...valid, revision: 2 },
    { ...valid, discovery: { ...valid.discovery, discoveredAt: 'invalid' } },
    { ...valid, discovery: { ...valid.discovery, discoveredAt: '2026-09-26' } },
    { ...valid, discovery: { ...valid.discovery, models: [
      { providerId: 'anthropic', id: 'gpt-4.1', label: 'Foreign' }] } },
    { ...valid, discovery: { ...valid.discovery, models: [
      valid.discovery.models[0], valid.discovery.models[0] ] } },
    { ...valid, discovery: { ...valid.discovery, models: [
      { ...valid.discovery.models[0], rawResponse: 'fixture-private-key' }] } },
  ]
  for (const item of invalid) {
    response = item
    const result = await page.evaluate(async () => {
      const { discoverModels } = await import('/src/aiConnectionRepository.ts' as string)
      return discoverModels('openai', 1).then(() => 'accepted', (error: { code: string }) => error.code)
    })
    expect(result).toBe('INVALID_RESPONSE')
  }
  response = valid
  expect(await page.evaluate(async () => {
    const { discoverModels } = await import('/src/aiConnectionRepository.ts' as string)
    return discoverModels('openai', 1)
  })).toEqual(valid)
})