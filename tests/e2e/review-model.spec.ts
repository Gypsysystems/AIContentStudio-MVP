import { expect, test, type Page } from '@playwright/test'
import {
  createEmptyReviewModel,
  hydrateReviewModel,
  reconcileReviewModelTopics,
  type ReviewFinding,
  type ReviewInputProvenance,
  type ReviewModel,
} from '../../src/reviewModel'

test.describe.configure({ mode: 'serial' })

type StoredTopic = {
  id: number
  topicId: string
  title: string
  level: 1 | 2 | 3 | 4
  words: number
}

type StoredProject = {
  projectId: string
  projectName: string
  isDemoMode: boolean
  appToc: StoredTopic[]
  sourceFileIds: string[]
  reviewModel?: ReviewModel
}

function provenance(projectId: string, sourceFileIds: string[] = []): ReviewInputProvenance {
  return {
    projectId,
    contentRevision: 4,
    contentFingerprint: 'content-fingerprint',
    sourcesRevision: 2,
    sourceFileIds,
    evidenceExtractionRevision: 'extract-2-stable',
    evidenceIndexBuiltAt: 1_700_000_000_000,
    analysisRevision: 3,
    analysisBuiltAt: 1_700_000_000_100,
    tocRevision: 2,
    contentType: 'user-guide',
    styleProfileId: 'style-project',
    styleFingerprint: 'style-fingerprint',
    standardsFingerprint: 'standards-fingerprint',
    capturedAt: 1_700_000_000_200,
  }
}

function finding(
  projectId: string,
  findingId: string,
  topicId: string,
  sourceFileId?: string,
): ReviewFinding {
  return {
    findingId,
    reviewRunId: 'review-run-stable',
    projectId,
    topicId,
    blockId: `block-${topicId}`,
    category: 'source-grounding',
    severity: 'warning',
    required: true,
    originalText: `Original text for ${topicId}`,
    claimFingerprint: `claim-${topicId}`,
    sourceReferences: sourceFileId ? [{
      projectId,
      sourceId: sourceFileId,
      fileId: sourceFileId,
      sourceFileName: 'review-source.md',
      blockId: 'source-block-1',
      location: 'Review source',
      sectionPath: ['Review source'],
    }] : [],
    evidenceReferences: sourceFileId ? [{
      evidenceId: 'evidence-stable',
      projectId,
      sourceId: sourceFileId,
      fileId: sourceFileId,
      sourceFileName: 'review-source.md',
      location: 'Review source',
    }] : [],
    styleReferences: [{
      styleProfileId: 'style-project',
      standardId: 'standard-plain-language',
      label: 'Plain language',
      fingerprint: 'standard-fingerprint',
    }],
    suggestion: {
      kind: 'replace',
      blockId: `block-${topicId}`,
      originalText: `Original text for ${topicId}`,
      proposedText: `Suggested text for ${topicId}`,
      range: { start: 0, end: 12 },
      rationale: 'Improve grounding.',
    },
    status: 'open',
    dismissalReason: null,
    resolutionHistory: [],
    inputProvenance: provenance(projectId, sourceFileId ? [sourceFileId] : []),
    freshness: {
      status: 'current',
      reasons: [],
      checkedAt: 1_700_000_000_300,
    },
    createdAt: 1_700_000_000_300,
    updatedAt: 1_700_000_000_300,
    retiredAt: null,
    retirementReason: null,
  }
}

function reviewModel(
  projectId: string,
  findings: ReviewFinding[],
  sourceFileIds: string[] = [],
): ReviewModel {
  return {
    version: 1,
    projectId,
    activeReviewRunId: 'review-run-stable',
    inputSnapshot: null,
    runs: [{
      reviewRunId: 'review-run-stable',
      projectId,
      findingIds: findings.map(item => item.findingId),
      inputProvenance: provenance(projectId, sourceFileIds),
      status: 'complete',
      createdAt: 1_700_000_000_200,
      updatedAt: 1_700_000_000_300,
      completedAt: 1_700_000_000_300,
    }],
    findings,
    updatedAt: 1_700_000_000_300,
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
  patch: Partial<StoredProject>,
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

test('hydrates legacy and demo projects to an empty isolated Review model', () => {
  expect(hydrateReviewModel(undefined, 'legacy-project'))
    .toEqual(createEmptyReviewModel('legacy-project'))
  expect(hydrateReviewModel(undefined, 'explicit-demo-project').findings).toEqual([])
})

test('keeps stable IDs and retires only findings for deleted topics', () => {
  const projectId = 'project-topic-lifecycle'
  const original = reviewModel(projectId, [
    finding(projectId, 'finding-alpha', 'topic-alpha'),
    finding(projectId, 'finding-beta', 'topic-beta'),
  ])
  const hydrated = hydrateReviewModel(original, projectId)
  const reconciled = reconcileReviewModelTopics(hydrated, ['topic-alpha'], 1_800_000_000_000)

  expect(reconciled.activeReviewRunId).toBe('review-run-stable')
  expect(reconciled.runs[0].reviewRunId).toBe('review-run-stable')
  expect(reconciled.findings.map(item => item.findingId))
    .toEqual(['finding-alpha', 'finding-beta'])
  expect(reconciled.findings[0]).toMatchObject({
    findingId: 'finding-alpha',
    status: 'open',
    retiredAt: null,
  })
  expect(reconciled.findings[1]).toMatchObject({
    findingId: 'finding-beta',
    status: 'retired',
    retiredAt: 1_800_000_000_000,
    retirementReason: 'topic-deleted',
  })
  expect(reconciled.findings[1].resolutionHistory).toEqual([
    expect.objectContaining({
      status: 'retired',
      reason: 'topic-deleted',
      actor: 'system',
      at: 1_800_000_000_000,
    }),
  ])
})

test('persists and reloads structured Review data without changing stable IDs', async ({ page }) => {
  const projectName = `Review persistence ${Date.now()}`
  await createProject(page, projectName)
  const project = await readProject(page, projectName)
  const persisted = reviewModel(project.projectId, [
    finding(project.projectId, 'finding-persisted', 'topic-persisted'),
  ])

  await patchProject(page, projectName, {
    appToc: [{
      id: 1,
      topicId: 'topic-persisted',
      title: 'Persisted topic',
      level: 1,
      words: 100,
    }],
    reviewModel: persisted,
  })
  await page.reload()

  await expect.poll(async () =>
    (await readProject(page, projectName)).reviewModel?.activeReviewRunId,
  ).toBe('review-run-stable')
  const reloaded = (await readProject(page, projectName)).reviewModel!
  expect(reloaded.runs[0].reviewRunId).toBe('review-run-stable')
  expect(reloaded.findings[0]).toMatchObject({
    findingId: 'finding-persisted',
    reviewRunId: 'review-run-stable',
    topicId: 'topic-persisted',
    blockId: 'block-topic-persisted',
    claimFingerprint: 'claim-topic-persisted',
    status: 'open',
  })
})

test('retires only the affected persisted finding when its topic is deleted', async ({ page }) => {
  const projectName = `Review topic deletion ${Date.now()}`
  await createProject(page, projectName)
  const project = await readProject(page, projectName)
  const toc: StoredTopic[] = [
    { id: 1, topicId: 'topic-alpha', title: 'Alpha', level: 1, words: 100 },
    { id: 2, topicId: 'topic-beta', title: 'Beta', level: 1, words: 100 },
  ]
  await patchProject(page, projectName, {
    appToc: toc,
    reviewModel: reviewModel(project.projectId, [
      finding(project.projectId, 'finding-alpha', 'topic-alpha'),
      finding(project.projectId, 'finding-beta', 'topic-beta'),
    ]),
  })
  await page.reload()
  await page.locator('header').getByRole('button', { name: /^Author,/ }).click()

  const beta = page.getByTestId("author-outline").locator('[data-topic-id="topic-beta"]')
  await beta.hover()
  await beta.getByTitle('Delete').click()
  await expect(beta).toHaveCount(0)
  await expect.poll(async () => {
    const stored = (await readProject(page, projectName)).reviewModel!
    return stored.findings.map(item => ({
      findingId: item.findingId,
      status: item.status,
      reason: item.retirementReason,
    }))
  }).toEqual([
    { findingId: 'finding-alpha', status: 'open', reason: null },
    { findingId: 'finding-beta', status: 'retired', reason: 'topic-deleted' },
  ])
})

test('duplicates Review history while remapping copied project and source references', async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = `Review duplication ${Date.now()}`
  const duplicateName = `${projectName} Copy`
  await createProject(page, projectName)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'review-source.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Review source\n\nGrounded Review source text.'),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
  await expect.poll(async () => (await readProject(page, projectName)).sourceFileIds.length)
    .toBe(1)
  const project = await readProject(page, projectName)
  const sourceFileId = project.sourceFileIds[0]
  await patchProject(page, projectName, {
    appToc: [{
      id: 1,
      topicId: 'topic-grounded',
      title: 'Grounded',
      level: 1,
      words: 100,
    }],
    reviewModel: reviewModel(
      project.projectId,
      [finding(project.projectId, 'finding-grounded', 'topic-grounded', sourceFileId)],
      [sourceFileId],
    ),
  })
  await page.reload()
  await page.getByRole('button', { name: /Content Studio/ }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Duplicate project' })).toBeVisible()
  await page.getByLabel('Name for copy').fill(duplicateName)
  await page.getByRole('button', { name: `Create copy as “${duplicateName}”` }).click()
  await expect(page.getByText(duplicateName, { exact: true })).toBeVisible()

  const duplicate = await readProject(page, duplicateName)
  const copiedSourceFileId = duplicate.sourceFileIds[0]
  const copiedModel = duplicate.reviewModel!
  expect(copiedSourceFileId).not.toBe(sourceFileId)
  expect(copiedModel.projectId).toBe(duplicate.projectId)
  expect(copiedModel.runs[0]).toMatchObject({
    reviewRunId: 'review-run-stable',
    projectId: duplicate.projectId,
  })
  expect(copiedModel.runs[0].inputProvenance.sourceFileIds).toEqual([copiedSourceFileId])
  expect(copiedModel.findings[0]).toMatchObject({
    findingId: 'finding-grounded',
    reviewRunId: 'review-run-stable',
    projectId: duplicate.projectId,
    topicId: 'topic-grounded',
  })
  expect(copiedModel.findings[0].sourceReferences[0]).toMatchObject({
    projectId: duplicate.projectId,
    sourceId: copiedSourceFileId,
    fileId: copiedSourceFileId,
  })
  expect(copiedModel.findings[0].evidenceReferences[0]).toMatchObject({
    evidenceId: 'evidence-stable',
    projectId: duplicate.projectId,
    sourceId: copiedSourceFileId,
    fileId: copiedSourceFileId,
  })
  expect(copiedModel.findings[0].inputProvenance.sourceFileIds)
    .toEqual([copiedSourceFileId])
})