import { expect, test, type Page } from '@playwright/test'

const harnessPath = '/tests/fixtures/content-explorer-panel.html'

async function openPanel(page: Page, readOnly = false) {
  await page.setViewportSize({ width: 760, height: 820 })
  await page.goto(readOnly ? `${harnessPath}?readOnly=true` : harnessPath)
  await expect(page.getByTestId('content-explorer-panel')).toBeVisible()
}

async function createFolder(page: Page, name: string) {
  await page.getByTestId('content-explorer-new-folder').click()
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
}

test('renders fixed roots and opens the selected Author topic without changing tree metadata', async ({ page }) => {
  await openPanel(page)

  for (const root of ['topics', 'snippets', 'media', 'variables', 'conditions', 'references']) {
    await expect(page.getByTestId(`content-explorer-root-${root}`)).toBeVisible()
  }
  for (const category of ['Images', 'Videos', 'GIFs', 'Audio']) {
    await expect(page.getByRole('treeitem').filter({ hasText: category }).first()).toBeVisible()
  }
  await page.getByRole('button', { name: 'Actions for Topics' }).click()
  const fixedRootMenu = page.getByRole('menu', { name: 'Actions for Topics' })
  await expect(fixedRootMenu.getByRole('menuitem', { name: 'New folder' })).toBeVisible()
  await expect(fixedRootMenu.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
  await expect(fixedRootMenu.getByRole('menuitem', { name: 'Delete empty folder' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('content-explorer-item-snippet-snippet-caution')).toBeVisible()
  await expect(page.getByTestId('content-explorer-item-variable-variable-product')).toBeVisible()
  await expect(page.getByTestId('content-explorer-item-condition-condition-premium')).toBeVisible()
  await expect(page.getByTestId('content-explorer-item-reference-reference-safety')).toBeVisible()

  const structuralChanges = page.getByTestId('change-count')
  await expect(structuralChanges).toHaveText('0')
  await page.getByLabel('Filter content').fill('Safe Setup')
  const topicsRoot = page.getByTestId('content-explorer-root-topics')
  await expect(topicsRoot).toBeVisible()
  await expect(page.locator('[data-folder-id="folder-author-guides"]')).toBeVisible()
  await expect(page.locator('[data-folder-id="folder-getting-started"]')).toBeVisible()

  const topic = page.getByTestId('content-explorer-item-topic-topic-setup')
  await expect(topic).toBeVisible()
  await topic.click()
  await expect(page.getByTestId('opened-topic')).toHaveText('topic-setup')
  await expect(structuralChanges).toHaveText('0')

  await page.getByLabel('Clear filter').click()
  await page.getByRole('button', { name: 'Collapse Topics' }).click()
  await expect(structuralChanges).toHaveText('0')
})

test('creates, renames, and deletes empty folders while rejecting duplicate sibling names', async ({ page }) => {
  await openPanel(page)
  await createFolder(page, 'Research Notes')
  await expect(page.locator('[data-folder-id]').filter({ hasText: 'Research Notes' }).first()).toBeVisible()
  await expect(page.getByTestId('change-count')).toHaveText('1')

  await page.getByRole('button', { name: 'Actions for Research Notes' }).click()
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  await page.getByLabel('New folder name').fill('Nested Note')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('[data-folder-id]').filter({ hasText: 'Nested Note' }).last()).toBeVisible()
  await expect(page.getByTestId('change-count')).toHaveText('2')

  await page.getByRole('button', { name: 'Actions for Research Notes' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByLabel('Rename Research Notes').fill('Field Notes')
  await page.getByRole('button', { name: 'Save folder name' }).click()
  await expect(page.locator('[data-folder-id]').filter({ hasText: 'Field Notes' }).first()).toBeVisible()
  await expect(page.getByTestId('change-count')).toHaveText('3')

  await page.getByTestId('content-explorer-new-folder').click()
  await page.getByLabel('New folder name').fill('author guides')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('status')).toContainText(/already exists/i)
  await expect(page.getByTestId('change-count')).toHaveText('3')

  await page.getByRole('button', { name: 'Actions for Field Notes' }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete empty folder' }).click()
  await expect(page.getByRole('status')).toContainText(/must be empty/i)
  await expect(page.getByTestId('change-count')).toHaveText('3')

  await createFolder(page, 'Temporary Folder')
  await expect(page.getByTestId('change-count')).toHaveText('4')
  await page.getByRole('button', { name: 'Actions for Temporary Folder' }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete empty folder' }).click()
  await expect(page.locator('[data-folder-id]').filter({ hasText: 'Temporary Folder' })).toHaveCount(0)
  await expect(page.getByTestId('change-count')).toHaveText('5')
})

test('blocks folder organization controls for viewers but keeps topic selection available', async ({ page }) => {
  await openPanel(page, true)
  await expect(page.getByTestId('content-explorer-new-folder')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actions for Topics' })).toHaveCount(0)
  await page.getByLabel('Filter content').fill('Welcome')
  await page.getByTestId('content-explorer-item-topic-topic-welcome').click()
  await expect(page.getByTestId('opened-topic')).toHaveText('topic-welcome')
  await expect(page.getByTestId('change-count')).toHaveText('0')
})

test('moves topic references into project folders without changing their content references', async ({ page }) => {
  await openPanel(page)
  const topic = page.getByTestId('content-explorer-item-topic-topic-welcome')
    .locator('xpath=ancestor::*[@role="treeitem"][1]')
  const folder = page.locator('[data-folder-id="folder-author-guides"]')
  await topic.dragTo(folder)
  await expect(page.getByTestId('change-count')).toHaveText('1')

  await page.getByLabel('Filter content').fill('Welcome')
  await expect(page.locator('[data-folder-id="folder-author-guides"]')).toBeVisible()
  await expect(page.getByTestId('content-explorer-item-topic-topic-welcome')).toBeVisible()
  await expect(page.getByTestId('opened-topic')).toHaveText('')
})