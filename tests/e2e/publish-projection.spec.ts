import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import JSZip from 'jszip'
import { buildPublishProjection, flattenPublishBlocks } from '../../src/publishProjection'
import { generateHtmlPackage, getHtmlPublishDiagnostics, htmlTopicFile } from '../../src/htmlPublisher'

function input() {
  return {
    projectName: 'Guide',
    topics: [
      { id: 7, topicId: 'stable-a', title: 'First', level: 1 },
      { id: 2, topicId: 'stable-b', title: 'Second', level: 2 },
      { id: 9, topicId: 'stable-c', title: 'Third', level: 1 },
    ],
    topicContent: {
      'stable-a': [{ id: 'a', type: 'h1', content: 'Old First' }, { id: 'a2', type: 'para', content: 'First body' }],
      'stable-b': [{ id: 'b', type: 'para', content: 'Second body' }],
      'stable-c': [{ id: 'c', type: 'h1', content: 'Third' }],
    },
    masterAssignments: { 2: 'custom' },
    variables: [{ name: 'PRODUCT', value: 'Workspace' }],
    theme: { id: 'theme', name: 'Theme' },
    styleProfile: { id: 'canonical', name: 'Selected rich style', primaryColor: '#123456' },
    legacyBrandProfile: { id: 'legacy', name: 'Legacy', primaryColor: '#123456' },
    templatePack: { id: 'pack', name: 'Pack' },
    pageLayouts: [{ id: 'cover', name: 'Cover', layoutType: 'cover' }, { id: 'content', name: 'Content', layoutType: 'content' }],
    htmlMasters: [{ id: 'home', name: 'Home', masterType: 'home' }, { id: 'custom', name: 'Custom', masterType: 'topic' }],
  }
}

test('exports every committed topic in TOC order, with its stable ID and master reference', () => {
  const source = input()
  const projection = buildPublishProjection(source)
  expect(projection.topics.map(topic => [topic.topicId, topic.title, topic.blocks.map(block => block.id)]))
    .toEqual([
      ['stable-a', 'First', ['a', 'a2']],
      ['stable-b', 'Second', ['b']],
      ['stable-c', 'Third', ['c']],
    ])
  expect(projection.topics[1].assignedMasterId).toBe('custom')
  expect(projection.topics[1].assignedMaster?.id).toBe('custom')
  expect(projection.styleProfile.id).toBe('canonical')
  expect(projection.contentLayout?.id).toBe('content')
  expect(projection.homeMaster?.id).toBe('home')
  expect(flattenPublishBlocks(projection).map(block => block.content))
    .toEqual(['First', 'First body', 'Second', 'Second body', 'Third'])
  // Projection and compatibility adapter must not change persisted Author content.
  expect(source.topicContent['stable-a'][0].content).toBe('Old First')
})

test('renames and reorders by committed TOC, not by old headings or object key order', () => {
  const source = input()
  source.topics = [
    { id: 9, topicId: 'stable-c', title: 'Renamed Third', level: 1 },
    { id: 7, topicId: 'stable-a', title: 'Renamed First', level: 1 },
    { id: 2, topicId: 'stable-b', title: 'Second', level: 2 },
  ]
  const projection = buildPublishProjection(source)
  expect(projection.topics.map(topic => topic.title)).toEqual(['Renamed Third', 'Renamed First', 'Second'])
  expect(projection.topics[1].blocks[1].content).toBe('First body')
  expect(flattenPublishBlocks(projection).filter(block => block.type === 'h1').map(block => block.content))
    .toEqual(['Renamed Third', 'Renamed First', 'Second'])
})

test('missing and empty topics stay explicit; stable content wins over numeric legacy content', () => {
  const source = input()
  source.topicContent = {
    'stable-a': [],
    '7': [{ id: 'obsolete', type: 'para', content: 'Should not return' }],
    '2': [{ id: 'legacy', type: 'para', content: 'Legacy body' }],
  }
  const projection = buildPublishProjection(source)
  expect(projection.topics.map(topic => topic.blocks.map(block => block.id))).toEqual([[], ['legacy'], []])
  expect(flattenPublishBlocks(projection).map(block => block.content))
    .toEqual(['First', 'Second', 'Legacy body', 'Third'])
})

test('resolves all authored text fields, warns for unknown and cyclic variables, and keeps media intact', () => {
  const source = input()
  const image = 'data:image/png;base64,AAAA'
  source.variables = [
    { name: 'PRODUCT', value: 'Workspace' },
    { name: 'LONG_NAME', value: '{{PRODUCT}} Pro' },
    { name: 'CYCLE', value: '{{CYCLE}}' },
  ]
  source.topicContent = {
    'stable-a': [
      { id: 'a', type: 'para', content: '{{LONG_NAME}} / {{MISSING}} / {{CYCLE}}' },
      { id: 'list', type: 'list', content: '', listItems: [{ id: 'li', text: '{{PRODUCT}}', level: 1, type: 'bullet' }] },
      { id: 'table', type: 'table', content: '', tableData: { rows: [['{{PRODUCT}}', '{{MISSING}}']], hasHeader: true } },
      { id: 'steps', type: 'procedure', content: '{{PRODUCT}}', procedureSteps: ['Open {{LONG_NAME}}'] },
      { id: 'image', type: 'media', content: '', mediaType: image, caption: '{{PRODUCT}} image / {{UNKNOWN}}' },
    ],
  } as typeof source.topicContent
  const projection = buildPublishProjection(source)
  const [paragraph, list, table, steps, media] = projection.topics[0].blocks
  expect(paragraph.content).toBe('Workspace Pro / {{MISSING}} / {{CYCLE}}')
  expect(list.listItems?.[0].text).toBe('Workspace')
  expect(table.tableData?.rows).toEqual([['Workspace', '{{MISSING}}']])
  expect(steps.procedureSteps).toEqual(['Open Workspace Pro'])
  expect(media.mediaType).toBe(image)
  expect(media.caption).toBe('Workspace image / {{UNKNOWN}}')
  expect(projection.unresolvedVariables).toEqual([
    { topicId: 'stable-a', blockId: 'a', field: 'content', name: 'MISSING' },
    { topicId: 'stable-a', blockId: 'a', field: 'content', name: 'CYCLE' },
    { topicId: 'stable-a', blockId: 'table', field: 'tableData.rows[0][1]', name: 'MISSING' },
    { topicId: 'stable-a', blockId: 'image', field: 'caption', name: 'UNKNOWN' },
  ])
  expect(source.topicContent['stable-a'][4].caption).toBe('{{PRODUCT}} image / {{UNKNOWN}}')
  expect(projection.topics[0].blocks[4]).not.toBe(source.topicContent['stable-a'][4])
})

test('rebuilds the same projection from the persisted project after a browser reload', async ({ page }) => {
  const id = `publish-projection-${Date.now()}`
  await page.goto('/')
  await page.evaluate(async projectId => {
    const { createProject } = await import('/src/projectRepository.ts' as string)
    await createProject({
      projectId, projectName: 'Reloaded Guide',
      appToc: [{ id: 42, topicId: 'persisted-topic', title: 'Renamed {{PRODUCT}}', level: 1, words: 0 }],
      topicContent: { 'persisted-topic': [{ id: 'saved', type: 'para', content: 'Hello {{PRODUCT}}' }] },
      docBlocks: [{ id: 'stale', type: 'para', content: 'Wrong active topic' }],
      themeVariables: { theme: [{ name: 'PRODUCT', value: 'Workspace' }] },
      masterAssignments: { 42: 'master' },
    })
  }, id)
  await page.reload()
  const result = await page.evaluate(async projectId => {
    const { loadProject, deleteProject } = await import('/src/projectRepository.ts' as string)
    const { buildPublishProjection, flattenPublishBlocks } = await import('/src/publishProjection.ts' as string)
    const record = await loadProject(projectId)
    if (!record) throw new Error('Persisted project missing after reload')
    const projection = buildPublishProjection({
      projectName: record.projectName,
      topics: record.appToc,
      topicContent: record.topicContent,
      masterAssignments: record.masterAssignments,
      variables: record.themeVariables.theme,
      theme: { id: 'theme', name: 'Theme' },
      styleProfile: { id: 'profile', name: 'Profile' },
      legacyBrandProfile: null,
      templatePack: null,
      pageLayouts: [],
      htmlMasters: [],
    })
    await deleteProject(projectId)
    return {
      topics: projection.topics.map((topic: { topicId: string; title: string; blocks: Array<{ content: string }> }) =>
        [topic.topicId, topic.title, topic.blocks.map(block => block.content)]),
      flat: flattenPublishBlocks(projection).map((block: { content: string }) => block.content),
      assignments: projection.topics.map((topic: { assignedMasterId: string }) => topic.assignedMasterId),
    }
  }, id)
  expect(result).toEqual({
    topics: [['persisted-topic', 'Renamed Workspace', ['Hello Workspace']]],
    flat: ['Renamed Workspace', 'Hello Workspace'],
    assignments: ['master'],
  })
})

test('Publish downloads every persisted topic, not the stale active Author block', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('Publish projection test')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('docflow-active-project'))).not.toBeNull()

  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const id = getActiveProjectId()
    const record = id && await loadProject(id)
    if (!record) throw new Error('Project was not created')
    record.appToc = [
      { id: 1, topicId: 'topic-a', title: 'Renamed Alpha', level: 1, words: 0 },
      { id: 2, topicId: 'topic-b', title: 'Beta', level: 1, words: 0 },
    ]
    record.topicContent = {
      'topic-a': [{ id: 'a-h1', type: 'h1', content: 'Old Alpha' }, { id: 'a-body', type: 'para', content: 'Alpha persisted body' }],
      'topic-b': [{ id: 'b-body', type: 'para', content: 'Beta persisted body' }],
    }
    record.docBlocks = [{ id: 'stale', type: 'para', content: 'Do not publish stale ref' }]
    await saveProject(record)
  })
  await page.reload()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Publish Document' })).toBeVisible()
  await page.locator('label').filter({ hasText: 'HTML' }).locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText('HTML Ready', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadPromise
  const archive = await JSZip.loadAsync(await readFile(await download.path()))
  const index = await archive.file('index.html')!.async('string')
  const first = await archive.file(htmlTopicFile('topic-a'))!.async('string')
  const second = await archive.file(htmlTopicFile('topic-b'))!.async('string')
  expect(index).toContain('Renamed Alpha')
  expect(index).toContain('Beta')
  expect(first).toContain('Alpha persisted body')
  expect(first).not.toContain('Old Alpha')
  expect(second).toContain('Beta persisted body')
  expect(second).not.toContain('Do not publish stale ref')
  const stored = await page.evaluate(async () => {
    const { getActiveProjectId, loadProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    return {
      firstHeading: record.topicContent['topic-a'][0].content,
      activeBlock: record.docBlocks[0].content,
      reviewFindingCount: record.reviewModel.findings.length,
    }
  })
  expect(stored).toEqual({
    firstHeading: 'Old Alpha',
    activeBlock: 'Do not publish stale ref',
    reviewFindingCount: 0,
  })
})

test('HTML ZIP preserves stable topics, master composition, real destinations, brand tokens, and media', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yn8AAAAASUVORK5CYII='
  const projection = buildPublishProjection({
    ...input(),
    projectName: 'Guide <& "Alpha">',
    topicContent: {
      'stable-a': [
        { id: 'a', type: 'h1', content: 'Obsolete heading' },
        { id: 'heading', type: 'h2', content: 'Install & <setup>' },
        { id: 'text', type: 'para', content: 'Read <script>alert(1)</script> & learn' },
        { id: 'media', type: 'media', content: '', mediaType: png, caption: 'Diagram "one"' },
        { id: 'note', type: 'callout', content: 'Careful & clear', calloutVariant: 'note' },
        { id: 'table', type: 'table', content: '', tableData: { rows: [['<th>', '& text']] } },
      ],
      'stable-b': [{ id: 'b', type: 'para', content: 'Second body' }],
      'stable-c': [],
    },
    styleProfile: {
      id: 'canonical', name: 'Selected rich style', primaryColor: '#123456',
      secondaryColor: '#242424', headingTextColor: '#abcdef', bodyTextColor: '#222222',
      linkColor: '#bcdef0', borderColorToken: '#fedcba', tableHeaderBgToken: '#aabbcc',
      callouts: { note: { accentColor: '#a1b2c3', bgColor: '#d4e5f6', textColor: '#111222' } },
      headingFont: 'Example Sans',
      logoLabel: 'GL', logoDataUrl: png,
    },
    htmlMasters: [
      {
        id: 'home', name: 'Home', masterType: 'home', showHeader: true, showLogo: true,
        showSearch: true, showHero: true, showNavCards: true, showFooter: true,
        blocks: [
          { id: 'header', type: 'header', props: { siteTitle: 'Site <title>', bgColor: '#778899' } },
          { id: 'cards', type: 'navigation-cards', props: { title: 'Explore', cards: [
            { id: 'good', title: 'Read', desc: 'A & B', icon: '→', destinationType: 'topic', topicId: 2 },
            { id: 'missing', title: 'Missing', destinationType: 'topic', topicId: 99 },
            { id: 'unsafe', title: 'Unsafe', destinationType: 'external-url', url: 'javascript:alert(1)' },
            { id: 'external', title: 'Web', destinationType: 'external-url', url: 'https://example.com/?a=1&b=2' },
            { id: 'file', title: 'Unpacked file', destinationType: 'file', fileName: 'missing.pdf' },
            { id: 'logo', title: 'Brand logo', destinationType: 'file', fileName: 'logo.png' },
          ] } },
          { id: 'footer', type: 'footer', props: { copyrightText: 'Copyright <safe>' } },
        ],
      },
      { id: 'default', name: 'Default', masterType: 'topic', showBreadcrumb: true, showFooter: true },
      {
        id: 'custom', name: 'Custom', masterType: 'topic', showHeader: false, showBreadcrumb: false,
        showLeftNav: true, showOnThisPage: true, showPrevNext: false, showFooter: true,
        blocks: [
          { id: 'header', type: 'header' },
          { id: 'heading', type: 'heading', props: { text: 'Special topic' } },
          { id: 'body', type: 'body' },
          { id: 'footer', type: 'footer', props: { copyrightText: 'Custom footer' } },
        ],
      },
    ],
  })
  const diagnostics = getHtmlPublishDiagnostics(projection)
  expect(diagnostics).toMatchObject({ topicPages: 3, validCards: 3, unavailableCards: 3, missingAssignedMasters: 0, assetError: null })
  const archive = await JSZip.loadAsync(await generateHtmlPackage(projection).then(blob => blob.arrayBuffer()))
  const files = Object.keys(archive.files).filter(path => !archive.files[path].dir)
  expect(files).toEqual(expect.arrayContaining([
    'index.html', htmlTopicFile('stable-a'), htmlTopicFile('stable-b'), htmlTopicFile('stable-c'),
    'css/theme.css', 'js/search.js', 'assets/logo.png',
  ]))
  expect(files.filter(path => path.startsWith('topics/'))).toHaveLength(3)
  const home = await archive.file('index.html')!.async('string')
  const first = await archive.file(htmlTopicFile('stable-a'))!.async('string')
  const second = await archive.file(htmlTopicFile('stable-b'))!.async('string')
  const third = await archive.file(htmlTopicFile('stable-c'))!.async('string')
  const css = await archive.file('css/theme.css')!.async('string')
  expect(home).toContain('background-color:#778899')
  expect(home).toContain('Site &lt;title&gt;')
  expect(home).toContain(`href="${htmlTopicFile('stable-b')}"`)
  expect(home).toContain('data-link-state="unavailable"')
  expect(home).not.toContain('href="#"')
  expect(home).not.toContain('href="javascript:')
  expect(home).toContain('href="https://example.com/?a=1&amp;b=2"')
  expect(home).toContain('href="assets/logo.png"')
  expect(home).toContain('Copyright &lt;safe&gt;')
  expect(home).not.toContain('Getting Started Guide')
  expect(first).toContain('<h1>First</h1>')
  expect(first).not.toContain('Obsolete heading')
  expect(first).toContain('id="section-1"')
  expect(first).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; learn')
  expect(first).toContain('alt="Diagram &quot;one&quot;"')
  expect(first).toContain('&lt;th&gt;')
  expect(first).toContain('class="callout note"')
  expect(first).toContain('Careful &amp; clear')
  expect(first).toContain(`href="../${htmlTopicFile('stable-b')}"`)
  expect(first).not.toContain('topic-1.html')
  expect(second).toContain('data-master-id="custom"')
  expect(second).toContain('Special topic')
  expect(second).toContain('Custom footer')
  expect(second).not.toContain('class="site-header')
  expect(second).not.toContain('class="breadcrumb')
  expect(third).toContain('<h1>Third</h1>')
  expect(third).toContain('data-master-id="default"')
  expect(css).toContain('--heading:#abcdef')
  expect(css).toContain('--link:#bcdef0')
  expect(css).toContain('--heading-font:"Example Sans"')
  expect(css).toContain('--table-header:#aabbcc')
  expect(css).toContain('.callout.note{background:#d4e5f6;border-left-color:#a1b2c3;color:#111222}')
  expect(await archive.file('assets/logo.png')!.async('uint8array')).toHaveLength(68)
  expect(files.some(path => path.startsWith('assets/media-'))).toBe(true)
  const mediaFile = files.find(path => path.startsWith('assets/media-'))!
  expect(first).toContain(`src="../${mediaFile}"`)
  for (const fileName of files.filter(path => path.endsWith('.html'))) {
    const html = await archive.file(fileName)!.async('string')
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith('https://') || href.startsWith('http://') || href.startsWith('#')) continue
      const target = posix.normalize(posix.join(posix.dirname(fileName), href.split('#')[0]))
      expect(files, `Broken link ${href} in ${fileName}`).toContain(target)
    }
  }
  const search = await archive.file('js/search.js')!.async('string')
  expect(search).toContain(htmlTopicFile('stable-b'))
  expect(search).toContain('second body')
})

test('HTML ZIP reports unsupported image data instead of emitting a dead asset', async () => {
  const projection = buildPublishProjection({
    ...input(),
    topicContent: {
      'stable-a': [{ id: 'svg', type: 'media', content: '', mediaType: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }],
    },
  })
  expect(getHtmlPublishDiagnostics(projection).assetError).toContain('supported raster image')
  await expect(generateHtmlPackage(projection)).rejects.toThrow('supported raster image')
})

test('HTML media QA rejects invalid bytes before generation', async () => {
  const projection = buildPublishProjection({
    ...input(),
    topicContent: {
      'stable-a': [{ id: 'bad-image', type: 'media', content: '', mediaType: 'data:image/png;base64,AAAA' }],
    },
  })
  expect(getHtmlPublishDiagnostics(projection).assetError).toContain('could not decode an image')
  await expect(generateHtmlPackage(projection)).rejects.toThrow('could not decode an image')
})

test('Home keeps committed topics reachable when configured cards have no destinations', async () => {
  const projection = buildPublishProjection({
    ...input(),
    htmlMasters: [
      { id: 'home', name: 'Home', masterType: 'home', showNavCards: true, blocks: [
        { id: 'cards', type: 'navigation-cards', props: { cards: [
          { id: 'unlinked', title: 'No destination', destinationType: 'none' },
        ] } },
      ] },
      { id: 'custom', name: 'Custom', masterType: 'topic' },
    ],
  })
  const archive = await JSZip.loadAsync(await generateHtmlPackage(projection).then(blob => blob.arrayBuffer()))
  const home = await archive.file('index.html')!.async('string')
  for (const topic of projection.topics) {
    expect(home).toContain(`href="${htmlTopicFile(topic.topicId)}"`)
  }
  expect(home).toContain('data-link-state="unavailable"')
})

test('HTML export and QA reject a master that explicitly hides topic content', async () => {
  const projection = buildPublishProjection({
    ...input(),
    htmlMasters: [
      { id: 'home', name: 'Home', masterType: 'home' },
      { id: 'custom', name: 'Custom', masterType: 'topic', blocks: [
        { id: 'body', type: 'body', props: { hidden: true } },
      ] },
    ],
  })
  expect(getHtmlPublishDiagnostics(projection).hiddenTopicBodies).toBe(3)
  await expect(generateHtmlPackage(projection)).rejects.toThrow('hides the topic Body block')
})