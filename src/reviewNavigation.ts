import { stableAuthorTopicId } from './authorMetadata'
import type { ReviewFinding } from './reviewModel'
import type { ReviewInputSnapshot } from './reviewInput'

type AuthorTopic = { id: number; topicId?: string }
type AuthorBlock = { id: string }

export type ReviewAuthorTarget = {
  findingId: string
  topicId: string
  blockId: string
  category: string
}

export type ReviewNavigationState =
  | { status: 'ready'; target: ReviewAuthorTarget }
  | { status: 'unavailable' | 'stale' | 'missing-topic' | 'missing-block'; message: string }

export function resolveReviewAuthorTarget(
  finding: ReviewFinding,
  snapshot: ReviewInputSnapshot | null,
  topics: AuthorTopic[],
  topicContent: Record<string, AuthorBlock[]>,
): ReviewNavigationState {
  if (!finding.topicId || !finding.blockId) {
    return { status: 'unavailable', message: 'This finding has no exact authored block to open.' }
  }
  if (!snapshot || finding.projectId !== snapshot.projectId) {
    return { status: 'stale', message: 'This finding is stale. Rerun Review with current inputs before opening it in Author.' }
  }
  const topic = topics.find(item => stableAuthorTopicId(item) === finding.topicId)
  if (!topic) {
    return { status: 'missing-topic', message: 'The authored topic no longer exists. Rerun Review to update this finding.' }
  }
  const blocks = topicContent[finding.topicId] ?? topicContent[String(topic.id)]
  if (!blocks?.some(block => block.id === finding.blockId)) {
    return { status: 'missing-block', message: 'The exact authored block no longer exists. Rerun Review to update this finding.' }
  }
  if (
    snapshot.readiness !== 'ready'
    || finding.inputSnapshotId !== snapshot.snapshotId
    || finding.freshness.status !== 'current'
    || finding.status === 'retired'
  ) {
    return { status: 'stale', message: 'This finding is stale. Rerun Review with current inputs before opening it in Author.' }
  }
  return {
    status: 'ready',
    target: {
      findingId: finding.findingId,
      topicId: finding.topicId,
      blockId: finding.blockId,
      category: finding.category,
    },
  }
}