import { expect, test, type Page } from '@playwright/test'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

async function createProject(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('Preview fidelity')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('docflow-active-project'))).not.toBeNull()
}
async function openPreview(page: Page) {
  await page.locator('header').getByRole('button', { name: /^Publish,/ }).click()
  await page.getByRole('button', { name: 'Full Preview' }).click()
}

test('real Preview renders all committed stable-ID topics and structures, selected style/layout/master, media and warnings after reload', async ({ page }) => {
  test.setTimeout(90_000)
  await createProject(page)
  await page.evaluate(async (image) => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    record.appToc = [
      { id: 10, topicId: 'stable-z', title: 'Zeta {{PRODUCT}}', level: 1, words: 0 },
      { id: 3, topicId: 'stable-a', title: 'Alpha section', level: 2, words: 0 },
      { id: 6, topicId: 'stable-empty', title: 'Needs Grounding topic', level: 1, words: 0 },
    ]
    record.topicContent = {
      'stable-z': [
        { id: 'old-heading', type: 'h1', content: 'Stale editor heading' },
        { id: 'intro', type: 'para', content: 'Real {{PRODUCT}} paragraph with {{UNKNOWN}}. https://example.com/help #topic-stable-a' },
        { id: 'sub', type: 'h2', content: 'Setup details' },
        { id: 'list', type: 'list', content: '', listItems: [{ text: 'List entry', level: 1, type: 'ordered' }] },
        { id: 'steps', type: 'procedure', content: 'Procedure label', procedureSteps: ['Open {{PRODUCT}}'] },
        { id: 'table', type: 'table', content: '', tableData: { hasHeader: true, rows: [['Header A'], ['Saved cell']] } },
        { id: 'callout', type: 'callout', content: 'Review this', calloutVariant: 'warning' },
        { id: 'quote', type: 'quote', content: 'Quoted fact' },
        { id: 'code', type: 'code', content: 'const saved = true' },
        { id: 'media', type: 'media', content: '', mediaType: image, caption: 'Real figure' },
        { id: 'caption', type: 'caption', content: 'Additional caption' },
        { id: 'conditional', type: 'para', content: 'Restricted unpublished content', conditions: ['private'] },
      ],
      'stable-a': [{ id: 'alpha', type: 'para', content: 'Stable Alpha content' },
        { id: 'alpha-heading', type: 'h2', content: 'Alpha detail' }],
      'stable-empty': [],
      '10': [{ id: 'wrong', type: 'para', content: 'Old numeric-key content' }],
    }
    record.docBlocks = [{ id: 'stale', type: 'para', content: 'Stale active editor excerpt' }]
    const meta = record.projectMeta as { themeId: string; styleProfileId: string }
    record.themeVariables[meta.themeId] = [{ name: 'PRODUCT', value: 'Atlas' }]
    const theme = (record.themes as Array<{ id: string; styleProfiles: unknown[] }>).find(item => item.id === meta.themeId)!
    const role = (fontSize: number, color: string) => ({
      fontFamily: 'Georgia', fontSize, fontWeight: '400', color, lineHeight: 1.4,
      spaceBefore: 2, spaceAfter: 4, alignment: 'left',
    })
    const callout = { label: 'WARNING', accentColor: '#AA5500', bgColor: '#FFF2DD', textColor: '#334455' }
    const style = {
      id: 'preview-style', name: 'Verified Brand Style', clientId: theme.id, scope: 'project',
      primaryColor: '#123ABC', headingTextColor: '#1655AA', bodyTextColor: '#334455',
      headingFont: 'Georgia', bodyFont: 'Arial', accentColor: '#AA5500', linkColor: '#1655AA',
      h1: role(22, '#1655AA'), h2: role(16, '#1655AA'), h3: role(14, '#1655AA'),
      h4: role(12, '#1655AA'), body: role(11, '#334455'), caption: role(9, '#667788'),
      code: role(10, '#334455'), links: { color: '#1655AA', underline: true },
      lists: { bulletL1: '•', bulletL2: '○', bulletL3: '–', itemSpacing: 4, indentation: 14 },
      tables: { headerBgColor: '#123ABC', headerTextColor: '#FFFFFF', bodyTextColor: '#334455',
        borderColor: '#ABCDEF', borderWidth: 1, cellPadding: 6, alternateRows: false },
      callouts: { note: callout, tip: callout, important: callout, warning: callout, example: callout },
    }
    theme.styleProfiles = [style]
    record.activeStyleProfileId = style.id
    meta.styleProfileId = style.id
    const layouts = record.pageLayouts as Array<{
      layoutType: string; name: string; pageSize: string; orientation: string
      marginLeft: number; marginRight: number; brandOverrides: { bgColor?: string }
    }>
    const content = layouts.find(item => item.layoutType === 'content')!
    if (!content) throw new Error(`No persisted content layout: ${JSON.stringify(record.pageLayouts)}`)
    content.name = 'Selected Letter Layout'
    content.pageSize = 'Letter'
    content.orientation = 'landscape'
    content.marginLeft = 31
    content.marginRight = 27
    content.brandOverrides = { bgColor: '#F0FAFC' }
    const masters = record.htmlMasterPages as Array<{
      id: string; name: string; masterType: string; showHeader: boolean; showLeftNav: boolean; showFooter: boolean
      showOnThisPage?: boolean; blocks?: Array<{ id: string; type: string; props?: Record<string, unknown> }>
    }>
    const defaultMaster = masters.find(item => item.masterType === 'topic')!
    if (!defaultMaster) throw new Error(`No persisted topic master: ${JSON.stringify(record.htmlMasterPages)}`)
    const custom = { ...structuredClone(defaultMaster), id: 'custom-master', name: 'Assigned HTML master',
      showHeader: false, showLeftNav: true, showFooter: false, showOnThisPage: true,
      blocks: [
        { id: 'head', type: 'header' },
        { id: 'notice', type: 'announcement-banner', props: { text: 'Saved master announcement' } },
        { id: 'body', type: 'body' },
        { id: 'rich', type: 'rich-text', props: { content: 'Saved master after the Body' } },
        { id: 'crumb', type: 'breadcrumb' },
        { id: 'search', type: 'search' },
        { id: 'foot', type: 'footer' },
      ] }
    masters.push(custom)
    record.masterAssignments = { '3': custom.id }
    await saveProject(record)
  }, png)
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Publish,/ }).click()
  await expect(page.getByTestId('publish-conditional-warning')).toContainText('HTML export condition context is required')
  await page.getByRole('button', { name: 'Full Preview' }).click()
  const preview = page.getByTestId('project-preview')
  await expect(preview).toBeVisible()
  const nav = preview.getByRole('navigation', { name: 'Committed table of contents' })
  await expect(nav.locator('a')).toHaveText(['Zeta Atlas', 'Alpha section', 'Needs Grounding topic'])
  await expect(nav.locator('a').first()).toHaveAttribute('href', /preview-topic-stable-z/)
  const articles = preview.locator('article[data-topic-id]')
  await expect(articles).toHaveCount(3)
  await expect(articles.nth(0)).toHaveAttribute('data-topic-id', 'stable-z')
  await expect(articles.nth(1)).toHaveAttribute('data-topic-id', 'stable-a')
  await expect(articles.nth(1)).toHaveAttribute('data-master-id', 'custom-master')
  await expect(articles.nth(1)).toContainText('Assigned HTML master')
  await expect(articles.nth(1).locator('header')).toHaveCount(0)
  await expect(articles.nth(1).locator('footer')).toHaveCount(0)
  const composed = await articles.nth(1).textContent() ?? ''
  expect(composed.indexOf('Saved master announcement')).toBeLessThan(composed.indexOf('Stable Alpha content'))
  expect(composed.indexOf('Stable Alpha content')).toBeLessThan(composed.indexOf('Saved master after the Body'))
  expect(composed.indexOf('Saved master after the Body')).toBeLessThan(composed.indexOf('Preview fidelity / Alpha section'))
  await expect(articles.nth(1)).toContainText('On this topic')
  await expect(articles.nth(1).getByRole('link', { name: 'Alpha detail' })).toHaveAttribute('href', '#preview-block-stable-a-alpha-heading')
  await expect(articles.nth(1).getByTestId('preview-master-limitations')).toContainText('search')
  await expect(articles.nth(1).getByRole('searchbox')).toHaveCount(0)
  await expect(articles.nth(2)).toContainText('Needs Grounding — no content authored')
  await expect(articles.nth(0)).toContainText('Real Atlas paragraph with {{UNKNOWN}}')
  for (const text of ['Setup details', 'List entry', 'Procedure label', 'Open Atlas', 'Header A',
    'Saved cell', 'Review this', 'Quoted fact', 'const saved = true', 'Real figure', 'Additional caption']) {
    await expect(articles.nth(0)).toContainText(text)
  }
  await expect(articles.nth(0).getByRole('img', { name: 'Real figure' })).toHaveAttribute('src', png)
  await expect(articles.nth(0).getByRole('link', { name: '#topic-stable-a' })).toHaveAttribute('href', '#preview-topic-stable-a')
  await expect(articles.nth(0).getByRole('link', { name: 'https://example.com/help' })).toHaveAttribute('href', 'https://example.com/help')
  await expect(preview.getByRole('alert').filter({ hasText: 'Unresolved variables' })).toContainText('{{UNKNOWN}}')
  await expect(preview.getByTestId('preview-conditional-export-warning')).toContainText('HTML export refuses to publish')
  await expect(preview.getByTestId('preview-conditional-export-warning')).toContainText('Zeta Atlas (1 conditional block)')
  await expect(preview.getByText('Selected Letter Layout')).toBeVisible()
  await expect(preview.getByText('Verified Brand Style')).toBeVisible()
  await expect(articles.nth(0)).toHaveCSS('background-color', 'rgb(240, 250, 252)')
  await expect(articles.nth(0).locator('h2').first()).toHaveCSS('color', 'rgb(22, 85, 170)')
  await expect(preview).not.toContainText('Restricted unpublished content')
  await expect(preview).toContainText('Conditional block not shown')
  await expect(preview).not.toContainText('Stale editor heading')
  await expect(preview).not.toContainText('Old numeric-key content')
  await expect(preview).not.toContainText('Stale active editor excerpt')
  await expect(preview).not.toContainText('Nexus Platform')

  // Rename and reorder committed titles without moving or rewriting stable-ID content.
  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    const topics = record.appToc as Array<{ topicId: string; title: string }>
    const alpha = topics.find(topic => topic.topicId === 'stable-a')!
    alpha.title = 'Renamed Alpha'
    record.appToc = [alpha, ...topics.filter(topic => topic.topicId !== alpha.topicId)]
    await saveProject(record)
  })
  await page.reload()
  await openPreview(page)
  await expect(page.getByTestId('project-preview').getByRole('navigation', { name: 'Committed table of contents' }).locator('a'))
    .toHaveText(['Renamed Alpha', 'Zeta Atlas', 'Needs Grounding topic'])
  const reordered = page.getByTestId('project-preview').locator('article[data-topic-id]')
  await expect(reordered.first()).toHaveAttribute('data-topic-id', 'stable-a')
  await expect(reordered.first()).toContainText('Stable Alpha content')
  await expect(reordered.nth(1)).toContainText('Real Atlas paragraph')

  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    const master = (record.htmlMasterPages as Array<{ id: string; blocks: Array<{ type: string; props?: Record<string, unknown> }> }>)
      .find(item => item.id === 'custom-master')!
    master.blocks.find(block => block.type === 'body')!.props = { hidden: true }
    await saveProject(record)
  })
  await page.reload()
  await openPreview(page)
  const hidden = page.getByTestId('project-preview').locator('article[data-topic-id="stable-a"]')
  await expect(hidden).toContainText('HTML export rejects this topic')
  await expect(hidden.getByTestId('preview-authored-content')).toContainText('Stable Alpha content')
})

test('real empty Preview and Publish format summaries do not show demo content or pretend output details', async ({ page }) => {
  await createProject(page)
  await openPreview(page)
  await expect(page.getByTestId('project-preview')).toContainText('No committed topics yet.')
  await expect(page.getByTestId('project-preview')).not.toContainText('Nexus Platform')
  await page.getByRole('button', { name: 'Go to Publish' }).click()
  const summary = page.getByTestId('publish-format-summary')
  await expect(summary).toContainText('0')
  await expect(summary).toContainText('not a rendered output file')
  await expect(summary).not.toContainText('Search…')
  await expect(summary).not.toContainText('Page 2')
  await expect(summary).not.toContainText('Last updated')
  await page.getByRole('button', { name: /^word$/i }).click()
  await expect(summary).toContainText('Editable Word output')
  await page.getByRole('button', { name: /^html$/i }).click()
  await expect(summary).toContainText('Responsive HTML topic pages')
  await expect(summary).not.toContainText('help.previewfidelity.com')
})

test('demo Preview remains isolated from the real-project renderer', async ({ page }) => {
  await createProject(page)
  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    record.isDemoMode = true
    await saveProject(record)
  })
  await page.reload()
  await openPreview(page)
  await expect(page.getByTestId('project-preview')).toHaveCount(0)
  await expect(page.getByText('Nexus Platform v3.2')).toBeVisible()
})