import type { EvidenceIndex } from '../src/evidenceIndex'
import { buildTocProposal, type ProposedTopic } from '../src/tocProposal'
import type { ConceptAnalysis } from '../src/conceptAnalysis'

export type GeneratedTocClassification = 'evidence-backed' | 'optional-structural'

export type GeneratedTocItem = {
  key: string
  title: string
  level: 1 | 2 | 3 | 4
  parentKey: string | null
  rationale: string
  classification: GeneratedTocClassification
  supportingEvidenceIds: string[]
}

export type GeneratedTocDocument = {
  items: GeneratedTocItem[]
}

export class GroundedTocOutputError extends Error {
  readonly code = 'INVALID_OUTPUT' as const

  constructor() {
    super('The provider output is not a valid evidence-grounded TOC proposal.')
    this.name = 'GroundedTocOutputError'
  }
}

const MAX_ITEMS = 60
const MAX_KEY_LENGTH = 60
const MAX_TITLE_LENGTH = 120
const MAX_RATIONALE_LENGTH = 1_200
const MAX_EVIDENCE_IDS = 20
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalized(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function parseDocument(raw: string): unknown {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 64_000)
    throw new GroundedTocOutputError()
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new GroundedTocOutputError()
  }
}

function validateItem(value: unknown): GeneratedTocItem {
  if (!isRecord(value)
    || !exactKeys(value, [
      'key', 'title', 'level', 'parentKey', 'rationale', 'classification', 'supportingEvidenceIds',
    ])
    || typeof value.key !== 'string' || value.key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(value.key)
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_TITLE_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value.title)
    || typeof value.level !== 'number' || !Number.isInteger(value.level) || value.level < 1 || value.level > 4
    || !(value.parentKey === null || (typeof value.parentKey === 'string' && KEY_PATTERN.test(value.parentKey)))
    || typeof value.rationale !== 'string' || !value.rationale.trim() || value.rationale.length > MAX_RATIONALE_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value.rationale)
    || (value.classification !== 'evidence-backed' && value.classification !== 'optional-structural')
    || !Array.isArray(value.supportingEvidenceIds) || value.supportingEvidenceIds.length > MAX_EVIDENCE_IDS
    || value.supportingEvidenceIds.some(id => typeof id !== 'string' || id.length > 120)) {
    throw new GroundedTocOutputError()
  }
  const evidenceIds = value.supportingEvidenceIds as string[]
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new GroundedTocOutputError()
  if (value.classification === 'evidence-backed' && evidenceIds.length === 0)
    throw new GroundedTocOutputError()
  if (value.classification === 'optional-structural' && evidenceIds.length !== 0)
    throw new GroundedTocOutputError()
  return {
    key: value.key,
    title: value.title.trim(),
    level: value.level as 1 | 2 | 3 | 4,
    parentKey: value.parentKey as string | null,
    rationale: value.rationale.trim(),
    classification: value.classification,
    supportingEvidenceIds: evidenceIds,
  }
}

function validateHierarchy(items: GeneratedTocItem[]): void {
  const byKey = new Map(items.map(item => [item.key, item]))
  if (byKey.size !== items.length) throw new GroundedTocOutputError()
  for (const item of items) {
    if (item.level === 1) {
      if (item.parentKey !== null) throw new GroundedTocOutputError()
      continue
    }
    if (!item.parentKey) throw new GroundedTocOutputError()
    const parent = byKey.get(item.parentKey)
    if (!parent || parent.level !== item.level - 1) throw new GroundedTocOutputError()
  }
  for (const item of items) {
    const seen = new Set<string>()
    let cursor: GeneratedTocItem | undefined = item
    while (cursor?.parentKey) {
      if (seen.has(cursor.key)) throw new GroundedTocOutputError()
      seen.add(cursor.key)
      cursor = byKey.get(cursor.parentKey)
    }
    if (cursor && cursor !== item && cursor.level !== 1) throw new GroundedTocOutputError()
  }
}

function validateGrounding(
  items: GeneratedTocItem[],
  evidenceIndex: EvidenceIndex,
  candidates: ProposedTopic[],
): void {
  const evidenceIds = new Set(evidenceIndex.items.map(item => item.id))
  const groundedCandidates = new Map<string, { topicId: string; evidenceIds: Set<string>; rationale: string }>()
  const optionalCandidates = new Map<string, { topicId: string; evidenceIds: Set<string>; rationale: string }>()
  for (const candidate of candidates) {
    const key = normalized(candidate.title)
    if (candidate.proposalKind === 'evidence-backed' && candidate.supportingEvidenceIds.length) {
      const current = groundedCandidates.get(key)
      if (current && current.topicId !== candidate.topicId) throw new GroundedTocOutputError()
      if (optionalCandidates.has(key)) throw new GroundedTocOutputError()
      const resolved = current ?? {
        topicId: candidate.topicId,
        evidenceIds: new Set<string>(),
        rationale: candidate.rationale,
      }
      for (const id of candidate.supportingEvidenceIds) resolved.evidenceIds.add(id)
      groundedCandidates.set(key, resolved)
    } else if (candidate.proposalKind === 'optional-structural') {
      const current = optionalCandidates.get(key)
      if (current && current.topicId !== candidate.topicId) throw new GroundedTocOutputError()
      if (groundedCandidates.has(key)) throw new GroundedTocOutputError()
      optionalCandidates.set(key, {
        topicId: candidate.topicId,
        evidenceIds: new Set(candidate.supportingEvidenceIds),
        rationale: candidate.rationale,
      })
    }
  }

  const usedCandidateIds = new Set<string>()
  const usedCandidateTitles = new Set<string>()
  for (const item of items) {
    const titleKey = normalized(item.title)
    if (item.supportingEvidenceIds.some(id => !evidenceIds.has(id)))
      throw new GroundedTocOutputError()
    if (usedCandidateTitles.has(titleKey)) throw new GroundedTocOutputError()
    usedCandidateTitles.add(titleKey)
    if (item.classification === 'evidence-backed') {
      const candidate = groundedCandidates.get(titleKey)
      if (!candidate
        || usedCandidateIds.has(candidate.topicId)
        || item.supportingEvidenceIds.some(id => !candidate.evidenceIds.has(id))) {
        throw new GroundedTocOutputError()
      }
      usedCandidateIds.add(candidate.topicId)
      item.rationale = candidate.rationale
    } else if (!optionalCandidates.has(titleKey) || groundedCandidates.has(titleKey)) {
      throw new GroundedTocOutputError()
    } else {
      const candidate = optionalCandidates.get(titleKey)!
      if (usedCandidateIds.has(candidate.topicId)) throw new GroundedTocOutputError()
      usedCandidateIds.add(candidate.topicId)
      item.rationale = candidate.rationale
    }
  }
}

export function validateGroundedTocOutput(
  raw: string,
  evidenceIndex: EvidenceIndex,
  analysis: ConceptAnalysis,
  contentType: string,
): GeneratedTocDocument {
  const parsed = parseDocument(raw)
  if (!isRecord(parsed) || !exactKeys(parsed, ['items'])
    || !Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > MAX_ITEMS) {
    throw new GroundedTocOutputError()
  }
  const items = parsed.items.map(validateItem)
  validateHierarchy(items)
  const candidates = buildTocProposal(evidenceIndex, analysis, contentType).items
  validateGrounding(items, evidenceIndex, candidates)
  return { items }
}

export function groundedTocOutputIsMalformed(error: unknown): boolean {
  return error instanceof GroundedTocOutputError
}