import { expect, test, type Page } from '@playwright/test'
import {
  createManualAuthorTopicMetadata,
  type AuthorTopicMetadataMap,
} from '../../src/authorMetadata'
import {
  CONCEPT_ANALYSIS_METHOD,
  type ConceptAnalysis,
} from '../../src/conceptAnalysis'
import type { EvidenceIndex } from '../../src/evidenceIndex'
import {
  buildReviewInputSnapshot,
  type BuildReviewInputSnapshotInput,
  type ReviewInputSnapshot,
} from '../../src/reviewInput'
import { createEmptyReviewModel, type ReviewModel } from '../../src/reviewModel'
import type { SourceExtraction } from '../../src/sourceExtractor'
import {
  UNSUPPORTED_ANALYSIS_METHOD,
  type UnsupportedAnalysis,
} from '../../src/unsupportedAnalysis'

test.describe.configure({ mode: 'serial' })

type StoredProject = {
  projectId: string
  projectName: string
  isDemoMode: boolean
  appToc: unknown[]
  topicContent: Record<string, unknown[]>
  sourceFileIds: string[]
  reviewModel: ReviewModel
}

function completeInput(
  projectId: string,
  capturedAt = 1_700_000_000_000,
  fileId = 'file-review',
): BuildReviewInputSnapshotInput {
  const extraction: SourceExtraction = {
    sourceId: fileId,
    fileName: 'review-source.md',
    fileType: 'md',
    status: 'extracted',
    extractedText: 'Canonical Workspace terminology.',
    warnings: [],
    sourceRevision: 2,
    extractionRevision: 2,
    extractedAt: 1_699_999_999_000,
    blocks: [{
      id: 'source-block-stable',
      sourceId: fileId,
      type: 'paragraph',
      text: 'Canonical Workspace terminology.',
      order: 0,
      sectionPath: ['Terminology'],
    }],
  }
  const evidenceIndex: EvidenceIndex = {
    items: [{
      id: 'evidence-stable',
      sourceId: fileId,
      fileId,
      blockId: 'source-block-stable',
      sourceFileName: 'review-source.md',
      text: 'Canonical Workspace terminology.',
      blockType: 'paragraph',
      order: 0,
      location: 'Terminology',
      sectionPath: ['Terminology'],
    }],
    sourcesRevision: 2,
    extractionRevision: 'extract-stable',
    builtAt: 1_699_999_999_100,
  }
  const conceptAnalysis: ConceptAnalysis = {
    version: 2,
    method: CONCEPT_ANALYSIS_METHOD,
    evidenceSourcesRevision: 2,
    evidenceExtractionRevision: 'extract-stable',
    builtAt: 1_699_999_999_200,
    concepts: [{
      id: 'concept-workspace',
      label: 'Workspace',
      exactTerms: ['Workspace'],
      occurrenceCount: 1,
      sourceCount: 1,
      evidenceIds: ['evidence-stable'],
      evidenceRefs: [{
        evidenceId: 'evidence-stable',
        sourceId: fileId,
        fileId,
        sourceFileName: 'review-source.md',
        location: 'Terminology',
      }],
    }],
    terminology: [{
      id: 'term-workspace',
      normalizedLabel: 'Workspace',
      exactTerms: ['Workspace', 'workspace'],
      occurrenceCount: 2,
      sourceCount: 1,
      evidenceIds: ['evidence-stable'],
      evidenceRefs: [{
        evidenceId: 'evidence-stable',
        sourceId: fileId,
        fileId,
        sourceFileName: 'review-source.md',
        location: 'Terminology',
      }],
    }],
    conflicts: [],
    gaps: [],
  }
  const unsupportedAnalysis: UnsupportedAnalysis = {
    version: 1,
    method: UNSUPPORTED_ANALYSIS_METHOD,
    evidenceSourcesRevision: 2,
    evidenceExtractionRevision: 'extract-stable',
    groundedAnalysisBuiltAt: conceptAnalysis.builtAt,
    contentRevision: 4,
    contentFingerprint: 'content-stable',
    builtAt: 1_699_999_999_300,
    status: 'complete',
    analyzedClaimCount: 1,
    supportedClaimCount: 1,
    findings: [],
  }
  const author = createManualAuthorTopicMetadata(
    'topic-stable',
    { contentType: 'user-guide', variables: [] },
    false,
  )
  author.blockStates = { 'block-stable': 'manually-edited' }
  const authorTopicMetadata: AuthorTopicMetadataMap = { 'topic-stable': author }

  return {
    projectId,
    capturedAt,
    contentType: 'user-guide',
    language: 'en-US',
    contentRevision: 4,
    tocRevision: 3,
    topics: [{
      id: 7,
      topicId: 'topic-stable',
      title: 'Stable topic',
      level: 1,
      order: 0,
    }],
    topicContent: {
      'topic-stable': [{
        id: 'block-stable',
        type: 'para',
        content: 'Persisted project content.',
      }],
    },
    sourcesRevision: 2,
    sourceFileIds: [fileId],
    sourceExtractions: { [fileId]: extraction },
    evidenceIndex,
    evidenceFresh: true,
    conceptAnalysis,
    conceptAnalysisFresh: true,
    analysisRevision: 2,
    unsupportedAnalysis,
    unsupportedAnalysisFresh: true,
    styleProfile: {
      id: 'style-canonical',
      name: 'Canonical Style',
      scope: 'project',
      source: 'Project profile',
      body: { fontFamily: 'Inter', fontSize: 11 },
      h1: { fontFamily: 'Inter', fontSize: 28 },
      links: { color: '#5B5BD6', underline: true },
      lists: { bulletL1: 'disc' },
      tables: { headerFontWeight: '600' },
      callouts: { warning: { label: 'Warning' } },
    },
    authorTopicMetadata,
  }
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
      const request = indexedDB.open('docflow-db', 2)
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
  patch: Partial<StoredProject> & Record<string, unknown>,
) {
  await page.evaluate(async ({ name, values }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const project = await new Promise<StoredProject>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const found = (request.result as StoredProject[])
          .find(candidate => candidate.projectName === name)
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

test('builds a deterministic snapshot from stable project topic, block, evidence, style, and Author inputs', () => {
  const first = buildReviewInputSnapshot(completeInput('project-input', 1_700_000_000_000))
  const second = buildReviewInputSnapshot(completeInput('project-input', 1_800_000_000_000))

  expect(first.snapshotId).toBe(second.snapshotId)
  expect(first.readiness).toBe('ready')
  expect(first.issues).toEqual([])
  expect(first.topics[0]).toMatchObject({
    topicId: 'topic-stable',
    title: 'Stable topic',
    blocks: [{
      blockId: 'block-stable',
      type: 'para',
      content: 'Persisted project content.',
      fingerprint: expect.stringMatching(/^review-block-/),
    }],
  })
  expect(first.sources[0]).toMatchObject({
    sourceId: 'file-review',
    fileId: 'file-review',
    blockIds: ['source-block-stable'],
  })
  expect(first.evidence[0]).toMatchObject({
    evidenceId: 'evidence-stable',
    blockId: 'source-block-stable',
  })
  expect(first.groundedAnalysis).toMatchObject({
    fresh: true,
    conceptIds: ['concept-workspace'],
    terminologyIds: ['term-workspace'],
  })
  expect(first.terminology[0]).toMatchObject({
    termId: 'term-workspace',
    preferredTerm: 'Workspace',
  })
  expect(first.style).toMatchObject({
    styleProfileId: 'style-canonical',
    name: 'Canonical Style',
  })
  expect(first.authorTopics[0]).toMatchObject({
    topicId: 'topic-stable',
    generatedFreshness: 'not-applicable',
    blockStates: { 'block-stable': 'manually-edited' },
  })
})

test('captures only explicitly configured writing and formatting rules plus observable table structure', () => {
  const input = completeInput('project-rules')
  input.topicContent['topic-stable'].push({
    id: 'table-stable', type: 'table', content: 'Name | Value',
    tableData: { rows: [['Alice', '1']], hasHeader: false },
  })
  input.styleProfile = {
    ...input.styleProfile!,
    writingRules: { activeVoice: true, directAddress: true },
    formattingRules: { requireTableHeader: true },
  }
  const configured = buildReviewInputSnapshot(input)
  const writing = configured.standards.find(standard => standard.standardId === 'writing-rules')
  const formatting = configured.standards.find(standard => standard.standardId === 'formatting-rules')
  expect(JSON.parse(writing!.value)).toEqual({ activeVoice: true, directAddress: true })
  expect(JSON.parse(formatting!.value)).toEqual({ requireTableHeader: true })
  expect(configured.topics[0].blocks.find(block => block.blockId === 'table-stable')?.tableHasHeader).toBe(false)
  expect(configured.topics[0].blocks.find(block => block.blockId === 'table-stable')?.tableExcerpt).toBe('Alice | 1')
  expect(configured.topics[0].blocks.find(block => block.blockId === 'block-stable')?.tableHasHeader).toBeUndefined()

  const withoutRules = buildReviewInputSnapshot({
    ...input, styleProfile: { ...input.styleProfile, writingRules: undefined, formattingRules: undefined },
  })
  expect(withoutRules.standards.some(standard => standard.standardId === 'writing-rules'
    || standard.standardId === 'formatting-rules')).toBe(false)
  expect(withoutRules.snapshotId).not.toBe(configured.snapshotId)
})

test('reports deterministic missing and stale Review inputs without creating findings', () => {
  const complete = completeInput('project-stale')
  const missing = buildReviewInputSnapshot({
    ...complete,
    topics: [],
    topicContent: {},
    sourceFileIds: [],
    sourceExtractions: {},
    evidenceIndex: null,
    evidenceFresh: false,
    conceptAnalysis: null,
    conceptAnalysisFresh: false,
    unsupportedAnalysis: null,
    unsupportedAnalysisFresh: false,
    styleProfile: null,
    authorTopicMetadata: {},
  })
  expect(missing.readiness).toBe('missing-inputs')
  expect(missing.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
    'toc-missing',
    'topic-content-missing',
    'sources-missing',
    'evidence-missing',
    'grounded-analysis-missing',
    'unsupported-analysis-missing',
    'style-profile-missing',
  ]))

  const staleAuthor = structuredClone(complete.authorTopicMetadata)
  staleAuthor['topic-stable'].generatedFreshness = 'stale'
  staleAuthor['topic-stable'].generatedFreshnessReason = 'sources-changed'
  const stale = buildReviewInputSnapshot({
    ...complete,
    evidenceFresh: false,
    conceptAnalysisFresh: false,
    unsupportedAnalysisFresh: false,
    authorTopicMetadata: staleAuthor,
  })
  expect(stale.readiness).toBe('stale-inputs')
  expect(stale.issues.map(issue => issue.code)).toEqual([
    'evidence-stale',
    'grounded-analysis-stale',
    'unsupported-analysis-stale',
    'author-grounding-stale',
  ])
})

test('persists and reloads real Review inputs and exposes stable topic and block references', async ({ page }) => {
  const projectName = `Review input persistence ${Date.now()}`
  await createProject(page, projectName)
  const project = await readProject(page, projectName)
  await patchProject(page, projectName, {
    appToc: [{
      id: 7,
      topicId: 'topic-persisted',
      title: 'Persisted Review topic',
      level: 1,
      words: 100,
    }],
    topicContent: {
      'topic-persisted': [{
        id: 'block-persisted',
        type: 'para',
        content: 'Only persisted project content is reviewed.',
      }],
    },
    reviewModel: createEmptyReviewModel(project.projectId),
  })
  await page.reload()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByTestId('review-input-diagnostics')).toBeVisible()
  await page.getByTestId('review-input-topics').locator('summary').click()
  await expect(page.getByTestId('review-input-topics')).toContainText('topic-persisted')
  await expect(page.getByTestId('review-input-topics')).toContainText('block-persisted')

  await expect.poll(async () =>
    (await readProject(page, projectName)).reviewModel.inputSnapshot?.snapshotId,
  ).toMatch(/^review-input-/)
  await page.waitForTimeout(3_000)
  const persistedBeforeReload = (await readProject(page, projectName)).reviewModel.inputSnapshot!
  expect((await readProject(page, projectName)).reviewModel.findings).toEqual([])

  await page.reload()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForTimeout(1_500)
  await expect.poll(async () =>
    (await readProject(page, projectName)).reviewModel.inputSnapshot?.provenance.contentFingerprint,
  ).toBe(persistedBeforeReload.provenance.contentFingerprint)
  const persistedAfterReload = (await readProject(page, projectName)).reviewModel.inputSnapshot!
  expect(persistedAfterReload.topics).toEqual(persistedBeforeReload.topics)
  expect(persistedAfterReload.projectId).toBe(project.projectId)
  await expect(page.getByTestId('review-input-topics')).toContainText('topic-persisted')
})

test('remaps a persisted Review input snapshot when its project and source are duplicated', async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Review input duplicate ${Date.now()}`
  const duplicateName = `${projectName} Copy`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'review-input-source.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Review input source\n\nProject-only evidence.'),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length).toBe(1)
  const project = await readProject(page, projectName)
  const sourceFileId = project.sourceFileIds[0]
  const snapshot = buildReviewInputSnapshot(completeInput(project.projectId, undefined, sourceFileId))
  await patchProject(page, projectName, {
    reviewModel: {
      ...createEmptyReviewModel(project.projectId),
      inputSnapshot: snapshot,
      updatedAt: snapshot.capturedAt,
    },
  })
  await page.reload()
  await page.getByRole('button', { name: /Content Studio/ }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Duplicate project' })).toBeVisible()
  await page.getByLabel('Name for copy').fill(duplicateName)
  await page.getByRole('button', { name: `Create copy as “${duplicateName}”` }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const duplicate = await readProject(page, duplicateName)
  const copiedSourceId = duplicate.sourceFileIds[0]
  const copiedSnapshot = duplicate.reviewModel.inputSnapshot!
  expect(copiedSourceId).not.toBe(sourceFileId)
  expect(copiedSnapshot.projectId).toBe(duplicate.projectId)
  expect(copiedSnapshot.provenance.projectId).toBe(duplicate.projectId)
  expect(copiedSnapshot.provenance.sourceFileIds).toEqual([copiedSourceId])
  expect(copiedSnapshot.sources[0]).toMatchObject({
    sourceId: copiedSourceId,
    fileId: copiedSourceId,
  })
  expect(copiedSnapshot.evidence[0]).toMatchObject({
    sourceId: copiedSourceId,
    fileId: copiedSourceId,
  })
  expect(copiedSnapshot.snapshotId).not.toBe(snapshot.snapshotId)
})

test('keeps real Review diagnostics and persisted inputs isolated from explicit demo Review data', async ({ page }) => {
  const projectName = `Review input demo isolation ${Date.now()}`
  await createProject(page, projectName)
  await page.getByRole('button', { name: 'Use demo project', exact: true }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()

  await expect(page.getByTestId('review-input-diagnostics')).toHaveCount(0)
  await expect(page.getByText('Ready to analyze your document')).toBeVisible()
  const project = await readProject(page, projectName)
  expect(project.reviewModel.findings).toEqual([])
  expect(JSON.stringify(project.reviewModel.inputSnapshot ?? {})).not.toMatch(
    /Nexus|Technical Specification|UX_Research/,
  )
})