import { expect, test } from '@playwright/test'

async function mountResourcePicker(page: import('@playwright/test').Page, canCopy: boolean) {
  await page.goto('/')
  await page.evaluate(async (viewerCanCopy) => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const ReactDOMModule = await import('/node_modules/.vite/deps/react-dom_client.js')
    const React = ReactModule.default
    const ReactDOM = ReactDOMModule.default
    const { ResourcePicker } = await import('/src/ResourcePicker.tsx')

    document.body.innerHTML = '<button id="return-focus">Return focus</button><div id="resource-picker-root"></div>'
    const returnFocus = document.querySelector<HTMLButtonElement>('#return-focus')!
    returnFocus.focus()

    const items = [
      {
        itemId: 'topic-1', projectId: 'project-a', assetType: 'topic' as const,
        displayName: 'Launch guide', currentVersion: 7, updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        itemId: 'snippet-1', projectId: 'project-b', assetType: 'snippet' as const,
        displayName: 'Email copy', currentVersion: 2, updatedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        itemId: 'variable-1', projectId: 'project-a', assetType: 'variable' as const,
        displayName: 'Audience segment', currentVersion: 3, updatedAt: '2026-09-03T00:00:00.000Z',
      },
      {
        itemId: 'condition-1', projectId: 'project-b', assetType: 'condition' as const,
        displayName: 'Paid audience', currentVersion: 5, updatedAt: '2026-09-04T00:00:00.000Z',
      },
    ]
    const state = { loads: [] as Array<Record<string, unknown>>, copies: [] as Array<{ itemId: string; version: number }>, closeCount: 0 }
    ;(window as any).__resourcePickerState = state
    let root: ReturnType<typeof ReactDOM.createRoot> | null = null
    root = ReactDOM.createRoot(document.querySelector('#resource-picker-root')!)
    root.render(React.createElement(ResourcePicker, {
      projects: [
        { projectId: 'project-a', projectName: 'Project Alpha' },
        { projectId: 'project-b', projectName: 'Project Beta' },
      ],
      canCopy: viewerCanCopy,
      loadItems: async (filters: { projectId?: string; assetType?: string; search?: string }) => {
        state.loads.push({ ...filters })
        return items.filter(item =>
          (!filters.projectId || item.projectId === filters.projectId)
          && (!filters.assetType || item.assetType === filters.assetType)
          && (!filters.search || item.displayName.toLowerCase().includes(filters.search.toLowerCase())),
        )
      },
      loadPreview: async (item: (typeof items)[number]) => ({
        item,
        version: {
          version: item.currentVersion,
          payload: item.assetType === 'topic'
            ? { title: 'Launch guide', blocks: [{ type: 'text', text: 'Topic block body text' }] }
            : item.assetType === 'condition'
              ? { name: 'Paid audience', group: 'Audience rules', tags: ['paid', 'active'], expression: 'plan = paid' }
              : {},
        },
      }),
      onCopy: async (item: (typeof items)[number], version: number) => {
        state.copies.push({ itemId: item.itemId, version })
      },
      onClose: () => {
        state.closeCount += 1
        root?.unmount()
        root = null
      },
    }))
  }, canCopy)
  await expect(page.getByRole('dialog', { name: 'Reuse content' })).toBeVisible()
}

test('resource picker filters, selects current versions, and previews topic and condition content', async ({ page }) => {
  await mountResourcePicker(page, true)

  await page.locator('input[type="search"]').fill('Audience')
  await expect(page.getByRole('option', { name: /Audience segment/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Paid audience/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Launch guide/ })).toHaveCount(0)

  await page.getByLabel('Filter by source project').selectOption('project-b')
  await expect(page.getByRole('option', { name: /Paid audience/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Audience segment/ })).toHaveCount(0)
  await page.getByLabel('Filter by content type').selectOption('condition')
  await expect(page.getByRole('option', { name: /Paid audience/ })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__resourcePickerState.loads.at(-1))).toMatchObject({
    projectId: 'project-b',
    assetType: 'condition',
    search: 'Audience',
  })

  await page.getByRole('option', { name: /Paid audience/ }).click()
  await expect(page.locator('.rp-preview-content')).toContainText('Audience rules')
  await expect(page.locator('.rp-preview-content')).toContainText('paid · active')

  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByLabel('Filter by source project').selectOption('')
  await page.getByLabel('Filter by content type').selectOption('')
  await page.getByRole('option', { name: /Launch guide/ }).click()
  await expect(page.locator('.rp-preview-content')).toContainText('Block 1: Topic block body text')
  await expect(page.getByText('Previewing exact current version v7')).toBeVisible()
})

test('viewer cannot copy; an editor copies the exact version and Escape restores focus', async ({ page }) => {
  await mountResourcePicker(page, false)
  await page.getByRole('option', { name: /Paid audience/ }).click()
  await expect(page.getByRole('button', { name: /Copy to this project/ })).toBeDisabled()
  await expect(page.getByText('View-only access · copying is unavailable')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__resourcePickerState.copies)).toEqual([])
  await page.getByRole('button', { name: 'Close resource picker' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await mountResourcePicker(page, true)
  await page.getByRole('option', { name: /Launch guide/ }).click()
  await expect(page.getByRole('button', { name: /Copy to this project/ })).toBeEnabled()
  await page.getByRole('button', { name: /Copy to this project/ }).click()
  await expect(page.getByRole('status')).toContainText('Copied into this project.')
  expect(await page.evaluate(() => (window as any).__resourcePickerState.copies)).toEqual([
    { itemId: 'topic-1', version: 7 },
  ])

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#return-focus')).toBeFocused()
})