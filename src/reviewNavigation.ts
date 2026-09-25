import { checkReviewActionEligibility } from './reviewActionEligibility'
import type { ReviewFinding, ReviewModel } from './reviewModel'
import type { ReviewInputDocBlock } from './reviewInput'
import type { ReviewInputSnapshot } from './reviewInput'

type AuthorTopic = { id: number; topicId?: string }

export type ReviewAuthorTarget = {
  findingId: string
  topicId: string
  blockId: string
  category: string
}

export type ReviewNavigationState =
  | { status: 'ready'; target: ReviewAuthorTarget }
  | { status: 'unavailable' | 'stale' | 'missing-topic' | 'missing-block' | 'changed-block'; message: string }

export function resolveReviewAuthorTarget(
  finding: ReviewFinding,
  model: ReviewModel,
  snapshot: ReviewInputSnapshot | null,
  topics: AuthorTopic[],
  topicContent: Record<string, ReviewInputDocBlock[]>,
): ReviewNavigationState {
  if (!finding.topicId || !finding.blockId) {
    return { status: 'unavailable', message: 'This finding has no exact authored block to open.' }
  }
  const eligibility = checkReviewActionEligibility(model, finding.findingId, snapshot, topics, topicContent, 'exact')
  if (!eligibility.ok) return { status: eligibility.code, message: eligibility.reason }
  const currentFinding = model.findings.find(item => item.findingId === finding.findingId)!
  return {
    status: 'ready',
    target: {
      findingId: currentFinding.findingId,
      topicId: currentFinding.topicId!,
      blockId: currentFinding.blockId!,
      category: currentFinding.category,
    },
  }
}

// The save may wait on IndexedDB while Review inputs or the selected run change.
export async function validateReviewNavigationAfterSave(
  save: () => Promise<boolean>,
  validate: () => ReviewNavigationState,
): Promise<ReviewNavigationState | null> {
  const before = validate()
  if (before.status !== 'ready') return before
  if (!await save()) return null
  return validate()
}