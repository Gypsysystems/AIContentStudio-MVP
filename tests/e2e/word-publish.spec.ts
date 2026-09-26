import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { buildPublishProjection } from '../../src/publishProjection'
import { generateWordDocument } from '../../src/wordPublisher'
import type { StyleProfile } from '../../src/App'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yn8AAAAASUVORK5CYII='
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

function fixture() {
  return buildPublishProjection({
    projectName: 'Committed Manual',
    topics: [
      { id: 20, topicId: 'stable-beta', title: 'Beta {{PRODUCT}}', level: 1 },
      { id: 10, topicId: 'stable-alpha', title: 'Alpha <Guide>', level: 2 },
      { id: 30, topicId: 'stable-empty', title: 'Empty Topic', level: 1 },
    ],
    topicContent: {
      'stable-beta': [
        { id: 'old-title', type: 'h1', content: 'Old Beta' },
        { id: 'intro', type: 'para', content: 'Use {{PRODUCT}} and {{MISSING}}. See https://example.com/docs.' },
        { id: 'sub', type: 'h2', content: 'Install' },
        { id: 'list', type: 'list', content: '', listItems: [
          { id: 'one', text: 'First {{PRODUCT}}', type: 'ordered', level: 1 },
          { id: 'two', text: 'Second', type: 'ordered', level: 1 },
          { id: 'three', text: 'Bullet', type: 'bullet', level: 1 },
        ] },
        { id: 'steps', type: 'procedure', content: 'Procedure heading', procedureSteps: ['Open {{PRODUCT}}', 'Save changes'] },
        { id: 'grid', type: 'table', content: '', tableData: { hasHeader: true, rows: [['Column A', 'Column B'], ['Cell 1', 'Cell 2']] } },
        { id: 'note', type: 'callout', content: 'Read this', calloutVariant: 'note' },
        { id: 'quote', type: 'quote', content: 'Quoted guidance' },
        { id: 'code', type: 'code', content: 'npm install --save' },
        { id: 'image', type: 'media', content: '', mediaType: png, caption: 'Process diagram' },
        { id: 'caption', type: 'caption', content: 'Additional caption' },
      ],
      'stable-alpha': [{ id: 'body', type: 'para', content: 'Persisted Alpha body' }],
      'stable-empty': [],
    },
    masterAssignments: {},
    variables: [{ name: 'PRODUCT', value: 'Workspace' }, { name: 'Version', value: '3.2' }],
    theme: { id: 't1', name: 'Theme' },
    styleProfile,
    legacyBrandProfile: { id: 'legacy', name: 'Legacy', primaryColor: '#FF0000' },
    templatePack: { id: 'p', name: 'Pack', footerShowPageNum: true, footerShowCopyright: true },
    pageLayouts: [
      { id: 'cover', name: 'Cover', layoutType: 'cover', pageSize: 'A4' as const, orientation: 'portrait' as const,
        marginTop: 26, marginBottom: 28, marginLeft: 24, marginRight: 22,
        topZone: [{ id: 'logo', label: 'Logo', alignment: 'left' as const, visible: true }],
        centerZone: [{ id: 'title', label: 'Document Title', alignment: 'center' as const, visible: true }],
        bottomZone: [] },
      { id: 'content', name: 'Content', layoutType: 'content', pageSize: 'Letter' as const, orientation: 'landscape' as const,
        marginTop: 17, marginBottom: 18, marginLeft: 19, marginRight: 21,
        headerZone: [
          { id: 'chaptertitle', label: 'Chapter Title', alignment: 'center' as const, visible: true },
          { id: 'version', label: 'Version', alignment: 'right' as const, visible: true },
          { id: 'client', label: 'Client Name', alignment: 'left' as const, visible: false },
        ],
        footerZone: [
          { id: 'copyright', label: 'Copyright', alignment: 'left' as const, visible: true },
          { id: 'pagenum', label: 'Page Number', alignment: 'right' as const, visible: true },
        ] },
    ],
    htmlMasters: [],
  })
}

const xml = (zip: JSZip, path: string) => zip.file(path)!.async('string')
const documentText = (document: string): string[] =>
  [...document.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1])

test('Word package retains full committed TOC order and authored structures without demo text', async () => {
  const source = fixture()
  expect(source.unresolvedVariables.map(warning => warning.name)).toContain('MISSING')
  const archive = await JSZip.loadAsync(await generateWordDocument(source).then(blob => blob.arrayBuffer()))
  const document = await xml(archive, 'word/document.xml')
  const text = documentText(document).join(' ')
  expect(text.indexOf('Beta Workspace')).toBeLessThan(text.indexOf('Alpha &lt;Guide&gt;'))
  expect(text.indexOf('Alpha &lt;Guide&gt;')).toBeLessThan(text.indexOf('Empty Topic'))
  for (const phrase of [
    'Use Workspace and {{MISSING}}.', 'Install', 'First Workspace', 'Second', 'Bullet',
    'Procedure heading', 'Open Workspace', 'Save changes', 'Column A', 'Cell 2',
    'NOTE label:', 'Read this', 'Quoted guidance', 'npm install --save', 'Process diagram',
    'Additional caption', 'Persisted Alpha body',
  ]) expect(text).toContain(phrase)
  expect(document).toContain('topic_737461626c652d62657461')
  expect(document).toContain('<w:tbl>')
  expect(document).toContain('<w:numPr>')
  expect(document).toContain('<w:drawing>')
  expect(document).toContain('https://example.com/docs')
  expect(document).not.toContain('Old Beta')
  expect(document).not.toContain('Getting Started Guide')
  expect(document).not.toContain('Welcome to Our Documentation')
  expect(document).not.toContain('Do not publish stale ref')
  const numbering = await xml(archive, 'word/numbering.xml')
  expect(numbering).toContain('w:numFmt w:val="decimal"')
  expect(numbering).toContain('w:numFmt w:val="bullet"')
  expect(Object.keys(archive.files).filter(path => path.startsWith('word/media/'))).not.toHaveLength(0)
  expect(source.topics[0].blocks[0].content).toBe('Old Beta')
})

test('Word package maps canonical typography, page geometry, headers, footers and page numbers', async () => {
  const archive = await JSZip.loadAsync(await generateWordDocument(fixture()).then(blob => blob.arrayBuffer()))
  const document = await xml(archive, 'word/document.xml')
  const styles = await xml(archive, 'word/styles.xml')
  expect(document).toContain('w:w="15840"')
  expect(document).toContain('w:h="12240"')
  expect(document).toContain('w:w="11906"')
  expect(document).toContain('w:h="16838"')
  expect(document).toContain('w:left="1077"')
  expect(document).toContain('w:right="1191"')
  expect(document).toContain('w:top="964"')
  expect(document).toContain('w:bottom="1020"')
  expect(document).toContain('w:pgNumType w:start="1"')
  expect(document).toContain('w:pStyle w:val="Title"')
  expect(document).toMatch(/<w:p>[^]*?<w:pStyle w:val="Heading2"[^]*?Alpha &lt;Guide&gt;/)
  expect(styles).toContain('w:ascii="Georgia"')
  expect(styles).toContain('w:ascii="Tahoma"')
  expect(styles).toContain('w:ascii="Consolas"')
  expect(styles).toContain('w:val="13579B"')
  expect(styles).toContain('w:val="243648"')
  expect(styles).toContain('w:styleId="AuthorCaption"')
  expect(styles).toContain('w:styleId="AuthorCode"')
  expect(document).toContain('w:fill="334455"')
  expect(document).not.toContain('FF0000')
  const headerPath = Object.keys(archive.files).find(path => /^word\/header\d+\.xml$/.test(path))!
  const footerPath = Object.keys(archive.files).find(path => /^word\/footer\d+\.xml$/.test(path))!
  const header = await xml(archive, headerPath)
  const footer = await xml(archive, footerPath)
  expect(header).toContain('STYLEREF')
  expect(header).toContain('3.2')
  expect(header).toContain('<w:tabs>')
  expect(header).not.toContain('Client Name')
  expect(footer).toContain('© Committed Manual')
  expect(footer).toContain('PAGE')
})

test('Word export explicitly rejects unsupported images rather than omitting them', async () => {
  const source = fixture()
  source.topics[0].blocks.push({ id: 'bad-image', type: 'media', content: '',
    mediaType: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
  await expect(generateWordDocument(source)).rejects.toThrow('supports only PNG, JPEG, GIF and BMP')
})

test('Word preserves list restarts and authored media descriptions without inventing missing assets', async () => {
  const source = fixture()
  source.topics[0].blocks.push({
    id: 'restart', type: 'list', content: '', listItems: [
      { text: 'Item one', type: 'ordered', level: 1 },
      { text: 'Start over', type: 'ordered', level: 1, startFresh: true },
    ],
  })
  source.topics[0].blocks.push({
    id: 'caption-only', type: 'media', mediaType: 'diagram', content: 'Authored diagram description',
    caption: 'Authored diagram caption',
  })
  const archive = await JSZip.loadAsync(await generateWordDocument(source).then(blob => blob.arrayBuffer()))
  const document = await xml(archive, 'word/document.xml')
  const paragraph = (text: string) => [...document.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)]
    .find(match => match[0].includes(`>${text}</w:t>`))?.[0] ?? ''
  const first = paragraph('Item one').match(/<w:numId w:val="(\d+)"/)?.[1]
  const restart = paragraph('Start over').match(/<w:numId w:val="(\d+)"/)?.[1]
  expect(first).toBeTruthy()
  expect(restart).toBeTruthy()
  expect(restart).not.toBe(first)
  expect(document).toContain('Authored diagram description')
  expect(document).toContain('Authored diagram caption')
})

test('Word refuses conditional blocks when the projection does not contain a matching variant filter', async () => {
  const source = fixture()
  source.topics[0].blocks.push({ id: 'restricted', type: 'para', content: 'Audience-only secret',
    conditions: ['internal'] })
  await expect(generateWordDocument(source)).rejects.toThrow('cannot safely apply conditions')
})

test('Word UI downloads persisted topics after reload, not the stale active Author document', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('Word persistence')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect(page.getByRole('button', { name: 'Output Templates' })).toBeVisible()
  await page.evaluate(async () => {
    const { getActiveProjectId, loadProject, saveProject } = await import('/src/projectRepository.ts' as string)
    const record = await loadProject(getActiveProjectId())
    if (!record) throw new Error('Project missing')
    record.appToc = [
      { id: 8, topicId: 'persisted-a', title: 'Saved First', level: 1, words: 0 },
      { id: 4, topicId: 'persisted-b', title: 'Saved Second', level: 1, words: 0 },
    ]
    record.topicContent = {
      'persisted-a': [{ id: 'pa', type: 'para', content: 'First persisted content' }],
      'persisted-b': [{ id: 'pb', type: 'para', content: 'Second persisted content' }],
    }
    record.docBlocks = [{ id: 'stale', type: 'para', content: 'Stale author content' }]
    await saveProject(record)
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Publish,/ }).click()
  await page.locator('label').filter({ hasText: 'Word' }).locator('input[type=checkbox]').check()
  await page.locator('label').filter({ hasText: 'PDF' }).locator('input[type=checkbox]').uncheck()
  await page.locator('label').filter({ hasText: 'HTML' }).locator('input[type=checkbox]').uncheck()
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText('Word Ready', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadPromise
  const archive = await JSZip.loadAsync(await readFile(await download.path()))
  const text = documentText(await xml(archive, 'word/document.xml')).join(' ')
  expect(text.indexOf('Saved First')).toBeLessThan(text.indexOf('Saved Second'))
  expect(text).toContain('First persisted content')
  expect(text).toContain('Second persisted content')
  expect(text).not.toContain('Stale author content')
})