import { stableAuthorTopicId } from './authorMetadata'
import { reviewBlockFingerprint, type ReviewInputDocBlock, type ReviewInputSnapshot } from './reviewInput'
import type { ReviewModel } from './reviewModel'

type Topic = { id: number; topicId?: string }
export type ReviewActionTarget = 'none' | 'exists' | 'exact'
export type ReviewActionEligibility =
  | { ok: true }
  | { ok: false; reason: string; code: 'stale' | 'missing-topic' | 'missing-block' | 'changed-block' }

const RERUN = 'This finding is stale or belongs to an earlier Review run. Rerun Review before acting on it.'

export function checkReviewActionEligibility(
  model: ReviewModel,
  findingId: string,
  snapshot: ReviewInputSnapshot | null,
  topics: Topic[],
  topicContent: Record<string, ReviewInputDocBlock[]>,
  target: ReviewActionTarget = 'exists',
): ReviewActionEligibility {
  const finding = model.findings.find(item => item.findingId === findingId)
  const run = model.runs.find(item => item.reviewRunId === finding?.reviewRunId)
  if (!finding || !snapshot || snapshot.readiness !== 'ready'
    || model.projectId !== snapshot.projectId
    || model.inputSnapshot?.snapshotId !== snapshot.snapshotId
    || finding.projectId !== snapshot.projectId
    || finding.inputSnapshotId !== snapshot.snapshotId
    || finding.freshness.status !== 'current'
    || finding.status === 'retired'
    || model.activeReviewRunId !== finding.reviewRunId
    || !run || run.status !== 'complete'
    || run.projectId !== snapshot.projectId
    || run.inputSnapshotId !== snapshot.snapshotId
    || !run.findingIds.includes(findingId)) {
    return { ok: false, code: 'stale', reason: RERUN }
  }
  if (target === 'none' || (!finding.topicId && !finding.blockId)) return { ok: true }
  const topic = topics.find(item => stableAuthorTopicId(item) === finding.topicId)
  if (!topic) return { ok: false, code: 'missing-topic', reason: `The authored topic is missing. ${RERUN}` }
  if (!finding.blockId) return { ok: true }
  const blocks = topicContent[finding.topicId!] ?? topicContent[String(topic.id)]
  const block = blocks?.find(item => item.id === finding.blockId)
  if (!block) return { ok: false, code: 'missing-block', reason: `The exact authored block is missing. ${RERUN}` }
  if (target === 'exact') {
    const snapshotBlock = snapshot.topics.find(item => item.topicId === finding.topicId)
      ?.blocks.find(item => item.blockId === finding.blockId)
    if (!snapshotBlock || snapshotBlock.content !== block.content
      || snapshotBlock.fingerprint !== reviewBlockFingerprint(block)) {
      return { ok: false, code: 'changed-block', reason: `The exact authored block text or fingerprint has changed. ${RERUN}` }
    }
  }
  return { ok: true }
}