import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'
import { organizeHeading } from './tocInformationArchitecture'

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

function localSectionEvidence(heading: EvidenceItem, index: EvidenceIndex): EvidenceItem[] {
  const path = heading.sectionPath
  if (path?.length) {
    return index.items.filter(item =>
      item.sourceId === heading.sourceId
      && item.blockType !== 'heading'
      && item.sectionPath?.length === path.length
      && path.every((part, position) => normalized(part) === normalized(item.sectionPath![position])),
    )
  }
  const nextHeading = headingItems(index).find(item => item.sourceId === heading.sourceId && item.order > heading.order)
  return index.items.filter(item =>
    item.sourceId === heading.sourceId
    && item.blockType !== 'heading'
    && item.order > heading.order
    && (nextHeading === undefined || item.order < nextHeading.order),
  )
}

function uniquePaths(paths: string[][]): string[][] {
  return unique(paths.map(path => JSON.stringify(path))).map(path => JSON.parse(path) as string[])
}

export function buildTocProposal(
  evidenceIndex: EvidenceIndex,
  groundedAnalysis: ConceptAnalysis,
  contentType: string,
): TocProposal {
  const topics: ProposedTopic[] = []
  type HeadingSeed = {
    heading: EvidenceItem
    title: string
    section: string
    sectionOrder: number
    intent: string
    evidenceIds: string[]
    paths: string[][]
  }
  const headingByTitle = new Map<string, HeadingSeed>()

  const add = (
    input: Omit<ProposedTopic, 'id' | 'order'> & { id?: number },
  ): ProposedTopic => {
    const topic: ProposedTopic = {
      ...input,
      id: input.id ?? stableNumber(input.topicId),
      order: topics.length,
    }
    topics.push(topic)
    return topic
  }

  for (const heading of headingItems(evidenceIndex)) {
    const titleKey = normalized(heading.text)
    const nearby = localSectionEvidence(heading, evidenceIndex)
    const evidenceIds = unique([heading.id, ...nearby.map(item => item.id)])
    const paths = heading.sectionPath ? [[...heading.sectionPath]] : []
    if (headingByTitle.has(titleKey)) {
      const existing = headingByTitle.get(titleKey)!
      existing.evidenceIds = unique([...existing.evidenceIds, ...evidenceIds])
      existing.paths = uniquePaths([...existing.paths, ...paths])
      continue
    }
    const organized = organizeHeading(heading, nearby, contentType)
    headingByTitle.set(titleKey, {
      heading,
      ...organized,
      evidenceIds,
      paths,
    })
  }

  const seeds = [...headingByTitle.values()]
  const sections = unique(seeds.map(seed => seed.section)).sort((left, right) =>
    seeds.find(seed => seed.section === left)!.sectionOrder
      - seeds.find(seed => seed.section === right)!.sectionOrder)
  for (const section of sections) {
    const members = seeds.filter(seed => seed.section === section)
    const root = add({
      topicId: `ia-${normalized(contentType).replace(/\s+/g, '-')}-${stableHash(normalized(section))}`,
      title: section,
      level: 1,
      words: 0,
      rationale: `${contentTypeLabel(contentType)} grouping supported by source sections: ${members.map(seed => seed.heading.text.trim()).join(', ')}. It is not an unsupported generic feature claim.`,
      supportingEvidenceIds: unique(members.flatMap(seed => seed.evidenceIds)),
      proposalKind: 'evidence-backed',
      sourceSectionPaths: uniquePaths(members.flatMap(seed => seed.paths)),
    })
    for (const seed of members) {
      add({
        topicId: `heading-${stableHash(normalized(seed.heading.text))}`,
        title: seed.title,
        level: 2,
        words: 0,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: `The source heading "${seed.heading.text.trim()}"${seed.paths.length ? ` at ${seed.paths.map(path => path.join(' › ')).join('; ')}` : ''} and its local evidence support a ${contentTypeLabel(contentType)} ${seed.intent} topic. Source wording is retained as context, not copied as the final TOC.`,
        supportingEvidenceIds: seed.evidenceIds,
        proposalKind: 'evidence-backed',
        sourceSectionPaths: seed.paths,
      })
    }
  }

  const conceptOnly = groundedAnalysis.concepts.filter(concept => !headingByTitle.has(normalized(concept.label)))
  if (conceptOnly.length > 0) {
    const userGuide = normalized(contentType) === 'user guide'
    const rootTitle = userGuide ? 'Key concepts' : 'Core concepts'
    const root = topics.find(topic => topic.level === 1 && topic.title === rootTitle) ?? add({
      topicId: `structural-${normalized(contentType).replace(/\s+/g, '-')}-concepts`,
      title: rootTitle,
      level: 1,
      words: 0,
      rationale: `Optional structural grouping for ${contentTypeLabel(contentType)} concepts supported by source content but not by source headings.`,
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    })
    for (const concept of conceptOnly) {
      const evidence = evidenceForConcept(concept, evidenceIndex)
      add({
        topicId: `concept-${stableHash(normalized(concept.label))}`,
        title: userGuide ? `Understand ${concept.label}` : concept.label,
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