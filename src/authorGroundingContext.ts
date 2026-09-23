import { isConceptAnalysisFresh, type ConceptAnalysis } from './conceptAnalysis'
import { isEvidenceIndexFresh, type EvidenceIndex, type EvidenceItem } from './evidenceIndex'
import type { SourceExtraction } from './sourceExtractor'

export type TopicGroundingEvidence = {
  evidenceId: string
  fileId: string
  sourceId: string
  sourceFileName: string
  location: string
  sectionPath: string[]
  text: string
}

export type TopicGroundingFinding = {
  id: string
  title: string
  rationale: string
  evidenceIds: string[]
}

export type TopicGroundingTerm = {
  id: string
  label: string
  exactTerms: string[]
  evidenceIds: string[]
}

export type TopicGroundingContext = {
  version: 1
  contextId: string
  topic: {
    topicId: string
    title: string
    level: number
    rationale: string
    proposalKind: 'evidence-backed' | 'optional-structural' | 'manual'
    sourcePaths: string[][]
  }
  evidenceStatus: 'available' | 'no-supporting-evidence' | 'unavailable'
  requiredEvidence: TopicGroundingEvidence[]
  optionalSupportingEvidence: TopicGroundingEvidence[]
  concepts: TopicGroundingTerm[]
  terminology: TopicGroundingTerm[]
  conflicts: TopicGroundingFinding[]
  gaps: TopicGroundingFinding[]
  unavailableInformation: string[]
  sourceExtractions: Array<{
    fileId: string
    fileName: string
    status: SourceExtraction['status']
    sourceRevision: number
    extractionRevision: number
  }>
  writingGuidance: {
    contentType: string
    language: string
    variables: Record<string, string>
    styleProfileId: string
    styleProfileName: string
    styleProfileScope: string
    brandNames: string[]
    instructions: string[]
  }
  provenance: {
    sourcesRevision: number
    evidenceExtractionRevision: string
    analysisBuiltAt: number | null
    analysisRevision: number
    tocRevision: number
    contentType: string
    variableFingerprint: string
    styleFingerprint: string
  }
}

export type GroundingTopicInput = {
  topicId: string
  title: string
  level: number
  rationale?: string
  supportingEvidenceIds?: string[]
  sourceSectionPaths?: string[][]
  proposalKind?: 'evidence-backed' | 'optional-structural' | 'manual'
  hasGap?: boolean
}

export type TopicGroundingBuildInput = {
  topic: GroundingTopicInput
  evidenceIndex: EvidenceIndex | null
  sourceExtractions: Record<string, SourceExtraction>
  sourcesRevision: number
  conceptAnalysis: ConceptAnalysis | null
  analysisRevision: number
  tocRevision: number
  contentType: string
  variables: Array<{ name: string; value: string }>
  selectedSourceFileIds?: string[]
  writingGuidance: {
    language: string
    styleProfileId: string
    styleProfileName: string
    styleProfileScope: string
    brandNames: string[]
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value: unknown): string {
  return stableHash(stableStringify(value))
}

function normalizedTokens(value: string): Set<string> {
  return new Set(value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3))
}

function relatedToTopic(item: EvidenceItem, topicText: string, sourcePaths: string[][]): boolean {
  if (sourcePaths.some(path =>
    item.sectionPath?.join(' › ').toLocaleLowerCase('en-US') === path.join(' › ').toLocaleLowerCase('en-US'))) {
    return true
  }
  const topicTokens = normalizedTokens(topicText)
  if (topicTokens.size === 0) return false
  const itemTokens = normalizedTokens(`${item.sectionPath?.join(' ') ?? ''} ${item.text}`)
  return [...topicTokens].some(token => itemTokens.has(token))
}

function groundingEvidence(item: EvidenceItem): TopicGroundingEvidence {
  return {
    evidenceId: item.id,
    fileId: item.fileId,
    sourceId: item.sourceId,
    sourceFileName: item.sourceFileName,
    location: item.location,
    sectionPath: [...(item.sectionPath ?? [])],
    text: item.text,
  }
}

function termSummary(
  item: ConceptAnalysis['concepts'][number] | ConceptAnalysis['terminology'][number],
): TopicGroundingTerm {
  return {
    id: item.id,
    label: 'label' in item ? item.label : item.normalizedLabel,
    exactTerms: [...item.exactTerms],
    evidenceIds: [...item.evidenceIds],
  }
}

function contentTypeInstructions(contentType: string): string[] {
  const normalized = contentType.toLocaleLowerCase('en-US')
  if (normalized.includes('api')) return ['Use reference-oriented structure.', 'Keep prerequisites, parameters, responses, and errors distinct.']
  if (normalized.includes('runbook') || normalized.includes('playbook')) return ['Use procedural structure.', 'Separate prerequisites, actions, validation, and rollback.']
  if (normalized.includes('training') || normalized.includes('course')) return ['Use learning-oriented structure.', 'Separate objectives, explanation, practice, and checks.']
  return ['Use clear documentation structure appropriate to the selected content type.', 'Do not infer product facts from style or brand guidance.']
}

export function buildTopicGroundingContext(
  input: TopicGroundingBuildInput,
): TopicGroundingContext {
  const variables = Object.fromEntries(input.variables
    .filter(variable => variable.name.trim())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(variable => [variable.name, variable.value]))
  const styleSnapshot = {
    ...input.writingGuidance,
    brandNames: [...new Set(input.writingGuidance.brandNames.filter(Boolean))].sort(),
  }
  const evidenceFresh = isEvidenceIndexFresh(
    input.evidenceIndex,
    input.sourceExtractions,
    input.sourcesRevision,
  )
  const analysisFresh = evidenceFresh
    && isConceptAnalysisFresh(input.conceptAnalysis, input.evidenceIndex)
  const evidenceItems = evidenceFresh ? input.evidenceIndex?.items ?? [] : []
  const evidenceById = new Map(evidenceItems.map(item => [item.id, item]))
  const requiredIds = [...new Set(input.topic.supportingEvidenceIds ?? [])]
  const requiredEvidence = requiredIds.flatMap(id => {
    const item = evidenceById.get(id)
    return item ? [groundingEvidence(item)] : []
  })
  const unavailableInformation: string[] = []

  if (!evidenceFresh) {
    unavailableInformation.push('Current evidence is unavailable because the Evidence Index is missing or stale.')
  }
  const missingRequiredIds = requiredIds.filter(id => !evidenceById.has(id))
  if (missingRequiredIds.length > 0) {
    unavailableInformation.push(`Required evidence is unavailable: ${missingRequiredIds.join(', ')}.`)
  }
  if (requiredIds.length === 0) {
    unavailableInformation.push('This committed topic has no supporting evidence.')
  }
  if (input.conceptAnalysis && !analysisFresh) {
    unavailableInformation.push('Grounded concepts, terminology, conflicts, and gaps are unavailable because analysis is stale.')
  } else if (!input.conceptAnalysis) {
    unavailableInformation.push('Grounded concepts, terminology, conflicts, and gaps have not been built.')
  }

  const requiredSet = new Set(requiredEvidence.map(item => item.evidenceId))
  const selectedSourceIds = new Set(input.selectedSourceFileIds ?? [])
  const topicText = `${input.topic.title} ${input.topic.rationale ?? ''}`
  const sourcePaths = input.topic.sourceSectionPaths ?? []
  const optionalSupportingEvidence = evidenceItems
    .filter(item =>
      !requiredSet.has(item.id)
      && (selectedSourceIds.has(item.fileId) || selectedSourceIds.has(item.sourceId))
      && relatedToTopic(item, topicText, sourcePaths))
    .slice(0, 24)
    .map(groundingEvidence)
  const relevantEvidenceIds = new Set([
    ...requiredEvidence.map(item => item.evidenceId),
    ...optionalSupportingEvidence.map(item => item.evidenceId),
  ])
  const analysis = analysisFresh ? input.conceptAnalysis : null
  const relevant = (ids: string[], label: string): boolean =>
    ids.some(id => relevantEvidenceIds.has(id))
    || [...normalizedTokens(label)].some(token => normalizedTokens(topicText).has(token))

  const concepts = (analysis?.concepts ?? [])
    .filter(item => relevant(item.evidenceIds, item.label))
    .map(termSummary)
  const terminology = (analysis?.terminology ?? [])
    .filter(item => relevant(item.evidenceIds, item.normalizedLabel))
    .map(termSummary)
  const conflicts = (analysis?.conflicts ?? [])
    .filter(item => relevant(item.evidenceIds, `${item.subject} ${item.summary}`))
    .map(item => ({
      id: item.id,
      title: item.subject,
      rationale: item.rationale,
      evidenceIds: [...item.evidenceIds],
    }))
  const gaps = (analysis?.gaps ?? [])
    .filter(item => input.topic.hasGap || relevant(item.evidenceIds, `${item.title} ${item.rationale}`))
    .map(item => ({
      id: item.id,
      title: item.title,
      rationale: item.rationale,
      evidenceIds: [...item.evidenceIds],
    }))
  if (input.topic.hasGap && gaps.length === 0) {
    unavailableInformation.push('The TOC marks this topic as a gap, but no current grounded gap finding is available.')
  }

  const referencedFileIds = new Set([
    ...requiredEvidence.map(item => item.fileId),
    ...optionalSupportingEvidence.map(item => item.fileId),
  ])
  const sourceExtractions = Object.entries(input.sourceExtractions)
    .filter(([fileId]) => referencedFileIds.has(fileId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileId, extraction]) => ({
      fileId,
      fileName: extraction.fileName,
      status: extraction.status,
      sourceRevision: extraction.sourceRevision,
      extractionRevision: extraction.extractionRevision,
    }))
  const contextWithoutId = {
    version: 1 as const,
    topic: {
      topicId: input.topic.topicId,
      title: input.topic.title,
      level: input.topic.level,
      rationale: input.topic.rationale ?? 'No committed rationale is available.',
      proposalKind: input.topic.proposalKind ?? 'manual',
      sourcePaths: (input.topic.sourceSectionPaths ?? []).map(path => [...path]),
    },
    evidenceStatus: !evidenceFresh
      ? 'unavailable' as const
      : requiredIds.length === 0
        ? 'no-supporting-evidence' as const
        : 'available' as const,
    requiredEvidence,
    optionalSupportingEvidence,
    concepts,
    terminology,
    conflicts,
    gaps,
    unavailableInformation,
    sourceExtractions,
    writingGuidance: {
      contentType: input.contentType,
      language: styleSnapshot.language,
      variables,
      styleProfileId: styleSnapshot.styleProfileId,
      styleProfileName: styleSnapshot.styleProfileName,
      styleProfileScope: styleSnapshot.styleProfileScope,
      brandNames: styleSnapshot.brandNames,
      instructions: [
        ...contentTypeInstructions(input.contentType),
        ...(styleSnapshot.brandNames.length
          ? [`Preserve these approved brand and product names exactly: ${styleSnapshot.brandNames.join(', ')}.`]
          : []),
        `Write in ${styleSnapshot.language || 'the project language'}.`,
      ],
    },
    provenance: {
      sourcesRevision: input.sourcesRevision,
      evidenceExtractionRevision: evidenceFresh
        ? input.evidenceIndex?.extractionRevision ?? ''
        : '',
      analysisBuiltAt: analysis?.builtAt ?? null,
      analysisRevision: input.analysisRevision,
      tocRevision: input.tocRevision,
      contentType: input.contentType,
      variableFingerprint: fingerprint(variables),
      styleFingerprint: fingerprint(styleSnapshot),
    },
  }

  return {
    ...contextWithoutId,
    contextId: `grounding-${fingerprint(contextWithoutId)}`,
  }
}

export function isTopicGroundingContextFresh(
  context: TopicGroundingContext | null | undefined,
  input: TopicGroundingBuildInput,
): boolean {
  if (!context) return false
  return context.contextId === buildTopicGroundingContext(input).contextId
}

export function remapTopicGroundingContext(
  context: TopicGroundingContext | null | undefined,
  fileIdMap: Record<string, string>,
  copiedEvidenceIndex: EvidenceIndex | null,
  copiedConceptAnalysis: ConceptAnalysis | null,
): TopicGroundingContext | null {
  if (!context) return null
  const copiedEvidenceById = new Map((copiedEvidenceIndex?.items ?? []).map(item => [item.id, item]))
  const remapEvidence = (items: TopicGroundingEvidence[]) => items.flatMap(item => {
    const copied = copiedEvidenceById.get(item.evidenceId)
    if (!copied) return []
    return [groundingEvidence(copied)]
  })
  const remapped = {
    ...context,
    requiredEvidence: remapEvidence(context.requiredEvidence),
    optionalSupportingEvidence: remapEvidence(context.optionalSupportingEvidence),
    sourceExtractions: context.sourceExtractions.flatMap(extraction => {
      const copiedFileId = fileIdMap[extraction.fileId]
      return copiedFileId ? [{ ...extraction, fileId: copiedFileId }] : []
    }),
    provenance: {
      ...context.provenance,
      sourcesRevision: copiedEvidenceIndex?.sourcesRevision ?? context.provenance.sourcesRevision,
      evidenceExtractionRevision: copiedEvidenceIndex?.extractionRevision ?? context.provenance.evidenceExtractionRevision,
      analysisBuiltAt: copiedConceptAnalysis?.builtAt ?? context.provenance.analysisBuiltAt,
    },
  }
  const { contextId: _contextId, ...withoutId } = remapped
  return {
    ...remapped,
    contextId: `grounding-${fingerprint(withoutId)}`,
  }
}