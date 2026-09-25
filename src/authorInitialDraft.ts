import type { EvidenceIndex } from './evidenceIndex'
import type { TopicGroundingContext } from './authorGroundingContext'
import {
  authorContentFingerprint,
  buildDeterministicAuthorDraft,
  type AuthorComparableBlock,
  type AuthorDraftBlock,
} from './authorDraftGeneration'
import {
  createManualAuthorTopicMetadata,
  stableAuthorTopicId,
  type AuthorMetadataContext,
  type AuthorMetadataTopic,
  type AuthorTopicMetadataMap,
} from './authorMetadata'

type InitialDraftTopic = AuthorMetadataTopic & {
  proposalKind?: 'evidence-backed' | 'optional-structural' | 'manual'
  supportingEvidenceIds?: string[]
  hasGap?: boolean
}

export function initializeAcceptedTopicDrafts<
  TTopic extends InitialDraftTopic,
  TBlock extends AuthorComparableBlock,
>(input: {
  topics: TTopic[]
  previousTopicIds: ReadonlySet<string>
  topicContent: Record<string, TBlock[]>
  authorMetadata: AuthorTopicMetadataMap
  metadataContext: AuthorMetadataContext
  evidenceIndex: EvidenceIndex | null
  canGenerate: boolean
  contextFor: (topic: TTopic) => TopicGroundingContext
  toBlock: (draftBlock: AuthorDraftBlock, id: string) => TBlock
}): {
  topicContent: Record<string, TBlock[]>
  authorMetadata: AuthorTopicMetadataMap
  generatedCount: number
} {
  let topicContent = input.topicContent
  let authorMetadata = input.authorMetadata
  let generatedCount = 0
  const evidenceById = new Map(input.evidenceIndex?.items.map(item => [item.id, item]) ?? [])

  for (const topic of input.topics) {
    const topicId = stableAuthorTopicId(topic)
    if (input.previousTopicIds.has(topicId)
      || (topicContent[topicId]?.length ?? 0) > 0
      || (topicContent[String(topic.id)]?.length ?? 0) > 0
      || authorMetadata[topicId]) continue

    const context = input.contextFor(topic)
    const base = {
      ...createManualAuthorTopicMetadata(topicId, input.metadataContext, false),
      groundingContext: context,
      sourceFileIds: [...new Set([
        ...context.requiredEvidence,
        ...context.optionalSupportingEvidence,
      ].map(item => item.fileId))],
      manualEdited: false,
    }
    // A source heading alone, missing committed evidence, or a gap is not
    // enough to write a factual first draft. Keep only inspectable grounding.
    const requiredIds = [...new Set(topic.supportingEvidenceIds ?? [])]
    const hasSubstantiveEvidence = context.requiredEvidence.some(item =>
      evidenceById.get(item.evidenceId)?.blockType !== 'heading'
      && !!evidenceById.get(item.evidenceId)?.text.trim())
    if (!input.canGenerate
      || topic.proposalKind !== 'evidence-backed'
      || topic.hasGap
      || context.evidenceStatus !== 'available'
      || requiredIds.length === 0
      || requiredIds.length !== context.requiredEvidence.length
      || !hasSubstantiveEvidence) {
      authorMetadata = { ...authorMetadata, [topicId]: base }
      continue
    }

    const draft = buildDeterministicAuthorDraft(context)
    const usedEvidence = [
      ...context.requiredEvidence,
      ...context.optionalSupportingEvidence,
    ].filter(item => draft.evidenceIdsUsed.includes(item.evidenceId))
    const blocks = draft.blocks.map(block =>
      input.toBlock(block, `${draft.draftId}-${block.id}`))
    const baselineBlocks = draft.blocks.map((block, index) => ({
      sourceBlockId: block.id,
      appliedBlockId: blocks[index].id,
      block: structuredClone(block),
    }))
    topicContent = { ...topicContent, [topicId]: blocks }
    authorMetadata = {
      ...authorMetadata,
      [topicId]: {
        ...base,
        generationStatus: 'generated',
        contentOrigin: 'generated',
        evidenceIds: [...draft.evidenceIdsUsed],
        sourcePaths: usedEvidence.map(item => [...item.sectionPath]),
        sourceFileIds: [...new Set(usedEvidence.map(item => item.fileId))],
        draft,
        appliedBaseline: {
          draftId: draft.draftId,
          groundingContextId: context.contextId,
          contentFingerprint: authorContentFingerprint(blocks),
          blocks: baselineBlocks,
        },
        blockStates: Object.fromEntries(blocks.map(block => [block.id, 'generated' as const])),
        provenance: {
          sourcesRevision: context.provenance.sourcesRevision,
          evidenceExtractionRevision: context.provenance.evidenceExtractionRevision,
          evidenceIndexBuiltAt: context.provenance.evidenceIndexBuiltAt,
          analysisBuiltAt: context.provenance.analysisBuiltAt,
          analysisRevision: context.provenance.analysisRevision,
          tocRevision: context.provenance.tocRevision,
          contentType: draft.contentType,
          variableSnapshot: { ...draft.variableSnapshot },
          variableFingerprint: context.provenance.variableFingerprint,
          groundingContextId: context.contextId,
          language: draft.language,
          styleProfileId: draft.styleProvenance.styleProfileId,
          styleFingerprint: draft.styleProvenance.styleFingerprint,
        },
        generatedAt: draft.generatedAt,
        generatedFreshness: 'current',
        generatedFreshnessReason: null,
      },
    }
    generatedCount += 1
  }

  return { topicContent, authorMetadata, generatedCount }
}