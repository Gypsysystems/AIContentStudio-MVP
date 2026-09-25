import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { buildPublishProjection, flattenPublishBlocks } from '../../src/publishProjection'

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
  const first = await archive.file('topics/topic-1.html')!.async('string')
  const second = await archive.file('topics/topic-2.html')!.async('string')
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