import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'

export type ProposalTopicKind = 'evidence-backed' | 'optional-structural' | 'manual'

export type ProposedTopic = {
  id: number
  topicId: string
  title: string
  level: 1 | 2 | 3 | 4
  words: number
  parentId?: number
  parentTopicId?: string
  order: number
  rationale: string
  supportingEvidenceIds: string[]
  proposalKind: ProposalTopicKind
  sourceSectionPaths?: string[][]
  hasGap?: boolean
}

export type TocProposal = {
  version: 1
  method: 'evidence-grounded-toc-v1'
  contentType: string
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  groundedAnalysisBuiltAt: number
  generatedAt: number
  items: ProposedTopic[]
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableNumber(topicId: string): number {
  let hash = 2166136261
  for (let i = 0; i < topicId.length; i++) {
    hash ^= topicId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return 1000 + (hash >>> 0) % 900000000
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function contentTypeLabel(contentType: string): string {
  return contentType.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function optionalSections(contentType: string): string[] {
  const type = normalized(contentType)
  if (type.includes('api')) return ['Overview', 'Authentication and access', 'Errors and troubleshooting']
  if (type.includes('runbook') || type.includes('playbook')) return ['Purpose and scope', 'Prerequisites', 'Validation and rollback']
  if (type.includes('training') || type.includes('course')) return ['Learning objectives', 'Exercises', 'Knowledge check']
  if (type.includes('reference')) return ['About this reference', 'Quick reference', 'Troubleshooting']
  return ['Introduction', 'Prerequisites', 'Troubleshooting']
}

function headingItems(index: EvidenceIndex): EvidenceItem[] {
  return index.items
    .filter(item => item.blockType === 'heading' && item.text.trim())
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function evidenceForConcept(concept: ConceptAnalysis['concepts'][number], index: EvidenceIndex): EvidenceItem[] {
  const byId = new Map(index.items.map(item => [item.id, item]))
  return concept.evidenceIds.flatMap(id => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

export function buildTocProposal(
  evidenceIndex: EvidenceIndex,
  groundedAnalysis: ConceptAnalysis,
  contentType: string,
): TocProposal {
  const topics: ProposedTopic[] = []
  const usedTitles = new Set<string>()
  const headingByTitle = new Map<string, ProposedTopic>()
  const headingStack: ProposedTopic[] = []

  const add = (
    input: Omit<ProposedTopic, 'id' | 'order'> & { id?: number },
  ): ProposedTopic => {
    const topic: ProposedTopic = {
      ...input,
      id: input.id ?? stableNumber(input.topicId),
      order: topics.length,
    }
    topics.push(topic)
    usedTitles.add(normalized(topic.title))
    return topic
  }

  for (const heading of headingItems(evidenceIndex)) {
    const title = heading.text.trim()
    const titleKey = normalized(title)
    if (headingByTitle.has(titleKey)) {
      const existing = headingByTitle.get(titleKey)!
      existing.supportingEvidenceIds = unique([...existing.supportingEvidenceIds, heading.id])
      existing.sourceSectionPaths = unique([
        ...(existing.sourceSectionPaths ?? []).map(path => path.join(' › ')),
        ...(heading.sectionPath ? [heading.sectionPath.join(' › ')] : []),
      ]).map(path => path.split(' › '))
      continue
    }

    const headingLevel = Math.max(1, Math.min(4, heading.headingLevel ?? 1)) as 1 | 2 | 3 | 4
    while (headingStack.length >= headingLevel) headingStack.pop()
    const parent = headingLevel > 1 ? headingStack[headingStack.length - 1] : undefined
    const topic = add({
      topicId: `heading-${stableHash(titleKey)}`,
      title,
      level: parent ? headingLevel : 1,
      words: 0,
      parentId: parent?.id,
      parentTopicId: parent?.topicId,
      rationale: `Evidence-backed source heading${heading.sectionPath?.length ? ` under ${heading.sectionPath.join(' › ')}` : ''}.`,
      supportingEvidenceIds: [heading.id],
      proposalKind: 'evidence-backed',
      sourceSectionPaths: heading.sectionPath ? [heading.sectionPath] : [],
    })
    headingByTitle.set(titleKey, topic)
    headingStack.push(topic)
  }

  const conceptOnly = groundedAnalysis.concepts.filter(concept => !headingByTitle.has(normalized(concept.label)))
  if (conceptOnly.length > 0) {
    const root = add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-concepts`,
      title: 'Core concepts',
      level: 1,
      words: 0,
      rationale: `Optional structural grouping for ${contentTypeLabel(contentType)} topics that are evidenced in source content but are not source headings.`,
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    for (const concept of conceptOnly) {
      const evidence = evidenceForConcept(concept, evidenceIndex)
      add({
        topicId: `concept-${stableHash(normalized(concept.label))}`,
        title: concept.label,
        level: 2,
        words: 300,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: `Evidence-backed concept found in ${concept.sourceCount} source${concept.sourceCount === 1 ? '' : 's'} with terminology: ${concept.exactTerms.join(', ')}.`,
        supportingEvidenceIds: concept.evidenceIds,
        proposalKind: 'evidence-backed',
        sourceSectionPaths: unique(evidence.flatMap(item => item.sectionPath ? [item.sectionPath.join(' › ')] : [])).map(path => path.split(' › ')),
      })
    }
  }

  const representedTerms = new Set(
    [...headingByTitle.keys(), ...groundedAnalysis.concepts.map(concept => normalized(concept.label))],
  )
  const termsOnly = groundedAnalysis.terminology.filter(term => !representedTerms.has(normalized(term.normalizedLabel)))
  if (termsOnly.length > 0) {
    const root = add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-terminology`,
      title: 'Terminology',
      level: 1,
      words: 0,
      rationale: `Optional documentation section for evidence-backed terms relevant to this ${contentTypeLabel(contentType)}.`,
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    for (const term of termsOnly.slice(0, 12)) {
      add({
        topicId: `term-${stableHash(normalized(term.normalizedLabel))}`,
        title: term.normalizedLabel,
        level: 2,
        words: 180,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: `Evidence-backed terminology occurring ${term.occurrenceCount} time${term.occurrenceCount === 1 ? '' : 's'} across ${term.sourceCount} source${term.sourceCount === 1 ? '' : 's'}.`,
        supportingEvidenceIds: term.evidenceIds,
        proposalKind: 'evidence-backed',
      })
    }
  }

  const conflicts = groundedAnalysis.conflicts ?? []
  if (conflicts.length > 0) {
    const root = add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-open-decisions`,
      title: 'Open decisions',
      level: 1,
      words: 0,
      rationale: 'Optional documentation section for source-backed conflicts that should be resolved or called out before publication.',
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    for (const conflict of conflicts) {
      add({
        topicId: `conflict-${stableHash(conflict.id)}`,
        title: `Conflicting guidance: ${conflict.subject}`,
        level: 2,
        words: 220,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: conflict.rationale,
        supportingEvidenceIds: conflict.evidenceIds,
        proposalKind: 'evidence-backed',
      })
    }
  }

  const gaps = groundedAnalysis.gaps ?? []
  if (gaps.length > 0) {
    const root = add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-documentation-gaps`,
      title: 'Documentation gaps',
      level: 1,
      words: 0,
      rationale: 'Optional documentation section for source-backed missing or incomplete information. It does not assert facts that are absent from the sources.',
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    for (const gap of gaps) {
      add({
        topicId: `gap-${stableHash(gap.id)}`,
        title: gap.title,
        level: 2,
        words: 180,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: gap.rationale,
        supportingEvidenceIds: gap.evidenceIds,
        proposalKind: 'evidence-backed',
        hasGap: true,
      })
    }
  }

  const existingTitles = new Set(topics.map(topic => normalized(topic.title)))
  for (const title of optionalSections(contentType)) {
    if (existingTitles.has(normalized(title))) continue
    add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-${stableHash(normalized(title))}`,
      title,
      level: 1,
      words: 0,
      rationale: `Optional structural section commonly used for a ${contentTypeLabel(contentType)}. It is not presented as evidence-backed product information.`,
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    existingTitles.add(normalized(title))
  }

  return {
    version: 1,
    method: 'evidence-grounded-toc-v1',
    contentType,
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    groundedAnalysisBuiltAt: groundedAnalysis.builtAt,
    generatedAt: Date.now(),
    items: topics.map((topic, order) => ({ ...topic, order })),
  }
}

export function isTocProposalFresh(
  proposal: TocProposal | null,
  evidenceIndex: EvidenceIndex | null,
  groundedAnalysis: ConceptAnalysis | null,
  contentType: string,
): boolean {
  return !!proposal
    && !!evidenceIndex
    && !!groundedAnalysis
    && proposal.contentType === contentType
    && proposal.evidenceSourcesRevision === evidenceIndex.sourcesRevision
    && proposal.evidenceExtractionRevision === evidenceIndex.extractionRevision
    && proposal.groundedAnalysisBuiltAt === groundedAnalysis.builtAt
}

export function normalizeTopicIds<T extends {
  id: number
  title: string
  level: 1 | 2 | 3 | 4
  parentId?: number
  topicId?: string
}>(items: T[]): T[] {
  const topicIdById = new Map(items.map(item => [item.id, item.topicId ?? `legacy-${item.id}`]))
  return items.map((item, order) => ({
    ...item,
    topicId: item.topicId ?? topicIdById.get(item.id)!,
    order,
    parentTopicId: item.parentId !== undefined ? topicIdById.get(item.parentId) : undefined,
  })) as T[]
}