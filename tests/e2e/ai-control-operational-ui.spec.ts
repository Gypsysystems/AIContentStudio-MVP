import { expect, test, type Page } from '@playwright/test'

const workspaceId = 'operational-ui-workspace'
const userId = 'operational-ui-user'
const createdAt = '2026-03-01T12:00:00.000Z'

const workflow = {
  workspaceId, id: 'workflow_ui', kind: 'workflow', version: 1, state: 'draft',
  name: 'Operational workflow', description: 'Readiness UI fixture',
  definition: { capability: 'Prepare documentation', model: { mode: 'auto' }, promptPack: null, referenceSet: null, blueprint: null, steps: [] },
  createdAt, createdBy: userId,
}
const publishedWorkflow = {
  ...workflow,
  id: 'workflow_published',
  state: 'published',
  name: 'Published workflow',
  definition: {
    ...workflow.definition,
    model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-4o' },
    promptPack: { id: 'pack_ui', version: 1 },
    referenceSet: { id: 'reference_ui', version: 1 },
    blueprint: { id: 'blueprint_ui', version: 1 },
  },
}
const packV1 = {
  workspaceId, id: 'pack_ui', kind: 'prompt-pack', version: 1, state: 'published',
  name: 'Published pack', description: '',
  definition: { prompts: [{ id: 'prompt_ui', version: 1, state: 'published', name: 'Instruction', template: 'Write clearly.', variables: [] }] },
  createdAt, createdBy: userId,
}
const packV2 = { ...packV1, version: 2, state: 'draft' }
const reference = {
  workspaceId, id: 'reference_ui', kind: 'reference-set', version: 1, state: 'published',
  name: 'Published references', description: '', definition: { entries: [] }, createdAt, createdBy: userId,
}
const blueprint = {
  workspaceId, id: 'blueprint_ui', kind: 'blueprint', version: 1, state: 'published',
  name: 'Published blueprint', description: '', definition: { contentType: 'User Guide', sections: [] }, createdAt, createdBy: userId,
}
const latest = [workflow, publishedWorkflow, packV2, reference, blueprint]
const history: Record<string, typeof latest> = {
  workflow_ui: [workflow],
  workflow_published: [publishedWorkflow],
  pack_ui: [packV1, packV2],
  reference_ui: [reference],
  blueprint_ui: [blueprint],
}

async function setIdentity(page: Page, role: 'owner' | 'viewer') {
  await page.evaluate(async ({ role, workspaceId, userId }) => {
    const [auth, mode] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: userId },
      workspace: { id: workspaceId, name: 'Operational UI workspace' },
      membership: { userId, workspaceId, role },
    })
    mode.setCloudProjectMode(true)
  }, { role, workspaceId, userId })
}

async function installApiRoutes(page: Page, seen: string[]) {
  let publishAttempts = 0
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    seen.push(`catalog:${command.action}`)
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: latest }) })
    } else if (command.action === 'history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: history[command.id] ?? [] }) })
    } else if (command.action === 'readiness') {
      const blockedForState = command.id === workflow.id
      const blockers = blockedForState
        ? [{ code: 'WORKFLOW_NOT_PUBLISHED', message: 'The selected workflow version must be published.' }] : []
      const isPublishedWorkflow = command.id === publishedWorkflow.id
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ readiness: {
        status: blockers.length ? 'blocked' : 'ready', workflow: { id: command.id, version: command.version },
        dependencies: isPublishedWorkflow ? {
          promptPack: { id: 'pack_ui', version: 1, name: 'Published pack', state: 'published' },
          referenceSet: { id: 'reference_ui', version: 1, name: 'Published references', state: 'published' },
          blueprint: { id: 'blueprint_ui', version: 1, name: 'Published blueprint', state: 'published' },
        } : { promptPack: null, referenceSet: null, blueprint: null },
        model: isPublishedWorkflow ? { providerId: 'openai', modelId: 'gpt-4o' } : null,
        checkedAt: createdAt,
        blockers,
      } }) })
    } else if (command.action === 'transition' && command.state === 'published') {
      publishAttempts += 1
      const readinessBlocked = publishAttempts === 1
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(readinessBlocked ? {
        code: 'WORKFLOW_NOT_READY',
        blockers: [{ code: 'WORKFLOW_NOT_PUBLISHED', message: 'The selected workflow version must be published.' }],
      } : { code: 'VERSION_CONFLICT' }) })
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_REQUEST' }) })
    }
  })
  await page.route('**/api/ai-connections', async route => {
    const command = route.request().postDataJSON()
    seen.push(`connection:${command.action}`)
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connections: [{
        workspaceId, providerId: 'openai', revision: 1, state: 'verified', testedAt: createdAt, updatedAt: createdAt, updatedBy: userId,
      }] }) })
    } else if (command.action === 'discover') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        providerId: command.providerId, revision: command.expectedRevision,
        discovery: { state: 'available', discoveredAt: createdAt, models: [{ providerId: 'openai', id: 'gpt-4o', label: 'GPT-4o' }] },
      }) })
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_REQUEST' }) })
    }
  })
}

test('owners discover models, pin published exact versions, and check saved workflow readiness', async ({ page }) => {
  const seen: string[] = []
  await installApiRoutes(page, seen)
  await page.goto('/')
  await setIdentity(page, 'owner')
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Workflows/ }).click()

  await center.getByRole('button', { name: 'Create workflow' }).click()
  const editor = center.getByRole('dialog')
  const modelSelect = editor.getByRole('combobox', { name: 'Workflow model' })
  await expect(modelSelect.locator('option', { hasText: 'GPT-4o' })).toBeAttached()
  await modelSelect.selectOption('openai:gpt-4o')
  const packSelect = editor.getByRole('combobox', { name: 'Prompt pack published exact version' })
  await expect(packSelect.locator('option[value="pack_ui:1"]')).toContainText('Published')
  await expect(packSelect.locator('option[value="pack_ui:2"]')).toHaveCount(0)
  await expect(editor.getByRole('combobox', { name: 'Reference set published exact version' }).locator('option[value="reference_ui:1"]')).toBeAttached()
  await expect(editor.getByRole('combobox', { name: 'Blueprint published exact version' }).locator('option[value="blueprint_ui:1"]')).toBeAttached()
  await packSelect.selectOption('pack_ui:1')
  await expect(packSelect).toHaveValue('pack_ui:1')
  await expect(editor.getByRole('region', { name: 'Local workflow readiness' })).toContainText('Save first')
  await expect(editor.getByRole('region', { name: 'Local workflow readiness' })).not.toContainText('Ready for execution')
  await expect.poll(() => seen).toContain('connection:discover')
  await editor.getByRole('button', { name: 'Cancel' }).click()

  await center.getByRole('button', { name: 'Operational workflow' }).click()
  const detail = center.getByRole('region', { name: 'Workflow operational readiness' })
  await center.getByRole('button', { name: 'Publish', exact: true }).click()
  const notice = center.getByRole('alert')
  await expect(notice).toContainText('Workflow publish blocked by readiness')
  await expect(notice).toContainText('WORKFLOW_NOT_PUBLISHED')
  await expect(notice).toContainText('The selected workflow version must be published.')
  await expect(notice).not.toContainText('changed elsewhere')
  await expect(detail).toContainText('Blocked')
  await expect(detail).toContainText('WORKFLOW_NOT_PUBLISHED')
  await expect(detail).not.toContainText('Ready for execution')

  await center.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(center.getByRole('alert')).toContainText('changed elsewhere')
  await expect(center.getByRole('alert')).not.toContainText('WORKFLOW_NOT_PUBLISHED')

  await detail.getByRole('button', { name: 'Check readiness' }).click()
  await expect(detail).toContainText('WORKFLOW_NOT_PUBLISHED')
  await expect(detail).not.toContainText('Ready for execution')

  await center.getByRole('button', { name: 'Published workflow' }).click()
  const publishedDetail = center.getByRole('region', { name: 'Workflow operational readiness' })
  await publishedDetail.getByRole('button', { name: 'Check readiness' }).click()
  await expect(publishedDetail).toContainText('Ready for execution')
  await expect(publishedDetail).toContainText('Published pack · v1 · published')
  await expect(publishedDetail).toContainText('Published references · v1 · published')
  await expect(publishedDetail).toContainText('Published blueprint · v1 · published')
  await expect(publishedDetail).toContainText('openai / gpt-4o')
  await expect(publishedDetail).not.toContainText('WORKFLOW_NOT_PUBLISHED')
  await expect(publishedDetail).toContainText('rechecked at execution')
  expect(seen).toContain('catalog:readiness')

  await center.getByRole('navigation').getByRole('button', { name: /Prompt library/ }).click()
  await expect(center).toContainText('declared template variables')
  await center.getByRole('navigation').getByRole('button', { name: /Reference sets/ }).click()
  await expect(center).toContainText('never store source documents or excerpts')
  await center.getByRole('navigation').getByRole('button', { name: /Content blueprints/ }).click()
  await expect(center).toContainText('section order, required sections')
})

test('viewers can inspect workflow details but never discover, check readiness, or mutate', async ({ page }) => {
  const seen: string[] = []
  await installApiRoutes(page, seen)
  await page.goto('/')
  await setIdentity(page, 'viewer')
  await page.getByTestId('topbar-administration').click()
  const center = page.getByTestId('ai-control-center')
  await center.getByRole('navigation').getByRole('button', { name: /Workflows/ }).click()
  await center.getByRole('button', { name: 'Operational workflow' }).click()
  const detail = center.getByRole('region', { name: 'Workflow operational readiness' })
  await expect(detail).toContainText('available to workspace owners and administrators')
  await expect(detail.getByRole('button', { name: 'Check readiness' })).toHaveCount(0)
  await expect(center.getByRole('button', { name: 'Create workflow' })).toHaveCount(0)
  expect(seen).not.toContain('connection:discover')
  expect(seen).not.toContain('catalog:readiness')
  expect(seen.some(action => ['catalog:create', 'catalog:revise', 'catalog:transition'].includes(action))).toBe(false)
})