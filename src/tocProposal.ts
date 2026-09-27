import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'
import {
  cleanUserGuideHeading, isUserGuideContentType, organizeHeading, scoreUserGuideEvidence,
} from './tocInformationArchitecture'

export type ProposalTopicKind = 'evidence-backed' | 'optional-structural' | 'manual'

export type TocProposalAssetRef = {
  id: string
  version: number
}

export type AiTocProposalProvenance = {
  providerId: string
  modelId: string
  workflow: TocProposalAssetRef
  promptPack: TocProposalAssetRef
  referenceSet: TocProposalAssetRef
  blueprint: TocProposalAssetRef
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  analysisBuiltAt: number
}

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
  method: 'evidence-grounded-toc-v1' | 'ai-grounded-toc-v1'
  contentType: string
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  groundedAnalysisBuiltAt: number
  generatedAt: number
  items: ProposedTopic[]
  /** Safe configuration and source revision provenance. Never includes prompts, credentials, or provider payloads. */
  aiProvenance?: AiTocProposalProvenance
}

/** Strictly validates proposal data that crosses a recovery/storage trust boundary. */
export function validateTocProposal(value: unknown): asserts value is TocProposal {
  const invalid = (): never => { throw new Error('Invalid TOC recovery proposal.') }
  const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
  const exactKeys = (candidate: Record<string, unknown>, keys: string[]) =>
    Object.keys(candidate).sort().join(',') === [...keys].sort().join(',')
  if (!isObject(value)) invalid()
  const proposal = value as Record<string, unknown>
  if (!exactKeys(proposal, [
      'version', 'method', 'contentType', 'evidenceSourcesRevision',
      'evidenceExtractionRevision', 'groundedAnalysisBuiltAt', 'generatedAt',
      'items', ...(proposal.aiProvenance !== undefined ? ['aiProvenance'] : []),
    ])
    || proposal.version !== 1
    || (proposal.method !== 'evidence-grounded-toc-v1'
      && proposal.method !== 'ai-grounded-toc-v1')
    || typeof proposal.contentType !== 'string' || !proposal.contentType.trim()
    || !Number.isSafeInteger(proposal.evidenceSourcesRevision)
    || (proposal.evidenceSourcesRevision as number) < 0
    || typeof proposal.evidenceExtractionRevision !== 'string'
    || !Number.isFinite(proposal.groundedAnalysisBuiltAt)
    || !Number.isFinite(proposal.generatedAt)
    || !Array.isArray(proposal.items)) invalid()

  const allowedTopicKeys = [
    'id', 'topicId', 'title', 'level', 'words', 'parentId', 'parentTopicId',
    'order', 'rationale', 'supportingEvidenceIds', 'proposalKind',
    'sourceSectionPaths', 'hasGap',
  ]
  const topicIds = new Set<string>()
  const numericIds = new Set<number>()
  for (const candidate of proposal.items as unknown[]) {
    if (!isObject(candidate)
      || Object.keys(candidate).some(key => !allowedTopicKeys.includes(key))
      || !Number.isSafeInteger(candidate.id)
      || (candidate.id as number) < 0
      || typeof candidate.topicId !== 'string' || !candidate.topicId.trim()
      || candidate.topicId.length > 240
      || typeof candidate.title !== 'string' || !candidate.title.trim()
      || candidate.title.length > 5_000
      || ![1, 2, 3, 4].includes(candidate.level as number)
      || typeof candidate.words !== 'number' || !Number.isFinite(candidate.words) || candidate.words < 0
      || !Number.isSafeInteger(candidate.order) || (candidate.order as number) < 0
      || typeof candidate.rationale !== 'string' || candidate.rationale.length > 20_000
      || !Array.isArray(candidate.supportingEvidenceIds)
      || candidate.supportingEvidenceIds.some(id => typeof id !== 'string' || !id || id.length > 240)
      || !['evidence-backed', 'optional-structural', 'manual'].includes(String(candidate.proposalKind))
      || (candidate.parentId !== undefined && (!Number.isSafeInteger(candidate.parentId) || (candidate.parentId as number) < 0))
      || (candidate.parentTopicId !== undefined && (typeof candidate.parentTopicId !== 'string' || candidate.parentTopicId.length > 240))
      || (candidate.sourceSectionPaths !== undefined && (!Array.isArray(candidate.sourceSectionPaths)
        || candidate.sourceSectionPaths.some(path => !Array.isArray(path)
          || path.some(part => typeof part !== 'string' || part.length > 500))))
      || (candidate.hasGap !== undefined && typeof candidate.hasGap !== 'boolean')
      || topicIds.has(candidate.topicId as string)
      || numericIds.has(candidate.id as number)) invalid()
    const validCandidate = candidate as Record<string, unknown>
    topicIds.add(validCandidate.topicId as string)
    numericIds.add(validCandidate.id as number)
  }

  if (proposal.method === 'ai-grounded-toc-v1') {
    const provenance = proposal.aiProvenance
    const validReference = (reference: unknown): boolean => isObject(reference)
      && exactKeys(reference, ['id', 'version'])
      && typeof reference.id === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(reference.id)
      && Number.isSafeInteger(reference.version)
      && (reference.version as number) > 0
    if (!isObject(provenance)
      || !exactKeys(provenance, [
        'providerId', 'modelId', 'workflow', 'promptPack', 'referenceSet',
        'blueprint', 'evidenceSourcesRevision', 'evidenceExtractionRevision',
        'analysisBuiltAt',
      ])
      || typeof provenance.providerId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(provenance.providerId)
      || typeof provenance.modelId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(provenance.modelId)
      || !validReference(provenance.workflow)
      || !validReference(provenance.promptPack)
      || !validReference(provenance.referenceSet)
      || !validReference(provenance.blueprint)
      || !Number.isSafeInteger(provenance.evidenceSourcesRevision)
      || (provenance.evidenceSourcesRevision as number) < 0
      || typeof provenance.evidenceExtractionRevision !== 'string'
      || !provenance.evidenceExtractionRevision
      || !Number.isFinite(provenance.analysisBuiltAt)
      || provenance.evidenceSourcesRevision !== proposal.evidenceSourcesRevision
      || provenance.evidenceExtractionRevision !== proposal.evidenceExtractionRevision
      || provenance.analysisBuiltAt !== proposal.groundedAnalysisBuiltAt) invalid()
  } else if (proposal.aiProvenance !== undefined) {
    invalid()
  }
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

const GUIDE_ACTIONS = 'navigate|browse|search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|receive|configure|set up|troubleshoot|recover|sign in|log in|install|save|select|choose|click'
const MAX_USER_GUIDE_TITLE_LENGTH = 120

type UserGuideSeed = {
  title: string
  group: string
  level: 2 | 3
  evidenceIds: string[]
  paths: string[][]
  sourceId: string
  order: number
  parentTitle?: string
}

function userGuideActionTitle(text: string): string | null {
  const clean = cleanUserGuideHeading(text)
  const taskPattern = new RegExp(
    `\\b(?:users?|you|readers?)\\s+(?:(?:can|may|must|should|will|need to)\\s+)?((?:${GUIDE_ACTIONS})\\b[^.!?\\n]{0,90})`,
    'i',
  )
  const task = clean.match(taskPattern)?.[1]
    ?? clean.match(new RegExp(`^(?:how to\\s+)?((?:${GUIDE_ACTIONS})\\b[^.!?\\n]{0,75})`, 'i'))?.[1]
  if (!task) return null
  const title = task.trim().replace(/\btheir\b/gi, 'your').replace(/[.:;,\s]+$/, '')
  return title ? title[0].toLocaleUpperCase('en-US') + title.slice(1) : null
}

function isUserGuideStatedTask(text: string): boolean {
  return /\b(?:users?|you|readers?)\s+(?:(?:can|may|must|should|will|need to)\s+)?(?:navigate|browse|search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|receive|configure|set up|troubleshoot|recover|sign in|log in|install|save|select|choose|click)\b/i.test(text)
}

function isExplicitUserGuideTaskHeading(text: string): boolean {
  const heading = cleanUserGuideHeading(text)
  return /^(?:how to\s+)?(?:sign in|log in|install|troubleshoot|recover)\b/i.test(heading)
    || /^(?:search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|navigate|browse|install|save|select|choose|click)\b.{0,65}\b(?:cases?|evidence|files?|records?|reports?|workspace|dashboard|profile|notifications?|account|projects?|documents?|requests?|attachments?|results?|app|software|by|for|in|using|with)\b/i.test(heading)
}

function isUserGuideInstruction(text: string): boolean {
  return /^(?:click|select|choose|open|enter|type|press|selecting|clicking)\b/i.test(cleanUserGuideHeading(text))
}

function userGuideGroup(value: string): string {
  const text = value.toLocaleLowerCase('en-US')
  if (/\b(troubleshoot|error|issue|problem|recover|recovery)\b/.test(text)) return 'Troubleshoot issues'
  if (/\b(notification|profile|preferences?)\b/.test(text)) return 'Notifications and profile'
  if (/\b(report|export|download|share)\b/.test(text)) return 'Reports and exports'
  if (/\b(search|find|filter)\b/.test(text)) return 'Search and find information'
  if (/\b(case|evidence|attachment|record|request)\b/.test(text)) return 'Work with cases and evidence'
  if (/\b(navigate|navigation|browse|workspace|dashboard)\b/.test(text)) return 'Navigate the workspace'
  if (/\b(sign in|log in|install|get started|first steps?)\b/.test(text)) return 'Get started'
  return 'Complete common workflows'
}

function userGuideEvidencePaths(items: EvidenceItem[]): string[][] {
  return uniquePaths(items.flatMap(item =>
    item.sectionPath?.length ? [[...item.sectionPath]] : [],
  ).filter(path => path.length > 0))
}

function boundedUserGuideTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title
  if (maxLength <= 1) return title.slice(0, maxLength)
  return `${title.slice(0, maxLength - 1).trimEnd()}…`
}

function guideLocalEvidence(heading: EvidenceItem, index: EvidenceIndex): EvidenceItem[] {
  return localSectionEvidence(heading, index)
    .filter(item => scoreUserGuideEvidence(item) >= 0)
}

function guideHeadingParent(
  heading: EvidenceItem,
  candidates: Map<string, UserGuideSeed>,
  index: EvidenceIndex,
): UserGuideSeed | undefined {
  const path = heading.sectionPath?.map(normalized) ?? []
  const headingParents = headingItems(index)
    .filter(item => item.sourceId === heading.sourceId
      && item.order < heading.order
      && (item.headingLevel ?? 1) <= 2)
    .sort((left, right) => right.order - left.order)
  for (const parent of headingParents) {
    const parentPath = parent.sectionPath?.map(normalized) ?? []
    if (parentPath.length && path.length
      && parentPath.length < path.length
      && parentPath.every((part, position) => part === path[position])) {
      const action = userGuideActionTitle([parent.text, ...guideLocalEvidence(parent, index).map(item => item.text)].join(' '))
      if (action) {
        const candidate = candidates.get(`${parent.sourceId}:${parent.id}`)
        if (candidate) return candidate
      }
    }
  }
  return undefined
}

function buildUserGuideProposal(
  evidenceIndex: EvidenceIndex,
  groundedAnalysis: ConceptAnalysis,
  contentType: string,
): TocProposal {
  const headings = headingItems(evidenceIndex)
  const headingSectionKeys = new Set(headings.filter(heading => heading.sectionPath?.length).map(heading =>
    `${heading.sourceId}:${(heading.sectionPath ?? []).map(normalized).join('>')}`,
  ))
  const seeds: UserGuideSeed[] = []
  const byTitle = new Map<string, UserGuideSeed>()
  const parentCandidates = new Map<string, UserGuideSeed>()

  const addSeed = (heading: EvidenceItem, local: EvidenceItem[], preferredTitle?: string) => {
    if (scoreUserGuideEvidence(heading) < 0) return
    const actionItems = [heading, ...local].filter(item =>
      scoreUserGuideEvidence(item) >= 0 && userGuideActionTitle(item.text) !== null,
    )
    const statedAction = actionItems.find(item => isUserGuideStatedTask(item.text))
    const taskHeading = isExplicitUserGuideTaskHeading(heading.text)
      ? userGuideActionTitle(heading.text) : null
    const instruction = actionItems.find(item => item !== heading && isUserGuideInstruction(item.text))
    const title = preferredTitle
      ?? (statedAction ? userGuideActionTitle(statedAction.text) : null)
      ?? taskHeading
      ?? (instruction ? userGuideActionTitle(instruction.text) : null)
    if (!title) return

    const isSubtask = (heading.headingLevel ?? 2) >= 3
    const parentSeed = isSubtask ? guideHeadingParent(heading, parentCandidates, evidenceIndex) : undefined
    const parentTitle = parentSeed?.title
    const subject = cleanUserGuideHeading(heading.text)
    const group = parentSeed?.group
      ?? userGuideGroup(`${title} ${subject} ${(heading.sectionPath ?? []).join(' ')}`)
    const level: 2 | 3 = parentTitle ? 3 : 2
    const related = unique([
      heading.id,
      ...actionItems.map(item => item.id),
    ])
    const relatedItems = [heading, ...actionItems]
    const key = `${level}:${normalized(group)}:${normalized(parentTitle ?? '')}:${normalized(title)}`
    const existing = byTitle.get(key)
    if (existing) {
      existing.evidenceIds = unique([...existing.evidenceIds, ...related])
      existing.paths = uniquePaths([...existing.paths, ...userGuideEvidencePaths(relatedItems)])
      existing.order = Math.min(existing.order, heading.order)
      if (level === 2) parentCandidates.set(`${heading.sourceId}:${heading.id}`, existing)
      return
    }

    const seed: UserGuideSeed = {
      title: title[0].toLocaleUpperCase('en-US') + title.slice(1),
      group,
      level,
      evidenceIds: related,
      paths: userGuideEvidencePaths(relatedItems),
      sourceId: heading.sourceId,
      order: heading.order,
      parentTitle,
    }
    byTitle.set(key, seed)
    seeds.push(seed)
    if (level === 2) parentCandidates.set(`${heading.sourceId}:${heading.id}`, seed)
  }

  for (const heading of headings) {
    const cleaned = cleanUserGuideHeading(heading.text)
    if (!cleaned || scoreUserGuideEvidence(heading) < 0) continue
    const local = guideLocalEvidence(heading, evidenceIndex)
    addSeed(heading, local)
  }

  // Walkthrough transcripts often contain useful procedures without formal
  // headings. Use only explicit user actions from those blocks as candidates.
  for (const item of evidenceIndex.items) {
    if (item.blockType === 'heading' || scoreUserGuideEvidence(item) < 0) continue
    if (headingSectionKeys.has(`${item.sourceId}:${(item.sectionPath ?? []).map(normalized).join('>')}`)) {
      continue
    }
    const title = userGuideActionTitle(item.text)
    if (!title) continue
    addSeed(item, [], title)
  }

  const groups = unique(seeds.map(seed => seed.group)).sort((left, right) => {
    const order = [
      'Get started', 'Navigate the workspace', 'Search and find information',
      'Work with cases and evidence', 'Complete common workflows',
      'Reports and exports', 'Notifications and profile', 'Troubleshoot issues',
    ]
    return order.indexOf(left) - order.indexOf(right) || left.localeCompare(right)
  })
  const topics: ProposedTopic[] = []
  const add = (input: Omit<ProposedTopic, 'id' | 'order'>): ProposedTopic => {
    const topic: ProposedTopic = {
      ...input,
      id: stableNumber(input.topicId),
      order: topics.length,
    }
    topics.push(topic)
    return topic
  }

  for (const group of groups) {
    const members = seeds
      .filter(seed => seed.group === group)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
    const rootId = `ia-user-guide-${stableHash(normalized(group))}`
    const root = add({
      topicId: rootId,
      title: group,
      level: 1,
      words: 0,
      rationale: `User-facing tasks in this capability group are supported by the cited source evidence.`,
      supportingEvidenceIds: unique(members.flatMap(seed => seed.evidenceIds)),
      proposalKind: 'evidence-backed',
      sourceSectionPaths: uniquePaths(members.flatMap(seed => seed.paths)),
    })
    const parentIds = new Map<string, ProposedTopic>()
    for (const seed of members.filter(item => item.level === 2)) {
      const topic = add({
        topicId: `heading-${stableHash(`${normalized(group)} ${normalized(seed.title)}`)}`,
        title: seed.title,
        level: 2,
        words: 0,
        parentId: root.id,
        parentTopicId: root.topicId,
        rationale: `This user task is supported by local action evidence in the cited source sections.`,
        supportingEvidenceIds: seed.evidenceIds,
        proposalKind: 'evidence-backed',
        sourceSectionPaths: seed.paths,
      })
      parentIds.set(normalized(seed.title), topic)
    }
    for (const seed of members.filter(item => item.level === 3 && item.parentTitle)) {
      const parent = parentIds.get(normalized(seed.parentTitle!))
      if (!parent) continue
      add({
        topicId: `procedure-${stableHash(`${group} ${normalized(seed.parentTitle!)} ${normalized(seed.title)}`)}`,
        title: seed.title,
        level: 3,
        words: 0,
        parentId: parent.id,
        parentTopicId: parent.topicId,
        rationale: `This procedure is supported by local action evidence in the cited source sections.`,
        supportingEvidenceIds: seed.evidenceIds,
        proposalKind: 'evidence-backed',
        sourceSectionPaths: seed.paths,
      })
    }
  }

  const usedTitles = new Set<string>()
  const titlesById = new Map(topics.map(topic => [topic.id, topic.title]))
  for (const topic of topics) {
    const originalTitle = boundedUserGuideTitle(topic.title, MAX_USER_GUIDE_TITLE_LENGTH)
    topic.title = originalTitle
    let candidate = originalTitle
    if (usedTitles.has(normalized(candidate))) {
      const context = topic.parentId === undefined ? 'section' : titlesById.get(topic.parentId) ?? 'section'
      const kind = topic.level === 3 ? 'step' : 'task'
      const shortContext = boundedUserGuideTitle(context, 32)
      const hash = stableHash(topic.topicId)
      const suffix = ` (${kind} in ${shortContext} #${hash})`
      candidate = `${boundedUserGuideTitle(originalTitle, MAX_USER_GUIDE_TITLE_LENGTH - suffix.length)}${suffix}`
      let disambiguator = 2
      while (usedTitles.has(normalized(candidate))) {
        const uniqueSuffix = ` (${kind} ${hash}-${disambiguator})`
        candidate = `${boundedUserGuideTitle(originalTitle, MAX_USER_GUIDE_TITLE_LENGTH - uniqueSuffix.length)}${uniqueSuffix}`
        disambiguator++
      }
      topic.title = candidate
      titlesById.set(topic.id, candidate)
    }
    usedTitles.add(normalized(topic.title))
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

export function buildTocProposal(
  evidenceIndex: EvidenceIndex,
  groundedAnalysis: ConceptAnalysis,
  contentType: string,
): TocProposal {
  if (isUserGuideContentType(contentType))
    return buildUserGuideProposal(evidenceIndex, groundedAnalysis, contentType)

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