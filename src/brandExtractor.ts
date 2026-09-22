// Brand Guideline Extractor
// Parses PDF and DOCX brand guidelines to discover color palettes, typography, and logos.
// Zero hardcoded brand values — all results derive from the uploaded document.

// ── Types ──────────────────────────────────────────────────────────────────

export type ExtractedColor = {
  id: string
  name: string
  value: string
  suggestedRole: string
  sourceSnippet: string
  detectionMethod: 'explicit-text' | 'table-value' | 'rgb-converted' | 'multi-line-block'
  confidence: 'high' | 'medium' | 'low'
}

export type ExtractedFont = {
  id: string
  family: string
  suggestedRole: string
  sourceSnippet: string
  detectionMethod: 'explicit-label' | 'typography-table' | 'token-table' | 'docx-style-metadata' | 'pdf-font-metadata' | 'inferred-from-formatting'
  confidence: 'high' | 'medium' | 'low'
}

export type ExtractedTypoStyle = {
  id: string
  role: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  color?: string
  sourceSnippet: string
  detectionMethod?: 'typography-table' | 'text-block' | 'token-table'
  confidence: 'high' | 'medium' | 'low'
  // Diagnostic fields — sourced directly from document; never derived
  sourceTableIndex?: number
  sourceRowIndex?: number
  rawCells?: {
    roleRaw?: string
    fontFamilyRaw?: string
    weightRaw?: string
    sizeRaw?: string
    colorRaw?: string
  }
  columnMap?: {
    role: number
    fontFamily: number
    weight: number
    size: number
    color: number
  }
}

export type ExtractedLogo = {
  id: string
  blob: Blob
  suggestedRole: string
}

export type ExtractionDiagnostics = {
  fileParsed: boolean
  textBlocksExtracted: number
  tablesFound: number
  rawColorCandidates: number
  acceptedColorCandidates: number
  fontCandidates: number
  embeddedImages: number
  // Typography-specific diagnostics
  typographyTablesFound: number
  fontFamilyCellsDetected: number
  explicitFontDeclarationsDetected: number
  docxMetadataFontCandidates: number
  pdfMetadataFontCandidates: number
  typographyStylesDetected: number
  warnings: string[]
}

export type BrandExtractionResult = {
  sourceFilename: string
  extractedText: string
  colors: ExtractedColor[]
  fonts: ExtractedFont[]
  typographyStyles: ExtractedTypoStyle[]
  logos: ExtractedLogo[]
  pdfLogoNote?: string
  diagnostics: ExtractionDiagnostics
}

// ── Helpers ────────────────────────────────────────────────────────────────

function windowAround(text: string, index: number, radius = 300): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + radius)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
  }
  return hex.toUpperCase()
}

function normalizeFamily(family: string): string {
  return family.replace(/\s+/g, ' ').trim()
}

// ── Semantic role detection ────────────────────────────────────────────────

const ROLE_KEYWORDS: [RegExp, string][] = [
  [/\bprimary\b/i,        'Primary'],
  [/\bsecondary\b/i,      'Secondary'],
  [/\baccent\b/i,         'Accent'],
  [/\bbackground\b/i,     'Background'],
  [/\bsurface\b/i,        'Surface'],
  [/\bbody[\s-]*text\b/i, 'Body Text'],
  [/\bborder\b/i,         'Border'],
  [/\bsuccess\b/i,        'Success'],
  [/\bwarning\b/i,        'Warning'],
  [/\bcritical\b/i,       'Critical'],
  [/\berror\b/i,          'Critical'],
  [/\binfo(?:rmation)?\b/i, 'Info'],
  [/\btable[\s-]*header\b/i, 'Table Header'],
  [/\bheading\b/i,        'Heading'],
  [/\blink\b/i,           'Link'],
  [/\bforeground\b/i,     'Foreground'],
  [/\bmuted\b/i,          'Muted'],
  [/\bdisabled\b/i,       'Disabled'],
  [/\bfocus\b/i,          'Focus'],
  [/\bselection\b/i,      'Selection'],
]

function detectRole(text: string): string {
  for (const [re, role] of ROLE_KEYWORDS) {
    if (re.test(text)) return role
  }
  return 'Unknown'
}

// ── Font role detection ─────────────────────────────────────────────────────

function detectFontRole(text: string): string | null {
  const l = text.toLowerCase()
  if (/document\s+title/.test(l)) return 'Heading'
  if (/heading\s*[0-9]|h[1-4]\b|display/.test(l)) return 'Heading'
  if (/heading/.test(l)) return 'Heading'
  if (/body|paragraph|normal text|regular text/.test(l)) return 'Body'
  if (/code|mono(?:space)?|technical/.test(l)) return 'Code'
  if (/fallback|alternative|system/.test(l)) return 'Fallback'
  if (/caption|small\s+text|footnote/.test(l)) return 'Caption'
  if (/title|primary/.test(l)) return 'Heading'
  if (/subheading|subtitle/.test(l)) return 'Subheading'
  return null
}

// Column header patterns for typography tables
const FONT_FAMILY_HEADER_RE = /font[\s-]*family|typeface|font\s+name|^font$|^typeface$|^type\s*face$|family\s*name|font\s*type|^font\b/i
const FONT_ROLE_HEADER_RE = /role|style\s*name|element|typography|type\s+style|text\s+style|^style$/i
const FONT_WEIGHT_HEADER_RE = /weight|font[\s-]*weight/i
const FONT_SIZE_HEADER_RE = /size|font[\s-]*size|default\s+size/i
const FONT_COLOR_HEADER_RE = /colou?r|hex/i
const TOKEN_NAME_HEADER_RE = /token|variable|key|name/i
const TOKEN_VALUE_HEADER_RE = /value|family|font/i
const FONT_TOKEN_VALUE_RE = /heading[\s-]*font|body[\s-]*font|display[\s-]*font|caption[\s-]*font|code[\s-]*font|fallback[\s-]*font|monospace[\s-]*font/i

// Values that look like font families but are actually role labels or weights
const INVALID_FONT_CANDIDATES = new Set([
  'heading', 'heading 1', 'heading 2', 'heading 3', 'heading 4', 'heading 5', 'heading 6',
  'body', 'body text', 'caption', 'code', 'title', 'subtitle', 'document title',
  'footnote', 'normal', 'default', 'text', 'label',
  'bold', 'semibold', 'semi-bold', 'medium', 'regular', 'light', 'thin', 'black', 'heavy',
  'extrabold', 'extra bold', 'extra-bold',
  'primary', 'secondary', 'accent',
  '100', '200', '300', '400', '500', '600', '700', '800', '900',
])

function isValidFontFamily(value: string): boolean {
  if (!value || value.length < 2) return false
  const lower = value.toLowerCase().trim()
  if (INVALID_FONT_CANDIDATES.has(lower)) return false
  // Must contain at least one letter, not be all digits/punctuation
  if (!/[a-zA-Z]/.test(value)) return false
  // Must be 2+ chars
  if (value.trim().length < 2) return false
  return true
}

// ── PDF Text Extraction ────────────────────────────────────────────────────

type PdfPositionedItem = { str: string; x: number; y: number; fontName?: string }

async function extractPdfText(file: File): Promise<{
  text: string
  pageTexts: string[]
  pdfFontNames: string[]
  positionedItems: PdfPositionedItem[][]  // per-page positioned items for table reconstruction
}> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).href

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pageTexts: string[] = []
  const pdfFontNameSet = new Set<string>()
  const positionedItems: PdfPositionedItem[][] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    type PdfItem = { str: string; transform: number[]; fontName?: string }
    const items = content.items.filter(item => 'str' in item) as PdfItem[]

    const pagePositioned: PdfPositionedItem[] = []
    for (const item of items) {
      const x = item.transform[4]
      const y = item.transform[5]
      const fontName = item.fontName?.replace(/^[A-Z]{6}\+/, '').trim()
      if (fontName && item.str.trim().length > 3 && fontName.length > 2) {
        pdfFontNameSet.add(fontName)
      }
      if (item.str.trim()) {
        pagePositioned.push({ str: item.str, x, y, fontName })
      }
    }
    positionedItems.push(pagePositioned)

    // Group by approximate Y position for text lines
    const sorted = [...pagePositioned].sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: string[][] = []
    let lastY: number | null = null
    for (const item of sorted) {
      const y = Math.round(item.y)
      if (lastY === null || Math.abs(y - lastY) > 2) {
        lines.push([item.str])
        lastY = y
      } else {
        lines[lines.length - 1].push(item.str)
      }
    }
    pageTexts.push(lines.map(l => l.join(' ')).join('\n'))
  }

  return { text: pageTexts.join('\n'), pageTexts, pdfFontNames: Array.from(pdfFontNameSet), positionedItems }
}

// Reconstruct table-like cells from positioned PDF items using x/y clustering
function reconstructPdfTables(positionedItems: PdfPositionedItem[][]): string[][][] {
  const allTables: string[][][] = []

  for (const pageItems of positionedItems) {
    if (pageItems.length < 4) continue

    // Group items into rows by Y proximity (within 4 units)
    const yGroups = new Map<number, PdfPositionedItem[]>()
    for (const item of pageItems) {
      const ry = Math.round(item.y / 4) * 4
      if (!yGroups.has(ry)) yGroups.set(ry, [])
      yGroups.get(ry)!.push(item)
    }

    // Sort rows top-to-bottom (PDF Y increases upward, so descending = top-first)
    const sortedRows = Array.from(yGroups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x))

    if (sortedRows.length < 2) continue

    // Detect column boundaries from the first few rows (header + data)
    // Use X positions to cluster into columns
    const firstRowXs = sortedRows[0].map(i => i.x)
    if (firstRowXs.length < 2) continue  // single-column row, not a table

    // Only include row groups that have multi-column content (potential table rows)
    const multiColRows = sortedRows.filter(row => row.length >= 2)
    if (multiColRows.length < 2) continue

    // Determine column X boundaries from header row
    const headerItems = multiColRows[0]
    const colXs = headerItems.map(i => i.x)
    const colTolerance = 30  // pixels

    // Assign each item in each row to the nearest column
    const tableRows: string[][] = []
    for (const rowItems of multiColRows) {
      const cells: string[] = new Array(colXs.length).fill('')
      for (const item of rowItems) {
        // Find nearest column header X
        let bestCol = 0
        let bestDist = Infinity
        for (let ci = 0; ci < colXs.length; ci++) {
          const dist = Math.abs(item.x - colXs[ci])
          if (dist < bestDist) { bestDist = dist; bestCol = ci }
        }
        if (bestDist <= colTolerance) {
          cells[bestCol] = cells[bestCol] ? cells[bestCol] + ' ' + item.str : item.str
        }
      }
      tableRows.push(cells.map(c => c.trim()))
    }

    if (tableRows.length >= 2) allTables.push(tableRows)
  }

  return allTables
}

// ── Direct DOCX XML Table Extraction ─────────────────────────────────────
// Parses word/document.xml directly for w:tbl → w:tr → w:tc structure.
// This is the primary source for typography tables — more reliable than mammoth HTML.

async function extractDocxTablesFromXml(arrayBuffer: ArrayBuffer): Promise<string[][][]> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(arrayBuffer)
    const docFile = zip.file('word/document.xml')
    if (!docFile) return []
    const xml = await docFile.async('text')

    const tables: string[][][] = []

    // Extract each <w:tbl>...</w:tbl>
    const tblRe = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/g
    let tblMatch: RegExpExecArray | null
    while ((tblMatch = tblRe.exec(xml)) !== null) {
      const tblXml = tblMatch[0]
      const rows: string[][] = []

      // Extract each <w:tr>...</w:tr>
      const trRe = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
      let trMatch: RegExpExecArray | null
      while ((trMatch = trRe.exec(tblXml)) !== null) {
        const trXml = trMatch[0]
        const cells: string[] = []

        // Extract each <w:tc>...</w:tc>
        const tcRe = /<w:tc[\s>][\s\S]*?<\/w:tc>/g
        let tcMatch: RegExpExecArray | null
        while ((tcMatch = tcRe.exec(trXml)) !== null) {
          const tcXml = tcMatch[0]
          // Collect all <w:t> text runs inside this cell
          const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
          let tMatch: RegExpExecArray | null
          const textParts: string[] = []
          while ((tMatch = tRe.exec(tcXml)) !== null) {
            if (tMatch[1].trim()) textParts.push(tMatch[1])
          }
          cells.push(textParts.join('').trim())
        }
        if (cells.length > 0) rows.push(cells)
      }
      if (rows.length > 0) tables.push(rows)
    }
    return tables
  } catch {
    return []
  }
}

// ── DOCX Text + Table + Image Extraction ──────────────────────────────────

type DocxContent = {
  rawText: string
  htmlText: string
  images: Blob[]
  tableTexts: string[]      // joined rows for color extraction (backward compat)
  tableCells: string[][][]  // [tableIndex][rowIndex][colIndex] — for schema-aware font detection
  docxFontNames: string[]   // font names from styles.xml (secondary evidence)
}

async function extractDocxContent(file: File): Promise<DocxContent> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const images: Blob[] = []

  const [rawResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          try {
            const buf = await image.read()
            images.push(new Blob([new Uint8Array(buf)], { type: image.contentType }))
          } catch { /* best-effort */ }
          return { src: '' }
        }),
      }
    ),
  ])

  // Primary: direct XML table extraction (preserves exact cell boundaries)
  const xmlTables = await extractDocxTablesFromXml(arrayBuffer)
  // Fallback: mammoth HTML tables (for files where XML extraction yields nothing)
  const htmlTables = extractTableCellsFromHtml(htmlResult.value)
  // Use XML tables if they found content; otherwise fall back to HTML tables
  const tableCells = xmlTables.length > 0 ? xmlTables : htmlTables

  // Flatten for color extraction: each row is cells joined by " | "
  const tableTexts = tableCells.flatMap(table =>
    table.map(row => row.join(' | '))
  )

  // Extract font names from DOCX XML (supporting evidence only)
  const docxFontNames = await extractDocxFontNames(arrayBuffer)

  return {
    rawText: rawResult.value,
    htmlText: htmlResult.value,
    images,
    tableTexts,
    tableCells,
    docxFontNames,
  }
}

// Parse mammoth HTML output preserving per-cell structure per table
function extractTableCellsFromHtml(html: string): string[][][] {
  const tables: string[][][] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  const tagRe = /<[^>]+>/g

  let tableMatch: RegExpExecArray | null
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const rows: string[][] = []
    const tableHtml = tableMatch[1]
    trRe.lastIndex = 0
    let trMatch: RegExpExecArray | null
    while ((trMatch = trRe.exec(tableHtml)) !== null) {
      const cells: string[] = []
      const rowHtml = trMatch[1]
      tdRe.lastIndex = 0
      let tdMatch: RegExpExecArray | null
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(tagRe, '').trim())
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length > 0) tables.push(rows)
  }
  return tables
}

// Extract font names declared in DOCX styles XML (secondary evidence only)
async function extractDocxFontNames(arrayBuffer: ArrayBuffer): Promise<string[]> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(arrayBuffer)
    // Read both styles.xml and document.xml for maximum coverage
    const xmlParts: string[] = []
    for (const path of ['word/styles.xml', 'word/document.xml', 'word/fontTable.xml']) {
      const f = zip.file(path)
      if (f) xmlParts.push(await f.async('text'))
    }
    if (xmlParts.length === 0) return []
    const xml = xmlParts.join('\n')
    const fontRe = /w:rFonts[^/]* w:ascii="([^"]+)"/g
    const hAnsiRe = /w:hAnsi="([^"]+)"/g
    const fontNameRe = /w:font\s+w:name="([^"]+)"/g
    const seen = new Set<string>()
    const names: string[] = []
    const addName = (raw: string) => {
      const name = normalizeFamily(raw)
      if (!seen.has(name.toLowerCase()) && name.length > 1) { seen.add(name.toLowerCase()); names.push(name) }
    }
    let m: RegExpExecArray | null
    while ((m = fontRe.exec(xml)) !== null) addName(m[1])
    while ((m = hAnsiRe.exec(xml)) !== null) addName(m[1])
    while ((m = fontNameRe.exec(xml)) !== null) addName(m[1])
    return names.slice(0, 30) // cap to avoid noise
  } catch {
    return []
  }
}

// ── Color Extraction (unchanged) ───────────────────────────────────────────

const ROLE_WORDS = new Set(['Primary', 'Secondary', 'Accent', 'Background', 'Surface',
  'Body', 'Border', 'Heading', 'Success', 'Warning', 'Critical', 'Error', 'Info',
  'Link', 'Table', 'Header', 'Text', 'Foreground', 'Muted', 'Disabled', 'Focus', 'Selection'])

function findColorName(snippet: string, hexValue: string): string {
  const matches = snippet.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g)
  for (const m of matches) {
    const word = m[1]
    if (ROLE_WORDS.has(word)) continue
    if (word === hexValue) continue
    if (/^\d/.test(word)) continue
    return word
  }
  return hexValue
}

export function extractColors(text: string, tableRows: string[] = []): ExtractedColor[] {
  const results: ExtractedColor[] = []
  const seenHex = new Set<string>()
  const lines = text.split('\n')

  // Strategy 1: Multi-line block detection
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const hexRe = /#([0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?)\b/g
    let hm: RegExpExecArray | null
    while ((hm = hexRe.exec(line)) !== null) {
      const hex = normalizeHex(hm[0])
      if (seenHex.has(hex)) continue
      const contextStart = Math.max(0, li - 4)
      const contextEnd = Math.min(lines.length - 1, li + 4)
      const context = lines.slice(contextStart, contextEnd + 1).join('\n')
      const role = detectRole(context)
      seenHex.add(hex)
      results.push({
        id: `col-${results.length}`, name: findColorName(context, hex), value: hex,
        suggestedRole: role, sourceSnippet: context.replace(/\s+/g, ' ').trim(),
        detectionMethod: 'multi-line-block', confidence: role !== 'Unknown' ? 'high' : 'low',
      })
    }
  }

  // Strategy 2: RGB values
  const rgbRe = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi
  let rm: RegExpExecArray | null
  while ((rm = rgbRe.exec(text)) !== null) {
    const r = parseInt(rm[1]), g = parseInt(rm[2]), b = parseInt(rm[3])
    if (r > 255 || g > 255 || b > 255) continue
    const hex = rgbToHex(r, g, b)
    if (seenHex.has(hex)) continue
    const snippet = windowAround(text, rm.index, 300)
    const role = detectRole(snippet)
    seenHex.add(hex)
    results.push({
      id: `col-${results.length}`, name: findColorName(snippet, hex), value: hex,
      suggestedRole: role, sourceSnippet: snippet,
      detectionMethod: 'rgb-converted', confidence: role !== 'Unknown' ? 'high' : 'medium',
    })
  }

  // Strategy 3: DOCX table rows (already flattened)
  for (const row of tableRows) {
    const hexInRow = row.match(/#([0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?)\b/i)
    if (!hexInRow) continue
    const hex = normalizeHex(hexInRow[0])
    if (seenHex.has(hex)) continue
    const role = detectRole(row)
    seenHex.add(hex)
    results.push({
      id: `col-${results.length}`, name: findColorName(row, hex), value: hex,
      suggestedRole: role, sourceSnippet: row,
      detectionMethod: 'table-value', confidence: role !== 'Unknown' ? 'high' : 'medium',
    })
  }

  return results
}

// ── Font Extraction (rewritten) ────────────────────────────────────────────

// Plausible font family: 1-4 words, mixed/title case, not all-digit, min 3 chars
const FONT_FAMILY_WORD_RE = /([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+){0,3})/

const FONT_ROLE_PROSE_PATTERNS: [RegExp, string][] = [
  [/heading\s+font\s*[:\-–=]/i,    'Heading'],
  [/body\s+font\s*[:\-–=]/i,       'Body'],
  [/primary\s+font\s*[:\-–=]/i,    'Heading'],
  [/fallback\s+font\s*[:\-–=]/i,   'Fallback'],
  [/code\s+font\s*[:\-–=]/i,       'Code'],
  [/mono(?:space)?\s+font\s*[:\-–=]/i, 'Code'],
  [/caption\s+font\s*[:\-–=]/i,    'Caption'],
  [/display\s+font\s*[:\-–=]/i,    'Display'],
  [/title\s+font\s*[:\-–=]/i,      'Heading'],
  [/subtitle\s+font\s*[:\-–=]/i,   'Subheading'],
  [/paragraph\s+font\s*[:\-–=]/i,  'Body'],
  [/typeface\s*[:\-–=]/i,          'Body'],
  [/font\s+family\s*[:\-–=]/i,     'Body'],
  [/sans[- ]serif\s*[:\-–=]/i,     'Body'],
]

export function extractFonts(
  text: string,
  tableRows: string[] = [],
  tableCells: string[][][] = [],
  docxFontNames: string[] = [],
  pdfFontNames: string[] = [],
): ExtractedFont[] {
  const results: ExtractedFont[] = []
  const seen = new Set<string>()

  const addFont = (family: string, role: string, snippet: string, method: ExtractedFont['detectionMethod'], confidence: ExtractedFont['confidence']) => {
    const key = family.toLowerCase()
    if (seen.has(key) || family.length < 2) return
    seen.add(key)
    results.push({ id: `fnt-${results.length}`, family, suggestedRole: role, sourceSnippet: snippet, detectionMethod: method, confidence })
  }

  // ── Strategy 1: Explicit prose patterns ("Heading font: Inter") ────────────
  for (const [roleRe, role] of FONT_ROLE_PROSE_PATTERNS) {
    const pat = new RegExp(roleRe.source + '\\s*' + FONT_FAMILY_WORD_RE.source, 'im')
    const m = text.match(pat)
    if (m && m[1]) {
      const family = normalizeFamily(m[1])
      const idx = text.indexOf(m[0])
      addFont(family, role, windowAround(text, idx, 150), 'explicit-label', 'high')
    }
  }

  // ── Strategy 2: Schema-aware typography tables ─────────────────────────────
  // Inspect each table's header row to find the font-family column specifically
  let typographyTablesFound = 0
  let fontFamilyCellsDetected = 0

  for (const table of tableCells) {
    if (table.length < 2) continue

    const headerRow = table[0].map(c => c.toLowerCase())

    // Find the font-family column index
    const fontFamilyCol = headerRow.findIndex(h => FONT_FAMILY_HEADER_RE.test(h))
    const roleCol = headerRow.findIndex(h => FONT_ROLE_HEADER_RE.test(h))
    const weightCol = headerRow.findIndex(h => FONT_WEIGHT_HEADER_RE.test(h))
    const sizeCol = headerRow.findIndex(h => FONT_SIZE_HEADER_RE.test(h))
    const colorCol = headerRow.findIndex(h => FONT_COLOR_HEADER_RE.test(h))

    // Check for token/summary table: "Token | Value" or "Key | Font"
    const tokenCol = headerRow.findIndex(h => TOKEN_NAME_HEADER_RE.test(h))
    const valueCol = headerRow.findIndex(h => TOKEN_VALUE_HEADER_RE.test(h))

    if (fontFamilyCol >= 0) {
      // Typography table with explicit Font family column
      typographyTablesFound++
      for (let ri = 1; ri < table.length; ri++) {
        const row = table[ri]
        const cellFamily = row[fontFamilyCol]?.trim() ?? ''
        if (!cellFamily || cellFamily.length < 2) continue
        if (!/[a-zA-Z]/.test(cellFamily)) continue // skip pure numbers

        fontFamilyCellsDetected++
        // Role: prefer role column, else detect from any cell text
        const rowText = row.join(' | ')
        const roleCellText = roleCol >= 0 ? (row[roleCol] ?? '') : ''
        const detectedRole = detectFontRole(roleCellText) ?? detectFontRole(rowText) ?? 'Body'

        addFont(cellFamily, detectedRole, `Typography table row: ${rowText}`, 'typography-table', 'high')
      }
    } else if (tokenCol >= 0 && valueCol >= 0) {
      // Token/summary table: Token | Value | Description
      typographyTablesFound++
      for (let ri = 1; ri < table.length; ri++) {
        const row = table[ri]
        const tokenName = row[tokenCol]?.trim().toLowerCase() ?? ''
        const tokenValue = row[valueCol]?.trim() ?? ''
        if (!tokenValue || tokenValue.length < 2) continue
        if (!FONT_TOKEN_VALUE_RE.test(tokenName)) continue

        fontFamilyCellsDetected++
        const detectedRole = detectFontRole(tokenName) ?? 'Body'
        const rowText = row.join(' | ')
        addFont(tokenValue, detectedRole, `Token table row: ${rowText}`, 'token-table', 'high')
      }
    } else if (roleCol >= 0 && table[0].length >= 2) {
      // Has a role column but no explicit font-family column — try next column after role
      typographyTablesFound++
      const guessedFontCol = roleCol === 0 ? 1 : 0
      for (let ri = 1; ri < table.length; ri++) {
        const row = table[ri]
        const roleCellText = row[roleCol]?.trim() ?? ''
        const familyGuess = row[guessedFontCol]?.trim() ?? ''
        if (!familyGuess || familyGuess.length < 2 || !FONT_FAMILY_WORD_RE.test(familyGuess)) continue
        const detectedRole = detectFontRole(roleCellText) ?? detectFontRole(familyGuess)
        if (!detectedRole) continue

        fontFamilyCellsDetected++
        const m = familyGuess.match(FONT_FAMILY_WORD_RE)
        if (m && m[1]) {
          const rowText = row.join(' | ')
          addFont(normalizeFamily(m[1]), detectedRole, `Typography table row: ${rowText}`, 'typography-table', 'medium')
        }
      }
    }
  }

  // ── Strategy 3: Multi-line font block in prose ─────────────────────────────
  // A role keyword line followed by a plausible font name on the next 1-2 lines
  const lines = text.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const roleFromLine = detectFontRole(lines[li])
    if (!roleFromLine) continue
    for (let offset = 1; offset <= 2; offset++) {
      const nextLine = lines[li + offset]?.trim() ?? ''
      if (!nextLine) continue
      const m = nextLine.match(/^([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+){0,2})\s*$/)
      if (m) {
        const family = normalizeFamily(m[1])
        if (family.length > 2) {
          const snippet = lines.slice(Math.max(0, li - 1), li + offset + 2).join('\n')
          addFont(family, roleFromLine, snippet, 'explicit-label', 'medium')
        }
        break
      }
    }
  }

  // ── Strategy 4: Table rows as joined strings (fallback for non-schema tables) ─
  for (const row of tableRows) {
    const role = detectFontRole(row)
    if (!role) continue
    // Only use if NOT already covered by a structured table above
    // Find a plausible font name that is NOT the role/first word
    // Split on " | " and look for cells with a capitalized font-like value
    const cells = row.split(' | ')
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci].trim()
      if (ci === 0 && detectFontRole(cell)) continue // skip role column
      if (FONT_FAMILY_HEADER_RE.test(cell)) continue // skip column headers
      const m = cell.match(/^([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+){0,2})$/)
      if (m && m[1].length > 2) {
        addFont(normalizeFamily(m[1]), role, row, 'explicit-label', 'low')
        break
      }
    }
  }

  // ── Strategy 5: DOCX style metadata (secondary evidence only) ──────────────
  // Only add fonts from DOCX metadata if not already found via explicit detection
  for (const name of docxFontNames) {
    if (seen.has(name.toLowerCase())) continue
    // Only include as evidence; do not auto-assign roles from metadata alone
    addFont(name, 'Unknown (DOCX metadata)', `From DOCX styles.xml: ${name}`, 'docx-style-metadata', 'low')
  }

  // ── Strategy 6: PDF font metadata (secondary evidence only) ──────────────
  for (const name of pdfFontNames) {
    if (seen.has(name.toLowerCase())) continue
    addFont(name, 'Unknown (PDF metadata)', `From PDF font metadata: ${name}`, 'pdf-font-metadata', 'low')
  }

  return results
}

// ── Typography Style Extraction ────────────────────────────────────────────

const TYPO_ROLE_LABELS = [
  ['Document Title', /document\s+title/i],
  ['Title',          /\btitle\b(?!\s+font)/i],
  ['Heading 1',      /heading\s*1\b|h1\b/i],
  ['Heading 2',      /heading\s*2\b|h2\b/i],
  ['Heading 3',      /heading\s*3\b|h3\b/i],
  ['Heading 4',      /heading\s*4\b|h4\b/i],
  ['Body',           /\bbody\b(?!\s+text|\s+font)/i],
  ['Caption',        /\bcaption\b/i],
  ['Code',           /\bcode\b(?!\s+font)/i],
  ['Footnote',       /\bfootnote\b/i],
] as const

function normalizeWeight(w: string): string {
  const l = w.toLowerCase().replace(/[\s-]/g, '')
  if (l === 'bold' || l === 'extrabold') return '700'
  if (l === 'semibold') return '600'
  if (l === 'medium') return '500'
  if (l === 'regular') return '400'
  if (l === 'light') return '300'
  if (l === 'thin') return '100'
  if (l === 'black' || l === 'heavy') return '900'
  if (/^\d+$/.test(l)) return l
  return w
}

function findFontForRole(role: string, context: string, fonts: ExtractedFont[]): string | undefined {
  // Primary: non-metadata fonts whose name appears in the context text
  for (const f of fonts) {
    if (f.detectionMethod === 'docx-style-metadata' || f.detectionMethod === 'pdf-font-metadata') continue
    if (context.toLowerCase().includes(f.family.toLowerCase())) return f.family
  }
  // Secondary: role-matched non-metadata fonts
  const r = role.toLowerCase()
  const highConfidence = fonts.filter(f => f.confidence !== 'low')
  const roleMatch =
    r.includes('code')
      ? highConfidence.find(f => f.suggestedRole === 'Code')?.family
      : r.includes('heading') || r.includes('title')
        ? highConfidence.find(f => ['Heading', 'Display', 'Subheading'].includes(f.suggestedRole))?.family
        : r.includes('caption')
          ? (highConfidence.find(f => f.suggestedRole === 'Caption')?.family ?? highConfidence.find(f => f.suggestedRole === 'Body')?.family)
          : highConfidence.find(f => f.suggestedRole === 'Body')?.family
  if (roleMatch) return roleMatch

  // Last resort: use document-embedded font metadata (DOCX styles.xml / PDF font stream).
  // These are real fonts from the file; we just have less certainty about role assignment.
  const metaFonts = fonts.filter(f => f.detectionMethod === 'docx-style-metadata' || f.detectionMethod === 'pdf-font-metadata')
  if (metaFonts.length === 0) return undefined
  // Prefer a mono/code face for code roles
  if (r.includes('code')) {
    const mono = metaFonts.find(f => /mono|courier|consolas|inconsolata|fira\s*code|source\s*code/i.test(f.family))
    if (mono) return mono.family
  }
  // Return the most frequently embedded face (first in list = highest occurrence from extractDocxFontNames)
  return metaFonts[0].family
}

export function extractTypographyStyles(
  text: string,
  fonts: ExtractedFont[],
  tableCells: string[][][] = [],
): ExtractedTypoStyle[] {
  const results: ExtractedTypoStyle[] = []
  const lines = text.split('\n')

  // First pass: typography table extraction (schema-aware, column-index–based)
  for (let ti = 0; ti < tableCells.length; ti++) {
    const table = tableCells[ti]
    if (table.length < 2) continue

    // Normalize header row: trim, lowercase, collapse spaces
    const headerRow = table[0].map(c => c.toLowerCase().trim().replace(/\s+/g, ' '))
    const roleCol      = headerRow.findIndex(h => FONT_ROLE_HEADER_RE.test(h))
    const fontFamilyCol = headerRow.findIndex(h => FONT_FAMILY_HEADER_RE.test(h))
    const weightCol    = headerRow.findIndex(h => FONT_WEIGHT_HEADER_RE.test(h))
    const sizeCol      = headerRow.findIndex(h => FONT_SIZE_HEADER_RE.test(h))
    const colorCol     = headerRow.findIndex(h => FONT_COLOR_HEADER_RE.test(h))

    // Skip tables with no recognizable typography columns
    if (roleCol < 0 && fontFamilyCol < 0) continue

    const columnMap = { role: roleCol, fontFamily: fontFamilyCol, weight: weightCol, size: sizeCol, color: colorCol }

    for (let ri = 1; ri < table.length; ri++) {
      const row = table[ri]

      // Read each value strictly from its column — never shift between rows
      const roleRaw      = roleCol      >= 0 ? (row[roleCol]?.trim()      ?? '') : ''
      const fontFamilyRaw = fontFamilyCol >= 0 ? (row[fontFamilyCol]?.trim() ?? '') : ''
      const weightRaw    = weightCol    >= 0 ? (row[weightCol]?.trim()    ?? '') : ''
      const sizeRaw      = sizeCol      >= 0 ? (row[sizeCol]?.trim()      ?? '') : ''
      const colorRaw     = colorCol     >= 0 ? (row[colorCol]?.trim()     ?? '') : ''

      if (!roleRaw) continue

      const matchedRole = TYPO_ROLE_LABELS.find(([, re]) => re.test(roleRaw))
      const roleName = matchedRole?.[0] ?? roleRaw

      // Font family: use the cell value directly if it's a valid font name
      // Never borrow from another row or infer from the role name
      let fontFamily: string | undefined
      if (isValidFontFamily(fontFamilyRaw)) {
        fontFamily = normalizeFamily(fontFamilyRaw)
      } else if (!fontFamilyRaw) {
        // Column absent or blank — try to find from extracted fonts list as last resort
        const rowText = row.join(' | ')
        const found = findFontForRole(roleName, rowText, fonts)
        fontFamily = found && isValidFontFamily(found) ? found : undefined
      }
      // If fontFamilyRaw is present but invalid (e.g., "Bold") → leave undefined

      const fontWeight = weightRaw ? normalizeWeight(weightRaw) : undefined
      const sizeMatch = sizeRaw.match(/(\d{1,3})/)
      const fontSize = sizeMatch ? parseInt(sizeMatch[1]) : undefined
      const colorMatch = colorRaw.match(/#([0-9A-Fa-f]{6})\b/i)
      const color = colorMatch ? normalizeHex(colorMatch[0]) : undefined

      if (!fontFamily && !fontWeight && !fontSize && !color) continue

      results.push({
        id: `typo-${results.length}`,
        role: roleName,
        fontFamily,
        fontSize,
        fontWeight,
        color,
        sourceSnippet: `Typography table ${ti} row ${ri}: ${row.join(' | ')}`,
        detectionMethod: 'typography-table',
        confidence: (fontFamily || fontSize) ? 'high' : 'medium',
        sourceTableIndex: ti,
        sourceRowIndex: ri,
        rawCells: { roleRaw, fontFamilyRaw, weightRaw, sizeRaw, colorRaw },
        columnMap,
      })
    }
  }

  // Second pass: text-based detection for roles not yet found in tables
  const foundRoles = new Set(results.map(r => r.role))
  for (const [role, re] of TYPO_ROLE_LABELS) {
    if (foundRoles.has(role)) continue
    for (let li = 0; li < lines.length; li++) {
      if (!re.test(lines[li])) continue
      const ctxStart = Math.max(0, li - 1)
      const ctxEnd = Math.min(lines.length - 1, li + 6)
      const ctxLines = lines.slice(ctxStart, ctxEnd + 1)
      const context = ctxLines.join('\n')

      const sizeM = context.match(/(\d{1,3})\s*pt\b/i)
      const fontSize = sizeM ? parseInt(sizeM[1]) : undefined

      const wm = context.match(/\b(Bold|Semibold|Semi[\s-]Bold|Medium|Regular|Light|Thin|Black|Heavy|ExtraBold|Extra[\s-]Bold|\b[1-9]00)\b/i)
      const fontWeight = wm ? normalizeWeight(wm[1]) : undefined

      const cm = context.match(/#([0-9A-Fa-f]{6})\b/i)
      const color = cm ? normalizeHex(cm[0]) : undefined

      const foundFamily = findFontForRole(role, context, fonts)
      const fontFamily = foundFamily && isValidFontFamily(foundFamily) ? foundFamily : undefined

      if (!fontSize && !fontWeight && !color && !fontFamily) continue

      results.push({
        id: `typo-${results.length}`, role, fontFamily, fontSize, fontWeight, color,
        sourceSnippet: context.replace(/\s+/g, ' ').trim(),
        detectionMethod: 'text-block',
        confidence: (fontSize || fontWeight) ? 'high' : 'medium',
      })
      break
    }
  }

  return results
}

// ── Main Entry Point ───────────────────────────────────────────────────────

export async function extractBrandFromFile(file: File): Promise<BrandExtractionResult> {
  const fileType = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()
  const diag: ExtractionDiagnostics = {
    fileParsed: false,
    textBlocksExtracted: 0,
    tablesFound: 0,
    rawColorCandidates: 0,
    acceptedColorCandidates: 0,
    fontCandidates: 0,
    embeddedImages: 0,
    typographyTablesFound: 0,
    fontFamilyCellsDetected: 0,
    explicitFontDeclarationsDetected: 0,
    docxMetadataFontCandidates: 0,
    pdfMetadataFontCandidates: 0,
    typographyStylesDetected: 0,
    warnings: [],
  }

  let extractedText = ''
  let tableRows: string[] = []
  let tableCells: string[][][] = []
  let logos: ExtractedLogo[] = []
  let pdfLogoNote: string | undefined
  let docxFontNames: string[] = []
  let pdfFontNames: string[] = []

  try {
    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      const result = await extractPdfText(file)
      extractedText = result.text
      diag.textBlocksExtracted = result.pageTexts.length
      pdfFontNames = result.pdfFontNames
      diag.pdfMetadataFontCandidates = pdfFontNames.length
      pdfLogoNote = 'Logo image extraction from PDF is not available in this prototype. Upload your logo separately.'
      // Reconstruct table cells from PDF positioned items (position-based, not text-order)
      const pdfTables = reconstructPdfTables(result.positionedItems)
      if (pdfTables.length > 0) tableCells = pdfTables
    } else if (
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      const docx = await extractDocxContent(file)
      extractedText = docx.rawText
      tableRows = docx.tableTexts
      tableCells = docx.tableCells
      docxFontNames = docx.docxFontNames
      diag.textBlocksExtracted = extractedText.split('\n').filter(l => l.trim()).length
      diag.tablesFound = tableCells.length
      diag.embeddedImages = docx.images.length
      diag.docxMetadataFontCandidates = docxFontNames.length
      logos = docx.images
        .filter(blob => blob.size > 500)
        .map((blob, i) => ({ id: `logo-${i}`, blob, suggestedRole: i === 0 ? 'Primary Logo' : 'Secondary Logo' }))
    } else {
      throw new Error(`Unsupported file type: ${file.type || file.name}`)
    }
    diag.fileParsed = true
  } catch (err) {
    diag.warnings.push(`Parse error: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }

  diag.rawColorCandidates = (extractedText.match(/#[0-9A-Fa-f]{3,6}\b/g) ?? []).length

  const colors = extractColors(extractedText, tableRows)
  diag.acceptedColorCandidates = colors.length

  const fonts = extractFonts(extractedText, tableRows, tableCells, docxFontNames, pdfFontNames)
  diag.explicitFontDeclarationsDetected = fonts.filter(f => f.detectionMethod === 'explicit-label').length

  // Count typography table metrics
  for (const table of tableCells) {
    if (table.length < 2) continue
    const header = table[0].map(c => c.toLowerCase())
    const hasFontCol = header.some(h => FONT_FAMILY_HEADER_RE.test(h))
    const hasRoleCol = header.some(h => FONT_ROLE_HEADER_RE.test(h))
    const hasTokenCol = header.some(h => TOKEN_NAME_HEADER_RE.test(h))
    if (hasFontCol || hasRoleCol || hasTokenCol) diag.typographyTablesFound++
    if (hasFontCol) diag.fontFamilyCellsDetected += table.length - 1
  }

  const typographyStyles = extractTypographyStyles(extractedText, fonts, tableCells)
  diag.typographyStylesDetected = typographyStyles.length

  // Derive the Detected Fonts list from typography styles (spec §10)
  // Families extracted from actual typography table rows take priority over
  // standalone explicit-label font detection.
  const typoFamilies = new Map<string, ExtractedFont>()
  for (const style of typographyStyles) {
    if (!style.fontFamily || !isValidFontFamily(style.fontFamily)) continue
    const key = style.fontFamily.toLowerCase()
    if (!typoFamilies.has(key)) {
      typoFamilies.set(key, {
        id: `fnt-typo-${typoFamilies.size}`,
        family: style.fontFamily,
        suggestedRole: style.role,
        sourceSnippet: style.sourceSnippet,
        detectionMethod: 'typography-table',
        confidence: 'high',
      })
    }
  }
  // Merge: typography-derived fonts first, then any standalone explicit fonts not already covered
  const mergedFonts: ExtractedFont[] = Array.from(typoFamilies.values())
  for (const f of fonts) {
    if (f.detectionMethod === 'docx-style-metadata' || f.detectionMethod === 'pdf-font-metadata') continue
    if (!typoFamilies.has(f.family.toLowerCase())) mergedFonts.push(f)
  }
  const finalFonts = mergedFonts.length > 0 ? mergedFonts : fonts
  diag.fontCandidates = finalFonts.length

  if (colors.length === 0) {
    diag.warnings.push('No brand colors detected. The document may use image-based swatches or non-standard formatting.')
  }
  if (fonts.length === 0) {
    if (diag.typographyTablesFound > 0) {
      diag.warnings.push(`Typography tables were found (${diag.typographyTablesFound}) but no font family column was identified. Check that the table has a column labeled "Font family", "Typeface", or "Font name".`)
    } else if (diag.tablesFound > 0) {
      diag.warnings.push('Tables were found but none contained recognizable typography schemas. Check that the document includes a column for "Font family" or "Typeface".')
    } else {
      diag.warnings.push('No font declarations detected. Check that the document contains explicit font labels (e.g. "Heading font: X") or a typography table with a Font family column.')
    }
  }

  return {
    sourceFilename: file.name,
    extractedText,
    colors,
    fonts: finalFonts,
    typographyStyles,
    logos,
    pdfLogoNote,
    diagnostics: diag,
  }
}
