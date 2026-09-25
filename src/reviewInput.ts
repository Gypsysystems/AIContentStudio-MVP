import type { AuthorTopicMetadataMap } from './authorMetadata'
import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex } from './evidenceIndex'
import type { SourceExtraction } from './sourceExtractor'
import type { UnsupportedAnalysis } from './unsupportedAnalysis'

export const REVIEW_INPUT_SNAPSHOT_VERSION = 1

export type ReviewInputProvenance = {
  projectId: string
  contentRevision: number
  contentFingerprint: string
  sourcesRevision: number
  sourceFileIds: string[]
  evidenceExtractionRevision: string | null
  evidenceIndexBuiltAt: number | null
  analysisRevision: number | null
  analysisBuiltAt: number | null
  tocRevision: number
  contentType: string
  styleProfileId: string | null
  styleFingerprint: string | null
  standardsFingerprint: string | null
  capturedAt: number
}

export type ReviewInputTopic = {
  topicId: string
  title: string
  level: number
  parentTopicId: string | null
  order: number
  blocks: ReviewInputBlock[]
}

export type ReviewInputBlock = {
  blockId: string
  type: string
  content: string
  fingerprint: string
  tableHasHeader?: boolean
  tableExcerpt?: string
}

export type ReviewInputSource = {
  sourceId: string
  fileId: string
  fileName: string
  status: SourceExtraction['status']
  extractionRevision: number
  blockIds: string[]
  contentFingerprint: string
}

export type ReviewInputEvidence = {
  evidenceId: string
  sourceId: string
  fileId: string
  blockId: string
  sourceFileName: string
  location: string
  contentFingerprint: string
}

export type ReviewInputAnalysis = {
  builtAt: number | null
  fresh: boolean
  conceptIds: string[]
  terminologyIds: string[]
  conflictIds: string[]
  gapIds: string[]
}

export type ReviewInputUnsupportedAnalysis = {
  builtAt: number | null
  fresh: boolean
  contentFingerprint: string | null
  findingIds: string[]
}

export type ReviewInputStyle = {
  styleProfileId: string
  name: string
  scope: string
  source: string | null
  fingerprint: string
}

export type ReviewInputStandard = {
  standardId: string
  label: string
  value: string
  fingerprint: string
}

export type ReviewInputTerminology = {
  termId: string
  preferredTerm: string
  exactTerms: string[]
  evidenceIds: string[]
}

export type ReviewInputAuthorTopic = {
  topicId: string
  contentOrigin: string
  generationStatus: string
  generatedFreshness: string
  generatedFreshnessReason: string | null
  evidenceIds: string[]
  sourceFileIds: string[]
  groundingContextId: string | null
  blockStates: Record<string, string>
  provenanceFingerprint: string
}

export type ReviewInputIssue = {
  code: string
  severity: 'missing' | 'stale'
  message: string
  topicId?: string
  sourceId?: string
}

export type ReviewInputSnapshot = {
  version: typeof REVIEW_INPUT_SNAPSHOT_VERSION
  snapshotId: string
  projectId: string
  capturedAt: number
  contentType: string
  language: string
  topics: ReviewInputTopic[]
  sources: ReviewInputSource[]
  evidence: ReviewInputEvidence[]
  groundedAnalysis: ReviewInputAnalysis
  unsupportedAnalysis: ReviewInputUnsupportedAnalysis
  style: ReviewInputStyle | null
  standards: ReviewInputStandard[]
  terminology: ReviewInputTerminology[]
  authorTopics: ReviewInputAuthorTopic[]
  issues: ReviewInputIssue[]
  readiness: 'ready' | 'missing-inputs' | 'stale-inputs'
  provenance: ReviewInputProvenance
}

export type ReviewInputTocItem = {
  id: number
  topicId?: string
  title: string
  level: number
  parentTopicId?: string
  parentId?: number
  order?: number
}

export type ReviewInputDocBlock = {
  id: string
  type: string
  content: string
  tableData?: { rows: string[][]; hasHeader: boolean }
  procedureSteps?: string[]
  caption?: string
  conditions?: string[]
  listItems?: Array<{ id: string; text: string; level: number; type: string }>
}

export type ReviewStyleProfileInput = {
  id: string
  name: string
  scope: string
  source?: string
  body?: unknown
  h1?: unknown
  h2?: unknown
  h3?: unknown
  h4?: unknown
  caption?: unknown
  code?: unknown
  links?: unknown
  lists?: unknown
  tables?: unknown
  callouts?: unknown
  writingRules?: unknown
  formattingRules?: unknown
}

export type BuildReviewInputSnapshotInput = {
  projectId: string
  capturedAt?: number
  contentType: string
  language: string
  contentRevision: number
  tocRevision: number
  topics: ReviewInputTocItem[]
  topicContent: Record<string, ReviewInputDocBlock[]>
  sourcesRevision: number
  sourceFileIds: string[]
  sourceExtractions: Record<string, SourceExtraction>
  evidenceIndex: EvidenceIndex | null
  evidenceFresh: boolean
  conceptAnalysis: ConceptAnalysis | null
  conceptAnalysisFresh: boolean
  analysisRevision: number
  unsupportedAnalysis: UnsupportedAnalysis | null
  unsupportedAnalysisFresh: boolean
  styleProfile: ReviewStyleProfileInput | null
  authorTopicMetadata: AuthorTopicMetadataMap
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  )
}

function fingerprint(prefix: string, value: unknown): string {
  return `${prefix}-${stableHash(JSON.stringify(stableValue(value)))}`
}

function stableTopicId(topic: ReviewInputTocItem): string {
  return topic.topicId?.trim() || `legacy-${topic.id}`
}

function blockPayload(block: ReviewInputDocBlock): Omit<ReviewInputBlock, 'fingerprint'> {
  return {
    blockId: block.id,
    type: block.type,
    content: block.content,
    ...(block.tableData ? { tableHasHeader: block.tableData.hasHeader } : {}),
    ...(block.tableData?.rows[0]?.length
      ? { tableExcerpt: block.tableData.rows[0].join(' | ') }
      : {}),
  }
}

function topicBlocks(
  topic: ReviewInputTocItem,
  topicContent: Record<string, ReviewInputDocBlock[]>,
): ReviewInputBlock[] {
  const topicId = stableTopicId(topic)
  const blocks = topicContent[topicId] ?? topicContent[String(topic.id)] ?? []
  return blocks.map(block => {
    const payload = {
      ...blockPayload(block),
      tableData: block.tableData ?? null,
      procedureSteps: block.procedureSteps ?? null,
      caption: block.caption ?? null,
      conditions: block.conditions ?? null,
      listItems: block.listItems ?? null,
    }
    return {
      ...blockPayload(block),
      fingerprint: fingerprint('review-block', payload),
    }
  })
}

function styleStandards(
  contentType: string,
  language: string,
  styleProfile: ReviewStyleProfileInput | null,
): ReviewInputStandard[] {
  const values: Array<[string, string, unknown]> = [
    ['content-type', 'Content type', contentType],
    ['language', 'Language', language],
  ]
  if (styleProfile) {
    values.push(
      ['body-typography', 'Body typography', styleProfile.body ?? null],
      ['heading-typography', 'Heading typography', {
        h1: styleProfile.h1 ?? null,
        h2: styleProfile.h2 ?? null,
        h3: styleProfile.h3 ?? null,
        h4: styleProfile.h4 ?? null,
      }],
      ['caption-typography', 'Caption typography', styleProfile.caption ?? null],
      ['code-typography', 'Code typography', styleProfile.code ?? null],
      ['links', 'Link treatment', styleProfile.links ?? null],
      ['lists', 'List treatment', styleProfile.lists ?? null],
      ['tables', 'Table treatment', styleProfile.tables ?? null],
      ['callouts', 'Callout treatment', styleProfile.callouts ?? null],
    )
    if (styleProfile.writingRules) values.push(['writing-rules', 'Writing rules', styleProfile.writingRules])
    if (styleProfile.formattingRules) values.push(['formatting-rules', 'Formatting rules', styleProfile.formattingRules])
  }
  return values.map(([standardId, label, value]) => ({
    standardId,
    label,
    value: typeof value === 'string' ? value : JSON.stringify(stableValue(value)),
    fingerprint: fingerprint(`review-standard-${standardId}`, value),
  }))
}

function buildIssues(input: BuildReviewInputSnapshotInput): ReviewInputIssue[] {
  const issues: ReviewInputIssue[] = []
  if (!input.topics.length) {
    issues.push({ code: 'toc-missing', severity: 'missing', message: 'No committed topics are available.' })
  }
  const contentBlockCount = input.topics.reduce(
    (count, topic) => count + topicBlocks(topic, input.topicContent).length,
    0,
  )
  if (!contentBlockCount) {
    issues.push({ code: 'topic-content-missing', severity: 'missing', message: 'No persisted topic blocks are available.' })
  }
  if (!input.sourceFileIds.length) {
    issues.push({ code: 'sources-missing', severity: 'missing', message: 'No project sources are available.' })
  }
  for (const sourceId of [...input.sourceFileIds].sort()) {
    const extraction = input.sourceExtractions[sourceId]
    if (!extraction) {
      issues.push({
        code: 'source-extraction-missing',
        severity: 'missing',
        message: 'A project source has no persisted extraction.',
        sourceId,
      })
    } else if (extraction.status !== 'extracted' && extraction.status !== 'partial') {
      issues.push({
        code: 'source-extraction-incomplete',
        severity: 'missing',
        message: `${extraction.fileName} is not ready for Review.`,
        sourceId,
      })
    }
  }
  if (!input.evidenceIndex) {
    issues.push({ code: 'evidence-missing', severity: 'missing', message: 'The Evidence Index has not been built.' })
  } else if (!input.evidenceFresh) {
    issues.push({ code: 'evidence-stale', severity: 'stale', message: 'The Evidence Index is stale.' })
  }
  if (!input.conceptAnalysis) {
    issues.push({ code: 'grounded-analysis-missing', severity: 'missing', message: 'Grounded concepts and terminology have not been built.' })
  } else if (!input.conceptAnalysisFresh) {
    issues.push({ code: 'grounded-analysis-stale', severity: 'stale', message: 'Grounded concepts, terminology, conflicts, and gaps are stale.' })
  }
  if (!input.unsupportedAnalysis) {
    issues.push({ code: 'unsupported-analysis-missing', severity: 'missing', message: 'Unsupported-claim analysis has not been built.' })
  } else if (!input.unsupportedAnalysisFresh) {
    issues.push({ code: 'unsupported-analysis-stale', severity: 'stale', message: 'Unsupported-claim analysis is stale.' })
  }
  if (!input.styleProfile) {
    issues.push({ code: 'style-profile-missing', severity: 'missing', message: 'No canonical style profile is available.' })
  }
  for (const [topicId, metadata] of Object.entries(input.authorTopicMetadata).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (metadata.generatedFreshness === 'stale' || metadata.generatedFreshness === 'needs-grounding') {
      issues.push({
        code: 'author-grounding-stale',
        severity: 'stale',
        message: `Author provenance is ${metadata.generatedFreshness.replace('-', ' ')}.`,
        topicId,
      })
    }
  }
  return issues
}

function snapshotPayload(snapshot: Omit<ReviewInputSnapshot, 'snapshotId' | 'capturedAt'>): unknown {
  const { capturedAt: _capturedAt, ...provenance } = snapshot.provenance
  return {
    ...snapshot,
    provenance,
  }
}

export function buildReviewInputSnapshot(
  input: BuildReviewInputSnapshotInput,
): ReviewInputSnapshot {
  const topicIdByLegacyId = new Map(input.topics.map(topic => [topic.id, stableTopicId(topic)]))
  const topics = input.topics
    .map((topic, index) => ({
      topicId: stableTopicId(topic),
      title: topic.title,
      level: topic.level,
      parentTopicId: topic.parentTopicId
        ?? (topic.parentId != null ? topicIdByLegacyId.get(topic.parentId) ?? null : null),
      order: topic.order ?? index,
      blocks: topicBlocks(topic, input.topicContent),
    }))
    .sort((left, right) => left.order - right.order || left.topicId.localeCompare(right.topicId))
  const sources = input.sourceFileIds
    .flatMap(fileId => {
      const extraction = input.sourceExtractions[fileId]
      if (!extraction) return []
      return [{
        sourceId: extraction.sourceId,
        fileId,
        fileName: extraction.fileName,
        status: extraction.status,
        extractionRevision: extraction.extractionRevision,
        blockIds: extraction.blocks.map(block => block.id),
        contentFingerprint: fingerprint('review-source', extraction.blocks.map(block => ({
          blockId: block.id,
          type: block.type,
          text: block.text,
          sectionPath: block.sectionPath ?? null,
          page: block.page ?? null,
        }))),
      }]
    })
    .sort((left, right) => left.fileId.localeCompare(right.fileId))
  const evidence = (input.evidenceIndex?.items ?? [])
    .map(item => ({
      evidenceId: item.id,
      sourceId: item.sourceId,
      fileId: item.fileId,
      blockId: item.blockId,
      sourceFileName: item.sourceFileName,
      location: item.location,
      contentFingerprint: fingerprint('review-evidence', {
        text: item.text,
        blockType: item.blockType,
        sectionPath: item.sectionPath ?? null,
        page: item.page ?? null,
      }),
    }))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
  const conceptAnalysis = input.conceptAnalysis
  const groundedAnalysis: ReviewInputAnalysis = {
    builtAt: conceptAnalysis?.builtAt ?? null,
    fresh: input.conceptAnalysisFresh,
    conceptIds: (conceptAnalysis?.concepts ?? []).map(item => item.id).sort(),
    terminologyIds: (conceptAnalysis?.terminology ?? []).map(item => item.id).sort(),
    conflictIds: (conceptAnalysis?.conflicts ?? []).map(item => item.id).sort(),
    gapIds: (conceptAnalysis?.gaps ?? []).map(item => item.id).sort(),
  }
  const unsupportedAnalysis: ReviewInputUnsupportedAnalysis = {
    builtAt: input.unsupportedAnalysis?.builtAt ?? null,
    fresh: input.unsupportedAnalysisFresh,
    contentFingerprint: input.unsupportedAnalysis?.contentFingerprint ?? null,
    findingIds: (input.unsupportedAnalysis?.findings ?? []).map(item => item.id).sort(),
  }
  const stylePayload = input.styleProfile
    ? {
        id: input.styleProfile.id,
        name: input.styleProfile.name,
        scope: input.styleProfile.scope,
        source: input.styleProfile.source ?? null,
        body: input.styleProfile.body ?? null,
        h1: input.styleProfile.h1 ?? null,
        h2: input.styleProfile.h2 ?? null,
        h3: input.styleProfile.h3 ?? null,
        h4: input.styleProfile.h4 ?? null,
        caption: input.styleProfile.caption ?? null,
        code: input.styleProfile.code ?? null,
        links: input.styleProfile.links ?? null,
        lists: input.styleProfile.lists ?? null,
        tables: input.styleProfile.tables ?? null,
        callouts: input.styleProfile.callouts ?? null,
        writingRules: input.styleProfile.writingRules ?? null,
        formattingRules: input.styleProfile.formattingRules ?? null,
      }
    : null
  const style = stylePayload
    ? {
        styleProfileId: stylePayload.id,
        name: stylePayload.name,
        scope: stylePayload.scope,
        source: stylePayload.source,
        fingerprint: fingerprint('review-style', stylePayload),
      }
    : null
  const standards = styleStandards(input.contentType, input.language, input.styleProfile)
  const terminology = (conceptAnalysis?.terminology ?? [])
    .map(term => ({
      termId: term.id,
      preferredTerm: term.normalizedLabel,
      exactTerms: [...term.exactTerms].sort(),
      evidenceIds: [...term.evidenceIds].sort(),
    }))
    .sort((left, right) => left.termId.localeCompare(right.termId))
  const authorTopics = Object.entries(input.authorTopicMetadata)
    .map(([topicId, metadata]) => ({
      topicId,
      contentOrigin: metadata.contentOrigin,
      generationStatus: metadata.generationStatus,
      generatedFreshness: metadata.generatedFreshness,
      generatedFreshnessReason: metadata.generatedFreshnessReason,
      evidenceIds: [...metadata.evidenceIds].sort(),
      sourceFileIds: [...metadata.sourceFileIds].sort(),
      groundingContextId: metadata.provenance.groundingContextId,
      blockStates: Object.fromEntries(Object.entries(metadata.blockStates).sort(([left], [right]) =>
        left.localeCompare(right))),
      provenanceFingerprint: fingerprint('review-author-provenance', metadata.provenance),
    }))
    .sort((left, right) => left.topicId.localeCompare(right.topicId))
  const issues = buildIssues(input)
  const contentFingerprint = fingerprint('review-content', topics.map(topic => ({
    topicId: topic.topicId,
    title: topic.title,
    level: topic.level,
    parentTopicId: topic.parentTopicId,
    order: topic.order,
    blocks: topic.blocks.map(block => ({
      blockId: block.blockId,
      type: block.type,
      fingerprint: block.fingerprint,
    })),
  })))
  const standardsFingerprint = fingerprint('review-standards', {
    standards,
    terminology,
  })
  const capturedAt = input.capturedAt ?? Date.now()
  const provenance: ReviewInputProvenance = {
    projectId: input.projectId,
    contentRevision: input.contentRevision,
    contentFingerprint,
    sourcesRevision: input.sourcesRevision,
    sourceFileIds: [...input.sourceFileIds].sort(),
    evidenceExtractionRevision: input.evidenceIndex?.extractionRevision ?? null,
    evidenceIndexBuiltAt: input.evidenceIndex?.builtAt ?? null,
    analysisRevision: input.analysisRevision >= 0 ? input.analysisRevision : null,
    analysisBuiltAt: conceptAnalysis?.builtAt ?? null,
    tocRevision: input.tocRevision,
    contentType: input.contentType,
    styleProfileId: style?.styleProfileId ?? null,
    styleFingerprint: style?.fingerprint ?? null,
    standardsFingerprint,
    capturedAt,
  }
  const withoutIdentity: Omit<ReviewInputSnapshot, 'snapshotId' | 'capturedAt'> = {
    version: REVIEW_INPUT_SNAPSHOT_VERSION,
    projectId: input.projectId,
    contentType: input.contentType,
    language: input.language,
    topics,
    sources,
    evidence,
    groundedAnalysis,
    unsupportedAnalysis,
    style,
    standards,
    terminology,
    authorTopics,
    issues,
    readiness: issues.some(issue => issue.severity === 'missing')
      ? 'missing-inputs'
      : issues.some(issue => issue.severity === 'stale')
        ? 'stale-inputs'
        : 'ready',
    provenance,
  }
  return {
    ...withoutIdentity,
    snapshotId: fingerprint('review-input', snapshotPayload(withoutIdentity)),
    capturedAt,
  }
}

function remapFileId(value: string, fileIdMap: Record<string, string>): string {
  return fileIdMap[value] ?? value
}

export function remapReviewInputSnapshot(
  snapshot: ReviewInputSnapshot,
  copiedProjectId: string,
  fileIdMap: Record<string, string>,
): ReviewInputSnapshot {
  const capturedAt = snapshot.capturedAt
  const withoutIdentity: Omit<ReviewInputSnapshot, 'snapshotId' | 'capturedAt'> = {
    ...snapshot,
    projectId: copiedProjectId,
    sources: snapshot.sources.map(source => ({
      ...source,
      sourceId: remapFileId(source.sourceId, fileIdMap),
      fileId: remapFileId(source.fileId, fileIdMap),
      blockIds: [...source.blockIds],
    })),
    evidence: snapshot.evidence.map(item => ({
      ...item,
      sourceId: remapFileId(item.sourceId, fileIdMap),
      fileId: remapFileId(item.fileId, fileIdMap),
    })),
    authorTopics: snapshot.authorTopics.map(topic => ({
      ...topic,
      evidenceIds: [...topic.evidenceIds],
      sourceFileIds: topic.sourceFileIds.map(fileId => remapFileId(fileId, fileIdMap)),
      blockStates: { ...topic.blockStates },
    })),
    provenance: {
      ...snapshot.provenance,
      projectId: copiedProjectId,
      sourceFileIds: snapshot.provenance.sourceFileIds.map(fileId =>
        remapFileId(fileId, fileIdMap)),
    },
  }
  return {
    ...withoutIdentity,
    snapshotId: fingerprint('review-input', snapshotPayload(withoutIdentity)),
    capturedAt,
  }
}

export function hydrateReviewInputSnapshot(
  value: unknown,
  projectId: string,
): ReviewInputSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Partial<ReviewInputSnapshot>
  if (
    snapshot.version !== REVIEW_INPUT_SNAPSHOT_VERSION
    || typeof snapshot.snapshotId !== 'string'
    || !Array.isArray(snapshot.topics)
    || !Array.isArray(snapshot.sources)
    || !Array.isArray(snapshot.evidence)
    || !Array.isArray(snapshot.standards)
    || !Array.isArray(snapshot.terminology)
    || !Array.isArray(snapshot.authorTopics)
    || !Array.isArray(snapshot.issues)
    || !snapshot.provenance
  ) {
    return null
  }
  return {
    ...snapshot as ReviewInputSnapshot,
    projectId,
    provenance: {
      ...snapshot.provenance,
      projectId,
      sourceFileIds: [...(snapshot.provenance.sourceFileIds ?? [])],
    },
  }
}