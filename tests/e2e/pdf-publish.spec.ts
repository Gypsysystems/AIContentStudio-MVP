import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildPublishProjection } from '../../src/publishProjection'
import { generatePdfDocument } from '../../src/pdfPublisher'
import type { StyleProfile } from '../../src/App'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
function tallPng(height: number): string {
  const crc = (bytes: Buffer): number => {
    let value = -1
    for (const byte of bytes) {
      value ^= byte
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    return (value ^ -1) >>> 0
  }
  const chunk = (name: string, content: Buffer): Buffer => {
    const type = Buffer.from(name)
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(content.length)
    checksum.writeUInt32BE(crc(Buffer.concat([type, content])))
    return Buffer.concat([length, type, content, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 2
  const data = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, 255, 0, 0])))
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')}`
}
const typo = (fontFamily: string, fontSize: number, color: string) => ({
  fontFamily, fontSize, fontWeight: '400', color, lineHeight: 1.4, spaceBefore: 2, spaceAfter: 4, alignment: 'left' as const,
})
const profile = {
  id: 'selected', name: 'Current style', clientId: 'c', scope: 'project',
  primaryColor: '#123456', headingTextColor: '#13579B', bodyTextColor: '#243648',
  secondaryColor: '#334455', accentColor: '#AA5500', linkColor: '#13579B',
  surfaceColor: '#EFF0F1', borderColorToken: '#ABCDEF', tableHeaderBgToken: '#334455',
  headingFont: 'Georgia', bodyFont: 'Arial', codeFont: 'Courier New',
  logoLabel: 'AC', logoDataUrl: png,
  body: typo('Arial', 11, '#243648'),
  h1: { ...typo('Georgia', 22, '#13579B'), fontWeight: '700' },
  h2: { ...typo('Georgia', 16, '#334455'), fontWeight: '700' },
  h3: { ...typo('Georgia', 13, '#334455'), fontWeight: '700' },
  h4: { ...typo('Georgia', 12, '#334455'), fontWeight: '700' },
  caption: typo('Arial', 9, '#667788'),
  code: typo('Courier New', 10, '#182736'),
  links: { color: '#13579B', underline: true },
  lists: { orderedL1: '1.', orderedL2: 'a.', orderedL3: 'i.', bulletL1: '•',
    bulletL2: '○', bulletL3: '–', itemSpacing: 4, indentation: 24 },
  tables: { headerFontWeight: '700', headerTextColor: '#FFFFFF', headerBgColor: '#334455',
    bodyTextColor: '#243648', borderColor: '#ABCDEF', borderWidth: 1, cellPadding: 8,
    alternateRows: true, alternateRowColor: '#F9FAFB', firstColEmphasis: false },
  callouts: Object.fromEntries(['note', 'tip', 'important', 'warning', 'example'].map(kind =>
    [kind, { label: `${kind.toUpperCase()} label`, accentColor: '#AA5500', bgColor: '#E1E2E3', textColor: '#334455' }])),
} as StyleProfile

function source() {
  return buildPublishProjection({
    projectName: 'Committed Manual',
    topics: [
      { id: 2, topicId: 'topic-b', title: 'Beta {{PRODUCT}}', level: 1 },
      { id: 7, topicId: 'topic-a', title: 'Alpha Manual', level: 2 },
      { id: 8, topicId: 'topic-empty', title: 'Empty Topic', level: 1 },
    ],
    topicContent: {
      'topic-b': [
        { id: 'old', type: 'h1', content: 'Obsolete Heading' },
        { id: 'intro', type: 'para', content: 'Use {{PRODUCT}} and {{MISSING}}. https://example.com/help #topic-7' },
        { id: 'sub', type: 'h2', content: 'Install Section' },
        { id: 'list', type: 'list', content: '', listItems: [
          { id: 'first', text: 'Step list item', type: 'ordered', level: 1 },
          { id: 'second', text: 'Bullet list item', type: 'bullet', level: 1 },
        ] },
        { id: 'steps', type: 'procedure', content: 'Procedure title', procedureSteps: ['Open {{PRODUCT}}', 'Save changes'] },
        { id: 'table', type: 'table', content: '', tableData: { hasHeader: true, rows: [['Column A', 'Column B'], ['Cell one', 'Cell two']] } },
        { id: 'callout', type: 'callout', content: 'Careful now', calloutVariant: 'note' },
        { id: 'quote', type: 'quote', content: 'Quoted material' },
        { id: 'code', type: 'code', content: 'npm install example' },
        { id: 'figure', type: 'media', content: '', mediaType: png, caption: 'Process diagram' },
        { id: 'caption', type: 'caption', content: 'Additional caption' },
        { id: 'divider', type: 'divider', content: '' },
      ],
      'topic-a': [{ id: 'saved', type: 'para', content: 'Persisted Alpha body' }],
      'topic-empty': [],
    },
    masterAssignments: {}, variables: [{ name: 'PRODUCT', value: 'Workspace' }, { name: 'Version', value: '3.2' }],
    theme: { id: 'theme', name: 'Theme' }, styleProfile: profile,
    legacyBrandProfile: { id: 'old-brand', name: 'Legacy', primaryColor: '#FF0000' },
    templatePack: { id: 'pack', name: 'Pack', footerShowPageNum: true },
    pageLayouts: [
      { id: 'cover', name: 'Cover', layoutType: 'cover', pageSize: 'A4' as const, orientation: 'portrait' as const,
        marginTop: 26, marginBottom: 28, marginLeft: 24, marginRight: 22, bgColor: '#1D4ED8',
        topZone: [{ id: 'logo', label: 'Logo', alignment: 'left' as const, visible: true }],
        centerZone: [{ id: 'title', label: 'Document Title', alignment: 'center' as const, visible: true }],
        bottomZone: [] },
      { id: 'content', name: 'Content', layoutType: 'content', pageSize: 'Letter' as const, orientation: 'landscape' as const,
        marginTop: 17, marginBottom: 18, marginLeft: 19, marginRight: 21,
        headerZone: [
          { id: 'chaptertitle', label: 'Chapter Title', alignment: 'center' as const, visible: true },
          { id: 'version', label: 'Version', alignment: 'right' as const, visible: true },
        ],
        footerZone: [
          { id: 'copyright', label: 'Copyright', alignment: 'left' as const, visible: true },
          { id: 'pagenum', label: 'Page Number', alignment: 'right' as const, visible: true },
        ] },
    ], htmlMasters: [],
  })
}
async function parsed(blob: Blob) {
  const data = new Uint8Array(await blob.arrayBuffer())
  const task = getDocument({ data, useSystemFonts: true })
  return task.promise
}
async function pageText(pdf: Awaited<ReturnType<typeof parsed>>, pageNumber: number) {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item)
}
async function allText(pdf: Awaited<ReturnType<typeof parsed>>) {
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) pages.push((await pageText(pdf, i)).map(item => item.str).join(' '))
  return pages
}

test('PDF respects committed TOC order and authored structures, resolves variables and excludes demo content', async () => {
  const snapshot = source()
  expect(snapshot.unresolvedVariables.map(item => item.name)).toContain('MISSING')
  const pdf = await parsed(await generatePdfDocument(snapshot))
  const texts = await allText(pdf)
  const text = texts.join(' ')
  expect(text.indexOf('Beta Workspace')).toBeLessThan(text.indexOf('Alpha Manual'))
  expect(text.indexOf('Alpha Manual')).toBeLessThan(text.indexOf('Empty Topic'))
  for (const phrase of ['Use Workspace and {{MISSING}}.', 'Install Section', 'Step list item',
    'Bullet list item', 'Procedure title', 'Open Workspace', 'Save changes', 'Column A',
    'Cell two', 'NOTE label:', 'Careful now', 'Quoted material', 'npm install example',
    'Process diagram', 'Additional caption', 'Persisted Alpha body']) expect(text).toContain(phrase)
  expect(text).not.toContain('Obsolete Heading')
  expect(text).not.toContain('Getting Started Guide')
  expect(text).not.toContain('Stale author content')
  expect(snapshot.topics[0].blocks[0].content).toBe('Obsolete Heading')
  const outline = await pdf.getOutline()
  expect(outline?.map(item => item.title)).toEqual(['Beta Workspace', 'Empty Topic'])
  expect(outline?.[0].items.map(item => item.title)).toEqual(['Alpha Manual'])
})

test('PDF uses separate cover/content geometry, canonical sizing and colors, image assets, links and page bands', async () => {
  const pdf = await parsed(await generatePdfDocument(source()))
  const cover = await pdf.getPage(1)
  const content = await pdf.getPage(2)
  expect(cover.view[2]).toBeCloseTo(595.28, 0)
  expect(cover.view[3]).toBeCloseTo(841.89, 0)
  expect(content.view[2]).toBeCloseTo(792, 0)
  expect(content.view[3]).toBeCloseTo(612, 0)
  const coverText = (await pageText(pdf, 1)).map(item => item.str).join(' ')
  expect(coverText).toContain('Committed Manual')
  expect(coverText).not.toContain('September')
  const items = await pageText(pdf, 2)
  const mainHeading = items.find(item => item.str.includes('Beta Workspace'))!
  const body = items.find(item => item.str.includes('Use Workspace'))!
  expect(mainHeading.transform[0]).toBeGreaterThan(body.transform[0])
  // Content starts below the header reserve and 17mm top margin, and ends above
  // the footer reserve and 18mm bottom margin.
  expect(mainHeading.transform[5]).toBeLessThan(612 - 17 * 72 / 25.4)
  expect(body.transform[5]).toBeGreaterThan(18 * 72 / 25.4)
  const page2 = items.map(item => item.str).join(' ')
  expect(page2).toContain('3.2')
  expect(page2).toContain('© Committed Manual')
  expect(page2).toContain(`1 / ${pdf.numPages - 1}`)
  const annotations = await content.getAnnotations()
  expect(annotations.some(a => a.url === 'https://example.com/help')).toBe(true)
  expect(annotations.some(a => !!a.dest)).toBe(true)
  const operators = await content.getOperatorList()
  expect(operators.fnArray.some(operator => operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject)).toBe(true)
  const colors = operators.argsArray.flatMap((args, i) =>
    operators.fnArray[i] === OPS.setFillRGBColor ? args as string[] : [])
  expect(colors).toContain('#13579b')
  expect(colors).toContain('#243648')
  expect(colors).not.toContain('#ff0000')
})

test('PDF paginates long prose and split table rows without writing into header/footer bands', async () => {
  const snapshot = source()
  snapshot.topics[0].blocks.push({
    id: 'long-prose', type: 'para', content: Array.from({ length: 280 }, (_, i) => `Long passage ${i}.`).join(' '),
  })
  snapshot.topics[0].blocks.push({
    id: 'huge-table', type: 'table', content: '',
    tableData: { hasHeader: true, rows: [
      ['Identifier', 'Detailed text'],
      ...Array.from({ length: 35 }, (_, i) => [`Row ${i}`, i === 12
        ? Array.from({ length: 210 }, (_, k) => `Cell ${k}`).join(' ') : `Value ${i}`]),
    ] },
  })
  const pdf = await parsed(await generatePdfDocument(snapshot))
  expect(pdf.numPages).toBeGreaterThan(3)
  const text = (await allText(pdf)).join(' ')
  expect(text).toContain('Long passage 279.')
  expect(text).toContain('Row 34')
  expect(text).toContain('Cell 209')
  for (let i = 2; i <= pdf.numPages; i++) {
    const items = await pageText(pdf, i)
    const authored = items.filter(item => /Long passage|Row \d+|Cell \d+/.test(item.str))
    for (const item of authored) {
      expect(item.transform[5], `Page ${i}: ${item.str.slice(0, 30)}`).toBeGreaterThan(18 * 72 / 25.4 + 8)
      expect(item.transform[5], `Page ${i}: ${item.str.slice(0, 30)}`).toBeLessThan(612 - 17 * 72 / 25.4 - 8)
    }
    expect(items.some(item => /\d+ \/ \d+/.test(item.str))).toBe(true)
  }
})

test('PDF keeps a tall image and caption inside the content region without covering the footer', async () => {
  const snapshot = source()
  snapshot.topics[0].blocks.push({ id: 'tall-image', type: 'media', content: '',
    mediaType: tallPng(1200), caption: 'Tall image caption' })
  const pdf = await parsed(await generatePdfDocument(snapshot))
  const texts = await allText(pdf)
  const imagePageNumber = texts.findIndex(text => text.includes('Tall image caption')) + 1
  expect(imagePageNumber).toBeGreaterThan(1)
  const page = await pdf.getPage(imagePageNumber)
  const operators = await page.getOperatorList()
  expect(operators.fnArray.some(operator => operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject)).toBe(true)
  const caption = (await pageText(pdf, imagePageNumber)).find(item => item.str.includes('Tall image caption'))!
  expect(caption.transform[5]).toBeGreaterThan(18 * 72 / 25.4 + 8)
  expect(caption.transform[5]).toBeLessThan(612 - 17 * 72 / 25.4 - 8)
  expect(texts[imagePageNumber - 1]).toMatch(/\d+ \/ \d+/)
})

test('PDF chooses only a bundled font, using a configured supported fallback for unavailable custom fonts', async () => {
  const snapshot = source()
  snapshot.styleProfile.bodyFont = 'Unavailable Brand Font'
  snapshot.styleProfile.fallbackFont = 'Times New Roman'
  const pdf = await parsed(await generatePdfDocument(snapshot))
  const page = await pdf.getPage(2)
  const body = (await pageText(pdf, 2)).find(item => item.str.includes('Use Workspace'))!
  await page.getOperatorList()
  expect(page.commonObjs.get(body.fontName).name).toMatch(/Times/i)
})

test('PDF rejects unsupported media and ambiguous conditional blocks instead of silently exporting them', async () => {
  const invalid = source()
  invalid.topics[0].blocks.push({ id: 'svg', type: 'media', content: '',
    mediaType: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
  await expect(generatePdfDocument(invalid)).rejects.toThrow('supports only PNG, JPEG and GIF')
  const conditional = source()
  conditional.topics[0].blocks.push({ id: 'restricted', type: 'para', content: 'Audience-only text',
    conditions: ['internal'] })
  await expect(generatePdfDocument(conditional)).rejects.toThrow('cannot safely apply conditions')
})

test('PDF download reads persisted full-project content after reload instead of stale active Author content', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill('PDF persistence')
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('docflow-active-project'))).not.toBeNull()
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
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page.locator('label').filter({ hasText: 'PDF' }).locator('input[type=checkbox]').check()
  await page.locator('label').filter({ hasText: 'Word' }).locator('input[type=checkbox]').uncheck()
  await page.locator('label').filter({ hasText: 'HTML' }).locator('input[type=checkbox]').uncheck()
  await page.getByRole('button', { name: 'Generate Outputs' }).click()
  await expect(page.getByText('PDF Ready', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadPromise
  const data = new Uint8Array(await readFile(await download.path()))
  const pdf = await getDocument({ data, useSystemFonts: true }).promise
  const text = (await allText(pdf)).join(' ')
  expect(text.indexOf('Saved First')).toBeLessThan(text.indexOf('Saved Second'))
  expect(text).toContain('First persisted content')
  expect(text).toContain('Second persisted content')
  expect(text).not.toContain('Stale author content')
})