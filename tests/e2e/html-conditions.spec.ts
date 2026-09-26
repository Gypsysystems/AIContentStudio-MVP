import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { buildPublishProjection } from '../../src/publishProjection'
import { generateHtmlPackage, htmlTopicFile } from '../../src/htmlPublisher'
import { generatePdfDocument } from '../../src/pdfPublisher'
import { generateWordDocument } from '../../src/wordPublisher'
import type { StyleProfile } from '../../src/App'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const typography = (fontFamily: string, fontSize: number, color: string) => ({
  fontFamily, fontSize, fontWeight: '700', color, lineHeight: 1.4,
  spaceBefore: 2, spaceAfter: 4, alignment: 'left' as const,
})
const styleProfile = {
  id: 'canonical', name: 'Canonical', clientId: 'test', scope: 'project',
  primaryColor: '#123456', headingTextColor: '#13579B', bodyTextColor: '#243648',
  linkColor: '#2468AC', surfaceColor: '#EFF0F1', borderColorToken: '#ABCDEF',
  tableHeaderBgToken: '#334455', logoDataUrl: png, logoLabel: 'AC',
  headingFont: 'Georgia', bodyFont: 'Tahoma', codeFont: 'Consolas',
  body: typography('Tahoma', 11, '#243648'),
  h1: typography('Georgia', 22, '#13579B'),
  h2: typography('Georgia', 16, '#13579B'),
  h3: typography('Georgia', 13, '#13579B'),
  h4: typography('Georgia', 12, '#13579B'),
  caption: typography('Tahoma', 9, '#667788'),
  code: typography('Consolas', 10, '#182736'),
  links: { color: '#2468AC', underline: true },
  lists: { orderedL1: '1.', orderedL2: 'a.', orderedL3: 'i.', bulletL1: '•',
    bulletL2: '○', bulletL3: '–', itemSpacing: 4, indentation: 24 },
  tables: { headerFontWeight: '700', headerTextColor: '#FFFFFF', headerBgColor: '#222222',
    bodyTextColor: '#243648', borderColor: '#ABCDEF', borderWidth: 1, cellPadding: 8,
    alternateRows: true, alternateRowColor: '#F9FAFB', firstColEmphasis: false },
  callouts: Object.fromEntries(['note', 'tip', 'important', 'warning', 'example'].map(kind => [kind, {
    label: `${kind.toUpperCase()} label`, accentColor: '#556677', bgColor: '#E1E2E3', textColor: '#334455',
  }])),
} as StyleProfile

function fixture(withConditions = true) {
  const conditions = (tags: string[]) => withConditions ? { conditions: tags } : {}
  return buildPublishProjection({
    projectName: 'Conditioned Manual',
    topics: [
      { id: 20, topicId: 'topic-beta', title: 'Beta {{PRODUCT}}', level: 1 },
      { id: 10, topicId: 'topic-alpha', title: 'Alpha Manual', level: 2 },
      { id: 30, topicId: 'topic-empty', title: 'Empty Topic', level: 1 },
    ],
    topicContent: {
      'topic-beta': [
        { id: 'intro', type: 'para', content: 'Unconditional {{PRODUCT}} introduction.' },
        { id: 'internal', type: 'para', content: 'Internal-only searchable content.', ...conditions(['internal', 'partner']) },
        { id: 'internal-media', type: 'media', content: '', mediaType: png, caption: 'Internal-only diagram.', ...conditions(['internal']) },
        { id: 'external', type: 'media', content: '', mediaType: png, caption: 'External-only media secret.', ...conditions(['external']) },
      ],
      'topic-alpha': [
        { id: 'alpha-body', type: 'para', content: 'Unconditional Alpha content.' },
        { id: 'alpha-internal', type: 'para', content: 'Second internal passage.', ...conditions(['internal']) },
      ],
      'topic-empty': [],
    },
    masterAssignments: {},
    variables: [{ name: 'PRODUCT', value: 'Workspace' }],
    theme: { id: 'theme', name: 'Theme' },
    styleProfile,
    legacyBrandProfile: null,
    templatePack: null,
    pageLayouts: [
      { id: 'cover', name: 'Cover', layoutType: 'cover' },
      { id: 'content', name: 'Content', layoutType: 'content' },
    ],
    htmlMasters: [
      { id: 'home', name: 'Home', masterType: 'home', showSearch: true },
      { id: 'topic', name: 'Topic', masterType: 'topic' },
    ],
  })
}

async function archiveFor(projection: ReturnType<typeof fixture>, selectedCondition?: string) {
  const blob = selectedCondition === undefined
    ? await generateHtmlPackage(projection)
    : await generateHtmlPackage(projection, { selectedCondition })
  return JSZip.loadAsync(await blob.arrayBuffer())
}

async function openPublish(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('HTML conditions QA')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('docflow-active-project'))).not.toBeNull()
  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    record.appToc = [{ id: 20, topicId: 'topic-beta', title: 'Beta', level: 1, words: 0 }]
    record.topicContent = {
      'topic-beta': [
        { id: 'public', type: 'para', content: 'Unconditional content.' },
        { id: 'private', type: 'para', content: 'Internal content.', conditions: ['internal'] },
        { id: 'external', type: 'para', content: 'External content.', conditions: ['external'] },
      ],
    }
    record.publishConfig = { selectedFormats: ['html'], activeVariant: '' }
    await saveProject(record)
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Publish,/ }).click()
  await expect(page.getByRole('heading', { name: 'Publish Document' })).toBeVisible()
}

test('HTML fails closed when conditional blocks have no selected audience or an invalid selection', async () => {
  const projection = fixture()
  await expect(generateHtmlPackage(projection)).rejects.toThrow(/condition context is required/i)
  await expect(generateHtmlPackage(projection, { selectedCondition: 'unconfigured' }))
    .rejects.toThrow(/condition context is required|valid.*condition/i)
  const malformed = fixture()
  malformed.topics[0].blocks[0].conditions = 'internal' as unknown as string[]
  await expect(generateHtmlPackage(malformed, { selectedCondition: 'internal' }))
    .rejects.toThrow(/malformed block conditions/i)
})

test('HTML filters by the selected condition, preserves unconditional content and TOC order, and excludes other content from search and assets', async () => {
  const projection = fixture()
  const archive = await archiveFor(projection, 'internal')
  const files = Object.keys(archive.files).filter(path => !archive.files[path].dir)
  expect(files).toEqual(expect.arrayContaining([
    'index.html',
    htmlTopicFile('topic-beta'),
    htmlTopicFile('topic-alpha'),
    htmlTopicFile('topic-empty'),
    'js/search.js',
  ]))
  expect(files.filter(path => path.startsWith('topics/'))).toEqual([
    htmlTopicFile('topic-beta'),
    htmlTopicFile('topic-alpha'),
    htmlTopicFile('topic-empty'),
  ])
  expect(files.filter(path => path.startsWith('assets/media-'))).toHaveLength(1)

  const home = await archive.file('index.html')!.async('string')
  const beta = await archive.file(htmlTopicFile('topic-beta'))!.async('string')
  const alpha = await archive.file(htmlTopicFile('topic-alpha'))!.async('string')
  const search = await archive.file('js/search.js')!.async('string')
  expect(home.indexOf('Beta Workspace')).toBeLessThan(home.indexOf('Alpha Manual'))
  expect(home.indexOf('Alpha Manual')).toBeLessThan(home.indexOf('Empty Topic'))
  expect(beta).toContain('Unconditional Workspace introduction.')
  expect(beta).toContain('Internal-only searchable content.')
  expect(beta).toContain('Internal-only diagram.')
  expect(beta).not.toContain('External-only media secret.')
  expect(beta).toContain('assets/media-')
  expect(alpha).toContain('Unconditional Alpha content.')
  expect(alpha).toContain('Second internal passage.')
  expect(search).toContain('internal-only searchable content.')
  expect(search).not.toContain('external-only media secret.')
  for (const html of [home, beta, alpha]) expect(html).not.toContain('Nexus Platform')
})

test('HTML without conditional blocks remains publishable without an audience selection', async () => {
  const archive = await archiveFor(fixture(false))
  const beta = await archive.file(htmlTopicFile('topic-beta'))!.async('string')
  expect(beta).toContain('Unconditional Workspace introduction.')
  expect(beta).toContain('Internal-only searchable content.')
  expect(beta).toContain('alt="Internal-only diagram."')
  expect(beta).toContain('alt="External-only media secret."')
  expect(Object.keys(archive.files).filter(path => path.startsWith('assets/media-'))).toHaveLength(2)
})

test('Word and PDF continue to reject conditional blocks without changing their safety rule', async () => {
  const projection = fixture()
  await expect(generateWordDocument(projection)).rejects.toThrow('cannot safely apply conditions')
  await expect(generatePdfDocument(projection)).rejects.toThrow('cannot safely apply conditions')
})

test('Publish QA explains missing HTML condition context and selected condition persists', async ({ page }) => {
  await openPublish(page)
  const conditionQaRow = page.getByText('HTML Conditions', { exact: true }).locator('..')
  await expect(conditionQaRow).toContainText(/condition context is required/i)
  await expect(page.getByTestId('publish-conditional-warning')).toContainText(/condition context is required/i)

  const audience = page.getByRole('combobox', { name: 'HTML audience condition' })
  await expect(audience).toBeVisible()
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText(/HTML generation failed:.*condition context is required/i)).toBeVisible()

  await audience.selectOption('internal')
  await expect.poll(async () => page.evaluate(async () => {
    const { getActiveProjectId, loadProject } = await import('/src/projectRepository.ts' as string)
    return (await loadProject(getActiveProjectId()))?.publishConfig?.selectedCondition
  })).toBe('internal')
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Publish,/ }).click()
  await expect(page.getByRole('combobox', { name: 'HTML audience condition' })).toHaveValue('internal')
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText('HTML Ready', { exact: true })).toBeVisible()
  await audience.selectOption('external')
  await expect(page.getByText('HTML Ready', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Full Preview' }).click()
  await expect(page.getByTestId('project-preview')).toContainText('External content.')
  await expect(page.getByTestId('project-preview')).not.toContainText('Internal content.')
  await page.getByRole('button', { name: 'Go to Publish' }).click()
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText('HTML Ready', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const archive = await JSZip.loadAsync(await readFile(await (await downloadPromise).path()))
  const html = await archive.file(htmlTopicFile('topic-beta'))!.async('string')
  expect(html).toContain('Unconditional content.')
  expect(html).toContain('External content.')
  expect(html).not.toContain('Internal content.')
})