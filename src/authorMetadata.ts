import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex } from './evidenceIndex'
import {
  remapTopicGroundingContext,
  type TopicGroundingContext,
} from './authorGroundingContext'
import type {
  AuthorAppliedBaseline,
  AuthorBlockState,
  AuthorRegenerationProposal,
  AuthorTopicDraft,
} from './authorDraftGeneration'

export type AuthorGenerationStatus = 'not-generated' | 'draft' | 'generated' | 'failed'
export type AuthorContentOrigin = 'manual' | 'generated' | 'mixed' | 'approved'
export type AuthorGeneratedFreshness = 'not-applicable' | 'current' | 'stale' | 'needs-grounding'
export type AuthorGeneratedStalenessReason =
  | 'grounding-missing'
  | 'sources-changed'
  | 'extraction-changed'
  | 'evidence-index-changed'
  | 'analysis-changed'
  | 'toc-changed'
  | 'content-type-changed'
  | 'variables-changed'
  | 'language-changed'
  | 'style-guidance-changed'
  | 'grounding-changed'

export type AuthorTopicMetadata = {
  topicId: string
  generationStatus: AuthorGenerationStatus
  contentOrigin: AuthorContentOrigin
  evidenceIds: string[]
  sourcePaths: string[][]
  sourceFileIds: string[]
  groundingContext: TopicGroundingContext | null
  draft: AuthorTopicDraft | null
  appliedBaseline: AuthorAppliedBaseline | null
  regenerationProposal: AuthorRegenerationProposal | null
  blockStates: Record<string, AuthorBlockState>
  provenance: {
    sourcesRevision: number | null
    evidenceExtractionRevision: string | null
    evidenceIndexBuiltAt: number | null
    analysisBuiltAt: number | null
    analysisRevision: number | null
    tocRevision: number | null
    contentType: string
    variableSnapshot: Record<string, string>
    variableFingerprint: string | null
    groundingContextId: string | null
    language: string
    styleProfileId: string | null
    styleFingerprint: string | null
  }
  generatedAt: number | null
  generatedFreshness: AuthorGeneratedFreshness
  generatedFreshnessReason: AuthorGeneratedStalenessReason | null
  manualEdited: boolean
  approved: boolean
  legacyHydrated: boolean
}

export type AuthorTopicMetadataMap = Record<string, AuthorTopicMetadata>

export type AuthorMetadataTopic = {
  id: number
  topicId?: string
}

export type AuthorMetadataContext = {
  contentType: string
  variables: Array<{ name: string; value: string }>
}

function variableSnapshot(
  variables: Array<{ name: string; value: string }>,
): Record<string, string> {
  return Object.fromEntries(
    variables
      .filter(variable => variable.name.trim().length > 0)
      .map(variable => [variable.name, variable.value]),
  )
}

export function stableAuthorTopicId(topic: AuthorMetadataTopic): string {
  return topic.topicId?.trim() || `legacy-${topic.id}`
}

export function createManualAuthorTopicMetadata(
  topicId: string,
  context: AuthorMetadataContext,
  legacyHydrated: boolean,
): AuthorTopicMetadata {
  return {
    topicId,
    generationStatus: 'not-generated',
    contentOrigin: 'manual',
    evidenceIds: [],
    sourcePaths: [],
    sourceFileIds: [],
    groundingContext: null,
    draft: null,
    appliedBaseline: null,
    regenerationProposal: null,
    blockStates: {},
    provenance: {
      sourcesRevision: null,
      evidenceExtractionRevision: null,
      evidenceIndexBuiltAt: null,
      analysisBuiltAt: null,
      analysisRevision: null,
      tocRevision: null,
      contentType: context.contentType,
      variableSnapshot: variableSnapshot(context.variables),
      variableFingerprint: null,
      groundingContextId: null,
      language: '',
      styleProfileId: null,
      styleFingerprint: null,
    },
    generatedAt: null,
    generatedFreshness: 'not-applicable',
    generatedFreshnessReason: null,
    manualEdited: true,
    approved: false,
    legacyHydrated,
  }
}

export function hydrateAuthorTopicMetadata(
  persisted: AuthorTopicMetadataMap | null | undefined,
  topicContent: Record<string, unknown[]>,
  toc: AuthorMetadataTopic[],
  context: AuthorMetadataContext,
): AuthorTopicMetadataMap {
  const hydrated: AuthorTopicMetadataMap = Object.fromEntries(
    Object.entries(persisted ?? {}).map(([topicId, metadata]) => {
      const provenance = metadata.provenance
      return [
        topicId,
        {
          ...metadata,
          topicId,
          generationStatus: metadata.generationStatus ?? 'not-generated',
          contentOrigin: metadata.contentOrigin ?? 'manual',
          evidenceIds: [...(metadata.evidenceIds ?? [])],
          sourcePaths: (metadata.sourcePaths ?? []).map(path => [...path]),
          sourceFileIds: [...(metadata.sourceFileIds ?? [])],
          groundingContext: metadata.groundingContext
            ? structuredClone(metadata.groundingContext)
            : null,
          draft: metadata.draft ? structuredClone(metadata.draft) : null,
          appliedBaseline: metadata.appliedBaseline
            ? structuredClone(metadata.appliedBaseline)
            : null,
          regenerationProposal: metadata.regenerationProposal
            ? structuredClone(metadata.regenerationProposal)
            : null,
          blockStates: { ...(metadata.blockStates ?? {}) },
          provenance: {
            sourcesRevision: provenance?.sourcesRevision ?? null,
            evidenceExtractionRevision: provenance?.evidenceExtractionRevision ?? null,
            evidenceIndexBuiltAt: provenance?.evidenceIndexBuiltAt ?? null,
            analysisBuiltAt: provenance?.analysisBuiltAt ?? null,
            analysisRevision: provenance?.analysisRevision ?? null,
            tocRevision: provenance?.tocRevision ?? null,
            contentType: provenance?.contentType ?? context.contentType,
            variableSnapshot: { ...(provenance?.variableSnapshot ?? {}) },
            variableFingerprint: provenance?.variableFingerprint ?? null,
            groundingContextId: provenance?.groundingContextId
              ?? metadata.draft?.groundingContextId
              ?? metadata.groundingContext?.contextId
              ?? null,
            language: provenance?.language ?? metadata.draft?.language ?? '',
            styleProfileId: provenance?.styleProfileId ?? metadata.draft?.styleProvenance.styleProfileId ?? null,
            styleFingerprint: provenance?.styleFingerprint ?? metadata.draft?.styleProvenance.styleFingerprint ?? null,
          },
          generatedAt: metadata.generatedAt ?? null,
          generatedFreshness: metadata.generatedFreshness ?? 'not-applicable',
          generatedFreshnessReason: metadata.generatedFreshnessReason ?? null,
          manualEdited: metadata.manualEdited ?? metadata.contentOrigin !== 'generated',
          approved: metadata.approved ?? metadata.contentOrigin === 'approved',
          legacyHydrated: metadata.legacyHydrated ?? false,
        },
      ]
    }),
  )

  for (const [contentKey, blocks] of Object.entries(topicContent)) {
    if (!blocks.length) continue
    const topic = toc.find(candidate =>
      stableAuthorTopicId(candidate) === contentKey || String(candidate.id) === contentKey)
    const topicId = topic ? stableAuthorTopicId(topic) : contentKey
    if (!hydrated[topicId]) {
      hydrated[topicId] = createManualAuthorTopicMetadata(topicId, context, true)
    }
  }

  return hydrated
}

export function pruneAuthorTopicMetadata(
  metadata: AuthorTopicMetadataMap,
  toc: AuthorMetadataTopic[],
): AuthorTopicMetadataMap {
  const retainedTopicIds = new Set(toc.map(stableAuthorTopicId))
  return Object.fromEntries(
    Object.entries(metadata).filter(([topicId]) => retainedTopicIds.has(topicId)),
  )
}

export function remapAuthorTopicMetadata(
  metadata: AuthorTopicMetadataMap | null | undefined,
  fileIdMap: Record<string, string>,
  sourceEvidenceIndex: EvidenceIndex | null,
  copiedEvidenceIndex: EvidenceIndex | null,
  sourceConceptAnalysis: ConceptAnalysis | null,
  copiedConceptAnalysis: ConceptAnalysis | null,
): AuthorTopicMetadataMap {
  const copiedEvidenceIds = new Set(copiedEvidenceIndex?.items.map(item => item.id) ?? [])

  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([topicId, item]) => {
      const evidenceProvenanceMatchesSource = !!sourceEvidenceIndex
        && !!sourceConceptAnalysis
        && item.provenance.sourcesRevision === sourceEvidenceIndex.sourcesRevision
        && item.provenance.evidenceExtractionRevision === sourceEvidenceIndex.extractionRevision
        && item.provenance.analysisBuiltAt === sourceConceptAnalysis.builtAt

      const groundingContext = remapTopicGroundingContext(
        item.groundingContext,
        fileIdMap,
        copiedEvidenceIndex,
        copiedConceptAnalysis,
      )
      const draft = item.draft
        ? {
            ...structuredClone(item.draft),
            groundingContextId: groundingContext?.contextId ?? item.draft.groundingContextId,
            groundingRevision: groundingContext?.contextId ?? item.draft.groundingRevision,
            evidenceIdsUsed: item.draft.evidenceIdsUsed.filter(id => copiedEvidenceIds.has(id)),
            requiredEvidenceIdsUsed: item.draft.requiredEvidenceIdsUsed.filter(id => copiedEvidenceIds.has(id)),
            optionalEvidenceIdsUsed: item.draft.optionalEvidenceIdsUsed.filter(id => copiedEvidenceIds.has(id)),
          }
        : null
      const appliedBaseline = item.appliedBaseline
        ? {
            ...structuredClone(item.appliedBaseline),
            groundingContextId: groundingContext?.contextId ?? item.appliedBaseline.groundingContextId,
            blocks: item.appliedBaseline.blocks.map(entry => ({
              ...entry,
              block: {
                ...entry.block,
                evidenceIds: entry.block.evidenceIds.filter(id => copiedEvidenceIds.has(id)),
              },
            })),
          }
        : null
      const regenerationProposal = item.regenerationProposal
        ? {
            ...structuredClone(item.regenerationProposal),
            groundingContextId: groundingContext?.contextId ?? item.regenerationProposal.groundingContextId,
          }
        : null
      return [
        topicId,
        {
          ...item,
          topicId,
          evidenceIds: (item.evidenceIds ?? []).filter(evidenceId => copiedEvidenceIds.has(evidenceId)),
          sourcePaths: (item.sourcePaths ?? []).map(path => [...path]),
          sourceFileIds: (item.sourceFileIds ?? []).flatMap(fileId =>
            fileIdMap[fileId] ? [fileIdMap[fileId]] : []),
          groundingContext,
          draft,
          appliedBaseline,
          regenerationProposal,
          blockStates: { ...(item.blockStates ?? {}) },
          provenance: {
            ...item.provenance,
            ...(evidenceProvenanceMatchesSource && copiedEvidenceIndex && copiedConceptAnalysis
              ? {
                  sourcesRevision: copiedEvidenceIndex.sourcesRevision,
                  evidenceExtractionRevision: copiedEvidenceIndex.extractionRevision,
                  evidenceIndexBuiltAt: copiedEvidenceIndex.builtAt,
                  analysisBuiltAt: copiedConceptAnalysis.builtAt,
                }
              : {}),
            variableSnapshot: { ...(item.provenance?.variableSnapshot ?? {}) },
            groundingContextId: groundingContext?.contextId ?? item.provenance.groundingContextId,
          },
        },
      ]
    }),
  )
}

export type AuthorGeneratedFreshnessEvaluation = {
  status: AuthorGeneratedFreshness
  reason: AuthorGeneratedStalenessReason | null
}

export function evaluateAuthorGeneratedFreshness(
  metadata: AuthorTopicMetadata | null | undefined,
  expectedContext: TopicGroundingContext | null,
): AuthorGeneratedFreshnessEvaluation {
  const hasGeneratedContent = !!metadata && (
    metadata.generationStatus === 'generated'
    || metadata.contentOrigin === 'generated'
    || metadata.contentOrigin === 'mixed'
    || metadata.contentOrigin === 'approved'
    || !!metadata.appliedBaseline
  )
  if (!hasGeneratedContent) return { status: 'not-applicable', reason: null }
  if (!metadata?.provenance.groundingContextId || !expectedContext) {
    return { status: 'needs-grounding', reason: 'grounding-missing' }
  }
  const stored = metadata.provenance
  const expected = expectedContext.provenance
  if (stored.sourcesRevision !== expected.sourcesRevision) return { status: 'stale', reason: 'sources-changed' }
  if (stored.evidenceExtractionRevision !== expected.evidenceExtractionRevision) return { status: 'stale', reason: 'extraction-changed' }
  if (stored.evidenceIndexBuiltAt !== expected.evidenceIndexBuiltAt) return { status: 'stale', reason: 'evidence-index-changed' }
  if (stored.analysisBuiltAt !== expected.analysisBuiltAt || stored.analysisRevision !== expected.analysisRevision) {
    return { status: 'stale', reason: 'analysis-changed' }
  }
  if (stored.tocRevision !== expected.tocRevision) return { status: 'stale', reason: 'toc-changed' }
  if (stored.contentType !== expected.contentType) return { status: 'stale', reason: 'content-type-changed' }
  if (stored.variableFingerprint !== expected.variableFingerprint) return { status: 'stale', reason: 'variables-changed' }
  if (stored.language !== expectedContext.writingGuidance.language) return { status: 'stale', reason: 'language-changed' }
  if (stored.styleFingerprint !== expected.styleFingerprint
    || stored.styleProfileId !== expectedContext.writingGuidance.styleProfileId) {
    return { status: 'stale', reason: 'style-guidance-changed' }
  }
  if (stored.groundingContextId !== expectedContext.contextId) return { status: 'stale', reason: 'grounding-changed' }
  return { status: 'current', reason: null }
}