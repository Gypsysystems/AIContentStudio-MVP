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