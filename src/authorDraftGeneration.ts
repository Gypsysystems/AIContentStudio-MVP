import type {
  TopicGroundingContext,
  TopicGroundingEvidence,
} from './authorGroundingContext'

export type AuthorDraftBlock = {
  id: string
  type: 'h1' | 'h2' | 'h3' | 'para' | 'callout'
  content: string
  calloutVariant?: 'note' | 'warning'
  evidenceIds: string[]
}

export type AuthorDraftWarning = {
  id: string
  kind: 'no-evidence' | 'conflict' | 'gap' | 'unavailable' | 'language'
  message: string
  evidenceIds: string[]
}

export type AuthorTopicDraft = {
  version: 1
  draftId: string
  topicId: string
  method: 'deterministic-evidence-draft-v1'
  modelLabel: 'No external model — deterministic evidence builder'
  generatedAt: number
  groundingContextId: string
  groundingRevision: string
  contentType: string
  language: string
  variableSnapshot: Record<string, string>
  styleProvenance: {
    styleProfileId: string
    styleProfileName: string
    styleProfileScope: string
    styleFingerprint: string
    brandNames: string[]
  }
  evidenceIdsUsed: string[]
  requiredEvidenceIdsUsed: string[]
  optionalEvidenceIdsUsed: string[]
  warnings: AuthorDraftWarning[]
  blocks: AuthorDraftBlock[]
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function applyApprovedVariables(
  text: string,
  variables: Record<string, string>,
): string {
  return Object.entries(variables).reduce((result, [name, value]) => {
    if (!name.trim()) return result
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return result.replace(new RegExp(`{{\\s*${escapedName}\\s*}}`, 'g'), value)
  }, text)
}

function uniqueEvidence(
  evidence: TopicGroundingEvidence[],
): TopicGroundingEvidence[] {
  const seen = new Set<string>()
  return evidence.filter(item => {
    if (seen.has(item.evidenceId)) return false
    seen.add(item.evidenceId)
    return true
  })
}

function structureHeading(contentType: string): string {
  const normalized = contentType.toLocaleLowerCase('en-US')
  if (normalized.includes('api')) return 'Reference details'
  if (normalized.includes('runbook') || normalized.includes('playbook')) return 'Operational guidance'
  if (normalized.includes('training') || normalized.includes('course')) return 'Learning content'
  return 'Evidence-backed details'
}

export function buildDeterministicAuthorDraft(
  context: TopicGroundingContext,
  generatedAt = Date.now(),
): AuthorTopicDraft {
  const requiredEvidence = uniqueEvidence(context.requiredEvidence)
  const requiredIds = new Set(requiredEvidence.map(item => item.evidenceId))
  const optionalEvidence = uniqueEvidence(context.optionalSupportingEvidence)
    .filter(item => !requiredIds.has(item.evidenceId))
  const usedEvidence = [...requiredEvidence, ...optionalEvidence]
  const warnings: AuthorDraftWarning[] = []

  if (usedEvidence.length === 0) {
    warnings.push({
      id: 'warning-no-evidence',
      kind: 'no-evidence',
      message: context.evidenceStatus === 'no-supporting-evidence'
        ? 'No supporting evidence is committed for this topic. No factual draft detail was generated.'
        : 'Current supporting evidence is unavailable. No factual draft detail was generated.',
      evidenceIds: [],
    })
  }
  for (const conflict of context.conflicts) {
    warnings.push({
      id: `warning-${conflict.id}`,
      kind: 'conflict',
      message: `Evidence conflict: ${conflict.title}. ${conflict.rationale} The draft does not choose a side.`,
      evidenceIds: [...conflict.evidenceIds],
    })
  }
  for (const gap of context.gaps) {
    warnings.push({
      id: `warning-${gap.id}`,
      kind: 'gap',
      message: `Information gap: ${gap.title}. ${gap.rationale}`,
      evidenceIds: [...gap.evidenceIds],
    })
  }
  for (const [index, message] of context.unavailableInformation.entries()) {
    if (message === 'This committed topic has no supporting evidence.') continue
    warnings.push({
      id: `warning-unavailable-${index}`,
      kind: 'unavailable',
      message,
      evidenceIds: [],
    })
  }

  const blocks: AuthorDraftBlock[] = [{
    id: 'draft-heading',
    type: 'h1',
    content: context.topic.title,
    evidenceIds: [],
  }]
  if (usedEvidence.length > 0) {
    blocks.push({
      id: 'draft-evidence-heading',
      type: 'h2',
      content: structureHeading(context.writingGuidance.contentType),
      evidenceIds: [],
    })
    usedEvidence.forEach((evidence, index) => {
      blocks.push({
        id: `draft-evidence-${index + 1}`,
        type: 'para',
        content: applyApprovedVariables(
          evidence.text,
          context.writingGuidance.variables,
        ),
        evidenceIds: [evidence.evidenceId],
      })
    })
  }
  warnings.forEach((warning, index) => {
    blocks.push({
      id: `draft-warning-${index + 1}`,
      type: 'callout',
      content: warning.message,
      calloutVariant: warning.kind === 'conflict' || warning.kind === 'gap'
        ? 'warning'
        : 'note',
      evidenceIds: [...warning.evidenceIds],
    })
  })

  const evidenceIdsUsed = usedEvidence.map(item => item.evidenceId)
  const draftSnapshot = {
    topicId: context.topic.topicId,
    groundingContextId: context.contextId,
    generatedAt,
    evidenceIdsUsed,
    blocks,
    warnings,
  }

  return {
    version: 1,
    draftId: `author-draft-${stableHash(JSON.stringify(draftSnapshot))}`,
    topicId: context.topic.topicId,
    method: 'deterministic-evidence-draft-v1',
    modelLabel: 'No external model — deterministic evidence builder',
    generatedAt,
    groundingContextId: context.contextId,
    groundingRevision: context.contextId,
    contentType: context.writingGuidance.contentType,
    language: context.writingGuidance.language,
    variableSnapshot: { ...context.writingGuidance.variables },
    styleProvenance: {
      styleProfileId: context.writingGuidance.styleProfileId,
      styleProfileName: context.writingGuidance.styleProfileName,
      styleProfileScope: context.writingGuidance.styleProfileScope,
      styleFingerprint: context.provenance.styleFingerprint,
      brandNames: [...context.writingGuidance.brandNames],
    },
    evidenceIdsUsed,
    requiredEvidenceIdsUsed: requiredEvidence.map(item => item.evidenceId),
    optionalEvidenceIdsUsed: optionalEvidence.map(item => item.evidenceId),
    warnings,
    blocks,
  }
}

export function isAuthorDraftFresh(
  draft: AuthorTopicDraft | null | undefined,
  context: TopicGroundingContext | null | undefined,
  contextIsCurrent: boolean,
): boolean {
  return !!draft
    && !!context
    && contextIsCurrent
    && draft.groundingContextId === context.contextId
}