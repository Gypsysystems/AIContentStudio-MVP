import { expect, test, type Page } from '@playwright/test'

async function createProject(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(`Guided workflow ${Date.now()}`)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
}

async function addSource(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'workspace-operations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Workspace Operations\n\nWorkspace operators configure team access in the dashboard.\n\n## Access Control\n\nOperators manage access to the workspace.\n'),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
}

async function proposedToc(page: Page) {
  await addSource(page)
  await page.getByTestId('analyze-sources').click()
  await expect(page.getByTestId('concept-analysis-freshness')).toHaveText('Current')
  await page.getByTestId('analysis-generate-toc').click()
  await expect(page.getByTestId('toc-proposal-review')).toBeVisible()
}

test('Sources explains blocked and ready states, then keyboard action advances to Analysis on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createProject(page)
  const action = page.getByTestId('analyze-sources')
  await expect(action).toBeDisabled()
  await expect(page.getByTestId('sources-next-step')).toContainText('Blocked')
  await expect(page.getByTestId('sources-next-step')).toContainText('Add at least one source')
  await expect(page.getByTestId('sources-next-step').getByRole('button', { name: 'Choose files' })).toBeVisible()
  await addSource(page)
  await expect(page.getByTestId('sources-next-step')).toContainText('Ready')
  await expect(action).toBeEnabled()
  const bounds = await action.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376)
  await action.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('analysis-next-step')).toContainText(/Ready for TOC|Review cited findings/)
  await expect(page.getByTestId('analysis-generate-toc')).toBeEnabled()
})

test('Analysis explains missing prerequisites and preserves Generate TOC progression', async ({ page }) => {
  await createProject(page)
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await expect(page.getByTestId('analysis-generate-toc')).toBeDisabled()
  await expect(page.getByTestId('analysis-next-step')).toContainText('Blocked')
  await expect(page.getByTestId('analysis-toc-unavailable')).toContainText('Evidence Index')
  await expect(page.getByTestId('analysis-next-step').getByRole('button', { name: 'Open Sources' })).toBeVisible()
  await page.getByTestId('analysis-next-step').getByRole('button', { name: 'Open Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
  await proposedToc(page)
  await expect(page.getByTestId('real-toc-next-step')).toContainText('Ready to accept')
})

test('TOC acceptance advances into Author, focuses the workspace and keeps the structure available', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createProject(page)
  await proposedToc(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)
  await expect(page.getByTestId('commit-toc-proposal')).toBeEnabled()
  await page.getByTestId('commit-toc-proposal').click()
  await expect(page.locator('header').getByRole('button', { name: /^Author,/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('author-stage-heading')).toBeFocused()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  await expect(page.getByTestId('committed-toc-panel')).toContainText('Workspace Operations')
})

test('Author describes missing Review inputs and runs Review when ready; Review advances to Preview', async ({ page }) => {
  await createProject(page)
  await page.locator('header').getByRole('button', { name: /^Author,/ }).click()
  await expect(page.getByTestId('author-run-review')).toBeDisabled()
  await expect(page.getByTestId('author-review-next-step')).toContainText(/Blocked|In progress/)
  await expect(page.getByTestId('author-review-next-step').getByRole('button', { name: 'Review TOC' })).toBeVisible()
  await page.locator('header').getByRole('button', { name: /^Sources,/ }).click()
  await proposedToc(page)
  await page.getByTestId('commit-toc-proposal').click()
  await expect(page.getByTestId('author-review-next-step')).toContainText('Unsupported-claim analysis is stale')
  await page.getByTestId('author-review-next-step').getByRole('button', { name: 'Refresh Claim Check' }).click()
  await expect(page.getByTestId('analysis-next-step')).toContainText('claim check is stale')
  await page.getByTestId('analysis-next-step').getByRole('button', { name: 'Rebuild Claim Check' }).click()
  await expect(page.getByTestId('unsupported-analysis-freshness')).toHaveText('Current')
  await page.locator('header').getByRole('button', { name: /^Author,/ }).click()
  await expect(page.getByTestId('author-run-review')).toBeEnabled()
  await page.getByTestId('author-run-review').click()
  await expect(page.locator('header').getByRole('button', { name: /^Review,/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('real-review-findings')).toBeVisible()
  await expect(page.getByTestId('review-next-step')).toContainText(/Complete|Needs attention/)
  if (await page.getByTestId('review-preview-publish').isDisabled()) {
    await expect(page.getByTestId('review-next-step')).toContainText('required')
    await page.getByTestId('review-next-step').getByRole('button', { name: 'Open a required finding' }).click()
    await expect(page.getByTestId('review-finding-inspector')).toBeVisible()
    for (let i = 0; i < 30 && await page.getByTestId('review-preview-publish').isDisabled(); i++) {
      const finding = page.getByTestId('grounded-review-finding').filter({ hasText: /Required.*(?:open|in-review)/ }).first()
      if (await finding.getByRole('button', { name: 'Inspect' }).count()) await finding.getByRole('button', { name: 'Inspect' }).click()
      await finding.getByRole('button', { name: 'Mark resolved' }).click()
    }
  }
  await expect(page.getByTestId('review-preview-publish')).toBeEnabled()
  await page.getByTestId('review-preview-publish').click()
  await expect(page.getByText('Preview mode', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /Go to Publish/ }).first().click()
  await expect(page.getByTestId('publish-stage-status')).toContainText('Choose at least one output format')
  await expect(page.getByTestId('publish-generate-outputs')).toBeDisabled()
  await page.getByRole('checkbox', { name: /HTML/ }).check()
  await expect(page.getByTestId('publish-stage-status')).toContainText(/Ready|Complete/)
  await expect(page.getByTestId('publish-generate-outputs')).toBeEnabled()
  await page.getByTestId('publish-generate-outputs').click()
  await expect(page.getByTestId('publish-stage-status')).toContainText('Complete', { timeout: 20_000 })
  await page.getByRole('checkbox', { name: /PDF/ }).check()
  await expect(page.getByTestId('publish-stage-status')).toContainText('Ready')
  await expect(page.getByTestId('publish-stage-status')).toContainText('PDF file')
})

test('ordinary source gaps remain informational while genuine conflicts and missing facts are warnings', async ({ page }) => {
  await page.goto('/')
  const states = await page.evaluate(async () => {
    const { analysisSummary } = await import('/src/analysisPresentation.ts')
    const empty = { conflicts: [], gaps: [] } as unknown as Parameters<typeof analysisSummary>[0]
    const ordinary = { category: 'insufficient-coverage', title: 'Asteria coverage note' } as NonNullable<typeof empty.gaps>[number]
    const conflict = { id: 'asteria-conflict', title: 'Asteria retention conflict' } as NonNullable<typeof empty.conflicts>[number]
    const missing = { category: 'explicit-missing-information', title: 'Asteria recovery gap' } as NonNullable<typeof empty.gaps>[number]
    return {
      ordinary: analysisSummary({ ...empty, gaps: [ordinary] }, true, true, null, true),
      material: analysisSummary({ ...empty, conflicts: [conflict], gaps: [ordinary, missing] }, true, true, null, true),
    }
  })
  expect(states.ordinary).toMatchObject({ severity: 'info' })
  expect(states.ordinary.message).not.toMatch(/warning|caution/i)
  expect(states.material).toMatchObject({ severity: 'warning' })
  expect(states.material.message).toContain('1 evidence conflict')
  expect(states.material.message).toContain('1 actionable source gap')
})