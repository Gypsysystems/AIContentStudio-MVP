import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'

export const CONCEPT_ANALYSIS_METHOD = 'deterministic-evidence-heuristics-v1' as const

export type AnalysisEvidenceReference = {
  evidenceId: string
  sourceId: string
  fileId: string
  sourceFileName: string
  location: string
}

export type GroundedConcept = {
  id: string
  label: string
  exactTerms: string[]
  occurrenceCount: number
  sourceCount: number
  evidenceIds: string[]
  evidenceRefs: AnalysisEvidenceReference[]
}

export type GroundedTerm = {
  id: string
  normalizedLabel: string
  exactTerms: string[]
  occurrenceCount: number
  sourceCount: number
  evidenceIds: string[]
  evidenceRefs: AnalysisEvidenceReference[]
}

export type ConceptAnalysis = {
  version: 1
  method: typeof CONCEPT_ANALYSIS_METHOD
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  builtAt: number
  concepts: GroundedConcept[]
  terminology: GroundedTerm[]
}

type CandidateAggregate = {
  normalizedKey: string
  variants: Map<string, number>
  occurrenceCount: number
  evidenceIds: Set<string>
}

const GENERIC_LABELS = new Set([
  'about',
  'appendix',
  'background',
  'conclusion',
  'contents',
  'document',
  'example',
  'examples',
  'guide',
  'introduction',
  'note',
  'notes',
  'overview',
  'purpose',
  'reference',
  'references',
  'summary',
  'table of contents',
])

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`([{]+|[\s"'`\])},.;:!?]+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedKey(value: string): string {
  return cleanCandidate(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
}

function isReliableCandidate(value: string): boolean {
  const cleaned = cleanCandidate(value)
  if (cleaned.length < 2 || cleaned.length > 80) return false
  const key = normalizedKey(cleaned)
  if (!key || GENERIC_LABELS.has(key)) return false
  if (!/[A-Za-z0-9]/.test(cleaned)) return false
  const words = cleaned.split(/\s+/)
  if (words.length > 6) return false
  return true
}

function candidateTerms(item: EvidenceItem): string[] {
  const candidates = new Set<string>()
  const add = (value: string) => {
    const cleaned = cleanCandidate(value)
    if (isReliableCandidate(cleaned)) candidates.add(cleaned)
  }

  if (item.blockType === 'heading') add(item.text)

  for (const match of item.text.matchAll(/`([^`\n]{2,80})`/g)) add(match[1])
  for (const match of item.text.matchAll(/["“]([^"”\n]{2,80})["”]/g)) add(match[1])
  for (const match of item.text.matchAll(/\b[A-Z][A-Z0-9]{1,9}\b/g)) add(match[0])
  for (const match of item.text.matchAll(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g)) add(match[0])
  for (const match of item.text.matchAll(
    /\b[A-Z][A-Za-z0-9+.#/-]*(?:\s+(?:(?:of|and|for|to|in|on|the)|[A-Z][A-Za-z0-9+.#/-]*)){1,5}\b/g,
  )) add(match[0])

  if (item.tableData?.length) {
    for (const cell of item.tableData[0]) add(cell)
  }

  return [...candidates]
}

function countOccurrences(text: string, candidate: string): number {
  const haystack = text.toLocaleLowerCase('en-US')
  const needle = candidate.toLocaleLowerCase('en-US')
  if (!needle) return 0
  let count = 0
  let cursor = 0
  while (cursor < haystack.length) {
    const found = haystack.indexOf(needle, cursor)
    if (found === -1) break
    count++
    cursor = found + needle.length
  }
  return count
}

function referenceFor(item: EvidenceItem): AnalysisEvidenceReference {
  return {
    evidenceId: item.id,
    sourceId: item.sourceId,
    fileId: item.fileId,
    sourceFileName: item.sourceFileName,
    location: item.location,
  }
}

function preferredVariant(aggregate: CandidateAggregate): string {
  return [...aggregate.variants.entries()]
    .sort(([leftValue, leftCount], [rightValue, rightCount]) =>
      rightCount - leftCount || leftValue.localeCompare(rightValue))
    [0][0]
}

function refsFor(
  evidenceIds: string[],
  evidenceById: Map<string, EvidenceItem>,
): AnalysisEvidenceReference[] {
  return evidenceIds.flatMap(id => {
    const item = evidenceById.get(id)
    return item ? [referenceFor(item)] : []
  })
}

export function buildConceptAnalysis(evidenceIndex: EvidenceIndex): ConceptAnalysis {
  const aggregates = new Map<string, CandidateAggregate>()
  const headingKeys = new Set<string>()
  const evidenceById = new Map(evidenceIndex.items.map(item => [item.id, item]))

  for (const item of evidenceIndex.items) {
    const candidates = candidateTerms(item)
    for (const candidate of candidates) {
      const key = normalizedKey(candidate)
      if (!key) continue
      const aggregate = aggregates.get(key) ?? {
        normalizedKey: key,
        variants: new Map<string, number>(),
        occurrenceCount: 0,
        evidenceIds: new Set<string>(),
      }
      const occurrences = Math.max(1, countOccurrences(item.text, candidate))
      aggregate.occurrenceCount += occurrences
      aggregate.variants.set(candidate, (aggregate.variants.get(candidate) ?? 0) + occurrences)
      aggregate.evidenceIds.add(item.id)
      aggregates.set(key, aggregate)
      if (item.blockType === 'heading' && normalizedKey(item.text) === key) headingKeys.add(key)
    }
  }

  const terminology: GroundedTerm[] = [...aggregates.values()].map(aggregate => {
    const evidenceIds = [...aggregate.evidenceIds]
    const refs = refsFor(evidenceIds, evidenceById)
    return {
      id: `term-${stableHash(aggregate.normalizedKey)}`,
      normalizedLabel: preferredVariant(aggregate),
      exactTerms: [...aggregate.variants.keys()].sort((a, b) => a.localeCompare(b)),
      occurrenceCount: aggregate.occurrenceCount,
      sourceCount: new Set(refs.map(ref => ref.fileId)).size,
      evidenceIds,
      evidenceRefs: refs,
    }
  }).sort((left, right) =>
    right.occurrenceCount - left.occurrenceCount
    || left.normalizedLabel.localeCompare(right.normalizedLabel))

  const concepts: GroundedConcept[] = terminology
    .filter(term => {
      const key = normalizedKey(term.normalizedLabel)
      const multiWord = term.normalizedLabel.trim().split(/\s+/).length >= 2
      return headingKeys.has(key) || (multiWord && term.occurrenceCount >= 2)
    })
    .map(term => ({
      id: `concept-${stableHash(normalizedKey(term.normalizedLabel))}`,
      label: term.normalizedLabel,
      exactTerms: [...term.exactTerms],
      occurrenceCount: term.occurrenceCount,
      sourceCount: term.sourceCount,
      evidenceIds: [...term.evidenceIds],
      evidenceRefs: term.evidenceRefs.map(ref => ({ ...ref })),
    }))
    .sort((left, right) =>
      right.sourceCount - left.sourceCount
      || right.occurrenceCount - left.occurrenceCount
      || left.label.localeCompare(right.label))

  return {
    version: 1,
    method: CONCEPT_ANALYSIS_METHOD,
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    builtAt: Date.now(),
    concepts,
    terminology,
  }
}

export function isConceptAnalysisFresh(
  analysis: ConceptAnalysis | null,
  evidenceIndex: EvidenceIndex | null,
): boolean {
  return !!analysis
    && !!evidenceIndex
    && analysis.evidenceSourcesRevision === evidenceIndex.sourcesRevision
    && analysis.evidenceExtractionRevision === evidenceIndex.extractionRevision
}

export function remapConceptAnalysis(
  analysis: ConceptAnalysis | null,
  fileIdMap: Record<string, string>,
  remappedEvidenceIndex: EvidenceIndex | null,
  wasFresh: boolean,
): ConceptAnalysis | null {
  if (!analysis) return null
  const copiedEvidenceById = new Map(
    (remappedEvidenceIndex?.items ?? []).map(item => [item.id, item]),
  )
  const remapRefs = (
    evidenceIds: string[],
    refs: AnalysisEvidenceReference[],
  ): AnalysisEvidenceReference[] => evidenceIds.flatMap(evidenceId => {
    const copiedEvidence = copiedEvidenceById.get(evidenceId)
    if (copiedEvidence) return [referenceFor(copiedEvidence)]
    const originalRef = refs.find(ref => ref.evidenceId === evidenceId)
    if (!originalRef) return []
    const copiedFileId = fileIdMap[originalRef.fileId] ?? fileIdMap[originalRef.sourceId]
    if (!copiedFileId) return []
    return [{ ...originalRef, sourceId: copiedFileId, fileId: copiedFileId }]
  })
  const concepts = analysis.concepts.map(concept => ({
    ...concept,
    exactTerms: [...concept.exactTerms],
    evidenceIds: [...concept.evidenceIds],
    evidenceRefs: remapRefs(concept.evidenceIds, concept.evidenceRefs),
  }))
  const terminology = analysis.terminology.map(term => ({
    ...term,
    exactTerms: [...term.exactTerms],
    evidenceIds: [...term.evidenceIds],
    evidenceRefs: remapRefs(term.evidenceIds, term.evidenceRefs),
  }))

  return {
    ...analysis,
    concepts,
    terminology,
    evidenceSourcesRevision: wasFresh && remappedEvidenceIndex
      ? remappedEvidenceIndex.sourcesRevision
      : analysis.evidenceSourcesRevision,
    evidenceExtractionRevision: wasFresh && remappedEvidenceIndex
      ? remappedEvidenceIndex.extractionRevision
      : analysis.evidenceExtractionRevision,
  }
}