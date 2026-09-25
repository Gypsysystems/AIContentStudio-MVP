import type { ConceptAnalysis, AnalysisEvidenceReference } from './conceptAnalysis'
import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'
import type { ReviewInputSnapshot, ReviewInputTopic } from './reviewInput'
import { languageAndStandardsChecks } from './reviewLanguageChecks'
import type {
  ReviewEvidenceReference,
  ReviewFinding,
  ReviewModel,
  ReviewRun,
  ReviewSourceReference,
} from './reviewModel'
import type { UnsupportedAnalysis } from './unsupportedAnalysis'

export const GROUNDED_REVIEW_METHOD = 'grounded-review-v1' as const

export type GroundedReviewCategory =
  | 'Unsupported Claim'
  | 'Source Gap'
  | 'Conflict'
  | 'Terminology'
  | 'Grammar'
  | 'Spelling'
  | 'Writing Style'
  | 'Formatting / Standards'

export type BuildGroundedReviewResult =
  | { ok: true; model: ReviewModel; run: ReviewRun; findings: ReviewFinding[] }
  | { ok: false; reason: string }

type Location = { topicId: string | null; blockId: string | null }

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function fingerprint(prefix: string, value: string): string {
  return `${prefix}-${stableHash(value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim())}`
}

const LOCATION_STOP_WORDS = new Set([
  'about', 'and', 'are', 'for', 'from', 'has', 'have', 'into', 'not', 'source',
  'sources', 'that', 'the', 'their', 'this', 'was', 'were', 'with',
])

function tokens(value: string): Set<string> {
  return new Set(
    value.normalize('NFKC').toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(token => token.length >= 3 && !LOCATION_STOP_WORDS.has(token)),
  )
}

function overlap(query: Set<string>, value: string): number {
  const candidate = tokens(value)
  return [...query].filter(token => candidate.has(token)).length
}

function resolveLocation(snapshot: ReviewInputSnapshot, queryText: string): Location {
  const query = tokens(queryText)
  if (!query.size) return { topicId: null, blockId: null }
  let bestTopic: { topic: ReviewInputTopic; score: number } | null = null
  let bestBlock: { topicId: string; blockId: string; score: number } | null = null
  for (const topic of snapshot.topics) {
    const topicScore = overlap(query, topic.title)
    if (topicScore > 0 && (!bestTopic || topicScore > bestTopic.score
      || (topicScore === bestTopic.score && topic.topicId < bestTopic.topic.topicId))) {
      bestTopic = { topic, score: topicScore }
    }
    for (const block of topic.blocks) {
      const blockScore = overlap(query, `${topic.title} ${block.content}`)
      if (blockScore > 0 && (!bestBlock || blockScore > bestBlock.score
        || (blockScore === bestBlock.score
          && `${topic.topicId}|${block.blockId}` < `${bestBlock.topicId}|${bestBlock.blockId}`))) {
        bestBlock = { topicId: topic.topicId, blockId: block.blockId, score: blockScore }
      }
    }
  }
  if (bestBlock && (!bestTopic || bestBlock.score >= bestTopic.score)) {
    return { topicId: bestBlock.topicId, blockId: bestBlock.blockId }
  }
  return bestTopic
    ? { topicId: bestTopic.topic.topicId, blockId: null }
    : { topicId: null, blockId: null }
}

function validatedLocation(
  snapshot: ReviewInputSnapshot,
  topicId: string | undefined,
  blockId: string | undefined,
  fallbackText: string,
): Location {
  const topic = topicId ? snapshot.topics.find(item => item.topicId === topicId) : undefined
  const block = topic && blockId ? topic.blocks.find(item => item.blockId === blockId) : undefined
  if (topic && block) return { topicId: topic.topicId, blockId: block.blockId }
  if (topic) return { topicId: topic.topicId, blockId: null }
  return resolveLocation(snapshot, fallbackText)
}

function evidenceItemMap(index: EvidenceIndex): Map<string, EvidenceItem> {
  return new Map(index.items.map(item => [item.id, item]))
}

function sourceReference(projectId: string, item: EvidenceItem): ReviewSourceReference {
  return {
    projectId,
    sourceId: item.sourceId,
    fileId: item.fileId,
    sourceFileName: item.sourceFileName,
    blockId: item.blockId,
    location: item.location,
    sectionPath: item.sectionPath ? [...item.sectionPath] : undefined,
  }
}

function evidenceReference(projectId: string, item: EvidenceItem): ReviewEvidenceReference {
  return {
    evidenceId: item.id,
    projectId,
    sourceId: item.sourceId,
    fileId: item.fileId,
    sourceFileName: item.sourceFileName,
    blockId: item.blockId,
    location: item.location,
    sectionPath: item.sectionPath ? [...item.sectionPath] : undefined,
    excerpt: item.text,
  }
}

function referencesFor(
  projectId: string,
  ids: string[],
  byId: Map<string, EvidenceItem>,
): { sources: ReviewSourceReference[]; evidence: ReviewEvidenceReference[] } {
  const items = [...new Set(ids)].flatMap(id => {
    const item = byId.get(id)
    return item ? [item] : []
  })
  return {
    sources: items.map(item => sourceReference(projectId, item)),
    evidence: items.map(item => evidenceReference(projectId, item)),
  }
}

function evidenceIdsFromRefs(refs: AnalysisEvidenceReference[]): string[] {
  return refs.map(reference => reference.evidenceId)
}

type FindingSeed = Omit<
  ReviewFinding,
  'findingId' | 'reviewRunId' | 'inputSnapshotId' | 'projectId'
  | 'inputProvenance' | 'freshness' | 'createdAt' | 'updatedAt'
>

function seedBase(
  findingKey: string,
  category: GroundedReviewCategory,
  location: Location,
  originalText: string | null,
  rationale: string,
  severity: ReviewFinding['severity'],
  required: boolean,
  references: ReturnType<typeof referencesFor>,
): FindingSeed {
  return {
    findingKey,
    topicId: location.topicId,
    blockId: location.blockId,
    category,
    severity,
    required,
    originalText,
    claimFingerprint: originalText ? fingerprint('review-claim', originalText) : fingerprint('review-context', findingKey),
    rationale,
    sourceReferences: references.sources,
    evidenceReferences: references.evidence,
    styleReferences: [],
    suggestion: null,
    status: 'open',
    dismissalReason: null,
    resolutionHistory: [],
    retiredAt: null,
    retirementReason: null,
  }
}

function unsupportedSeeds(
  snapshot: ReviewInputSnapshot,
  analysis: UnsupportedAnalysis,
  byId: Map<string, EvidenceItem>,
): FindingSeed[] {
  return analysis.findings.map(finding => {
    const location = validatedLocation(
      snapshot,
      finding.context.topicId,
      finding.context.blockId,
      `${finding.context.location} ${finding.claimText}`,
    )
    const evidenceIds = finding.nearMatches.map(candidate => candidate.evidenceId)
    return seedBase(
      `unsupported:${finding.id}`,
      'Unsupported Claim',
      location,
      finding.claimText,
      finding.reason,
      'warning',
      true,
      referencesFor(snapshot.projectId, evidenceIds, byId),
    )
  })
}

function gapSeeds(
  snapshot: ReviewInputSnapshot,
  analysis: ConceptAnalysis,
  byId: Map<string, EvidenceItem>,
): FindingSeed[] {
  return (analysis.gaps ?? []).map(gap => seedBase(
    `gap:${gap.id}`,
    'Source Gap',
    resolveLocation(snapshot, `${gap.title} ${gap.rationale}`),
    null,
    gap.rationale,
    'warning',
    true,
    referencesFor(snapshot.projectId, gap.evidenceIds, byId),
  ))
}

function conflictSeeds(
  snapshot: ReviewInputSnapshot,
  analysis: ConceptAnalysis,
  byId: Map<string, EvidenceItem>,
): FindingSeed[] {
  return (analysis.conflicts ?? []).map(conflict => {
    const affectedText = conflict.sides.map(side => `${side.label}: ${side.claimText}`).join(' | ')
    return seedBase(
      `conflict:${conflict.id}`,
      'Conflict',
      resolveLocation(snapshot, `${conflict.subject} ${conflict.summary} ${affectedText}`),
      affectedText,
      `${conflict.summary} ${conflict.rationale}`,
      'critical',
      true,
      referencesFor(snapshot.projectId, conflict.evidenceIds, byId),
    )
  })
}

function termRegex(value: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])(${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-z0-9])`, 'g')
}

function terminologySeeds(
  snapshot: ReviewInputSnapshot,
  analysis: ConceptAnalysis,
  byId: Map<string, EvidenceItem>,
): FindingSeed[] {
  const seeds: FindingSeed[] = []
  for (const term of analysis.terminology) {
    const variants = term.exactTerms.filter(variant => variant !== term.normalizedLabel)
    if (!variants.length) continue
    const refs = referencesFor(
      snapshot.projectId,
      term.evidenceIds.length ? term.evidenceIds : evidenceIdsFromRefs(term.evidenceRefs),
      byId,
    )
    for (const topic of snapshot.topics) {
      for (const block of topic.blocks) {
        for (const variant of variants) {
          if (!termRegex(variant).test(block.content)) continue
          seeds.push(seedBase(
            `terminology:${term.id}:${topic.topicId}:${block.blockId}:${fingerprint('variant', variant)}`,
            'Terminology',
            { topicId: topic.topicId, blockId: block.blockId },
            variant,
            `The grounded terminology record prefers “${term.normalizedLabel}”; this block uses the source-backed variant “${variant}”. Review for consistent usage. No replacement is applied automatically.`,
            'suggestion',
            false,
            refs,
          ))
        }
      }
    }
  }
  return seeds
}

function runOrdinal(model: ReviewModel, snapshotId: string): number {
  return model.runs.filter(run => run.inputSnapshotId === snapshotId).length + 1
}

export function buildGroundedReviewRun(
  model: ReviewModel,
  snapshot: ReviewInputSnapshot | null,
  evidenceIndex: EvidenceIndex | null,
  conceptAnalysis: ConceptAnalysis | null,
  unsupportedAnalysis: UnsupportedAnalysis | null,
  at = Date.now(),
): BuildGroundedReviewResult {
  if (!snapshot) return { ok: false, reason: 'The Review input snapshot is not available.' }
  if (snapshot.readiness !== 'ready') {
    return { ok: false, reason: 'Review inputs are missing or stale. Resolve the diagnostics before starting a new run.' }
  }
  if (!evidenceIndex || !conceptAnalysis || !unsupportedAnalysis) {
    return { ok: false, reason: 'Grounded evidence or analysis inputs are unavailable.' }
  }
  const currentIds = {
    conflicts: new Set((conceptAnalysis.conflicts ?? []).map(item => item.id)),
    gaps: new Set((conceptAnalysis.gaps ?? []).map(item => item.id)),
    unsupported: new Set(unsupportedAnalysis.findings.map(item => item.id)),
  }
  if (
    snapshot.groundedAnalysis.conflictIds.some(id => !currentIds.conflicts.has(id))
    || snapshot.groundedAnalysis.gapIds.some(id => !currentIds.gaps.has(id))
    || snapshot.unsupportedAnalysis.findingIds.some(id => !currentIds.unsupported.has(id))
  ) {
    return { ok: false, reason: 'The persisted Review snapshot no longer matches the grounded analysis inputs.' }
  }

  const ordinal = runOrdinal(model, snapshot.snapshotId)
  const reviewRunId = `review-run-${stableHash(`${snapshot.snapshotId}|${ordinal}`)}`
  const byId = evidenceItemMap(evidenceIndex)
  const seeds = [
    ...unsupportedSeeds(snapshot, unsupportedAnalysis, byId),
    ...gapSeeds(snapshot, conceptAnalysis, byId),
    ...conflictSeeds(snapshot, conceptAnalysis, byId),
    ...terminologySeeds(snapshot, conceptAnalysis, byId),
    ...languageAndStandardsChecks(snapshot).map(check => ({
      ...seedBase(
        `language-standard:${check.key}`,
        check.category,
        { topicId: check.topicId, blockId: check.blockId },
        check.originalText,
        check.rationale,
        check.severity,
        false,
        { sources: [], evidence: [] },
      ),
      styleReferences: check.styleReferences,
      suggestion: check.category === 'Spelling' ? check.suggestion ?? null : null,
    })),
  ].sort((left, right) => left.findingKey.localeCompare(right.findingKey))
  const findings = seeds.map(seed => ({
    ...seed,
    findingId: `review-finding-${stableHash(`${reviewRunId}|${seed.findingKey}`)}`,
    reviewRunId,
    inputSnapshotId: snapshot.snapshotId,
    projectId: snapshot.projectId,
    inputProvenance: structuredClone(snapshot.provenance),
    freshness: { status: 'current' as const, reasons: [], checkedAt: at },
    createdAt: at,
    updatedAt: at,
  }))
  const run: ReviewRun = {
    reviewRunId,
    inputSnapshotId: snapshot.snapshotId,
    projectId: snapshot.projectId,
    findingIds: findings.map(finding => finding.findingId),
    inputProvenance: structuredClone(snapshot.provenance),
    status: 'complete',
    createdAt: at,
    updatedAt: at,
    completedAt: at,
  }
  return {
    ok: true,
    run,
    findings,
    model: {
      ...model,
      projectId: snapshot.projectId,
      activeReviewRunId: reviewRunId,
      inputSnapshot: snapshot,
      runs: [...model.runs, run],
      findings: [...model.findings, ...findings],
      updatedAt: at,
    },
  }
}

export function markReviewHistoryFreshness(
  model: ReviewModel,
  snapshot: ReviewInputSnapshot,
  at = Date.now(),
): ReviewModel {
  let changed = false
  const findings = model.findings.map(finding => {
    const isCurrent = finding.inputSnapshotId === snapshot.snapshotId
    const status = isCurrent ? 'current' as const : 'stale' as const
    const reasons = isCurrent ? [] : ['review-input-snapshot-changed']
    if (finding.freshness.status === status
      && JSON.stringify(finding.freshness.reasons) === JSON.stringify(reasons)) return finding
    changed = true
    return { ...finding, freshness: { status, reasons, checkedAt: at }, updatedAt: at }
  })
  const runs = model.runs.map(run => {
    const status = run.inputSnapshotId === snapshot.snapshotId ? run.status : 'stale' as const
    if (run.status === status) return run
    changed = true
    return { ...run, status, updatedAt: at }
  })
  return changed ? { ...model, findings, runs, updatedAt: at } : model
}