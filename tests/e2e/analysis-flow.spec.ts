import { expect, test } from '@playwright/test'

test('Analysis generates a grounded proposal and opens TOC without using the progress bar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('Analysis to TOC')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'operations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Operations\n\nOperations guide the team.\n\n## Access Control\n\nAccess Control protects the workspace.\n'),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Analyze Sources' }).click()
  await expect(page.getByTestId('concept-analysis-freshness')).toHaveText('Current')
  const generate = page.getByTestId('analysis-generate-toc')
  await expect(generate).toBeEnabled()
  await generate.click()
  await expect(page.getByRole('heading', { name: 'Review TOC proposal' })).toBeVisible()
  await expect(page.getByTestId('generate-grounded-toc')).toHaveCount(0)
  await expect(page.getByText('Access Control').first()).toBeVisible()
  await page.locator('header').getByRole('button', { name: /Analysis/ }).click()
  await expect(page.getByTestId('analysis-generate-toc')).toHaveText(/Review proposed TOC/)
})

test('Analysis explains why TOC generation is unavailable before sources are ready', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('No sources')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await page.getByRole('button', { name: 'Analysis', exact: true }).click()
  await expect(page.getByTestId('analysis-generate-toc')).toBeDisabled()
  await expect(page.getByTestId('analysis-toc-unavailable')).toContainText('Evidence Index')
  await expect(page.getByTestId('real-toc-screen')).toHaveCount(0)
  await page.locator('header').getByRole('button', { name: /TOC/ }).click()
  await expect(page.getByTestId('real-toc-screen')).toBeVisible()
})

test('Analysis summary keeps conflicts and actionable gaps distinct from ordinary coverage notes', async ({ page }) => {
  await page.goto('/')
  const states = await page.evaluate(async () => {
    const { analysisSummary } = await import('/src/analysisPresentation.ts')
    const analysis = { conflicts: [], gaps: [] } as unknown as Parameters<typeof analysisSummary>[0]
    const gap = { category: 'insufficient-coverage' } as NonNullable<typeof analysis.gaps>[number]
    const ordinary = analysisSummary({ ...analysis, gaps: [gap] }, true, true, null, true)
    const ready = analysisSummary(analysis, true, true, null, true)
    const conflict = { id: 'asteria-conflict' } as NonNullable<typeof analysis.conflicts>[number]
    const actionable = { category: 'explicit-missing-information' } as NonNullable<typeof analysis.gaps>[number]
    const warning = analysisSummary({ ...analysis, conflicts: [conflict], gaps: [gap, actionable] }, true, true, null, true)
    const stale = analysisSummary(analysis, false, false, null, true)
    return { ordinary, ready, warning, stale }
  })
  expect(states.ordinary.severity).toBe('info')
  expect(states.ready.severity).toBe('ready')
  expect(states.warning.severity).toBe('warning')
  expect(states.warning.message).toContain('1 evidence conflict')
  expect(states.warning.message).toContain('1 actionable source gap')
  expect(states.stale.severity).toBe('warning')
})