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

function userGuideFixture() {
  const items = [
    {
      id: 'ev-search-heading', sourceId: 'walkthrough', fileId: 'walkthrough',
      blockId: 'block-search-heading', sourceFileName: 'Walkthrough Transcript.docx',
      text: '00:03:20–00:04:15 1. Search cases', blockType: 'heading' as const,
      headingLevel: 2, order: 0, location: 'Search cases',
      sectionPath: ['00:03:20–00:04:15 1. Search cases'],
    },
    {
      id: 'ev-search-action', sourceId: 'walkthrough', fileId: 'walkthrough',
      blockId: 'block-search-action', sourceFileName: 'Walkthrough Transcript.docx',
      text: 'You can search cases and filter results by status.', blockType: 'paragraph' as const,
      order: 1, location: 'Search cases',
      sectionPath: ['00:03:20–00:04:15 1. Search cases'],
    },
    {
      id: 'ev-filter-heading', sourceId: 'walkthrough', fileId: 'walkthrough',
      blockId: 'block-filter-heading', sourceFileName: 'Walkthrough Transcript.docx',
      text: '1. Filter cases by status', blockType: 'heading' as const,
      headingLevel: 3, order: 2, location: 'Search cases › Filter cases by status',
      sectionPath: ['00:03:20–00:04:15 1. Search cases', '1. Filter cases by status'],
    },
    {
      id: 'ev-filter-action', sourceId: 'walkthrough', fileId: 'walkthrough',
      blockId: 'block-filter-action', sourceFileName: 'Walkthrough Transcript.docx',
      text: 'You can filter cases by status before opening a record.', blockType: 'paragraph' as const,
      order: 3, location: 'Search cases › Filter cases by status',
      sectionPath: ['00:03:20–00:04:15 1. Search cases', '1. Filter cases by status'],
    },
    {
      id: 'ev-report-heading', sourceId: 'features', fileId: 'features',
      blockId: 'block-report-heading', sourceFileName: 'Product Features and Capabilities.docx',
      text: '02. Reports and exports', blockType: 'heading' as const,
      headingLevel: 2, order: 0, location: 'Reports and exports',
      sectionPath: ['02. Reports and exports'],
    },
    {
      id: 'ev-report-action', sourceId: 'features', fileId: 'features',
      blockId: 'block-report-action', sourceFileName: 'Product Features and Capabilities.docx',
      text: 'Users can export a report as CSV.', blockType: 'paragraph' as const,
      order: 1, location: 'Reports and exports',
      sectionPath: ['02. Reports and exports'],
    },
    {
      id: 'ev-admin-heading', sourceId: 'admin', fileId: 'admin',
      blockId: 'block-admin-heading', sourceFileName: 'Admin Reference.docx',
      text: 'Configure tenant policy', blockType: 'heading' as const,
      headingLevel: 2, order: 0, location: 'Configure tenant policy',
      sectionPath: ['Configure tenant policy'],
    },
  ]
  const index: EvidenceIndex = {
    items,
    sourcesRevision: 3,
    extractionRevision: 'extract-3-user-guide',
    builtAt: 30,
  }
  const userGuideAnalysis: ConceptAnalysis = {
    ...analysis,
    evidenceExtractionRevision: index.extractionRevision,
    concepts: [],
    terminology: [],
    conflicts: [],
    gaps: [],
  }
  const candidates = buildTocProposal(index, userGuideAnalysis, 'User Guide').items
  const output = candidates.map((candidate, order) => ({
    key: `guide-${order}`,
    title: candidate.title,
    level: candidate.level,
    parentKey: candidate.parentTopicId
      ? `guide-${candidates.findIndex(parent => parent.topicId === candidate.parentTopicId)}`
      : null,
    rationale: 'The source describes this task.',
    classification: 'evidence-backed',
    supportingEvidenceIds: candidate.supportingEvidenceIds.slice(0, 20),
  }))
  return { index, analysis: userGuideAnalysis, candidates, output }
}

function twoBranchUserGuideFixture() {
  const sourceId = 'two-branch-walkthrough'
  const sourceFileName = 'Two-branch walkthrough.docx'
  const blocks = [
    { id: 'search-heading', text: 'Search cases', type: 'heading' as const, headingLevel: 2, path: ['Search cases'] },
    { id: 'search-action', text: 'Users can search cases using a name.', type: 'paragraph' as const, path: ['Search cases'] },
    { id: 'filter-heading', text: 'Filter cases by status', type: 'heading' as const, headingLevel: 3, path: ['Search cases', 'Filter cases by status'] },
    { id: 'filter-action', text: 'Users can filter cases by status.', type: 'paragraph' as const, path: ['Search cases', 'Filter cases by status'] },
    { id: 'owner-heading', text: 'Search cases by owner', type: 'heading' as const, headingLevel: 3, path: ['Search cases', 'Search cases by owner'] },
    { id: 'owner-action', text: 'Users can search cases by owner.', type: 'paragraph' as const, path: ['Search cases', 'Search cases by owner'] },
    { id: 'find-heading', text: 'Find cases', type: 'heading' as const, headingLevel: 2, path: ['Find cases'] },
    { id: 'find-action', text: 'Users can find cases by owner.', type: 'paragraph' as const, path: ['Find cases'] },
    { id: 'open-heading', text: 'Open cases by ID', type: 'heading' as const, headingLevel: 3, path: ['Find cases', 'Open cases by ID'] },
    { id: 'open-action', text: 'Users can open cases by ID.', type: 'paragraph' as const, path: ['Find cases', 'Open cases by ID'] },
    { id: 'review-heading', text: 'Review cases by status', type: 'heading' as const, headingLevel: 3, path: ['Find cases', 'Review cases by status'] },
    { id: 'review-action', text: 'Users can review cases by status.', type: 'paragraph' as const, path: ['Find cases', 'Review cases by status'] },
  ]
  const index: EvidenceIndex = {
    items: blocks.map((block, order) => ({
      id: `ev-${block.id}`,
      sourceId,
      fileId: sourceId,
      blockId: block.id,
      sourceFileName,
      text: block.text,
      blockType: block.type,
      headingLevel: block.type === 'heading' ? block.headingLevel : undefined,
      order,
      location: block.path.join(' › '),
      sectionPath: block.path,
    })),
    sourcesRevision: 3,
    extractionRevision: 'extract-3-two-branch',
    builtAt: 31,
  }
  const twoBranchAnalysis: ConceptAnalysis = {
    ...analysis,
    evidenceExtractionRevision: index.extractionRevision,
    concepts: [],
    terminology: [],
    conflicts: [],
    gaps: [],
  }
  const candidates = buildTocProposal(index, twoBranchAnalysis, 'User Guide').items
  const outputFor = (selectedCandidates: typeof candidates) => selectedCandidates.map((item, order) => ({
    key: `two-branch-${order}`,
    title: item.title,
    level: item.level,
    parentKey: item.parentTopicId
      ? `two-branch-${selectedCandidates.findIndex(parent => parent.topicId === item.parentTopicId)}`
      : null,
    rationale: item.rationale,
    classification: 'evidence-backed',
    supportingEvidenceIds: item.supportingEvidenceIds.slice(0, 20),
  }))
  return { index, analysis: twoBranchAnalysis, candidates, outputFor }
}

function threeTaskUserGuideFixture() {
  const sourceId = 'three-task-walkthrough'
  const sourceFileName = 'Three-task walkthrough.docx'
  const blocks = [
    { id: 'search-heading', text: 'Search cases', type: 'heading' as const, headingLevel: 2, path: ['Search cases'] },
    { id: 'search-action', text: 'Users can search cases by name.', type: 'paragraph' as const, path: ['Search cases'] },
    { id: 'filter-heading', text: 'Filter cases by status', type: 'heading' as const, headingLevel: 3, path: ['Search cases', 'Filter cases by status'] },
    { id: 'filter-action', text: 'Users can filter cases by status.', type: 'paragraph' as const, path: ['Search cases', 'Filter cases by status'] },
    { id: 'find-heading', text: 'Find cases', type: 'heading' as const, headingLevel: 2, path: ['Find cases'] },
    { id: 'find-action', text: 'Users can find cases by owner.', type: 'paragraph' as const, path: ['Find cases'] },
    { id: 'date-heading', text: 'Search cases by date', type: 'heading' as const, headingLevel: 2, path: ['Search cases by date'] },
    { id: 'date-action', text: 'Users can search cases by date.', type: 'paragraph' as const, path: ['Search cases by date'] },
  ]
  const index: EvidenceIndex = {
    items: blocks.map((block, order) => ({
      id: `ev-${block.id}`,
      sourceId,
      fileId: sourceId,
      blockId: block.id,
      sourceFileName,
      text: block.text,
      blockType: block.type,
      headingLevel: block.type === 'heading' ? block.headingLevel : undefined,
      order,
      location: block.path.join(' › '),
      sectionPath: block.path,
    })),
    sourcesRevision: 3,
    extractionRevision: 'extract-3-three-task',
    builtAt: 32,
  }
  const threeTaskAnalysis: ConceptAnalysis = {
    ...analysis,
    evidenceExtractionRevision: index.extractionRevision,
    concepts: [],
    terminology: [],
    conflicts: [],
    gaps: [],
  }
  const candidates = buildTocProposal(index, threeTaskAnalysis, 'User Guide').items
  const outputFor = (selectedCandidates: typeof candidates) => selectedCandidates.map((item, order) => ({
    key: `three-task-${order}`,
    title: item.title,
    level: item.level,
    parentKey: item.parentTopicId
      ? `three-task-${selectedCandidates.findIndex(parent => parent.topicId === item.parentTopicId)}`
      : null,
    rationale: item.rationale,
    classification: 'evidence-backed',
    supportingEvidenceIds: item.supportingEvidenceIds.slice(0, 20),
  }))
  return { index, analysis: threeTaskAnalysis, candidates, outputFor }
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

test('accepts a User Guide hierarchy with cleaned transcript titles and evidence-backed subtasks', () => {
  const fixture = userGuideFixture()
  expect(fixture.candidates.some(item => item.level === 1)).toBe(true)
  expect(fixture.candidates.some(item => item.level === 2)).toBe(true)
  expect(fixture.candidates.some(item => item.level === 3)).toBe(true)
  const result = validateGroundedTocOutput(
    document(fixture.output),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )
  expect(result.items.some(item => item.level === 1)).toBe(true)
  expect(result.items.some(item => item.level === 2)).toBe(true)
  expect(result.items.some(item => item.level === 3)).toBe(true)
  expect(result.items.some(item => /^(?:\d+[\s.)-]|00:\d{2})/.test(item.title))).toBe(false)
  expect(result.items.some(item => /tenant policy/i.test(item.title))).toBe(false)
})

test('rejects flat and structurally weak User Guide output when task candidates support deeper levels', () => {
  const fixture = userGuideFixture()
  const withoutProcedures = fixture.output.filter(item => item.level !== 3)
  expect(() => validateGroundedTocOutput(
    document(withoutProcedures),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)

  const flat = fixture.output.map(item => ({
    ...item,
    level: 1,
    parentKey: null,
  }))
  expect(() => validateGroundedTocOutput(
    document(flat),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)
})

test('requires a supported procedure under each included User Guide task without requiring every candidate', () => {
  const fixture = twoBranchUserGuideFixture()
  const tasks = fixture.candidates.filter(item => item.level === 2)
  expect(tasks).toHaveLength(2)
  for (const task of tasks) {
    expect(fixture.candidates.filter(item =>
      item.level === 3 && item.parentTopicId === task.topicId,
    ).length).toBeGreaterThan(1)
  }

  const selectedProcedureParents = new Set<string>()
  const oneProcedurePerTask = fixture.candidates.filter(item => {
    if (item.level !== 3) return true
    const parentTopicId = item.parentTopicId!
    if (selectedProcedureParents.has(parentTopicId)) return false
    selectedProcedureParents.add(parentTopicId)
    return true
  })
  expect(oneProcedurePerTask.filter(item => item.level === 3)).toHaveLength(2)
  expect(oneProcedurePerTask.length).toBeLessThan(fixture.candidates.length)
  expect(() => validateGroundedTocOutput(
    document(fixture.outputFor(oneProcedurePerTask)),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).not.toThrow()

  const omittedBranchProcedure = oneProcedurePerTask.filter(item =>
    item.level !== 3 || item.parentTopicId !== tasks[1].topicId)
  expect(() => validateGroundedTocOutput(
    document(fixture.outputFor(omittedBranchProcedure)),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)
})

test('requires a procedure branch when multiple supported task areas include procedure evidence', () => {
  const fixture = threeTaskUserGuideFixture()
  const tasks = fixture.candidates.filter(item => item.level === 2)
  const procedures = fixture.candidates.filter(item => item.level === 3)
  expect(tasks).toHaveLength(3)
  expect(procedures.length).toBeGreaterThan(0)
  const procedureTaskIds = new Set(procedures.map(item => item.parentTopicId))
  const procedureTask = tasks.find(task => procedureTaskIds.has(task.topicId))!
  const procedureFreeTasks = tasks.filter(task => !procedureTaskIds.has(task.topicId))
  expect(procedureFreeTasks).toHaveLength(2)
  const root = fixture.candidates.find(item => item.level === 1)!

  const onlyProcedureFreeTasks = [
    root,
    ...procedureFreeTasks,
  ]
  expect(() => validateGroundedTocOutput(
    document(fixture.outputFor(onlyProcedureFreeTasks)),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)

  const supportedProcedure = procedures.find(item => item.parentTopicId === procedureTask.topicId)!
  const hierarchySubset = [
    root,
    procedureTask,
    procedureFreeTasks[0],
    supportedProcedure,
  ]
  expect(hierarchySubset.length).toBeLessThan(fixture.candidates.length)
  expect(() => validateGroundedTocOutput(
    document(fixture.outputFor(hierarchySubset)),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).not.toThrow()
})

test('rejects numbered or timestamped titles and incorrect task-group parents for User Guides', () => {
  const fixture = userGuideFixture()
  const numericTitle = fixture.output.map((item, index) => index === 1
    ? { ...item, title: `01 00:03:20 ${item.title}` }
    : item)
  expect(() => validateGroundedTocOutput(
    document(numericTitle),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)

  const root = fixture.output.find(item => item.level === 1)
  const wrongParent = fixture.output.map(item => item.level === 2 && root
    ? { ...item, parentKey: root.key === item.parentKey ? 'guide-999' : root.key }
    : item)
  expect(() => validateGroundedTocOutput(
    document(wrongParent),
    fixture.index,
    fixture.analysis,
    'User Guide',
  )).toThrow(GroundedTocOutputError)
})

test('preserves sparse User Guide evidence when one supported task has a valid H1-H2 structure', () => {
  const sparseIndex: EvidenceIndex = {
    ...evidenceIndex,
    items: [
      {
        ...evidenceIndex.items[0],
        id: 'ev-sparse-heading',
        sourceId: 'walkthrough',
        fileId: 'walkthrough',
        sourceFileName: 'Walkthrough Transcript.docx',
        text: 'Cases',
        sectionPath: ['Cases'],
      },
      {
        ...evidenceIndex.items[0],
        id: 'ev-sparse-action',
        sourceId: 'walkthrough',
        fileId: 'walkthrough',
        sourceFileName: 'Walkthrough Transcript.docx',
        text: 'Users can create a new case.',
        blockType: 'paragraph',
        order: 1,
        sectionPath: ['Cases'],
      },
    ],
  }
  const sparseAnalysis: ConceptAnalysis = {
    ...analysis,
    evidenceExtractionRevision: sparseIndex.extractionRevision,
    concepts: [],
    terminology: [],
    conflicts: [],
    gaps: [],
  }
  const candidates = buildTocProposal(sparseIndex, sparseAnalysis, 'User Guide').items
  const output = candidates.map((candidate, order) => ({
    key: `sparse-${order}`,
    title: candidate.title,
    level: candidate.level,
    parentKey: candidate.parentTopicId
      ? `sparse-${candidates.findIndex(parent => parent.topicId === candidate.parentTopicId)}`
      : null,
    rationale: candidate.rationale,
    classification: 'evidence-backed',
    supportingEvidenceIds: candidate.supportingEvidenceIds.slice(0, 20),
  }))
  expect(output.some(item => item.level === 1)).toBe(true)
  expect(output.some(item => item.level === 2)).toBe(true)
  expect(output.some(item => item.level === 3)).toBe(false)
  expect(() => validateGroundedTocOutput(
    document(output),
    sparseIndex,
    sparseAnalysis,
    'User Guide',
  )).not.toThrow()
})