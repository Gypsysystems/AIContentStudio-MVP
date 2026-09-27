import { expect, test } from '@playwright/test'
import { GroundedTocOutputError, validateGroundedTocOutput } from '../../server/groundedTocOutput'
import { buildTocProposal } from '../../src/tocProposal'
import type { ConceptAnalysis } from '../../src/conceptAnalysis'
import type { EvidenceIndex } from '../../src/evidenceIndex'

const evidenceIndex = {
  items: [{
    id: 'ev-heading',
    sourceId: 'source',
    fileId: 'source',
    blockId: 'block',
    sourceFileName: 'guide.txt',
    text: 'Accounts',
    blockType: 'heading',
    headingLevel: 1,
    order: 0,
    location: 'Accounts',
    sectionPath: ['Accounts'],
  }],
  sourcesRevision: 3,
  extractionRevision: 'extract-3-sample',
  builtAt: 10,
} satisfies EvidenceIndex

const analysis = {
  version: 2,
  method: 'deterministic-evidence-heuristics-v1',
  evidenceSourcesRevision: 3,
  evidenceExtractionRevision: 'extract-3-sample',
  builtAt: 20,
  concepts: [{
    id: 'concept-accounts',
    label: 'Accounts',
    exactTerms: ['Accounts'],
    occurrenceCount: 1,
    sourceCount: 1,
    evidenceIds: ['ev-heading'],
    evidenceRefs: [],
  }],
  terminology: [],
  conflicts: [],
  gaps: [],
} satisfies ConceptAnalysis

const candidate = buildTocProposal(evidenceIndex, analysis, 'Admin Guide').items
  .find(item => item.proposalKind === 'evidence-backed')!

function document(items: unknown[]): string {
  return JSON.stringify({ items })
}

function evidenceItem(overrides: Record<string, unknown> = {}) {
  return {
    key: 'accounts',
    title: candidate.title,
    level: 1,
    parentKey: null,
    rationale: 'Derived from the source heading.',
    classification: 'evidence-backed',
    supportingEvidenceIds: ['ev-heading'],
    ...overrides,
  }
}

test('accepts bounded structured output for a server-derived candidate with supplied evidence', () => {
  const result = validateGroundedTocOutput(document([evidenceItem()]), evidenceIndex, analysis, 'Admin Guide')
  expect(result.items[0]).toMatchObject({
    title: candidate.title,
    classification: 'evidence-backed',
    supportingEvidenceIds: ['ev-heading'],
    rationale: candidate.rationale,
  })
})

test('does not persist model-authored factual rationale for a valid evidence-backed title', () => {
  const misleadingRationale = 'The source proves every account can export all invoices.'
  const result = validateGroundedTocOutput(document([
    evidenceItem({ rationale: misleadingRationale }),
  ]), evidenceIndex, analysis, 'Admin Guide')
  expect(result.items[0].rationale).toBe(candidate.rationale)
  expect(result.items[0].rationale).not.toBe(misleadingRationale)
})

test('rejects invalid JSON, extra fields, duplicate IDs, and unknown evidence IDs', () => {
  expect(() => validateGroundedTocOutput('{not json', evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([evidenceItem({ surprise: true })]), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([evidenceItem({ supportingEvidenceIds: ['ev-heading', 'ev-heading'] })]), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([evidenceItem({ supportingEvidenceIds: ['ev-fake'] })]), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
})

test('rejects different output keys that resolve to the same normalized candidate topic', () => {
  expect(() => validateGroundedTocOutput(document([
    evidenceItem({ key: 'accounts-one' }),
    evidenceItem({ key: 'accounts-two', title: `${candidate.title.toLocaleUpperCase('en-US')}!` }),
  ]), evidenceIndex, analysis, 'Admin Guide')).toThrow(GroundedTocOutputError)
})

test('rejects unsupported factual subjects even when they cite a real Evidence ID', () => {
  expect(() => validateGroundedTocOutput(document([
    evidenceItem({ title: 'Delete all accounts' }),
  ]), evidenceIndex, analysis, 'Admin Guide')).toThrow(GroundedTocOutputError)
})

test('rejects missing support, malformed hierarchy, duplicate keys, and cyclic parents', () => {
  expect(() => validateGroundedTocOutput(document([evidenceItem({ supportingEvidenceIds: [] })]), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([
    evidenceItem({ level: 2, parentKey: 'missing' }),
  ]), evidenceIndex, analysis, 'Admin Guide')).toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([
    evidenceItem(),
    evidenceItem({ title: candidate.title, level: 1 }),
  ]), evidenceIndex, analysis, 'Admin Guide')).toThrow(GroundedTocOutputError)
  expect(() => validateGroundedTocOutput(document([
    evidenceItem({ key: 'first', level: 1, parentKey: 'second' }),
    evidenceItem({ key: 'second', level: 2, parentKey: 'first' }),
  ]), evidenceIndex, analysis, 'Admin Guide')).toThrow(GroundedTocOutputError)
})

test('accepts optional structural sections only from the grounded deterministic candidate set', () => {
  const allowed = buildTocProposal(evidenceIndex, analysis, 'Admin Guide').items
    .find(item => item.proposalKind === 'optional-structural')!
  const item = {
    key: 'optional',
    title: allowed.title,
    level: 1,
    parentKey: null,
    rationale: 'Optional structure only.',
    classification: 'optional-structural',
    supportingEvidenceIds: [],
  }
  const result = validateGroundedTocOutput(document([{
    ...item,
    rationale: 'This optional section is required by law.',
  }]), evidenceIndex, analysis, 'Admin Guide')
  expect(result.items[0]).toMatchObject({
    title: allowed.title,
    classification: 'optional-structural',
    supportingEvidenceIds: [],
    rationale: allowed.rationale,
  })
})

test('rejects oversized output and excessive item lists', () => {
  expect(() => validateGroundedTocOutput(' '.repeat(64_001), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
  const items = Array.from({ length: 61 }, (_, index) =>
    evidenceItem({ key: `accounts-${index}`, supportingEvidenceIds: ['ev-heading'] }))
  expect(() => validateGroundedTocOutput(document(items), evidenceIndex, analysis, 'Admin Guide'))
    .toThrow(GroundedTocOutputError)
})