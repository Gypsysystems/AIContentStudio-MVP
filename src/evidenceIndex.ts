import type {
  ExtractedBlockType,
  ExtractedLink,
  SourceExtraction,
} from './sourceExtractor'

export type EvidenceItem = {
  id: string
  sourceId: string
  fileId: string
  blockId: string
  sourceFileName: string
  text: string
  blockType: ExtractedBlockType
  order: number
  location: string
  sectionPath?: string[]
  page?: number
  tableData?: string[][]
  links?: ExtractedLink[]
  listLevel?: number
  orderedList?: boolean
}

export type EvidenceIndex = {
  items: EvidenceItem[]
  sourcesRevision: number
  extractionRevision: string
  builtAt: number
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function evidenceId(blockId: string): string {
  return `ev-${stableHash(blockId)}`
}

function locationFor(extraction: SourceExtraction, block: SourceExtraction['blocks'][number]): string {
  const section = block.sectionPath?.join(' › ')
  if (block.page != null) {
    return `p. ${block.page}${section ? ` · ${section}` : ''}`
  }
  return section || extraction.fileName
}

export function buildEvidence(extraction: SourceExtraction): EvidenceItem[] {
  if (extraction.status !== 'extracted' && extraction.status !== 'partial') return []

  return extraction.blocks
    .filter(block => block.text.trim().length > 0)
    .map(block => ({
      id: evidenceId(block.id),
      sourceId: extraction.sourceId,
      fileId: extraction.sourceId,
      blockId: block.id,
      sourceFileName: extraction.fileName,
      text: block.text,
      blockType: block.type,
      order: block.order,
      location: locationFor(extraction, block),
      sectionPath: block.sectionPath ? [...block.sectionPath] : undefined,
      page: block.page,
      tableData: block.tableData?.map(row => [...row]),
      links: block.links?.map(link => ({ ...link })),
      listLevel: block.listLevel,
      orderedList: block.orderedList,
    }))
}

export function getEvidenceExtractionRevision(
  extractions: Record<string, SourceExtraction>,
  sourcesRevision: number,
): string {
  const revisionPayload = Object.entries(extractions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileId, extraction]) => ({
      fileId,
      sourceId: extraction.sourceId,
      fileName: extraction.fileName,
      status: extraction.status,
      sourceRevision: extraction.sourceRevision,
      extractionRevision: extraction.extractionRevision,
      extractedAt: extraction.extractedAt ?? null,
      blocks: extraction.blocks.map(block => ({
        id: block.id,
        sourceId: block.sourceId,
        type: block.type,
        text: block.text,
        order: block.order,
        headingLevel: block.headingLevel ?? null,
        sectionPath: block.sectionPath ?? null,
        page: block.page ?? null,
        tableData: block.tableData ?? null,
        links: block.links ?? null,
        listLevel: block.listLevel ?? null,
        orderedList: block.orderedList ?? null,
      })),
    }))

  return `extract-${sourcesRevision}-${stableHash(JSON.stringify(revisionPayload))}`
}

export function buildEvidenceIndex(
  extractions: Record<string, SourceExtraction>,
  sourcesRevision: number,
): EvidenceIndex {
  const items = Object.values(extractions).flatMap(buildEvidence)
  return {
    items,
    sourcesRevision,
    extractionRevision: getEvidenceExtractionRevision(extractions, sourcesRevision),
    builtAt: Date.now(),
  }
}

export function isEvidenceIndexFresh(
  index: EvidenceIndex | null,
  extractions: Record<string, SourceExtraction>,
  sourcesRevision: number,
): boolean {
  return !!index
    && index.sourcesRevision === sourcesRevision
    && index.extractionRevision === getEvidenceExtractionRevision(extractions, sourcesRevision)
}

export function remapEvidenceIndex(
  index: EvidenceIndex | null,
  fileIdMap: Record<string, string>,
  remappedExtractions: Record<string, SourceExtraction>,
  wasFresh: boolean,
): EvidenceIndex | null {
  if (!index) return null

  const items = index.items.flatMap(item => {
    const copiedFileId = fileIdMap[item.fileId] ?? fileIdMap[item.sourceId]
    if (!copiedFileId) return []
    return [{
      ...item,
      sourceId: copiedFileId,
      fileId: copiedFileId,
      sectionPath: item.sectionPath ? [...item.sectionPath] : undefined,
      tableData: item.tableData?.map(row => [...row]),
      links: item.links?.map(link => ({ ...link })),
    }]
  })

  return {
    ...index,
    items,
    extractionRevision: wasFresh
      ? getEvidenceExtractionRevision(remappedExtractions, index.sourcesRevision)
      : index.extractionRevision,
  }
}