import { stableAuthorTopicId } from './authorMetadata'
import { reviewBlockFingerprint, type ReviewInputDocBlock, type ReviewInputSnapshot } from './reviewInput'
import { deterministicSpellingCorrection } from './reviewLanguageChecks'
import { checkReviewActionEligibility } from './reviewActionEligibility'
import type { ReviewFindingStatus, ReviewModel } from './reviewModel'

type Topic = { id: number; topicId?: string }
type Block = ReviewInputDocBlock

export type SpellingApplyResult<T extends Block> =
  | { ok: false; reason: string }
  | { ok: true; topicContent: Record<string, T[]>; model: ReviewModel; topicId: string; blockId: string }

const RERUN = 'This correction is no longer current. Rerun Review before applying it.'

export function prepareSpellingApply<T extends Block>(
  model: ReviewModel,
  findingId: string,
  snapshot: ReviewInputSnapshot | null,
  topics: Topic[],
  topicContent: Record<string, T[]>,
  at = Date.now(),
): SpellingApplyResult<T> {
  const finding = model.findings.find(item => item.findingId === findingId)
  const suggestion = finding?.suggestion
  if (!finding || finding.category !== 'Spelling' || !suggestion
    || suggestion.kind !== 'replace' || suggestion.method !== 'deterministic-spelling-v1'
    || suggestion.confidence !== 'high' || !suggestion.range
    || typeof suggestion.originalText !== 'string' || typeof suggestion.proposedText !== 'string'
    || !suggestion.expectedBlockFingerprint) {
    return { ok: false, reason: 'Only verified deterministic spelling corrections can be applied.' }
  }
  const run = model.runs.find(item => item.reviewRunId === finding.reviewRunId)
  const eligibility = checkReviewActionEligibility(model, findingId, snapshot, topics, topicContent, 'exact')
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason }
  if (!snapshot || !run || !['open', 'in-review'].includes(finding.status)) return { ok: false, reason: RERUN }
  const topic = topics.find(item => stableAuthorTopicId(item) === finding.topicId)
  if (!topic || !finding.topicId || !finding.blockId || suggestion.blockId !== finding.blockId) {
    return { ok: false, reason: `The exact authored target is missing. ${RERUN}` }
  }
  const key = Object.prototype.hasOwnProperty.call(topicContent, finding.topicId) ? finding.topicId : String(topic.id)
  const blocks = topicContent[key]
  const block = blocks?.find(item => item.id === finding.blockId)
  const snapshotBlock = snapshot.topics.find(item => item.topicId === finding.topicId)
    ?.blocks.find(item => item.blockId === finding.blockId)
  if (!block || !snapshotBlock) {
    return { ok: false, reason: `The exact authored block is missing. ${RERUN}` }
  }
  const { start, end } = suggestion.range
  const word = suggestion.originalText.slice(start, end)
  const correction = deterministicSpellingCorrection(word)
  if (block.type !== 'para' && block.type !== 'paragraph' && block.type !== 'text') {
    return { ok: false, reason: RERUN }
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > suggestion.originalText.length
    || start >= end || !correction || finding.originalText !== word
    || suggestion.proposedText !== suggestion.originalText.slice(0, start) + correction + suggestion.originalText.slice(end)
    || snapshotBlock.content !== suggestion.originalText
    || snapshotBlock.fingerprint !== suggestion.expectedBlockFingerprint
    || block.content !== suggestion.originalText
    || reviewBlockFingerprint(block) !== suggestion.expectedBlockFingerprint) {
    return { ok: false, reason: `The target text or fingerprint has changed. ${RERUN}` }
  }
  const nextBlocks = blocks.map(item => item.id === block.id
    ? { ...item, content: suggestion.proposedText! }
    : item)
  const updated = {
    ...finding,
    status: 'resolved' as const,
    updatedAt: at,
    resolutionHistory: [
      ...finding.resolutionHistory,
      {
        eventId: `review-history-${findingId}-${at}-${finding.resolutionHistory.length}`,
        status: 'resolved' as const,
        action: 'applied' as const,
        reason: 'Applied deterministic spelling correction',
        actor: 'user' as const,
        at,
      },
    ],
  }
  return {
    ok: true,
    topicId: finding.topicId,
    blockId: finding.blockId,
    topicContent: { ...topicContent, [key]: nextBlocks },
    model: {
      ...model,
      findings: model.findings.map(item => item.findingId === findingId ? updated : item),
      updatedAt: at,
    },
  }
}

export function recordReviewFindingStatus(
  model: ReviewModel,
  findingId: string,
  status: ReviewFindingStatus,
  at = Date.now(),
): ReviewModel {
  let changed = false
  const findings = model.findings.map(finding => {
    if (finding.findingId !== findingId || finding.status === status || finding.status === 'retired'
      || (status === 'rejected' && (finding.category !== 'Spelling' || !finding.suggestion
        || !['open', 'in-review'].includes(finding.status)))) return finding
    changed = true
    const reason = status === 'dismissed' ? 'Dismissed in Review'
      : status === 'rejected' ? 'Rejected spelling suggestion in Review' : undefined
    return {
      ...finding,
      status,
      dismissalReason: status === 'dismissed' ? reason! : null,
      updatedAt: at,
      resolutionHistory: [
        ...finding.resolutionHistory,
        {
          eventId: `review-history-${findingId}-${at}-${finding.resolutionHistory.length}`,
          status,
          action: status === 'rejected' ? 'rejected' as const : undefined,
          reason,
          actor: 'user' as const,
          at,
        },
      ],
    }
  })
  return changed ? { ...model, findings, updatedAt: at } : model
}