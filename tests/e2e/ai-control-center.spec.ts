import { expect, test, type Page } from '@playwright/test'

async function setLocalSession(page: Page, role: 'owner' | 'admin' | 'editor' | 'viewer', workspaceId: string) {
  await page.evaluate(async ({ role, workspaceId }) => {
    const [session, projectMode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    session.setCloudAuthSession({
      user: { id: 'ai-ui-user' },
      workspace: { id: workspaceId, name: 'AI UI workspace' },
      membership: { userId: 'ai-ui-user', workspaceId, role },
    })
    projectMode.setCloudProjectMode(false)
  }, { role, workspaceId })
}

async function openAdministration(page: Page, role: 'owner' | 'admin' | 'editor' | 'viewer', workspaceId = 'ai-ui-workspace') {
  await setLocalSession(page, role, workspaceId)
  await page.getByTestId('topbar-administration').click()
  await expect(page.getByTestId('administration-workspace')).toBeVisible()
}

async function switchAdministrationRole(page: Page, role: 'owner' | 'admin' | 'editor' | 'viewer', workspaceId = 'ai-ui-workspace') {
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await openAdministration(page, role, workspaceId)
}

test('AI Control Center shows honest connection status and navigates all five areas', async ({ page }) => {
  await page.goto('/')
  await openAdministration(page, 'owner')
  const center = page.getByTestId('ai-control-center')
  await expect(center.getByRole('heading', { name: 'AI Control Center' })).toBeVisible()
  await expect(center.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible()
  await expect(center).toContainText('Unconfigured')
  await expect(center).toContainText('No connection record')
  await expect(center).toContainText('No provider operations are available here')
  await expect(center.getByRole('textbox')).toHaveCount(0)
  await expect(center.getByRole('button', { name: /^(connect|test connection|run ai)$/i })).toHaveCount(0)
  await expect(center).not.toContainText(/connected successfully|verified provider|API key configured/i)

  const destinations = [
    ['Workflows', 'Workflows'],
    ['Prompt library', 'Prompt library'],
    ['Reference sets', 'Reference sets'],
    ['Content blueprints', 'Content blueprints'],
    ['Connections', 'Connections'],
  ] as const
  for (const [navigation, heading] of destinations) {
    await center.getByRole('navigation', { name: 'AI Control Center sections' }).getByRole('button', { name: new RegExp(navigation) }).click()
    await expect(center.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
})

test('owner creates and admin revises, archives, and reviews history for each definition type', async ({ page }) => {
  await page.goto('/')
  await openAdministration(page, 'owner')
  const center = page.getByTestId('ai-control-center')
  const cases = [
    { area: 'Workflows', kind: 'workflow', name: 'E2E workflow', revised: 'E2E workflow revised' },
    { area: 'Prompt library', kind: 'prompt pack', name: 'E2E prompt pack', revised: 'E2E prompt pack revised' },
    { area: 'Reference sets', kind: 'reference set', name: 'E2E reference set', revised: 'E2E reference set revised' },
    { area: 'Content blueprints', kind: 'content blueprint', name: 'E2E blueprint', revised: 'E2E blueprint revised' },
  ] as const

  for (const item of cases) {
    await center.getByRole('navigation').getByRole('button', { name: new RegExp(item.area) }).click()
    await center.getByRole('button', { name: `Create ${item.kind}` }).click()
    const dialog = center.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(item.name)
    if (item.kind === 'workflow') {
      await dialog.getByRole('textbox', { name: 'Capability' }).fill('Prepare documentation')
    } else if (item.kind === 'prompt pack') {
      await dialog.getByRole('button', { name: 'Add prompt' }).click()
      await dialog.getByRole('textbox', { name: 'Prompt name' }).fill('Reusable instruction')
      await dialog.getByRole('textbox', { name: 'Prompt template' }).fill('Use {{audience}} and {{tone}}.')
      await dialog.getByRole('textbox', { name: 'Variables' }).fill('audience, tone')
    } else if (item.kind === 'reference set') {
      await dialog.getByRole('button', { name: 'Add reference' }).click()
      await dialog.getByRole('textbox', { name: 'Title' }).fill('Approved terminology source')
    } else if (item.kind === 'content blueprint') {
      await dialog.getByRole('button', { name: 'Add section' }).click()
      await dialog.getByRole('textbox', { name: 'Section title' }).fill('Overview')
    }
    await dialog.getByRole('button', { name: 'Create definition' }).click()
    await expect(center.getByRole('button', { name: new RegExp(item.name) })).toBeVisible()
  }

  await switchAdministrationRole(page, 'admin')
  for (const item of cases) {
    await center.getByRole('navigation').getByRole('button', { name: new RegExp(item.area) }).click()
    await center.getByRole('button', { name: new RegExp(item.name) }).click()
    await center.getByRole('button', { name: 'Revise', exact: true }).click()
    const dialog = center.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(item.revised)
    await dialog.getByRole('button', { name: 'Save revision' }).click()
    await expect(center.getByRole('heading', { name: item.revised, exact: true })).toBeVisible()
    await expect(center.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
    await center.getByRole('button', { name: 'Archive', exact: true }).click()
    const confirmation = center.getByRole('alertdialog')
    await confirmation.getByRole('button', { name: 'Archive definition' }).click()
    await expect(center.getByRole('heading', { name: item.revised, exact: true })).toBeVisible()
    await center.getByRole('button', { name: 'Load history' }).click()
    await expect(center.getByRole('button', { name: /v1.*Draft/i })).toBeVisible()
    await expect(center.getByRole('button', { name: /v2.*Draft/i })).toBeVisible()
    await expect(center.getByRole('button', { name: /v3.*Archived/i })).toBeVisible()
  }
})

test('editor and viewer can inspect definitions but have no create or lifecycle controls', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const [auth, projectMode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/aiCatalogRepository.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'ai-ui-user' },
      workspace: { id: 'ai-role-workspace', name: 'Role test workspace' },
      membership: { userId: 'ai-ui-user', workspaceId: 'ai-role-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(false)
    await repository.executeAiCatalog({
      action: 'create',
      asset: { kind: 'blueprint', name: 'Read-only blueprint', description: '',
        definition: { contentType: 'User Guide', sections: [] } },
    })
  })

  const center = page.getByTestId('ai-control-center')
  for (const role of ['editor', 'viewer'] as const) {
    if (role === 'editor') await openAdministration(page, role, 'ai-role-workspace')
    else await switchAdministrationRole(page, role, 'ai-role-workspace')
    await expect(center).toContainText('Read-only access')
    await center.getByRole('navigation').getByRole('button', { name: /Content blueprints/ }).click()
    await center.getByRole('button', { name: 'Read-only blueprint' }).click()
    await expect(center.getByRole('heading', { name: 'Read-only blueprint' })).toBeVisible()
    await expect(center.getByRole('button', { name: 'Create content blueprint' })).toHaveCount(0)
    await expect(center.getByRole('button', { name: 'Revise', exact: true })).toHaveCount(0)
    await expect(center.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
    await expect(center).toContainText('reserved for workspace owners and administrators')
  }
})

test('cloud catalog errors fail closed, surface actionable codes, and never imply an empty workspace', async ({ page }) => {
  let code = 'AI_CATALOG_SCHEMA_UNAVAILABLE'
  await page.route('**/api/ai-catalog', async route => {
    const body = route.request().postDataJSON()
    if (body.action === 'list') {
      const status = code === 'FORBIDDEN' || code === 'MEMBERSHIP_INACTIVE' ? 403 : code === 'VERSION_CONFLICT' ? 409 : 400
      if (code === 'INVALID_RESPONSE') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' })
        return
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, error: 'backend detail' }) })
      return
    }
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'FORBIDDEN', error: 'backend detail' }) })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({ user: { id: 'truthful-user' }, workspace: { id: 'truthful-ws', name: 'Truthful workspace' },
      membership: { userId: 'truthful-user', workspaceId: 'truthful-ws', role: 'owner' } })
    mode.setCloudProjectMode(true)
  })
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Workflows/ }).click()
  await expect(center.getByRole('alert')).toContainText('storage schema has not been installed')
  await expect(center.getByText(/No workflows yet/i)).toHaveCount(0)
  await expect(center.getByRole('button', { name: 'Create workflow' })).toBeDisabled()
  await expect(center.getByRole('navigation')).toContainText('—')

  const codeMessages = [
    ['UNAUTHENTICATED', 'Sign in again'],
    ['MEMBERSHIP_LOOKUP_FAILED', 'could not verify your workspace membership'],
    ['MEMBERSHIP_INACTIVE', 'membership is inactive'],
    ['FORBIDDEN', 'workspace role does not allow'],
    ['ASSET_NOT_FOUND', 'no longer available in the current workspace'],
    ['VERSION_CONFLICT', 'changed elsewhere'],
    ['WORKFLOW_REFERENCE_INVALID', 'linked definition is unavailable'],
    ['INVALID_ASSET', 'does not meet the catalog requirements'],
    ['INVALID_REVISION', 'revision is not valid'],
    ['INVALID_TRANSITION', 'lifecycle change is not allowed'],
    ['API_UNAVAILABLE', 'service is currently unavailable'],
    ['AI_CATALOG_UNAVAILABLE', 'service is currently unavailable'],
    ['INVALID_RESPONSE', 'response could not be verified'],
    ['STORAGE_RESPONSE_INVALID', 'response could not be verified'],
  ] as const
  for (const [nextCode, text] of codeMessages) {
    code = nextCode
    await center.getByRole('button', { name: 'Retry loading' }).click()
    await expect(center.getByRole('alert')).toContainText(text)
  }
})

test('catalog rejects cross-workspace results and history failures remain explicit', async ({ page }) => {
  let foreign = true
  let historyFails = true
  const record = {
    workspaceId: 'mock-workspace', id: 'mock-blueprint', kind: 'blueprint', version: 1, state: 'draft',
    name: 'Scoped blueprint', description: '', definition: { contentType: 'User Guide', sections: [] },
    createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'mock-user',
  }
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      const assets = foreign ? [{ ...record, workspaceId: 'other-workspace' }] : [record]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets }) })
    } else if (command.action === 'history' && historyFails) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AI_CATALOG_UNAVAILABLE', error: 'unavailable' }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [record] }) })
    }
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({ user: { id: 'mock-user' }, workspace: { id: 'mock-workspace', name: 'Mock workspace' },
      membership: { userId: 'mock-user', workspaceId: 'mock-workspace', role: 'viewer' } })
    mode.setCloudProjectMode(true)
  })
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Content blueprints/ }).click()
  await expect(center.getByRole('alert')).toContainText('outside this workspace. No records are displayed.')
  await expect(center.getByRole('button', { name: 'Scoped blueprint' })).toHaveCount(0)
  foreign = false
  await center.getByRole('button', { name: 'Retry loading' }).click()
  await center.getByRole('button', { name: 'Scoped blueprint' }).click()
  await center.getByRole('button', { name: 'Load history' }).click()
  await expect(center.getByRole('alert')).toContainText('service is currently unavailable')
  historyFails = false
  await center.getByRole('button', { name: 'Retry history' }).click()
  await expect(center.getByRole('button', { name: /v1.*Draft/i })).toBeVisible()
})

test('mocked cloud catalog confirms each definition kind, persists through reload, and records transitions in history', async ({ page }) => {
  type Row = { workspaceId: string; id: string; kind: string; version: number; state: string; name: string; description: string; definition: Record<string, unknown>; createdAt: string; createdBy: string }
  const records: Row[] = []
  let nextId = 0
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      const latest = new Map<string, Row>()
      for (const row of records) {
        const prior = latest.get(row.id)
        if (!prior || row.version > prior.version) latest.set(row.id, row)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [...latest.values()] }) })
      return
    }
    if (command.action === 'history') {
      const versions = records.filter(row => row.id === command.id).sort((a, b) => a.version - b.version)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions }) })
      return
    }
    await new Promise(resolve => setTimeout(resolve, 180))
    if (command.action === 'create') {
      const asset = { workspaceId: 'mock-workspace', id: `mock-${++nextId}`, ...command.asset, version: 1, state: 'draft', createdAt: '2026-02-03T12:00:00.000Z', createdBy: 'mock-user' }
      records.push(asset)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ asset }) })
      return
    }
    const previous = records.filter(row => row.id === command.id).sort((a, b) => b.version - a.version)[0]
    const asset = { ...previous, version: previous.version + 1, state: command.state, createdAt: '2026-02-04T12:00:00.000Z' }
    records.push(asset)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ asset }) })
  })
  const setCloudIdentity = async () => page.evaluate(async () => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({ user: { id: 'mock-user' }, workspace: { id: 'mock-workspace', name: 'Mock workspace' },
      membership: { userId: 'mock-user', workspaceId: 'mock-workspace', role: 'owner' } })
    mode.setCloudProjectMode(true)
  })
  await page.goto('/')
  await setCloudIdentity()
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  const cases = [
    { area: 'Workflows', kind: 'workflow', name: 'Cloud workflow' },
    { area: 'Prompt library', kind: 'prompt pack', name: 'Cloud prompt pack' },
    { area: 'Reference sets', kind: 'reference set', name: 'Cloud reference set' },
    { area: 'Content blueprints', kind: 'content blueprint', name: 'Cloud blueprint' },
  ] as const
  for (const item of cases) {
    await center.getByRole('navigation').getByRole('button', { name: new RegExp(item.area) }).click()
    await center.getByRole('button', { name: `Create ${item.kind}` }).click()
    const dialog = center.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(item.name)
    if (item.kind === 'workflow') await dialog.getByRole('textbox', { name: 'Capability' }).fill('Prepare a source-grounded guide')
    if (item.kind === 'prompt pack') {
      await dialog.getByRole('button', { name: 'Add prompt' }).click()
      await dialog.getByRole('textbox', { name: 'Prompt name' }).fill('Evidence prompt')
    }
    if (item.kind === 'reference set') {
      await dialog.getByRole('button', { name: 'Add reference' }).click()
      await dialog.getByRole('textbox', { name: 'Title' }).fill('Approved glossary')
    }
    if (item.kind === 'content blueprint') {
      await dialog.getByRole('button', { name: 'Add section' }).click()
      await dialog.getByRole('textbox', { name: 'Section title' }).fill('Evidence')
    }
    await dialog.getByRole('button', { name: 'Create definition' }).click()
    await expect(center.getByRole('status')).toContainText('Saving catalog changes.')
    await expect(center.getByRole('status').filter({ hasText: 'saved as v1' })).toBeVisible({ timeout: 5000 })
    await expect(center.getByRole('button', { name: item.name })).toBeVisible()
  }

  await page.reload()
  await setCloudIdentity()
  await page.getByTestId('topbar-administration').click()
  const reloadedCenter = page.getByTestId('ai-control-center')
  for (const item of cases) {
    await reloadedCenter.getByRole('navigation').getByRole('button', { name: new RegExp(item.area) }).click()
    await expect(reloadedCenter.getByRole('button', { name: item.name })).toBeVisible()
    await reloadedCenter.getByRole('button', { name: item.name }).click()
    await reloadedCenter.getByRole('button', { name: item.kind === 'prompt pack' ? 'Move to review' : 'Publish', exact: true }).click()
    const title = item.kind === 'workflow' ? 'Workflow' : item.kind === 'prompt pack' ? 'Prompt pack' : item.kind === 'reference set' ? 'Reference set' : 'Content blueprint'
    await expect(reloadedCenter.getByText(`${title} moved to ${item.kind === 'prompt pack' ? 'test / review' : 'published'}.`)).toBeVisible()
    await expect(reloadedCenter.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    await reloadedCenter.getByRole('button', { name: 'Load history' }).click()
    await expect(reloadedCenter.getByRole('button', { name: /v1.*Draft/i })).toBeVisible()
    await expect(reloadedCenter.getByRole('button', { name: item.kind === 'prompt pack' ? /v2.*Test \/ review/i : /v2.*Published/i })).toBeVisible()
  }
})

test('malformed saves are never reported as saved and version conflicts retain the editable draft', async ({ page }) => {
  let createAttempt = 0
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [] }) })
      return
    }
    createAttempt += 1
    if (createAttempt === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' })
      return
    }
    if (createAttempt === 2) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'VERSION_CONFLICT', error: 'changed' }) })
      return
    }
    const asset = {
      workspaceId: 'draft-workspace', id: 'bad-confirmation', ...command.asset,
      name: `${command.asset.name} altered`, version: 1, state: 'draft',
      createdAt: '2026-02-03T12:00:00.000Z', createdBy: 'draft-user',
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ asset }) })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({ user: { id: 'draft-user' }, workspace: { id: 'draft-workspace', name: 'Draft workspace' },
      membership: { userId: 'draft-user', workspaceId: 'draft-workspace', role: 'owner' } })
    mode.setCloudProjectMode(true)
  })
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Workflows/ }).click()
  await center.getByRole('button', { name: 'Create workflow' }).click()
  const dialog = center.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved grounded workflow')
  await dialog.getByRole('textbox', { name: 'Capability' }).fill('Prepare a source-grounded guide')
  await dialog.getByRole('button', { name: 'Create definition' }).click()
  await expect(dialog.getByRole('alert')).toContainText('response could not be verified')
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved grounded workflow')
  await expect(center.getByText(/saved as v/i)).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Create definition' }).click()
  await expect(dialog.getByRole('alert')).toContainText('changed elsewhere')
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved grounded workflow')
  await expect(dialog).toBeVisible()
  await expect(center.getByText(/saved as v/i)).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Create definition' }).click()
  await expect(dialog.getByRole('alert')).toContainText('server could not confirm this catalog change')
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved grounded workflow')
  await expect(center.getByText(/saved as v/i)).toHaveCount(0)
})

test('a delayed history response for one asset cannot replace the selected asset history', async ({ page }) => {
  const assetA = {
    workspaceId: 'history-workspace', id: 'history-a', kind: 'blueprint', version: 1, state: 'test',
    name: 'History A', description: '', definition: { contentType: 'User Guide', sections: [] },
    createdAt: '2026-02-01T12:00:00.000Z', createdBy: 'history-user',
  }
  const assetBv1 = { ...assetA, id: 'history-b', version: 1, state: 'draft', name: 'History B', createdAt: '2026-02-02T12:00:00.000Z' }
  const assetBv2 = { ...assetBv1, version: 2, state: 'published', createdAt: '2026-02-03T12:00:00.000Z' }
  let releaseAHistory = () => {}
  let announceAHistory = () => {}
  const delayedAHistory = new Promise<void>(resolve => { releaseAHistory = resolve })
  const aHistoryStarted = new Promise<void>(resolve => { announceAHistory = resolve })
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [assetA, assetBv2] }) })
    } else if (command.action === 'history' && command.id === assetA.id) {
      announceAHistory()
      await delayedAHistory
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [assetA] }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [assetBv1, assetBv2] }) })
    }
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({ user: { id: 'history-user' }, workspace: { id: 'history-workspace', name: 'History workspace' },
      membership: { userId: 'history-user', workspaceId: 'history-workspace', role: 'viewer' } })
    mode.setCloudProjectMode(true)
  })
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Content blueprints/ }).click()
  await center.getByRole('button', { name: 'History A' }).click()
  await center.getByRole('button', { name: 'Load history' }).click()
  await aHistoryStarted

  await center.getByRole('button', { name: 'History B' }).click()
  const detailB = center.getByRole('region', { name: 'History B' })
  await detailB.getByRole('button', { name: 'Load history' }).click()
  await expect(detailB.getByRole('button', { name: /v2.*Published/i })).toBeVisible()
  releaseAHistory()
  await expect(detailB.getByRole('button', { name: /v2.*Published/i })).toBeVisible()
  await expect(detailB.getByRole('button', { name: /v1.*Test \/ review/i })).toHaveCount(0)
})