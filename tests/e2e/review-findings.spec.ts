import { expect, test, type Page } from '@playwright/test'
import { buildConceptAnalysis, type ConceptAnalysis } from '../../src/conceptAnalysis'
import { buildEvidenceIndex, type EvidenceIndex } from '../../src/evidenceIndex'
import type { SourceExtraction } from '../../src/sourceExtractor'
import {
  buildGroundedReviewRun,
  markReviewHistoryFreshness,
} from '../../src/reviewFindings'
import { reviewBlockFingerprint, type ReviewInputSnapshot } from '../../src/reviewInput'
import { resolveReviewAuthorTarget, validateReviewNavigationAfterSave } from '../../src/reviewNavigation'
import { checkReviewActionEligibility } from '../../src/reviewActionEligibility'
import { prepareSpellingApply, recordReviewFindingStatus } from '../../src/reviewSuggestions'
import {
  createEmptyReviewModel,
  remapReviewModelForDuplicate,
} from '../../src/reviewModel'
import type { UnsupportedAnalysis } from '../../src/unsupportedAnalysis'

test.describe.configure({ mode: 'serial' })

type StoredProject = {
  projectId: string
  projectName: string
  sourceFileIds: string[]
  sourcesRevision: number
  evidenceIndex: EvidenceIndex | null
  reviewModel: ReturnType<typeof createEmptyReviewModel>
  [key: string]: unknown
}

async function createProject(page: Page, projectName: string) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
}

async function readProject(page: Page, projectName: string): Promise<StoredProject> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll()
      request.onsuccess = () => resolve(request.result as StoredProject[])
      request.onerror = () => reject(request.error)
    })
    const project = projects.find(candidate => candidate.projectName === name)
    if (!project) throw new Error(`Project not found: ${name}`)
    return project
  }, projectName)
}

async function patchProject(
  page: Page,
  projectName: string,
  patch: Record<string, unknown>,
) {
  await page.evaluate(async ({ name, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const project = await new Promise<StoredProject>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const found = (request.result as StoredProject[]).find(candidate => candidate.projectName === name)
        if (!found) return reject(new Error(`Project not found: ${name}`))
        resolve(found)
      }
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ ...project, ...values })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, { name: projectName, values: patch })
}

function fixtures() {
  const projectId = 'project-grounded-review'
  const evidenceIndex = {
    items: [
      {
        id: 'evidence-a',
        sourceId: 'file-a',
        fileId: 'file-a',
        blockId: 'source-block-a',
        sourceFileName: 'operations-a.md',
        text: 'Retention period is 30 days.',
        blockType: 'paragraph',
        order: 0,
        location: 'Retention',
        sectionPath: ['Retention'],
      },
      {
        id: 'evidence-b',
        sourceId: 'file-b',
        fileId: 'file-b',
        blockId: 'source-block-b',
        sourceFileName: 'operations-b.md',
        text: 'Retention period is 60 days.',
        blockType: 'paragraph',
        order: 0,
        location: 'Retention',
        sectionPath: ['Retention'],
      },
      {
        id: 'evidence-gap',
        sourceId: 'file-a',
        fileId: 'file-a',
        blockId: 'source-block-gap',
        sourceFileName: 'operations-a.md',
        text: 'See section Recovery Procedure.',
        blockType: 'paragraph',
        order: 1,
        location: 'Recovery',
        sectionPath: ['Recovery'],
      },
      {
        id: 'evidence-term',
        sourceId: 'file-a',
        fileId: 'file-a',
        blockId: 'source-block-term',
        sourceFileName: 'operations-a.md',
        text: 'Workspace and Work Space are source variants.',
        blockType: 'paragraph',
        order: 2,
        location: 'Terminology',
        sectionPath: ['Terminology'],
      },
    ],
    sourcesRevision: 2,
    extractionRevision: 'extract-grounded',
    builtAt: 1_700_000_000_000,
  } as EvidenceIndex
  const conceptAnalysis = {
    version: 2,
    method: 'deterministic-evidence-heuristics-v1',
    evidenceSourcesRevision: 2,
    evidenceExtractionRevision: 'extract-grounded',
    builtAt: 1_700_000_000_100,
    concepts: [],
    terminology: [{
      id: 'term-workspace',
      normalizedLabel: 'Workspace',
      exactTerms: ['Work Space', 'Workspace'],
      occurrenceCount: 2,
      sourceCount: 1,
      evidenceIds: ['evidence-term'],
      evidenceRefs: [{
        evidenceId: 'evidence-term',
        sourceId: 'file-a',
        fileId: 'file-a',
        sourceFileName: 'operations-a.md',
        location: 'Terminology',
      }],
    }],
    conflicts: [{
      id: 'conflict-retention',
      subject: 'Retention period',
      kind: 'explicit-value',
      summary: 'Sources give different explicit values for Retention period.',
      rationale: 'Concrete statements in two sources use incompatible values.',
      sides: [
        {
          id: 'side-30',
          label: '30 days',
          claimText: 'Retention period is 30 days',
          evidenceIds: ['evidence-a'],
          evidenceRefs: [],
        },
        {
          id: 'side-60',
          label: '60 days',
          claimText: 'Retention period is 60 days',
          evidenceIds: ['evidence-b'],
          evidenceRefs: [],
        },
      ],
      evidenceIds: ['evidence-a', 'evidence-b'],
      evidenceRefs: [],
    }],
    gaps: [{
      id: 'gap-recovery',
      category: 'unresolved-reference',
      status: 'not-found-in-sources',
      title: 'Referenced topic not found: Recovery Procedure',
      rationale: 'A source explicitly references Recovery Procedure, but no matching source heading is present.',
      evidenceIds: ['evidence-gap'],
      evidenceRefs: [],
    }],
  } as ConceptAnalysis
  const unsupportedAnalysis = {
    version: 1,
    method: 'deterministic-evidence-support-v1',
    evidenceSourcesRevision: 2,
    evidenceExtractionRevision: 'extract-grounded',
    groundedAnalysisBuiltAt: conceptAnalysis.builtAt,
    contentRevision: 4,
    contentFingerprint: 'content-grounded',
    builtAt: 1_700_000_000_200,
    status: 'complete',
    analyzedClaimCount: 2,
    supportedClaimCount: 1,
    findings: [{
      id: 'unsupported-fast-recovery',
      claimText: 'Recovery always completes in five minutes.',
      reason: 'No current Evidence Index item supports the same proposition.',
      evidenceStatus: 'unsupported',
      context: {
        contextType: 'topic-block',
        location: 'Recovery / Overview',
        blockId: 'block-recovery',
        topicId: 'topic-recovery',
      },
      nearMatches: [{
        evidenceId: 'evidence-gap',
        sourceId: 'file-a',
        fileId: 'file-a',
        sourceFileName: 'operations-a.md',
        location: 'Recovery',
        text: 'See section Recovery Procedure.',
        similarity: 0.4,
        relationship: 'near-match',
      }],
    }],
  } as UnsupportedAnalysis
  const snapshot = {
    version: 1,
    snapshotId: 'review-input-grounded',
    projectId,
    capturedAt: 1_700_000_000_300,
    contentType: 'user-guide',
    language: 'en-US',
    topics: [{
      topicId: 'topic-recovery',
      title: 'Recovery and Retention',
      level: 1,
      parentTopicId: null,
      order: 0,
      blocks: [{
        blockId: 'block-recovery',
        type: 'para',
        content: 'Recovery always completes in five minutes. The Work Space retention period is documented here.',
        fingerprint: 'review-block-recovery',
      }],
    }],
    sources: [
      {
        sourceId: 'file-a',
        fileId: 'file-a',
        fileName: 'operations-a.md',
        status: 'extracted',
        extractionRevision: 2,
        blockIds: ['source-block-a', 'source-block-gap', 'source-block-term'],
        contentFingerprint: 'source-a',
      },
      {
        sourceId: 'file-b',
        fileId: 'file-b',
        fileName: 'operations-b.md',
        status: 'extracted',
        extractionRevision: 2,
        blockIds: ['source-block-b'],
        contentFingerprint: 'source-b',
      },
    ],
    evidence: evidenceIndex.items.map(item => ({
      evidenceId: item.id,
      sourceId: item.sourceId,
      fileId: item.fileId,
      blockId: item.blockId,
      sourceFileName: item.sourceFileName,
      location: item.location,
      contentFingerprint: `fingerprint-${item.id}`,
    })),
    groundedAnalysis: {
      builtAt: conceptAnalysis.builtAt,
      fresh: true,
      conceptIds: [],
      terminologyIds: ['term-workspace'],
      conflictIds: ['conflict-retention'],
      gapIds: ['gap-recovery'],
    },
    unsupportedAnalysis: {
      builtAt: unsupportedAnalysis.builtAt,
      fresh: true,
      contentFingerprint: unsupportedAnalysis.contentFingerprint,
      findingIds: ['unsupported-fast-recovery'],
    },
    style: {
      styleProfileId: 'style-canonical',
      name: 'Canonical',
      scope: 'project',
      source: 'Project',
      fingerprint: 'style-fingerprint',
    },
    standards: [],
    terminology: [{
      termId: 'term-workspace',
      preferredTerm: 'Workspace',
      exactTerms: ['Work Space', 'Workspace'],
      evidenceIds: ['evidence-term'],
    }],
    authorTopics: [],
    issues: [],
    readiness: 'ready',
    provenance: {
      projectId,
      contentRevision: 4,
      contentFingerprint: 'review-content-grounded',
      sourcesRevision: 2,
      sourceFileIds: ['file-a', 'file-b'],
      evidenceExtractionRevision: 'extract-grounded',
      evidenceIndexBuiltAt: evidenceIndex.builtAt,
      analysisRevision: 2,
      analysisBuiltAt: conceptAnalysis.builtAt,
      tocRevision: 3,
      contentType: 'user-guide',
      styleProfileId: 'style-canonical',
      styleFingerprint: 'style-fingerprint',
      standardsFingerprint: 'standards-fingerprint',
      capturedAt: 1_700_000_000_300,
    },
  } as ReviewInputSnapshot
  return { projectId, evidenceIndex, conceptAnalysis, unsupportedAnalysis, snapshot }
}

test('emits conservative language and explicit-standard findings with stable exact block references', () => {
  const data = fixtures()
  const standards = [
    { standardId: 'language', label: 'Language', value: 'en-US', fingerprint: 'language-en' },
    {
      standardId: 'writing-rules', label: 'Writing rules',
      value: JSON.stringify({ activeVoice: true, directAddress: true, maxSentenceWords: 10 }),
      fingerprint: 'writing-explicit',
    },
    {
      standardId: 'formatting-rules', label: 'Formatting rules',
      value: JSON.stringify({ requireTableHeader: true, maxHeadingLevelJump: 1 }),
      fingerprint: 'formatting-explicit',
    },
  ]
  const snapshot: ReviewInputSnapshot = {
    ...data.snapshot,
    snapshotId: 'review-input-language-and-standards',
    standards,
    topics: [{
      ...data.snapshot.topics[0],
      blocks: [
        { blockId: 'prose-1', type: 'para', fingerprint: 'prose-fingerprint',
          content: 'The the report is generated by the system. Users should recieve the report after the operation is complete today and tomorrow.' },
        { blockId: 'table-1', type: 'table', fingerprint: 'table-fingerprint',
          content: 'Name | Value', tableHasHeader: false },
        { blockId: 'heading-1', type: 'h1', fingerprint: 'h1-fingerprint', content: 'Summary' },
        { blockId: 'heading-3', type: 'h3', fingerprint: 'h3-fingerprint', content: 'Details' },
      ],
    }],
  }
  const run = () => buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis, 1_800_000_000_000,
  )
  const result = run()
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const newFindings = result.findings.filter(finding =>
    ['Grammar', 'Spelling', 'Writing Style', 'Formatting / Standards'].includes(finding.category))
  expect(new Set(newFindings.map(finding => finding.category))).toEqual(new Set([
    'Grammar', 'Spelling', 'Writing Style', 'Formatting / Standards',
  ]))
  const grammar = newFindings.find(finding => finding.category === 'Grammar')!
  const spelling = newFindings.find(finding => finding.category === 'Spelling')!
  expect(grammar).toMatchObject({ topicId: 'topic-recovery', blockId: 'prose-1', originalText: 'The the' })
  expect(spelling).toMatchObject({ topicId: 'topic-recovery', blockId: 'prose-1', originalText: 'recieve' })
  expect(spelling.suggestion).toMatchObject({
    kind: 'replace', blockId: 'prose-1',
    originalText: snapshot.topics[0].blocks[0].content,
    proposedText: snapshot.topics[0].blocks[0].content.replace('recieve', 'receive'),
    method: 'deterministic-spelling-v1', confidence: 'high',
    expectedBlockFingerprint: 'prose-fingerprint',
  })
  expect(newFindings.filter(finding => finding.category === 'Writing Style').map(finding => finding.rationale).join(' '))
    .toMatch(/active voice.*direct address.*word limit/)
  expect(newFindings.filter(finding => finding.category === 'Formatting / Standards')
    .map(finding => finding.blockId)).toEqual(['heading-3', 'table-1'])
  for (const finding of newFindings) {
    expect(finding.findingId).toMatch(/^review-finding-/)
    expect(finding.inputProvenance).toEqual(snapshot.provenance)
    expect(finding.styleReferences).toHaveLength(1)
    expect(standards.map(standard => standard.standardId)).toContain(finding.styleReferences[0].standardId)
    expect(finding.styleReferences[0].fingerprint).toBeTruthy()
    expect(finding.originalText).toBeTruthy()
    expect(finding.rationale).toBeTruthy()
    if (finding.category !== 'Spelling') expect(finding.suggestion).toBeNull()
    expect(snapshot.topics.find(topic => topic.topicId === finding.topicId)?.blocks
      .some(block => block.blockId === finding.blockId)).toBe(true)
  }
  const repeated = run()
  expect(repeated.ok).toBe(true)
  if (!repeated.ok) return
  expect(repeated.findings.map(finding => finding.findingId))
    .toEqual(result.findings.map(finding => finding.findingId))
  expect(snapshot.topics[0].blocks[0].content).toContain('recieve')
})

test('does not infer language or writing and formatting rules absent from the snapshot', () => {
  const data = fixtures()
  const suspicious = {
    ...data.snapshot,
    topics: [{
      ...data.snapshot.topics[0],
      blocks: [
        { blockId: 'prose-1', type: 'para',
          content: 'The the Work Space report was generated by the team. Users should recieve the report.',
          fingerprint: 'prose' },
        { blockId: 'table-1', type: 'table', content: 'A | B',
          tableHasHeader: false, fingerprint: 'table' },
      ],
    }],
  }
  const check = (snapshot: ReviewInputSnapshot) => buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  const absent = check(suspicious)
  expect(absent.ok).toBe(true)
  if (!absent.ok) return
  expect(absent.findings.map(finding => finding.category)).toEqual([
    'Conflict', 'Source Gap', 'Terminology', 'Unsupported Claim',
  ])
  const englishOnly = check({
    ...suspicious, standards: [{ standardId: 'language', label: 'Language',
      value: 'en-US', fingerprint: 'language-en' }],
  })
  expect(englishOnly.ok).toBe(true)
  if (!englishOnly.ok) return
  expect(englishOnly.findings.map(finding => finding.category)).toContain('Grammar')
  expect(englishOnly.findings.map(finding => finding.category)).toContain('Spelling')
  expect(englishOnly.findings.map(finding => finding.category)).not.toContain('Writing Style')
  expect(englishOnly.findings.map(finding => finding.category)).not.toContain('Formatting / Standards')
  const otherLanguage = check({
    ...suspicious, language: 'fr-FR', standards: [{ standardId: 'language', label: 'Language',
      value: 'fr-FR', fingerprint: 'language-fr' }],
  })
  expect(otherLanguage.ok).toBe(true)
  if (!otherLanguage.ok) return
  expect(otherLanguage.findings.map(finding => finding.category)).toEqual(absent.findings.map(finding => finding.category))
})

test('previews only deterministic spelling diffs and guards exact content, fingerprint, freshness, and target on Apply', () => {
  const data = fixtures()
  const block = { id: 'block-recovery', type: 'para', content: 'Please recieve updates.' }
  const snapshot: ReviewInputSnapshot = {
    ...data.snapshot,
    snapshotId: 'review-spelling-input',
    standards: [{ standardId: 'language', label: 'Language', value: 'en-US', fingerprint: 'english' }],
    topics: [{
      ...data.snapshot.topics[0],
      blocks: [{
        blockId: block.id, type: block.type, content: block.content,
        fingerprint: reviewBlockFingerprint(block),
      }],
    }],
  }
  const run = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(run.ok).toBe(true)
  if (!run.ok) return
  const spelling = run.findings.find(finding => finding.category === 'Spelling')!
  const topics = [{ id: 1, topicId: 'topic-recovery' }]
  const content = { 'topic-recovery': [block] }
  expect(spelling.suggestion).toMatchObject({
    originalText: 'Please recieve updates.', proposedText: 'Please receive updates.',
    range: { start: 7, end: 14 }, expectedBlockFingerprint: reviewBlockFingerprint(block),
  })
  const applied = prepareSpellingApply(run.model, spelling.findingId, snapshot, topics, content)
  expect(applied.ok).toBe(true)
  if (!applied.ok) return
  expect(applied.topicContent['topic-recovery']).toEqual([{ ...block, content: 'Please receive updates.' }])
  expect(content['topic-recovery'][0].content).toBe('Please recieve updates.')
  expect(applied.model.findings.find(item => item.findingId === spelling.findingId))
    .toMatchObject({ status: 'resolved', resolutionHistory: [expect.objectContaining({ action: 'applied', status: 'resolved' })] })
  expect(prepareSpellingApply(applied.model, spelling.findingId, snapshot, topics, applied.topicContent).ok).toBe(false)
  expect(prepareSpellingApply(run.model, spelling.findingId,
    { ...snapshot, snapshotId: 'changed-snapshot' }, topics, content)).toMatchObject({ ok: false, reason: expect.stringContaining('Rerun Review') })
  expect(prepareSpellingApply(run.model, spelling.findingId, snapshot, topics,
    { 'topic-recovery': [{ ...block, content: 'Different text.' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('fingerprint') })
  expect(prepareSpellingApply(run.model, spelling.findingId, snapshot, topics,
    { 'topic-recovery': [{ ...block, caption: 'Changed metadata' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('fingerprint') })
  expect(prepareSpellingApply(run.model, spelling.findingId, snapshot, topics,
    { 'topic-recovery': [{ ...block, id: 'another-block' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('missing') })
  expect(prepareSpellingApply(run.model, spelling.findingId, snapshot,
    [{ id: 2, topicId: 'other-topic' }], content).ok).toBe(false)
  expect(prepareSpellingApply(run.model, run.findings.find(item => item.category === 'Unsupported Claim')!.findingId,
    snapshot, topics, content).ok).toBe(false)

  const rejected = recordReviewFindingStatus(run.model, spelling.findingId, 'rejected')
  expect(rejected.findings.find(item => item.findingId === spelling.findingId))
    .toMatchObject({ status: 'rejected', resolutionHistory: [expect.objectContaining({ action: 'rejected' })] })
  expect(prepareSpellingApply(rejected, spelling.findingId, snapshot, topics, content).ok).toBe(false)
  const dismissed = recordReviewFindingStatus(run.model, spelling.findingId, 'dismissed')
  expect(dismissed.findings.find(item => item.findingId === spelling.findingId))
    .toMatchObject({ status: 'dismissed', resolutionHistory: [expect.objectContaining({ status: 'dismissed' })] })
  expect(content['topic-recovery']).toEqual([block])
  const reloaded = structuredClone(applied.model)
  expect(reloaded.findings.find(item => item.findingId === spelling.findingId)?.resolutionHistory[0].action).toBe('applied')
  const duplicated = remapReviewModelForDuplicate(run.model, data.projectId, 'copied-project', {})
  expect(duplicated.findings.find(item => item.findingId === spelling.findingId)?.suggestion).toEqual(spelling.suggestion)
  expect(prepareSpellingApply(duplicated, spelling.findingId, snapshot, topics, content).ok).toBe(false)
})

test('resolves exact real Author IDs across topic rename, reorder, and persisted reload; rejects missing and stale targets', () => {
  const data = fixtures()
  const generated = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), data.snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(generated.ok).toBe(true)
  if (!generated.ok) return
  const persisted = structuredClone(generated.model)
  const finding = persisted.findings.find(item => item.category === 'Unsupported Claim')!
  const topics = [
    { id: 42, topicId: 'other-topic', title: 'First now' },
    { id: 7, topicId: 'topic-recovery', title: 'Renamed after reordering' },
  ]
  const authoredBlock = {
    id: 'block-recovery', type: 'para',
    content: data.snapshot.topics[0].blocks[0].content,
  }
  const snapshot = {
    ...data.snapshot,
    topics: data.snapshot.topics.map(topic => ({
      ...topic,
      blocks: topic.blocks.map(block => block.blockId === authoredBlock.id
        ? { ...block, fingerprint: reviewBlockFingerprint(authoredBlock) } : block),
    })),
  }
  const blocks = {
    'topic-recovery': [
      { id: 'another-block', type: 'para', content: 'Other text' },
      authoredBlock,
    ],
  }
  expect(resolveReviewAuthorTarget(finding, persisted, snapshot, topics, blocks)).toEqual({
    status: 'ready',
    target: {
      findingId: finding.findingId,
      topicId: 'topic-recovery',
      blockId: 'block-recovery',
      category: 'Unsupported Claim',
    },
  })
  expect(resolveReviewAuthorTarget(finding, persisted, snapshot, topics, { 'topic-recovery': [blocks['topic-recovery'][0]] }))
    .toMatchObject({ status: 'missing-block', message: expect.stringContaining('Rerun Review') })
  expect(resolveReviewAuthorTarget(finding, persisted, snapshot, topics.slice(0, 1), blocks))
    .toMatchObject({ status: 'missing-topic' })
  const staleModel = {
    ...persisted,
    findings: persisted.findings.map(item => item.findingId === finding.findingId
      ? { ...item, freshness: { ...item.freshness, status: 'stale' as const } } : item),
  }
  expect(resolveReviewAuthorTarget(finding, staleModel, snapshot, topics, blocks))
    .toMatchObject({ status: 'stale' })
  expect(resolveReviewAuthorTarget(finding, persisted, { ...snapshot, snapshotId: 'new-snapshot' }, topics, blocks))
    .toMatchObject({ status: 'stale' })
  expect(resolveReviewAuthorTarget(finding, persisted, snapshot, topics, {
    'topic-recovery': [{ ...authoredBlock, content: 'Changed after Review.' }],
  })).toMatchObject({ status: 'changed-block' })
  expect(resolveReviewAuthorTarget(finding, persisted, snapshot, topics, {
    'topic-recovery': [{ ...authoredBlock, caption: 'Changed metadata' }],
  })).toMatchObject({ status: 'changed-block' })
})

test('generates each grounded category with stable locations, provenance, and exact evidence references', () => {
  const data = fixtures()
  const result = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    data.snapshot,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
    1_800_000_000_000,
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return

  expect(result.findings.map(finding => finding.category)).toEqual([
    'Conflict',
    'Source Gap',
    'Terminology',
    'Unsupported Claim',
  ])
  for (const finding of result.findings) {
    expect(finding.findingId).toMatch(/^review-finding-/)
    expect(finding.findingKey).toBeTruthy()
    expect(finding.inputSnapshotId).toBe(data.snapshot.snapshotId)
    expect(finding.inputProvenance).toEqual(data.snapshot.provenance)
    expect(finding.rationale).toBeTruthy()
    expect(finding.suggestion).toBeNull()
  }

  const unsupported = result.findings.find(item => item.category === 'Unsupported Claim')!
  expect(unsupported).toMatchObject({
    topicId: 'topic-recovery',
    blockId: 'block-recovery',
    originalText: 'Recovery always completes in five minutes.',
    required: true,
  })
  expect(unsupported.evidenceReferences[0]).toMatchObject({
    evidenceId: 'evidence-gap',
    fileId: 'file-a',
    blockId: 'source-block-gap',
    location: 'Recovery',
    excerpt: 'See section Recovery Procedure.',
  })

  const term = result.findings.find(item => item.category === 'Terminology')!
  expect(term).toMatchObject({
    topicId: 'topic-recovery',
    blockId: 'block-recovery',
    originalText: 'Work Space',
    required: false,
  })
  const conflict = result.findings.find(item => item.category === 'Conflict')!
  expect(conflict.evidenceReferences.map(reference => reference.evidenceId))
    .toEqual(['evidence-a', 'evidence-b'])
  const gap = result.findings.find(item => item.category === 'Source Gap')!
  expect(gap.evidenceReferences.map(reference => reference.evidenceId))
    .toEqual(['evidence-gap'])
})

test('blocks grounded Review generation when the input snapshot is missing or stale', () => {
  const data = fixtures()
  const missing = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    null,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
  )
  expect(missing).toEqual({ ok: false, reason: 'The Review input snapshot is not available.' })

  const stale = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    {
      ...data.snapshot,
      readiness: 'stale-inputs',
      issues: [{ code: 'evidence-stale', severity: 'stale', message: 'Evidence is stale.' }],
    },
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
  )
  expect(stale).toEqual({
    ok: false,
    reason: 'Review inputs are missing or stale. Resolve the diagnostics before starting a new run.',
  })
})

test('creates a new run on rerun while preserving prior resolved and dismissed history', () => {
  const data = fixtures()
  const first = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    data.snapshot,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
    1_800_000_000_000,
  )
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const resolvedId = first.findings[0].findingId
  const withResolution = {
    ...first.model,
    findings: first.model.findings.map(finding => finding.findingId === resolvedId
      ? { ...finding, status: 'resolved' as const }
      : finding),
  }
  const second = buildGroundedReviewRun(
    withResolution,
    data.snapshot,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
    1_800_000_001_000,
  )
  expect(second.ok).toBe(true)
  if (!second.ok) return

  expect(second.model.runs).toHaveLength(2)
  expect(second.model.findings).toHaveLength(8)
  expect(second.model.findings.find(finding => finding.findingId === resolvedId)?.status).toBe('resolved')
  expect(second.run.reviewRunId).not.toBe(first.run.reviewRunId)
  expect(second.findings.map(finding => finding.findingKey))
    .toEqual(first.findings.map(finding => finding.findingKey))
  expect(second.findings.map(finding => finding.findingId))
    .not.toEqual(first.findings.map(finding => finding.findingId))
})

test('marks prior grounded history stale when the Review snapshot changes', () => {
  const data = fixtures()
  const generated = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    data.snapshot,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
  )
  expect(generated.ok).toBe(true)
  if (!generated.ok) return
  const refreshed = markReviewHistoryFreshness(generated.model, {
    ...data.snapshot,
    snapshotId: 'review-input-new',
  }, 1_900_000_000_000)
  expect(refreshed.runs[0].status).toBe('stale')
  expect(refreshed.findings.every(finding =>
    finding.freshness.status === 'stale'
    && finding.freshness.reasons.includes('review-input-snapshot-changed'))).toBe(true)
})

test('shared Review eligibility locks stale and superseded history but permits active findings', () => {
  const data = fixtures()
  const first = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), data.snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const finding = first.findings.find(item => item.category === 'Unsupported Claim')!
  const topics = [{ id: 1, topicId: 'topic-recovery' }]
  const block = {
    id: 'block-recovery', type: 'para',
    content: data.snapshot.topics[0].blocks[0].content,
  }
  const content = { 'topic-recovery': [block] }
  const check = (model: typeof first.model, snapshot: ReviewInputSnapshot, target: 'exists' | 'exact' = 'exists') =>
    checkReviewActionEligibility(model, finding.findingId, snapshot, topics, content, target)
  expect(check(first.model, data.snapshot)).toEqual({ ok: true })
  for (const status of ['open', 'dismissed', 'resolved', 'rejected'] as const) {
    const model = {
      ...first.model,
      findings: first.model.findings.map(item => item.findingId === finding.findingId ? { ...item, status } : item),
    }
    const stale = markReviewHistoryFreshness(model, { ...data.snapshot, snapshotId: 'changed-input' })
    expect(check(stale, { ...data.snapshot, snapshotId: 'changed-input' })).toMatchObject({
      ok: false, code: 'stale', reason: expect.stringContaining('Rerun Review'),
    })
  }
  const second = buildGroundedReviewRun(
    first.model, data.snapshot, data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.model.findings.find(item => item.findingId === finding.findingId)?.status).toBe('open')
  expect(check(second.model, data.snapshot)).toMatchObject({ ok: false, code: 'stale' })
  expect(resolveReviewAuthorTarget(finding, second.model, data.snapshot, topics, content))
    .toMatchObject({ status: 'stale', message: expect.stringContaining('Rerun Review') })
  const active = second.findings.find(item => item.category === 'Unsupported Claim')!
  expect(checkReviewActionEligibility(second.model, active.findingId, data.snapshot, topics, content))
    .toEqual({ ok: true })
  expect(checkReviewActionEligibility(second.model, active.findingId, data.snapshot, topics,
    { 'topic-recovery': [] })).toMatchObject({ ok: false, code: 'missing-block' })
  expect(checkReviewActionEligibility(second.model, active.findingId, data.snapshot, [], content))
    .toMatchObject({ ok: false, code: 'missing-topic' })
})

test('navigation checks its exact target again after an awaited save', async () => {
  const data = fixtures()
  const first = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId), data.snapshot,
    data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const finding = first.findings.find(item => item.category === 'Unsupported Claim')!
  const block = { id: 'block-recovery', type: 'para', content: data.snapshot.topics[0].blocks[0].content }
  const snapshot = {
    ...data.snapshot,
    topics: data.snapshot.topics.map(topic => ({
      ...topic, blocks: topic.blocks.map(item => ({ ...item, fingerprint: reviewBlockFingerprint(block) })),
    })),
  }
  let content = { 'topic-recovery': [block] }
  let model = first.model
  const check = () => resolveReviewAuthorTarget(finding, model, snapshot, [{ id: 1, topicId: 'topic-recovery' }], content)
  let release!: (saved: boolean) => void
  const save = () => new Promise<boolean>(resolve => { release = resolve })
  const pending = validateReviewNavigationAfterSave(save, check)
  content = { 'topic-recovery': [{ ...block, content: 'Changed during save.' }] }
  release(true)
  await expect(pending).resolves.toMatchObject({ status: 'changed-block' })
  content = { 'topic-recovery': [block] }
  const pendingRerun = validateReviewNavigationAfterSave(save, check)
  const second = buildGroundedReviewRun(
    model, data.snapshot, data.evidenceIndex, data.conceptAnalysis, data.unsupportedAnalysis,
  )
  expect(second.ok).toBe(true)
  if (!second.ok) return
  model = second.model
  release(true)
  await expect(pendingRerun).resolves.toMatchObject({ status: 'stale' })
  await expect(validateReviewNavigationAfterSave(async () => true, () =>
    resolveReviewAuthorTarget(second.findings.find(item => item.category === 'Unsupported Claim')!,
      model, snapshot, [{ id: 1, topicId: 'topic-recovery' }], content))).resolves.toMatchObject({ status: 'ready' })
})

test('duplicates grounded Review history while remapping project and source traceability', () => {
  const data = fixtures()
  const generated = buildGroundedReviewRun(
    createEmptyReviewModel(data.projectId),
    data.snapshot,
    data.evidenceIndex,
    data.conceptAnalysis,
    data.unsupportedAnalysis,
  )
  expect(generated.ok).toBe(true)
  if (!generated.ok) return
  const duplicate = remapReviewModelForDuplicate(
    generated.model,
    data.projectId,
    'project-copy',
    { 'file-a': 'file-a-copy', 'file-b': 'file-b-copy' },
  )

  expect(duplicate.projectId).toBe('project-copy')
  expect(duplicate.runs[0].projectId).toBe('project-copy')
  expect(duplicate.runs[0].inputProvenance.sourceFileIds).toEqual(['file-a-copy', 'file-b-copy'])
  expect(duplicate.findings.map(finding => finding.findingId))
    .toEqual(generated.findings.map(finding => finding.findingId))
  expect(duplicate.findings.flatMap(finding => finding.sourceReferences).map(reference => reference.fileId))
    .not.toContain('file-a')
  expect(duplicate.findings.flatMap(finding => finding.evidenceReferences).map(reference => reference.fileId))
    .not.toContain('file-b')
})

test('runs, filters, inspects, persists, and reruns grounded findings in the real Review UI', async ({ page }) => {
  test.setTimeout(120_000)
  const projectName = `Grounded Review UI ${Date.now()}`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'operations-a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from([
        '# Recovery',
        '',
        'Retention period is 30 days.',
        '',
        'See section "Recovery Procedure".',
        '',
        '"Workspace" is the canonical term. "Workspace" appears throughout operations.',
      ].join('\n')),
    },
    {
      name: 'operations-b.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from([
        '# Retention',
        '',
        'Retention period is 60 days.',
        '',
        'The source also uses "workspace".',
      ].join('\n')),
    },
  ])
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length).toBe(2)
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return Object.values((project.sourceExtractions ?? {}) as Record<string, { status: string }>)
      .filter(extraction => extraction.status === 'extracted').length
  }).toBe(2)
  const stored = await readProject(page, projectName)
  const evidenceIndex = buildEvidenceIndex(
    stored.sourceExtractions as Record<string, SourceExtraction>, stored.sourcesRevision,
  )
  expect(new Set(evidenceIndex.items.map(item => item.fileId)).size).toBe(2)
  const item = (text: string) => {
    const found = evidenceIndex.items.find(candidate => candidate.text.includes(text))
    if (!found) throw new Error(`Evidence not found: ${text}`)
    return found
  }
  const retention30 = item('30 days')
  const retention60 = evidenceIndex.items.find(candidate => candidate.id !== retention30.id)
  if (!retention60) throw new Error('Expected a second evidence item for the conflict fixture')
  const recoveryReference = item('Recovery Procedure')
  const termEvidence = evidenceIndex.items.filter(candidate => /Workspace|workspace/.test(candidate.text))
  if (!termEvidence.length) termEvidence.push(retention30)
  const evidenceRef = (candidate: EvidenceIndex['items'][number]) => ({
    evidenceId: candidate.id,
    sourceId: candidate.sourceId,
    fileId: candidate.fileId,
    sourceFileName: candidate.sourceFileName,
    location: candidate.location,
  })
  const conceptAnalysis: ConceptAnalysis = {
    version: 2,
    method: 'deterministic-evidence-heuristics-v1',
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    builtAt: Date.now(),
    concepts: [],
    terminology: [{
      id: 'term-workspace-ui',
      normalizedLabel: 'Workspace',
      exactTerms: ['Workspace', 'workspace'],
      occurrenceCount: 3,
      sourceCount: 2,
      evidenceIds: termEvidence.map(candidate => candidate.id),
      evidenceRefs: termEvidence.map(evidenceRef),
    }],
    conflicts: [{
      id: 'conflict-retention-ui',
      subject: 'Retention period',
      kind: 'explicit-value',
      summary: 'Sources give different explicit values for Retention period.',
      rationale: 'Concrete statements in two sources use incompatible values: 30 days versus 60 days.',
      sides: [
        {
          id: 'side-retention-30',
          label: '30 days',
          claimText: 'Retention period is 30 days',
          evidenceIds: [retention30.id],
          evidenceRefs: [evidenceRef(retention30)],
        },
        {
          id: 'side-retention-60',
          label: '60 days',
          claimText: 'Retention period is 60 days',
          evidenceIds: [retention60.id],
          evidenceRefs: [evidenceRef(retention60)],
        },
      ],
      evidenceIds: [retention30.id, retention60.id],
      evidenceRefs: [evidenceRef(retention30), evidenceRef(retention60)],
    }],
    gaps: [{
      id: 'gap-recovery-ui',
      category: 'unresolved-reference',
      status: 'not-found-in-sources',
      title: 'Referenced topic not found: Recovery Procedure',
      rationale: 'A source explicitly references Recovery Procedure, but no matching source heading is present.',
      evidenceIds: [recoveryReference.id],
      evidenceRefs: [evidenceRef(recoveryReference)],
    }],
  }
  await patchProject(page, projectName, {
    appToc: [{
      id: 1,
      topicId: 'topic-recovery-ui',
      title: 'Recovery and Retention',
      level: 1,
      words: 100,
    }],
    topicContent: {
      'topic-recovery-ui': [{
        id: 'block-recovery-ui',
        type: 'para',
        content: 'The workspace always recovers in five minutes.',
      }],
    },
    contentRevision: 1,
    analysisRevision: evidenceIndex.sourcesRevision,
    evidenceIndex,
    conceptAnalysis,
    unsupportedAnalysis: null,
    reviewModel: createEmptyReviewModel(stored.projectId),
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Analysis/ }).click()
  await page.getByRole('button', { name: /Recheck Content|Check Content/ }).click()
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return (project.unsupportedAnalysis as UnsupportedAnalysis | null)?.findings.length ?? 0
  }).toBeGreaterThan(0)
  await expect.poll(async () =>
    (await readProject(page, projectName)).reviewModel.inputSnapshot?.readiness,
  ).toBe('ready')

  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await expect(page.getByTestId('run-grounded-review')).toBeEnabled()
  await page.getByTestId('run-grounded-review').click()
  await expect(page.getByTestId('grounded-review-finding')).toHaveCount(4)
  await expect(page.getByTestId('grounded-review-finding').filter({ hasText: 'Unsupported Claim' })).toBeVisible()
  await expect(page.getByTestId('grounded-review-finding').filter({ hasText: 'Source Gap' })).toBeVisible()
  await expect(page.getByTestId('grounded-review-finding').filter({ hasText: 'Conflict' })).toBeVisible()
  await expect(page.getByTestId('grounded-review-finding').filter({ hasText: 'Terminology' })).toBeVisible()

  await page.getByTestId('grounded-review-finding').filter({ hasText: 'Unsupported Claim' })
    .getByTestId('review-open-in-author').click()
  await expect(page.getByTestId('real-review-author-context')).toHaveAttribute('data-focus-status', 'focused')
  await expect(page.locator('[data-author-block-id="block-recovery-ui"]')).toContainText('five minutes')
  expect(await page.evaluate(() => document.activeElement?.closest('[data-author-block-id]')?.getAttribute('data-author-block-id')))
    .toBe('block-recovery-ui')
  await page.getByTestId('real-review-author-context').getByRole('button', { name: /Back to Review/ }).click()
  await expect(page.getByTestId('real-review-findings')).toBeVisible()
  expect((await readProject(page, projectName)).contentRevision).toBe(1)
  await expect(page.getByTestId('run-grounded-review')).toBeEnabled({ timeout: 10_000 })

  await page.getByTestId('review-category-filter').selectOption('Conflict')
  await expect(page.getByTestId('grounded-review-finding')).toHaveCount(1)
  await page.getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByTestId('review-finding-inspector')).toContainText('operations-a.md')
  await expect(page.getByTestId('review-finding-inspector')).toContainText('Retention period is 30 days.')
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await page.getByTestId('review-status-filter').selectOption('active')

  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.runs.length).toBe(1)
  await expect(page.getByTestId('run-grounded-review')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('run-grounded-review').click()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.runs.length).toBe(2)
  const rerun = (await readProject(page, projectName)).reviewModel
  expect(rerun.findings).toHaveLength(8)
  expect(new Set(rerun.runs.map(run => run.reviewRunId)).size).toBe(2)
  await page.getByTestId('review-run-filter').selectOption(rerun.runs[0].reviewRunId)
  await page.getByTestId('review-status-filter').selectOption('resolved')
  await page.getByTestId('grounded-review-finding').getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeDisabled()
  await expect(page.getByTestId('review-action-unavailable')).toContainText('Rerun Review')
  await page.getByTestId('review-category-filter').selectOption('Unsupported Claim')
  await page.getByTestId('review-status-filter').selectOption('active')
  await page.getByTestId('grounded-review-finding').getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeDisabled()
  await expect(page.getByTestId('review-open-in-author')).toBeDisabled()
  await page.getByTestId('review-run-filter').selectOption(rerun.activeReviewRunId!)
  await expect(page.getByTestId('review-open-in-author')).toBeEnabled()
  await page.reload()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.runs.length).toBe(2)
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.findings.length).toBe(8)
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  // Rehydrated grounding metadata may make an older run stale; rerun from the current ready snapshot.
  await expect(page.getByTestId('run-grounded-review')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('run-grounded-review').click()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.runs.length).toBe(3)
  await page.getByTestId('review-category-filter').selectOption('Unsupported Claim')
  await page.getByTestId('review-open-in-author').click()
  await expect(page.getByTestId('real-review-author-context')).toHaveAttribute('data-focus-status', 'focused')
  await page.getByTestId('real-review-author-context').getByRole('button', { name: /Back to Review/ }).click()

  // A later authored-block edit produces new real language findings without altering old runs.
  const previous = await readProject(page, projectName)
  await patchProject(page, projectName, {
    topicContent: {
      'topic-recovery-ui': [{
        id: 'block-recovery-ui',
        type: 'para',
        content: 'The the workspace always recovers in five minutes. Users should recieve updates.',
      }],
    },
    contentRevision: 2,
    reviewModel: previous.reviewModel,
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Analysis/ }).click()
  await page.getByRole('button', { name: /Recheck Content|Check Content/ }).click()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.inputSnapshot?.readiness)
    .toBe('ready')
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await page.getByTestId('run-grounded-review').click()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.runs.length).toBe(4)
  const updated = (await readProject(page, projectName)).reviewModel
  const activeRun = updated.runs.find(run => run.reviewRunId === updated.activeReviewRunId)!
  const current = updated.findings.filter(finding => activeRun.findingIds.includes(finding.findingId))
  for (const [category, excerpt] of [['Grammar', 'The the'], ['Spelling', 'recieve']]) {
    const finding = current.find(finding => finding.category === category)
    expect(finding).toMatchObject({
      topicId: 'topic-recovery-ui', blockId: 'block-recovery-ui', originalText: excerpt,
      inputSnapshotId: activeRun.inputSnapshotId, status: 'open',
    })
    expect(finding?.styleReferences[0].standardId).toBe('language')
  }
  expect(updated.runs.slice(0, 2).every(run => run.status === 'stale')).toBe(true)
  await page.getByTestId('review-category-filter').selectOption('Spelling')
  await expect(page.getByTestId('grounded-review-finding')).toHaveCount(1)
  await page.getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByTestId('review-finding-inspector')).toContainText('Language')
  await page.getByTestId('review-run-filter').selectOption(updated.runs[0].reviewRunId)
  await page.getByTestId('review-category-filter').selectOption('Unsupported Claim')
  await expect(page.getByTestId('review-navigation-unavailable').first()).toHaveAttribute('data-reason', 'stale')
  await expect(page.getByTestId('review-open-in-author').first()).toBeDisabled()
  await page.getByTestId('grounded-review-finding').first().getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeDisabled()
  await page.reload()
  const persisted = (await readProject(page, projectName)).reviewModel
  expect(persisted.findings.find(finding => finding.findingId === current.find(finding => finding.category === 'Spelling')!.findingId))
    .toMatchObject({ topicId: 'topic-recovery-ui', blockId: 'block-recovery-ui', originalText: 'recieve' })
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await expect(page.getByTestId('review-open-in-author').first()).toBeEnabled()
  const beforeDeletion = await readProject(page, projectName)
  await patchProject(page, projectName, {
    topicContent: { 'topic-recovery-ui': [{ id: 'replacement-block', type: 'para', content: 'Another paragraph.' }] },
    contentRevision: 3,
    reviewModel: beforeDeletion.reviewModel,
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await expect(page.getByTestId('review-navigation-unavailable').first()).toHaveAttribute('data-reason', 'stale')
  await expect(page.getByTestId('review-open-in-author').first()).toBeDisabled()
  await expect(page.getByTestId('review-navigation-unavailable').first()).toContainText('Rerun Review')
  await expect(page.getByTestId('real-review-author-context')).toHaveCount(0)
})

test('previews, rejects, dismisses, and applies only the exact real spelling replacement with persisted history', async ({ page }) => {
  test.setTimeout(90_000)
  const projectName = `Guarded spelling Review ${Date.now()}`
  const original = 'Users should recieve updates.'
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'operations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Recovery\n\nUsers should receive updates.'),
  })
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return Object.values((project.sourceExtractions ?? {}) as Record<string, { status: string }>)
      .filter(item => item.status === 'extracted').length
  }).toBe(1)
  const stored = await readProject(page, projectName)
  const evidenceIndex = buildEvidenceIndex(
    stored.sourceExtractions as Record<string, SourceExtraction>, stored.sourcesRevision,
  )
  await patchProject(page, projectName, {
    appToc: [{ id: 1, topicId: 'topic-spelling', title: 'Recovery', level: 1, words: 100 }],
    topicContent: { 'topic-spelling': [{ id: 'block-spelling', type: 'para', content: original }] },
    contentRevision: 1,
    evidenceIndex,
    conceptAnalysis: buildConceptAnalysis(evidenceIndex),
    analysisRevision: evidenceIndex.sourcesRevision,
    unsupportedAnalysis: null,
    reviewModel: createEmptyReviewModel(stored.projectId),
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Analysis/ }).click()
  await page.getByRole('button', { name: /Recheck Content|Check Content/ }).click()
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.inputSnapshot?.readiness).toBe('ready')
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await page.getByTestId('run-grounded-review').click()
  await page.getByTestId('review-category-filter').selectOption('Spelling')
  await expect(page.getByTestId('grounded-review-finding')).toHaveCount(1)
  await page.getByTestId('grounded-review-finding').getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByTestId('review-suggestion-original')).toHaveText(original)
  await expect(page.getByTestId('review-suggestion-proposed')).toHaveText('Users should receive updates.')
  const findingId = (await readProject(page, projectName)).reviewModel.findings.find(item => item.category === 'Spelling')!.findingId
  await page.getByTestId('review-reject-spelling').click()
  await page.getByTestId('review-status-filter').selectOption('rejected')
  await expect(page.getByTestId('grounded-review-finding')).toHaveCount(1)
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.findings.find(item => item.findingId === findingId)?.status).toBe('rejected')
  expect((await readProject(page, projectName)).topicContent['topic-spelling'][0].content).toBe(original)
  await expect(page.getByTestId('review-resolution-history')).toContainText('rejected')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await page.getByTestId('review-status-filter').selectOption('active')
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByTestId('review-status-filter').selectOption('dismissed')
  await expect.poll(async () => (await readProject(page, projectName)).reviewModel.findings.find(item => item.findingId === findingId)?.status).toBe('dismissed')
  expect((await readProject(page, projectName)).topicContent['topic-spelling'][0].content).toBe(original)
  await expect(page.getByTestId('review-resolution-history')).toContainText('dismissed')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await page.getByTestId('review-status-filter').selectOption('active')
  await page.getByTestId('review-apply-spelling').click()
  await page.getByTestId('review-status-filter').selectOption('resolved')
  await expect.poll(async () => {
    const project = await readProject(page, projectName)
    return [project.topicContent['topic-spelling'][0].content, project.reviewModel.findings.find(item => item.findingId === findingId)?.status]
  }).toEqual(['Users should receive updates.', 'resolved'])
  const applied = await readProject(page, projectName)
  expect(applied.contentRevision).toBe(2)
  expect(applied.reviewModel.findings.find(item => item.findingId === findingId)?.resolutionHistory.map(event => event.action ?? event.status))
    .toEqual(['rejected', 'open', 'dismissed', 'open', 'applied'])
  await page.reload()
  const reloaded = await readProject(page, projectName)
  expect(reloaded.topicContent['topic-spelling'][0].content).toBe('Users should receive updates.')
  expect(reloaded.reviewModel.findings.find(item => item.findingId === findingId))
    .toMatchObject({ status: 'resolved', resolutionHistory: expect.arrayContaining([expect.objectContaining({ action: 'applied' })]) })
  await page.locator('header').getByRole('button', { name: /^Review,/ }).click()
  await page.getByTestId('review-category-filter').selectOption('Spelling')
  await page.getByTestId('review-status-filter').selectOption('resolved')
  await page.getByTestId('grounded-review-finding').getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByTestId('review-resolution-history')).toContainText('applied')
  await expect(page.getByTestId('review-apply-spelling')).toHaveCount(0)
})

test('never exposes or persists grounded real-project findings from explicit demo Review data', async ({ page }) => {
  const projectName = `Grounded Review demo isolation ${Date.now()}`
  await createProject(page, projectName)
  await page.getByRole('button', { name: 'Use demo project', exact: true }).click()
  await page.getByText('Review', { exact: true }).last().click()
  await expect(page.getByTestId('real-review-findings')).toHaveCount(0)
  await expect(page.getByTestId('review-open-in-author')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run AI Review' }).click()
  await expect(page.getByText('6 findings')).toBeVisible({ timeout: 5_000 })
  const project = await readProject(page, projectName)
  expect(project.reviewModel.runs).toEqual([])
  expect(project.reviewModel.findings).toEqual([])
  await expect(page.getByTestId('review-apply-spelling')).toHaveCount(0)
  await expect(page.getByTestId('review-reject-spelling')).toHaveCount(0)
})