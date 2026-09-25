import {
  hydrateReviewInputSnapshot,
  remapReviewInputSnapshot,
  type ReviewInputProvenance,
  type ReviewInputSnapshot,
} from './reviewInput'

export type { ReviewInputProvenance } from './reviewInput'

export const REVIEW_MODEL_VERSION = 1

export type ReviewFindingStatus =
  | 'open'
  | 'in-review'
  | 'resolved'
  | 'rejected'
  | 'dismissed'
  | 'retired'

export type ReviewSeverity = 'critical' | 'warning' | 'suggestion' | 'info'

export type ReviewSourceReference = {
  projectId: string
  sourceId: string
  fileId: string
  sourceFileName?: string
  blockId?: string
  location?: string
  sectionPath?: string[]
}

export type ReviewEvidenceReference = {
  evidenceId: string
  projectId: string
  sourceId?: string
  fileId?: string
  sourceFileName?: string
  blockId?: string
  location?: string
  sectionPath?: string[]
  excerpt?: string
}

export type ReviewStyleReference = {
  styleProfileId?: string
  standardId?: string
  label: string
  value?: string
  fingerprint?: string
}

export type ReviewSuggestionDiff = {
  kind: 'replace' | 'insert' | 'delete'
  blockId: string
  originalText?: string
  proposedText?: string
  expectedBlockFingerprint?: string
  method?: 'deterministic-spelling-v1'
  confidence?: 'high'
  range?: {
    start: number
    end: number
  }
  rationale?: string
}

export type ReviewResolutionEvent = {
  eventId: string
  status: ReviewFindingStatus
  action?: 'applied' | 'rejected'
  reason?: string
  actor: 'user' | 'system'
  at: number
}

export type ReviewFreshness = {
  status: 'current' | 'stale' | 'unknown'
  reasons: string[]
  checkedAt: number | null
}

export type ReviewFinding = {
  findingId: string
  findingKey: string
  reviewRunId: string
  inputSnapshotId: string
  projectId: string
  topicId: string | null
  blockId: string | null
  category: string
  severity: ReviewSeverity
  required: boolean
  originalText: string | null
  claimFingerprint: string | null
  rationale: string
  sourceReferences: ReviewSourceReference[]
  evidenceReferences: ReviewEvidenceReference[]
  styleReferences: ReviewStyleReference[]
  suggestion: ReviewSuggestionDiff | null
  status: ReviewFindingStatus
  dismissalReason: string | null
  resolutionHistory: ReviewResolutionEvent[]
  inputProvenance: ReviewInputProvenance
  freshness: ReviewFreshness
  createdAt: number
  updatedAt: number
  retiredAt: number | null
  retirementReason: 'topic-deleted' | null
}

export type ReviewRun = {
  reviewRunId: string
  inputSnapshotId: string
  projectId: string
  findingIds: string[]
  inputProvenance: ReviewInputProvenance
  status: 'draft' | 'complete' | 'stale'
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export type ReviewModel = {
  version: typeof REVIEW_MODEL_VERSION
  projectId: string
  activeReviewRunId: string | null
  inputSnapshot: ReviewInputSnapshot | null
  runs: ReviewRun[]
  findings: ReviewFinding[]
  updatedAt: number | null
}

export function createEmptyReviewModel(projectId: string): ReviewModel {
  return {
    version: REVIEW_MODEL_VERSION,
    projectId,
    activeReviewRunId: null,
    inputSnapshot: null,
    runs: [],
    findings: [],
    updatedAt: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function hydrateReviewModel(value: unknown, projectId: string): ReviewModel {
  if (!isRecord(value) || value.version !== REVIEW_MODEL_VERSION) {
    return createEmptyReviewModel(projectId)
  }

  const runs = Array.isArray(value.runs)
    ? value.runs.filter(isRecord).filter(run => typeof run.reviewRunId === 'string')
      .map(run => ({ ...run, projectId })) as ReviewRun[]
    : []
  const findings = Array.isArray(value.findings)
    ? value.findings.filter(isRecord).filter(finding =>
        typeof finding.findingId === 'string' && typeof finding.reviewRunId === 'string')
      .map(finding => ({ ...finding, projectId })) as ReviewFinding[]
    : []
  const runIds = new Set(runs.map(run => run.reviewRunId))
  const findingIds = new Set(findings.map(finding => finding.findingId))
  const activeReviewRunId = typeof value.activeReviewRunId === 'string'
    && runIds.has(value.activeReviewRunId)
    ? value.activeReviewRunId
    : null

  return {
    version: REVIEW_MODEL_VERSION,
    projectId,
    activeReviewRunId,
    inputSnapshot: hydrateReviewInputSnapshot(value.inputSnapshot, projectId),
    runs: runs.map(run => ({
      ...run,
      projectId,
      inputSnapshotId: typeof run.inputSnapshotId === 'string' ? run.inputSnapshotId : '',
      findingIds: (run.findingIds ?? []).filter(findingId => findingIds.has(findingId)),
      inputProvenance: {
        ...run.inputProvenance,
        projectId,
        sourceFileIds: [...(run.inputProvenance?.sourceFileIds ?? [])],
      },
    })),
    findings: findings.map(finding => ({
      ...finding,
      projectId,
      findingKey: typeof finding.findingKey === 'string' ? finding.findingKey : finding.findingId,
      inputSnapshotId: typeof finding.inputSnapshotId === 'string' ? finding.inputSnapshotId : '',
      rationale: typeof finding.rationale === 'string' ? finding.rationale : '',
      sourceReferences: (finding.sourceReferences ?? []).map(reference => ({
        ...reference,
        projectId,
        sectionPath: reference.sectionPath ? [...reference.sectionPath] : undefined,
      })),
      evidenceReferences: (finding.evidenceReferences ?? []).map(reference => ({
        ...reference,
        projectId,
        sectionPath: reference.sectionPath ? [...reference.sectionPath] : undefined,
      })),
      styleReferences: (finding.styleReferences ?? []).map(reference => ({ ...reference })),
      suggestion: finding.suggestion
        ? {
            ...finding.suggestion,
            range: finding.suggestion.range ? { ...finding.suggestion.range } : undefined,
          }
        : null,
      resolutionHistory: (finding.resolutionHistory ?? []).map(event => ({ ...event })),
      inputProvenance: {
        ...finding.inputProvenance,
        projectId,
        sourceFileIds: [...(finding.inputProvenance?.sourceFileIds ?? [])],
      },
      freshness: {
        ...finding.freshness,
        reasons: [...(finding.freshness?.reasons ?? [])],
      },
    })),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : null,
  }
}

function remapFileId(value: string, fileIdMap: Record<string, string>): string {
  return fileIdMap[value] ?? value
}

function remapProvenance(
  provenance: ReviewInputProvenance,
  projectId: string,
  fileIdMap: Record<string, string>,
): ReviewInputProvenance {
  return {
    ...provenance,
    projectId,
    sourceFileIds: provenance.sourceFileIds.map(fileId => remapFileId(fileId, fileIdMap)),
  }
}

export function remapReviewModelForDuplicate(
  value: unknown,
  sourceProjectId: string,
  copiedProjectId: string,
  fileIdMap: Record<string, string>,
): ReviewModel {
  const source = hydrateReviewModel(value, sourceProjectId)
  return {
    ...source,
    projectId: copiedProjectId,
    inputSnapshot: source.inputSnapshot
      ? remapReviewInputSnapshot(source.inputSnapshot, copiedProjectId, fileIdMap)
      : null,
    runs: source.runs.map(run => ({
      ...run,
      projectId: copiedProjectId,
      findingIds: [...run.findingIds],
      inputProvenance: remapProvenance(run.inputProvenance, copiedProjectId, fileIdMap),
    })),
    findings: source.findings.map(finding => ({
      ...finding,
      projectId: copiedProjectId,
      sourceReferences: finding.sourceReferences.map(reference => ({
        ...reference,
        projectId: copiedProjectId,
        sourceId: remapFileId(reference.sourceId, fileIdMap),
        fileId: remapFileId(reference.fileId, fileIdMap),
        sectionPath: reference.sectionPath ? [...reference.sectionPath] : undefined,
      })),
      evidenceReferences: finding.evidenceReferences.map(reference => ({
        ...reference,
        projectId: copiedProjectId,
        sourceId: reference.sourceId ? remapFileId(reference.sourceId, fileIdMap) : undefined,
        fileId: reference.fileId ? remapFileId(reference.fileId, fileIdMap) : undefined,
        sectionPath: reference.sectionPath ? [...reference.sectionPath] : undefined,
      })),
      styleReferences: finding.styleReferences.map(reference => ({ ...reference })),
      suggestion: finding.suggestion
        ? {
            ...finding.suggestion,
            range: finding.suggestion.range ? { ...finding.suggestion.range } : undefined,
          }
        : null,
      resolutionHistory: finding.resolutionHistory.map(event => ({ ...event })),
      inputProvenance: remapProvenance(
        finding.inputProvenance,
        copiedProjectId,
        fileIdMap,
      ),
      freshness: {
        ...finding.freshness,
        reasons: [...finding.freshness.reasons],
      },
    })),
  }
}

function historyEventId(findingId: string, at: number): string {
  return `review-history-${findingId}-${at}`
}

export function reconcileReviewModelTopics(
  value: ReviewModel,
  validTopicIds: Iterable<string>,
  at = Date.now(),
): ReviewModel {
  const valid = new Set(validTopicIds)
  let changed = false
  const findings = value.findings.map(finding => {
    if (!finding.topicId || valid.has(finding.topicId) || finding.status === 'retired') {
      return finding
    }
    changed = true
    return {
      ...finding,
      status: 'retired' as const,
      retiredAt: at,
      retirementReason: 'topic-deleted' as const,
      updatedAt: at,
      resolutionHistory: [
        ...finding.resolutionHistory,
        {
          eventId: historyEventId(finding.findingId, at),
          status: 'retired' as const,
          reason: 'topic-deleted',
          actor: 'system' as const,
          at,
        },
      ],
    }
  })

  return changed ? { ...value, findings, updatedAt: at } : value
}