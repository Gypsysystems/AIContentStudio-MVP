// Source extraction pipeline — parses uploaded files into structured blocks
// Supports: DOCX (mammoth), PDF (pdfjs-dist), TXT, Markdown

import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker via Vite URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// ── Types ──────────────────────────────────────────────────────────────────

export type ExtractedBlockType =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table'
  | 'quote'
  | 'code'
  | 'other'

export type ExtractedBlock = {
  id: string
  sourceId: string
  type: ExtractedBlockType
  text: string
  order: number
  headingLevel?: number
  sectionPath?: string[]
  page?: number
  tableData?: string[][]
  links?: ExtractedLink[]
  listLevel?: number
  orderedList?: boolean
  inferred?: boolean
}

export type ExtractedLink = {
  text: string
  url: string
}

export type ExtractionStatus =
  | 'not-extracted'
  | 'extracting'
  | 'extracted'
  | 'partial'
  | 'failed'
  | 'unsupported'

export type SourceExtraction = {
  sourceId: string
  fileName: string
  fileType: string
  status: ExtractionStatus
  blocks: ExtractedBlock[]
  extractedText: string
  warnings: string[]
  extractedAt?: number
  sourceRevision: number
  extractionRevision: number
  extractionError?: string
  pageCount?: number
  charCount?: number
  parser?: string
}

export type EvidenceItem = {
  id: string
  sourceId: string
  blockId: string
  text: string
  location: string
  sectionPath?: string[]
  page?: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function mkId(sourceId: string, order: number, type: ExtractedBlockType, text: string): string {
  return `blk-${stableHash(`${sourceId}|${order}|${type}|${text}`)}`
}

function mkEvidenceId(sourceId: string, blockId: string): string {
  return `ev-${stableHash(`${sourceId}|${blockId}`)}`
}

function markdownLinks(text: string): ExtractedLink[] {
  return Array.from(text.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g))
    .map(match => ({ text: match[1], url: match[2] }))
}

export function buildEvidence(extraction: SourceExtraction): EvidenceItem[] {
  return extraction.blocks
    .filter(b => b.text.trim().length > 10)
    .map(b => ({
      id: mkEvidenceId(b.sourceId, b.id),
      sourceId: b.sourceId,
      blockId: b.id,
      text: b.text,
      location:
        b.page != null
          ? `p. ${b.page}${b.sectionPath?.length ? ' · ' + b.sectionPath.join(' › ') : ''}`
          : b.sectionPath?.length
          ? b.sectionPath.join(' › ')
          : extraction.fileName,
      sectionPath: b.sectionPath,
      page: b.page,
    }))
}

// ── DOCX extraction (mammoth) ──────────────────────────────────────────────

async function extractDocx(
  file: File,
  sourceId: string,
  sourceRevision: number
): Promise<SourceExtraction> {
  const warnings: string[] = []

  let mammoth: typeof import('mammoth')
  try {
    mammoth = (await import('mammoth')) as typeof import('mammoth')
  } catch {
    return {
      sourceId,
      fileName: file.name,
      fileType: 'docx',
      status: 'failed',
      blocks: [],
      extractedText: '',
      warnings: ['Could not load DOCX parser.'],
      extractedAt: Date.now(),
      sourceRevision,
      extractionRevision: sourceRevision,
      extractionError: 'mammoth module unavailable',
      parser: 'mammoth',
    }
  }

  const arrayBuffer = await file.arrayBuffer()

  let htmlResult: { value: string; messages: Array<{ type: string; message: string }> }
  try {
    htmlResult = await mammoth.convertToHtml({ arrayBuffer })
  } catch (err) {
    return {
      sourceId,
      fileName: file.name,
      fileType: 'docx',
      status: 'failed',
      blocks: [],
      extractedText: '',
      warnings: [],
      extractedAt: Date.now(),
      sourceRevision,
      extractionRevision: sourceRevision,
      extractionError: String(err),
      parser: 'mammoth',
    }
  }

  for (const msg of htmlResult.messages) {
    if (msg.type === 'warning') warnings.push(msg.message)
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlResult.value, 'text/html')
  const blocks: ExtractedBlock[] = []
  const sectionStack: string[] = []
  let order = 0
  const linksFor = (el: Element): ExtractedLink[] =>
    Array.from(el.querySelectorAll('a[href]'))
      .map(link => ({
        text: link.textContent?.trim() ?? '',
        url: link.getAttribute('href') ?? '',
      }))
      .filter(link => link.url.length > 0)

  const children = Array.from(doc.body.children)
  for (const el of children) {
    const tag = el.tagName.toLowerCase()
    const text = el.textContent?.trim() ?? ''
    if (!text) continue

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      const level = parseInt(tag[1])
      // Maintain sectionStack
      while (sectionStack.length >= level) sectionStack.pop()
      sectionStack.push(text)
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'heading', text),
        sourceId,
        type: 'heading',
        text,
        order: blockOrder,
        headingLevel: level,
        sectionPath: [...sectionStack],
        links: linksFor(el),
      })
    } else if (tag === 'p') {
      const blockquote = el.closest('blockquote')
      const type: ExtractedBlockType = blockquote ? 'quote' : 'paragraph'
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, type, text),
        sourceId,
        type,
        text,
        order: blockOrder,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
        links: linksFor(el),
      })
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll('li'))
      for (const li of items) {
        const liText = li.textContent?.trim() ?? ''
        if (!liText) continue
        const blockOrder = order++
        let listLevel = 1
        let parent = li.parentElement?.parentElement
        while (parent?.closest('li')) {
          listLevel++
          parent = parent.closest('li')?.parentElement?.parentElement ?? null
        }
        blocks.push({
          id: mkId(sourceId, blockOrder, 'list-item', liText),
          sourceId,
          type: 'list-item',
          text: liText,
          order: blockOrder,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          links: linksFor(li),
          listLevel,
          orderedList: li.parentElement?.tagName.toLowerCase() === 'ol',
        })
      }
    } else if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr'))
      const tableData: string[][] = rows.map(row =>
        Array.from(row.querySelectorAll('td, th')).map(
          cell => cell.textContent?.trim() ?? ''
        )
      )
      const flatText = tableData.map(r => r.join(' | ')).join('\n')
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'table', flatText),
        sourceId,
        type: 'table',
        text: flatText,
        order: blockOrder,
        tableData,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
        links: linksFor(el),
      })
    } else if (tag === 'pre' || tag === 'code') {
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'code', text),
        sourceId,
        type: 'code',
        text,
        order: blockOrder,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
      })
    }
  }

  const extractedText = blocks.map(b => b.text).join('\n')

  return {
    sourceId,
    fileName: file.name,
    fileType: 'docx',
    status: blocks.length > 0 ? 'extracted' : 'partial',
    blocks,
    extractedText,
    warnings,
    extractedAt: Date.now(),
    sourceRevision,
    extractionRevision: sourceRevision,
    charCount: extractedText.length,
    parser: 'mammoth 1.x',
  }
}

// ── PDF extraction (pdfjs-dist) ────────────────────────────────────────────

async function extractPdf(
  file: File,
  sourceId: string,
  sourceRevision: number
): Promise<SourceExtraction> {
  const arrayBuffer = await file.arrayBuffer()
  const warnings: string[] = []
  const blocks: ExtractedBlock[] = []
  let order = 0
  let pageCount = 0

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDoc = await loadingTask.promise
    pageCount = pdfDoc.numPages

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const textContent = await page.getTextContent()

      // Group items into lines by Y position
      type PdfItem = { str: string; transform: number[] }
      const items = textContent.items as PdfItem[]

      // Sort items by transform[5] (Y, descending = top to bottom) then transform[4] (X)
      const sorted = [...items].sort(
        (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
      )

      // Group into lines (items within ~2px Y are the same line)
      const lines: string[] = []
      let currentLineY: number | null = null
      let currentLine = ''
      for (const item of sorted) {
        if (!item.str) continue
        const y = Math.round(item.transform[5])
        if (currentLineY === null || Math.abs(y - currentLineY) <= 3) {
          currentLine += (currentLine ? ' ' : '') + item.str
          currentLineY = y
        } else {
          if (currentLine.trim()) lines.push(currentLine.trim())
          currentLine = item.str
          currentLineY = y
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim())

      // PDF.js exposes positioned text, but not reliable semantic heading roles.
      // Preserve page/order provenance without fabricating document structure.
      for (const line of lines) {
        if (!line) continue
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'paragraph', line),
          sourceId,
          type: 'paragraph',
          text: line,
          order: blockOrder,
          page: pageNum,
        })
      }
    }

    warnings.push('PDF text is preserved by page and reading order; headings are not inferred because PDF structure is uncertain.')
    if (blocks.length === 0) warnings.push('No selectable text was found. The PDF may contain scanned images.')
  } catch (err) {
    return {
      sourceId,
      fileName: file.name,
      fileType: 'pdf',
      status: 'failed',
      blocks: [],
      extractedText: '',
      warnings: [],
      extractedAt: Date.now(),
      sourceRevision,
      extractionRevision: sourceRevision,
      extractionError: String(err),
      pageCount,
      parser: 'pdfjs-dist 6.x',
    }
  }

  const extractedText = blocks.map(b => b.text).join('\n')

  return {
    sourceId,
    fileName: file.name,
    fileType: 'pdf',
    status: blocks.length > 0 ? 'extracted' : 'partial',
    blocks,
    extractedText,
    warnings,
    extractedAt: Date.now(),
    sourceRevision,
    extractionRevision: sourceRevision,
    pageCount,
    charCount: extractedText.length,
    parser: 'pdfjs-dist 6.x',
  }
}

// ── TXT extraction ─────────────────────────────────────────────────────────

async function extractTxt(
  file: File,
  sourceId: string,
  sourceRevision: number
): Promise<SourceExtraction> {
  const text = await file.text()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ExtractedBlock[] = []
  const sectionStack: string[] = []
  let order = 0
  let i = 0

  const isListLine = (line: string) => /^\s*(?:[-*+•]|\d+[.)])\s+/.test(line)
  const isHeadingLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 100) return false
    if (/^[A-Z][A-Z0-9 &/()'-]{2,}$/.test(trimmed) && /[A-Z]/.test(trimmed)) return true
    return trimmed.endsWith(':') && trimmed.length <= 80 && !/[.!?]:$/.test(trimmed)
  }

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    if (isListLine(line)) {
      while (i < lines.length && isListLine(lines[i])) {
        const raw = lines[i]
        const marker = raw.match(/^\s*((?:[-*+•])|(?:\d+[.)]))\s+/)
        const itemText = raw.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()
        if (itemText) {
          const blockOrder = order++
          blocks.push({
            id: mkId(sourceId, blockOrder, 'list-item', itemText),
            sourceId,
            type: 'list-item',
            text: itemText,
            order: blockOrder,
            sectionPath: sectionStack.length ? [...sectionStack] : undefined,
            listLevel: Math.max(1, Math.floor((raw.match(/^\s*/)?.[0].length ?? 0) / 2) + 1),
            orderedList: !!marker && /^\d/.test(marker[1]),
          })
        }
        i++
      }
      continue
    }

    if (isHeadingLine(line)) {
      const headingText = line.trim().replace(/:$/, '')
      sectionStack.length = 0
      sectionStack.push(headingText)
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'heading', headingText),
        sourceId,
        type: 'heading',
        text: headingText,
        order: blockOrder,
        headingLevel: 1,
        sectionPath: [...sectionStack],
        inferred: true,
      })
      i++
      continue
    }

    const paragraphLines: string[] = []
    while (
      i < lines.length
      && lines[i].trim()
      && !isListLine(lines[i])
      && !isHeadingLine(lines[i])
    ) {
      paragraphLines.push(lines[i].trim())
      i++
    }
    const paragraphText = paragraphLines.join(' ').trim()
    if (paragraphText) {
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'paragraph', paragraphText),
        sourceId,
        type: 'paragraph',
        text: paragraphText,
        order: blockOrder,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
      })
    }
  }

  const extractedText = blocks.map(b => b.text).join('\n')
  return {
    sourceId,
    fileName: file.name,
    fileType: 'txt',
    status: blocks.length > 0 ? 'extracted' : 'partial',
    blocks,
    extractedText,
    warnings: blocks.some(block => block.type === 'heading' && block.inferred)
      ? ['Plain-text headings are inferred only from conservative title patterns.']
      : [],
    extractedAt: Date.now(),
    sourceRevision,
    extractionRevision: sourceRevision,
    charCount: extractedText.length,
    parser: 'built-in text',
  }
}

// ── Markdown extraction ────────────────────────────────────────────────────

async function extractMarkdown(
  file: File,
  sourceId: string,
  sourceRevision: number
): Promise<SourceExtraction> {
  const text = await file.text()
  const lines = text.split('\n')
  const blocks: ExtractedBlock[] = []
  const sectionStack: string[] = []
  let order = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ATX heading: # Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      while (sectionStack.length >= level) sectionStack.pop()
      sectionStack.push(text)
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'heading', text),
        sourceId,
        type: 'heading',
        text,
        order: blockOrder,
        headingLevel: level,
        sectionPath: [...sectionStack],
        links: markdownLinks(text),
      })
      i++
      continue
    }

    // Setext heading: line followed by === or ---
    if (i + 1 < lines.length && /^={3,}\s*$/.test(lines[i + 1]) && line.trim()) {
      sectionStack.length = 0
      sectionStack.push(line.trim())
      const headingText = line.trim()
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'heading', headingText),
        sourceId,
        type: 'heading',
        text: headingText,
        order: blockOrder,
        headingLevel: 1,
        sectionPath: [...sectionStack],
        links: markdownLinks(headingText),
      })
      i += 2
      continue
    }
    if (i + 1 < lines.length && /^-{3,}\s*$/.test(lines[i + 1]) && line.trim() && !line.startsWith('-')) {
      while (sectionStack.length >= 2) sectionStack.pop()
      sectionStack.push(line.trim())
      const headingText = line.trim()
      const blockOrder = order++
      blocks.push({
        id: mkId(sourceId, blockOrder, 'heading', headingText),
        sourceId,
        type: 'heading',
        text: headingText,
        order: blockOrder,
        headingLevel: 2,
        sectionPath: [...sectionStack],
        links: markdownLinks(headingText),
      })
      i += 2
      continue
    }

    // Fenced code block
    if (/^```/.test(line) || /^~~~/.test(line)) {
      const fence = line.slice(0, 3)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith(fence)) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence
      const codeText = codeLines.join('\n').trim()
      if (codeText) {
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'code', codeText),
          sourceId,
          type: 'code',
          text: codeText,
          order: blockOrder,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
        })
      }
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      const quoteText = quoteLines.join(' ').trim()
      if (quoteText) {
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'quote', quoteText),
          sourceId,
          type: 'quote',
          text: quoteText,
          order: blockOrder,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          links: markdownLinks(quoteText),
        })
      }
      continue
    }

    // List item
    if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const listLines: Array<{ text: string; level: number; ordered: boolean }> = []
      while (
        i < lines.length &&
        (/^[-*+]\s/.test(lines[i]) || /^\d+\.\s/.test(lines[i]) || /^\s{2,}/.test(lines[i]))
      ) {
        const raw = lines[i]
        const itemText = raw.replace(/^\s*[-*+]\s/, '').replace(/^\s*\d+\.\s/, '').trim()
        if (itemText) {
          listLines.push({
            text: itemText,
            level: Math.max(1, Math.floor((raw.match(/^\s*/)?.[0].length ?? 0) / 2) + 1),
            ordered: /^\s*\d+\.\s/.test(raw),
          })
        }
        i++
      }
      for (const item of listLines) {
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'list-item', item.text),
          sourceId,
          type: 'list-item',
          text: item.text,
          order: blockOrder,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          links: markdownLinks(item.text),
          listLevel: item.level,
          orderedList: item.ordered,
        })
      }
      continue
    }

    // Simple table (| col | col |)
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        if (!/^[\s|:-]+$/.test(lines[i])) tableLines.push(lines[i]) // skip separator rows
        i++
      }
      if (tableLines.length > 0) {
        const tableData = tableLines.map(r =>
          r
            .split('|')
            .slice(1, -1)
            .map(c => c.trim())
        )
        const flatText = tableData.map(r => r.join(' | ')).join('\n')
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'table', flatText),
          sourceId,
          type: 'table',
          text: flatText,
          order: blockOrder,
          tableData,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          links: markdownLinks(flatText),
        })
      }
      continue
    }

    // Paragraph — collect non-empty non-special lines
    if (line.trim()) {
      const paraLines: string[] = []
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('> ') && !lines[i].includes('|')) {
        paraLines.push(lines[i].trim())
        i++
      }
      const paraText = paraLines.join(' ').trim()
      if (paraText) {
        const blockOrder = order++
        blocks.push({
          id: mkId(sourceId, blockOrder, 'paragraph', paraText),
          sourceId,
          type: 'paragraph',
          text: paraText,
          order: blockOrder,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          links: markdownLinks(paraText),
        })
      }
      continue
    }

    i++
  }

  const extractedText = blocks.map(b => b.text).join('\n')
  return {
    sourceId,
    fileName: file.name,
    fileType: 'markdown',
    status: blocks.length > 0 ? 'extracted' : 'partial',
    blocks,
    extractedText,
    warnings: [],
    extractedAt: Date.now(),
    sourceRevision,
    extractionRevision: sourceRevision,
    charCount: extractedText.length,
    parser: 'built-in markdown',
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

function getFileType(file: File): string {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) return 'docx'
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.txt')) return 'txt'
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown'
  const extension = name.includes('.') ? name.split('.').pop() : ''
  if (extension) return extension
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (file.type === 'text/plain') return 'txt'
  if (file.type === 'text/markdown') return 'markdown'
  return file.type || 'other'
}

export async function extractFromFile(
  file: File,
  sourceId: string,
  sourceRevision = 0
): Promise<SourceExtraction> {
  const fileType = getFileType(file)

  if (fileType === 'docx') return extractDocx(file, sourceId, sourceRevision)
  if (fileType === 'pdf') return extractPdf(file, sourceId, sourceRevision)
  if (fileType === 'txt') return extractTxt(file, sourceId, sourceRevision)
  if (fileType === 'markdown') return extractMarkdown(file, sourceId, sourceRevision)

  return {
    sourceId,
    fileName: file.name,
    fileType,
    status: 'unsupported',
    blocks: [],
    extractedText: '',
    warnings: [`Extraction is not yet supported for this file type.`],
    extractedAt: Date.now(),
    sourceRevision,
    extractionRevision: sourceRevision,
    charCount: 0,
  }
}

export function isExtractionFresh(
  extraction: SourceExtraction | undefined,
  sourcesRevision: number
): boolean {
  return !!extraction
    && extraction.status !== 'not-extracted'
    && extraction.status !== 'extracting'
    && extraction.extractionRevision === sourcesRevision
}

// ── Search ─────────────────────────────────────────────────────────────────

export type SearchHit = {
  sourceId: string
  fileName: string
  blockId: string
  blockType: ExtractedBlockType
  text: string
  matchStart: number
  matchEnd: number
  location: string
  page?: number
  sectionPath?: string[]
}

export function searchExtractions(
  extractions: Record<string, SourceExtraction>,
  query: string
): SearchHit[] {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  const hits: SearchHit[] = []

  for (const extraction of Object.values(extractions)) {
    if (
      extraction.status === 'unsupported'
      || extraction.status === 'failed'
      || extraction.status === 'not-extracted'
      || extraction.status === 'extracting'
    ) continue
    for (const block of extraction.blocks) {
      const lower = block.text.toLowerCase()
      const idx = lower.indexOf(q)
      if (idx === -1) continue
      hits.push({
        sourceId: extraction.sourceId,
        fileName: extraction.fileName,
        blockId: block.id,
        blockType: block.type,
        text: block.text,
        matchStart: idx,
        matchEnd: idx + q.length,
        location:
          block.page != null
            ? `p. ${block.page}${block.sectionPath?.length ? ' · ' + block.sectionPath[block.sectionPath.length - 1] : ''}`
            : block.sectionPath?.length
            ? block.sectionPath[block.sectionPath.length - 1]
            : extraction.fileName,
        page: block.page,
        sectionPath: block.sectionPath,
      })
    }
  }

  return hits.slice(0, 200)
}
