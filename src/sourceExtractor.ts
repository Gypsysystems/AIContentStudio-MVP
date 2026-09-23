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
  sourceId: string
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
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'heading',
        text,
        order: order++,
        headingLevel: level,
        sectionPath: [...sectionStack],
      })
    } else if (tag === 'p') {
      const blockquote = el.closest('blockquote')
      blocks.push({
        id: mkId(),
        sourceId,
        type: blockquote ? 'quote' : 'paragraph',
        text,
        order: order++,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
      })
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll('li'))
      for (const li of items) {
        const liText = li.textContent?.trim() ?? ''
        if (!liText) continue
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'list-item',
          text: liText,
          order: order++,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
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
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'table',
        text: flatText,
        order: order++,
        tableData,
        sectionPath: sectionStack.length ? [...sectionStack] : undefined,
      })
    } else if (tag === 'pre' || tag === 'code') {
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'code',
        text,
        order: order++,
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
    charCount: extractedText.length,
    parser: 'mammoth 1.x',
  }
}

// ── PDF extraction (pdfjs-dist) ────────────────────────────────────────────

async function extractPdf(
  file: File,
  sourceId: string
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

      // Heuristically classify lines
      const sectionStack: string[] = []
      for (const line of lines) {
        if (!line) continue
        const isLikelyHeading =
          line.length < 100 &&
          !line.endsWith('.') &&
          !line.endsWith(',') &&
          line.length > 2 &&
          /^[A-Z0-9]/.test(line)

        if (isLikelyHeading && line.length < 60) {
          while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].length > line.length) {
            sectionStack.pop()
          }
          sectionStack.push(line)
          blocks.push({
            id: mkId(),
            sourceId,
            type: 'heading',
            text: line,
            order: order++,
            page: pageNum,
            headingLevel: 2,
            sectionPath: [...sectionStack],
            inferred: true,
          })
        } else {
          blocks.push({
            id: mkId(),
            sourceId,
            type: 'paragraph',
            text: line,
            order: order++,
            page: pageNum,
            sectionPath: sectionStack.length ? [...sectionStack] : undefined,
          })
        }
      }
    }

    if (blocks.filter(b => b.type === 'heading' && b.inferred).length > 0) {
      warnings.push('Heading detection is heuristic for PDF files — headings are inferred from text characteristics.')
    }
  } catch (err) {
    return {
      sourceId,
      fileName: file.name,
      fileType: 'pdf',
      status: 'failed',
      blocks: [],
      extractedText: '',
      warnings: [],
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
    pageCount,
    charCount: extractedText.length,
    parser: 'pdfjs-dist 6.x',
  }
}

// ── TXT extraction ─────────────────────────────────────────────────────────

async function extractTxt(
  file: File,
  sourceId: string
): Promise<SourceExtraction> {
  const text = await file.text()
  const blocks: ExtractedBlock[] = []
  let order = 0

  const paragraphs = text.split(/\n{2,}/)
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue
    blocks.push({
      id: mkId(),
      sourceId,
      type: 'paragraph',
      text: trimmed,
      order: order++,
    })
  }

  const extractedText = blocks.map(b => b.text).join('\n')
  return {
    sourceId,
    fileName: file.name,
    fileType: 'txt',
    status: 'extracted',
    blocks,
    extractedText,
    warnings: [],
    extractedAt: Date.now(),
    charCount: extractedText.length,
    parser: 'built-in text',
  }
}

// ── Markdown extraction ────────────────────────────────────────────────────

async function extractMarkdown(
  file: File,
  sourceId: string
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
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'heading',
        text,
        order: order++,
        headingLevel: level,
        sectionPath: [...sectionStack],
      })
      i++
      continue
    }

    // Setext heading: line followed by === or ---
    if (i + 1 < lines.length && /^={3,}\s*$/.test(lines[i + 1]) && line.trim()) {
      sectionStack.length = 0
      sectionStack.push(line.trim())
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'heading',
        text: line.trim(),
        order: order++,
        headingLevel: 1,
        sectionPath: [...sectionStack],
      })
      i += 2
      continue
    }
    if (i + 1 < lines.length && /^-{3,}\s*$/.test(lines[i + 1]) && line.trim() && !line.startsWith('-')) {
      while (sectionStack.length >= 2) sectionStack.pop()
      sectionStack.push(line.trim())
      blocks.push({
        id: mkId(),
        sourceId,
        type: 'heading',
        text: line.trim(),
        order: order++,
        headingLevel: 2,
        sectionPath: [...sectionStack],
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
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'code',
          text: codeText,
          order: order++,
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
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'quote',
          text: quoteText,
          order: order++,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
        })
      }
      continue
    }

    // List item
    if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const listLines: string[] = []
      while (
        i < lines.length &&
        (/^[-*+]\s/.test(lines[i]) || /^\d+\.\s/.test(lines[i]) || /^\s{2,}/.test(lines[i]))
      ) {
        const itemText = lines[i].replace(/^[-*+]\s/, '').replace(/^\d+\.\s/, '').trim()
        if (itemText) listLines.push(itemText)
        i++
      }
      for (const itemText of listLines) {
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'list-item',
          text: itemText,
          order: order++,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
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
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'table',
          text: flatText,
          order: order++,
          tableData,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
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
        blocks.push({
          id: mkId(),
          sourceId,
          type: 'paragraph',
          text: paraText,
          order: order++,
          sectionPath: sectionStack.length ? [...sectionStack] : undefined,
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
    status: 'extracted',
    blocks,
    extractedText,
    warnings: [],
    extractedAt: Date.now(),
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
  return 'other'
}

export async function extractFromFile(
  file: File,
  sourceId: string
): Promise<SourceExtraction> {
  const fileType = getFileType(file)

  if (fileType === 'docx') return extractDocx(file, sourceId)
  if (fileType === 'pdf') return extractPdf(file, sourceId)
  if (fileType === 'txt') return extractTxt(file, sourceId)
  if (fileType === 'markdown') return extractMarkdown(file, sourceId)

  return {
    sourceId,
    fileName: file.name,
    fileType,
    status: 'unsupported',
    blocks: [],
    extractedText: '',
    warnings: [`Extraction is not yet supported for this file type.`],
    extractedAt: Date.now(),
    charCount: 0,
  }
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
    if (extraction.status === 'unsupported' || extraction.status === 'failed') continue
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
