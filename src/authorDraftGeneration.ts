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

export type AuthorBlockState = 'generated' | 'manually-edited' | 'approved' | 'mixed' | 'legacy'

export type AuthorAppliedBaseline = {
  draftId: string
  groundingContextId: string
  contentFingerprint: string
  blocks: Array<{
    sourceBlockId: string
    appliedBlockId: string
    block: AuthorDraftBlock
  }>
}

export type AuthorDraftDiffStatus =
  | 'added'
  | 'changed'
  | 'removed'
  | 'unchanged'
  | 'manually-edited'
  | 'protected'

export type AuthorDraftDiff = {
  id: string
  status: AuthorDraftDiffStatus
  selected: boolean
  sourceBlockId?: string
  currentBlock?: AuthorDraftBlock
  proposedBlock?: AuthorDraftBlock
  baselineBlock?: AuthorDraftBlock
  protection: 'none' | 'manual' | 'approved' | 'legacy'
}

export type AuthorRegenerationProposal = {
  version: 1
  proposalId: string
  baseDraftId: string | null
  proposedDraftId: string
  groundingContextId: string
  currentContentFingerprint: string
  diffs: AuthorDraftDiff[]
}

export type AuthorComparableBlock = {
  id: string
  type: string
  content: string
  calloutVariant?: string
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

function blockFingerprint(block: AuthorComparableBlock): string {
  return stableHash(stableStringify({
    type: block.type,
    content: block.content,
    calloutVariant: block.calloutVariant ?? '',
  }))
}

export function authorBlockFingerprint(block: AuthorComparableBlock): string {
  return blockFingerprint(block)
}

export function authorContentFingerprint(blocks: AuthorComparableBlock[]): string {
  return stableHash(stableStringify(blocks.map(block => ({
    id: block.id,
    type: block.type,
    content: block.content,
    calloutVariant: block.calloutVariant ?? '',
  }))))
}

function draftAsComparable(block: AuthorDraftBlock): AuthorComparableBlock {
  return {
    id: block.id,
    type: block.type,
    content: block.content,
    calloutVariant: block.calloutVariant,
  }
}

function contentAsDraft(block: AuthorComparableBlock): AuthorDraftBlock {
  return {
    id: block.id,
    type: block.type as AuthorDraftBlock['type'],
    content: block.content,
    ...(block.calloutVariant ? { calloutVariant: block.calloutVariant as 'note' | 'warning' } : {}),
    evidenceIds: [],
  }
}

function isSameBlock(left: AuthorComparableBlock | undefined, right: AuthorComparableBlock | undefined): boolean {
  return !!left && !!right && blockFingerprint(left) === blockFingerprint(right)
}

export function buildAuthorRegenerationProposal(
  proposedDraft: AuthorTopicDraft,
  currentBlocks: AuthorComparableBlock[],
  baseline: AuthorAppliedBaseline | null,
  topicApproved: boolean,
  blockStates: Record<string, AuthorBlockState> = {},
): AuthorRegenerationProposal {
  const baselineBySource = new Map((baseline?.blocks ?? []).map(item => [item.sourceBlockId, item]))
  const currentById = new Map(currentBlocks.map(block => [block.id, block]))
  const matchedCurrent = new Set<string>()
  const diffs: AuthorDraftDiff[] = []

  for (const proposed of proposedDraft.blocks) {
    const baselineEntry = baselineBySource.get(proposed.id)
    const baselineBlock = baselineEntry?.block
    const currentBlock = baselineEntry
      ? currentById.get(baselineEntry.appliedBlockId)
      : currentBlocks.find(block =>
          !matchedCurrent.has(block.id) && isSameBlock(block, proposed))

    if (currentBlock) matchedCurrent.add(currentBlock.id)
    const state = currentBlock
      ? blockStates[currentBlock.id]
      : undefined
    const manual = !!baselineBlock && !!currentBlock && !isSameBlock(currentBlock, baselineBlock)
    const approved = !!baselineBlock
      && !!currentBlock
      && !manual
      && (topicApproved || state === 'approved')

    let status: AuthorDraftDiffStatus
    let protection: AuthorDraftDiff['protection']
    let selected: boolean
    if (manual) {
      status = 'manually-edited'
      protection = state === 'legacy' ? 'legacy' : 'manual'
      selected = false
    } else if (approved && !isSameBlock(currentBlock, proposed)) {
      status = 'protected'
      protection = 'approved'
      selected = false
    } else if (currentBlock && isSameBlock(currentBlock, proposed)) {
      status = 'unchanged'
      protection = approved
        ? 'approved'
        : baselineBlock
          ? 'none'
          : state === 'legacy'
            ? 'legacy'
            : 'manual'
      selected = false
    } else if (baselineBlock) {
      status = 'changed'
      protection = 'none'
      selected = true
    } else {
      status = 'added'
      protection = 'none'
      selected = true
    }
    diffs.push({
      id: `diff-${proposed.id}`,
      status,
      selected,
      sourceBlockId: proposed.id,
      currentBlock: currentBlock ? contentAsDraft(currentBlock) : undefined,
      proposedBlock: proposed,
      baselineBlock,
      protection,
    })
  }

  for (const baselineEntry of baseline?.blocks ?? []) {
    if (proposedDraft.blocks.some(block => block.id === baselineEntry.sourceBlockId)) continue
    const currentBlock = currentById.get(baselineEntry.appliedBlockId)
    if (!currentBlock) continue
    const manual = !isSameBlock(currentBlock, baselineEntry.block)
    const state = blockStates[currentBlock.id]
    diffs.push({
      id: `diff-removed-${baselineEntry.sourceBlockId}`,
      status: manual ? 'manually-edited' : 'removed',
      selected: !manual && !topicApproved && state !== 'approved',
      sourceBlockId: baselineEntry.sourceBlockId,
      currentBlock: contentAsDraft(currentBlock),
      baselineBlock: baselineEntry.block,
      protection: manual ? (state === 'legacy' ? 'legacy' : 'manual') : (topicApproved || state === 'approved' ? 'approved' : 'none'),
    })
    matchedCurrent.add(currentBlock.id)
  }

  for (const current of currentBlocks) {
    if (matchedCurrent.has(current.id)) continue
    diffs.push({
      id: `diff-manual-${current.id}`,
      status: 'manually-edited',
      selected: false,
      currentBlock: contentAsDraft(current),
      protection: blockStates[current.id] === 'legacy' ? 'legacy' : 'manual',
    })
  }

  const snapshot = {
    baseDraftId: baseline?.draftId ?? null,
    proposedDraftId: proposedDraft.draftId,
    groundingContextId: proposedDraft.groundingContextId,
    diffs,
  }
  return {
    version: 1,
    proposalId: `author-proposal-${stableHash(JSON.stringify(snapshot))}`,
    baseDraftId: baseline?.draftId ?? null,
    proposedDraftId: proposedDraft.draftId,
    groundingContextId: proposedDraft.groundingContextId,
    currentContentFingerprint: authorContentFingerprint(currentBlocks),
    diffs,
  }
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