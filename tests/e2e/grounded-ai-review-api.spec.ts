import { expect, test } from '@playwright/test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildConceptAnalysis, isConceptAnalysisFresh } from '../../src/conceptAnalysis'
import { buildEvidenceIndex, isEvidenceIndexFresh } from '../../src/evidenceIndex'
import { buildReviewInputSnapshot } from '../../src/reviewInput'
import { createEmptyReviewModel } from '../../src/reviewModel'
import { buildGroundedReviewRun } from '../../src/reviewFindings'
import { buildUnsupportedAnalysis, isUnsupportedAnalysisFresh } from '../../src/unsupportedAnalysis'
import type { ProjectRecord } from '../../src/projectRepository'
import type { SourceExtraction } from '../../src/sourceExtractor'
import { normalizeTopicIds } from '../../src/tocProposal'
import { AiCatalogApiError, type AiWorkflowExecutionBundle } from '../../server/aiCatalogApi'
import {
  buildAuthoritativeAiReviewSnapshot,
  handleGroundedAiReview,
} from '../../server/groundedAiReviewApi'
import { GroundedTocProviderError } from '../../server/groundedTocProvider'

const PROJECT = 'ai-review-project'
const WORKSPACE = 'ai-review-workspace'
const SECRET = 'never-return-this-provider-secret'
const TOPIC = 'topic-install'
const BLOCK = 'author-block-1'

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const sourceExtractions: Record<string, SourceExtraction> = {
    'source-a': {
      sourceId: 'source-a',
      fileName: 'install-guide.md',
      fileType: 'text/markdown',
      status: 'extracted',
      blocks: [{
        id: 'source-block-1',
        sourceId: 'source-a',
        type: 'paragraph',
        text: 'Download the application from the project source before installation.',
        order: 0,
        sectionPath: ['Install'],
      }],
      extractedText: 'Download the application from the project source before installation.',
      warnings: [],
      sourceRevision: 1,
      extractionRevision: 1,
    },
  }
  const evidenceIndex = buildEvidenceIndex(sourceExtractions, 1)
  const conceptAnalysis = buildConceptAnalysis(evidenceIndex)
  const topicContent = {
    [TOPIC]: [{ id: BLOCK, type: 'para', content: 'Download the application before installation.' }],
  }
  const unsupportedAnalysis = buildUnsupportedAnalysis(evidenceIndex, conceptAnalysis, 3, [{
    id: `${BLOCK}-content`,
    text: topicContent[TOPIC][0].content,
    contextType: 'topic-block',
    location: `Topic ${TOPIC} · block ${BLOCK}`,
    blockId: BLOCK,
    topicId: TOPIC,
  }])
  const profile = {
    id: 'profile-ai',
    name: 'Project Style',
    clientId: 'workspace-client',
    scope: 'project',
    body: { fontFamily: 'Arial', fontSize: 12 },
    h1: { fontFamily: 'Arial', fontSize: 20 },
    h2: { fontFamily: 'Arial', fontSize: 18 },
    h3: { fontFamily: 'Arial', fontSize: 16 },
    h4: { fontFamily: 'Arial', fontSize: 14 },
    caption: { fontFamily: 'Arial', fontSize: 10 },
    code: { fontFamily: 'monospace', fontSize: 10 },
    links: { underline: true },
    lists: { orderedL1: 'decimal' },
    tables: { headerFontWeight: 'bold' },
    callouts: { note: { label: 'Note' } },
    writingRules: 'Use concise active language.',
  }
  return {
    projectId: PROJECT,
    schemaVersion: 1,
    recordRevision: 8,
    projectName: 'AI Review project',
    documentType: 'User Guide',
    version: '1',
    createdAt: 1,
    modifiedAt: 1,
    isDemoMode: false,
    ownerUserId: 'owner',
    workspaceId: WORKSPACE,
    themes: [{ id: 'theme-1', styleProfiles: [profile] }],
    projectMeta: { themeId: 'theme-1', styleProfileId: profile.id, contentType: 'User Guide', language: 'English' },
    activeStyleProfileId: profile.id,
    themeVariables: {},
    sourceFileIds: ['source-a'],
    sourcesRevision: 1,
    analysisRevision: 2,
    conceptAnalysis,
    unsupportedAnalysis,
    appToc: [{ id: 1, topicId: TOPIC, title: 'Install', level: 1 }],
    tocRevision: 3,
    sourceExtractions,
    evidenceIndex,
    authorTopicMetadata: {},
    topicContent,
    docBlocks: [],
    contentRevision: 3,
    reviewModel: createEmptyReviewModel(PROJECT),
    ...overrides,
  } as unknown as ProjectRecord
}

function workflowBundle(capability = ' AI_review '): AiWorkflowExecutionBundle {
  const asset = (
    id: string,
    kind: 'workflow' | 'prompt-pack' | 'reference-set' | 'blueprint',
    definition: unknown,
    version: number,
  ) => ({
    workspaceId: WORKSPACE,
    id,
    kind,
    version,
    state: 'published' as const,
    name: id,
    description: '',
    definition,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test-user',
  })
  const workflow = asset('workflow-ai-review', 'workflow', {
    capability,
    model: { mode: 'pinned', providerId: 'openai', modelId: 'review-model-v1' },
    promptPack: { id: 'ai-review-prompt', version: 2 },
    referenceSet: { id: 'ai-review-reference', version: 3 },
    blueprint: { id: 'ai-review-blueprint', version: 4 },
    steps: [{ id: 'review', capability }],
  }, 5)
  const promptPack = asset('ai-review-prompt', 'prompt-pack', {
    prompts: [{ id: 'review', version: 1, state: 'published', name: 'Review', template: 'Review content', variables: [] }],
  }, 2)
  const referenceSet = asset('ai-review-reference', 'reference-set', {
    entries: [{ id: 'reference', type: 'example', title: 'Untrusted text', locator: 'none', note: 'not evidence' }],
  }, 3)
  const blueprint = asset('ai-review-blueprint', 'blueprint', {
    contentType: 'User Guide',
    sections: [{ id: 'content', title: 'Content', required: false, rules: [] }],
  }, 4)
  return {
    readiness: {
      status: 'ready',
      workflow: { id: workflow.id, version: workflow.version },
      dependencies: {
        promptPack: { id: promptPack.id, version: promptPack.version, name: promptPack.id, state: 'published' },
        referenceSet: { id: referenceSet.id, version: referenceSet.version, name: referenceSet.id, state: 'published' },
        blueprint: { id: blueprint.id, version: blueprint.version, name: blueprint.id, state: 'published' },
      },
      model: { providerId: 'openai', modelId: 'review-model-v1' },
      checkedAt: '2026-01-01T00:00:00.000Z',
      blockers: [],
    },
    workflow, promptPack, referenceSet, blueprint,
    credential: SECRET,
    connectionRevision: 1,
  } as unknown as AiWorkflowExecutionBundle
}

function requestFor(body: unknown): IncomingMessage {
  return Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage
}

function responseRecorder() {
  const headers = new Map<string, string>()
  const target = {
    statusCode: 200,
    body: '',
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end(body?: string) { target.body = body ?? '' },
  }
  return { headers, response: target as unknown as ServerResponse & { body: string } }
}

function requestBody(record: ProjectRecord) {
  return {
    projectId: PROJECT,
    workflowId: 'workflow-ai-review',
    workflowVersion: 5,
    inputSnapshotId: buildAuthoritativeAiReviewSnapshot(record as unknown as Record<string, unknown>).snapshotId,
  }
}

function providerOutput(record: ProjectRecord, overrides: Record<string, unknown> = {}) {
  const evidence = record.evidenceIndex!.items[0]
  return JSON.stringify({
    findings: [{
      kind: 'evidence',
      title: 'Check this statement',
      rationale: 'Compare the statement with the cited source before relying on it.',
      severity: 'suggestion',
      topicId: TOPIC,
      blockId: BLOCK,
      evidenceIds: [evidence.id],
      sourceIds: [evidence.sourceId],
      styleIds: [],
      ...overrides,
    }],
  })
}

async function callEndpoint(
  record: ProjectRecord,
  options: {
    role?: string
    workflow?: AiWorkflowExecutionBundle
    output?: string
    providerError?: Error
    afterProvider?: () => void
    requestBody?: unknown
    workspaceId?: string
  } = {},
) {
  let reads = 0
  let providerCalls = 0
  let savedModel: unknown
  const body = options.requestBody ?? requestBody(record)
  const recorded = responseRecorder()
  await handleGroundedAiReview(requestFor(body), recorded.response, {
    createProjectStore: async () => ({
      async loadGroundedTopicProject(projectId) {
        expect(projectId).toBe(PROJECT)
        reads++
        return {
          workspaceId: options.workspaceId ?? WORKSPACE,
          role: options.role ?? 'editor',
          record: record as unknown as Record<string, unknown>,
        }
      },
      async saveGroundedReviewModel(projectId, expectedRevision, reviewModel) {
        expect(projectId).toBe(PROJECT)
        expect(expectedRevision).toBe(record.recordRevision)
        savedModel = reviewModel
        return {
          ...record,
          recordRevision: expectedRevision + 1,
          reviewModel,
        } as unknown as Record<string, unknown>
      },
    }),
    loadWorkflow: async (_request, workspaceId, workflowId, version) => {
      expect(workspaceId).toBe(options.workspaceId ?? WORKSPACE)
      expect(workflowId).toBe('workflow-ai-review')
      expect(version).toBe(5)
      return options.workflow ?? workflowBundle()
    },
    generateText: async input => {
      providerCalls++
      expect(input.credential).toBe(SECRET)
      options.afterProvider?.()
      if (options.providerError) throw options.providerError
      expect(input.userContent).not.toContain(SECRET)
      return options.output ?? providerOutput(record)
    },
    now: () => 1_700_000_000_000,
  })
  return { ...recorded, providerCalls, reads, savedModel }
}

test('persists advisory findings in the existing Review model with exact workflow and input provenance', async () => {
  const record = projectRecord()
  const deterministic = buildGroundedReviewRun(
    createEmptyReviewModel(PROJECT),
    buildAuthoritativeAiReviewSnapshot(record as unknown as Record<string, unknown>),
    record.evidenceIndex!,
    record.conceptAnalysis!,
    record.unsupportedAnalysis!,
    100,
  )
  expect(deterministic.ok).toBe(true)
  if (!deterministic.ok) return
  record.reviewModel = deterministic.model
  const result = await callEndpoint(record)
  expect(result.response.statusCode, result.response.body).toBe(200)
  const body = JSON.parse(result.response.body)
  expect(Object.keys(body).sort()).toEqual(['findings', 'recordRevision', 'reviewModel', 'run'])
  expect(body.recordRevision).toBe(record.recordRevision + 1)
  expect(body.run).toMatchObject({
    method: 'ai-grounded-review-v1',
    inputSnapshotId: requestBody(record).inputSnapshotId,
    aiProvenance: {
      providerId: 'openai',
      modelId: 'review-model-v1',
      workflow: { id: 'workflow-ai-review', version: 5 },
      promptPack: { id: 'ai-review-prompt', version: 2 },
      referenceSet: { id: 'ai-review-reference', version: 3 },
      blueprint: { id: 'ai-review-blueprint', version: 4 },
    },
  })
  expect(body.findings).toHaveLength(1)
  expect(body.findings[0]).toMatchObject({
    category: 'AI Advisory',
    required: false,
    suggestion: null,
    status: 'open',
    topicId: TOPIC,
    blockId: BLOCK,
    evidenceReferences: [{ evidenceId: record.evidenceIndex!.items[0].id }],
    sourceReferences: [{ sourceId: 'source-a' }],
    styleReferences: [],
    resolutionHistory: [],
  })
  expect(body.reviewModel.runs).toHaveLength(deterministic.model.runs.length + 1)
  expect(body.reviewModel.findings).toHaveLength(deterministic.model.findings.length + 1)
  expect(body.reviewModel.activeReviewRunId).toBe(deterministic.model.activeReviewRunId)
  expect(body.reviewModel.runs[0]).toEqual(deterministic.model.runs[0])
  expect(result.savedModel).toEqual(body.reviewModel)
  expect(result.reads).toBe(2)
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(result.response.body).not.toContain(SECRET)
})

test('accepts JSON-serialized evidence indexes with omitted undefined metadata', () => {
  const cloudRecord = JSON.parse(JSON.stringify(projectRecord())) as ProjectRecord
  expect(() => buildAuthoritativeAiReviewSnapshot(cloudRecord as unknown as Record<string, unknown>)).not.toThrow()
  expect(buildAuthoritativeAiReviewSnapshot(cloudRecord as unknown as Record<string, unknown>).readiness).toBe('ready')
})

test('matches the client-normalized snapshot for serialized legacy TOC ordering and parents', () => {
  const cloudRecord = JSON.parse(JSON.stringify(projectRecord())) as ProjectRecord
  cloudRecord.appToc = [
    { id: 20, topicId: 'legacy-child', title: 'Child', level: 2, parentId: 10, parentTopicId: 'wrong-parent', order: 99 },
    { id: 10, topicId: 'legacy-parent', title: 'Parent', level: 1, order: 42 },
    { id: 1, topicId: TOPIC, title: 'Install', level: 1, parentId: 10, order: 7 },
  ] as unknown as ProjectRecord['appToc']
  const normalizedTopics = normalizeTopicIds(cloudRecord.appToc as unknown as Array<{
    id: number
    topicId?: string
    title: string
    level: 1 | 2 | 3 | 4
    parentId?: number
  }>)
  const sourceExtractions = cloudRecord.sourceExtractions as Record<string, SourceExtraction>
  const evidenceIndex = cloudRecord.evidenceIndex!
  const conceptAnalysis = cloudRecord.conceptAnalysis!
  const contentItems = [{
    id: `${BLOCK}-content`,
    text: cloudRecord.topicContent![TOPIC][0].content,
    contextType: 'topic-block' as const,
    location: `Topic ${TOPIC} · block ${BLOCK}`,
    blockId: BLOCK,
    topicId: TOPIC,
  }]
  const clientStyleSnapshot = buildReviewInputSnapshot({
    projectId: PROJECT,
    capturedAt: 123_456,
    contentType: 'User Guide',
    language: 'English',
    contentRevision: cloudRecord.contentRevision,
    tocRevision: cloudRecord.tocRevision,
    topics: normalizedTopics,
    topicContent: cloudRecord.topicContent!,
    sourcesRevision: cloudRecord.sourcesRevision,
    sourceFileIds: cloudRecord.sourceFileIds!,
    sourceExtractions,
    evidenceIndex,
    evidenceFresh: isEvidenceIndexFresh(evidenceIndex, sourceExtractions, cloudRecord.sourcesRevision),
    conceptAnalysis,
    conceptAnalysisFresh: isConceptAnalysisFresh(conceptAnalysis, evidenceIndex),
    analysisRevision: cloudRecord.analysisRevision!,
    unsupportedAnalysis: cloudRecord.unsupportedAnalysis!,
    unsupportedAnalysisFresh: isUnsupportedAnalysisFresh(
      cloudRecord.unsupportedAnalysis!, evidenceIndex, conceptAnalysis, cloudRecord.contentRevision, contentItems,
    ),
    styleProfile: (cloudRecord.themes![0] as unknown as { styleProfiles: unknown[] })
      .styleProfiles[0] as Parameters<typeof buildReviewInputSnapshot>[0]['styleProfile'],
    authorTopicMetadata: cloudRecord.authorTopicMetadata!,
  })
  const serverSnapshot = buildAuthoritativeAiReviewSnapshot(
    cloudRecord as unknown as Record<string, unknown>,
    123_456,
  )
  expect(serverSnapshot.snapshotId).toBe(clientStyleSnapshot.snapshotId)
  expect(serverSnapshot.topics).toEqual(clientStyleSnapshot.topics)
  expect(serverSnapshot.topics.map(topic => [topic.topicId, topic.order, topic.parentTopicId])).toEqual([
    ['legacy-child', 0, 'legacy-parent'],
    ['legacy-parent', 1, null],
    [TOPIC, 2, 'legacy-parent'],
  ])
})

test('rejects invented targets/references and never converts AI text to a suggestion', async () => {
  const record = projectRecord()
  const valid = JSON.parse(providerOutput(record))
  const badOutputs = [
    '{ invalid json',
    JSON.stringify({ findings: [{ ...valid.findings[0], suggestion: { proposedText: 'edit me' } }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], evidenceIds: ['invented-evidence'] }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], sourceIds: ['invented-source'] }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], styleIds: ['invented-style'] }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], topicId: 'invented-topic' }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], blockId: 'invented-block' }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], evidenceIds: [], sourceIds: [] }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], styleIds: ['writing-rules'] }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], kind: 'style' }] }),
    JSON.stringify({ findings: [{ ...valid.findings[0], kind: 'style', evidenceIds: [], sourceIds: [], styleIds: [] }] }),
  ]
  for (const output of badOutputs) {
    const result = await callEndpoint(projectRecord(), { output })
    expect(result.response.statusCode).toBe(502)
    expect(JSON.parse(result.response.body).code).toBe('MODEL_OUTPUT_INVALID')
    expect(result.savedModel).toBeUndefined()
    expect(result.response.body).not.toContain(SECRET)
  }
})

test('rejects evidence that differs from current extracted source blocks', async () => {
  const mutations: Array<(evidence: Record<string, unknown>) => void> = [
    evidence => { evidence.id = 'ev-forged' },
    evidence => { evidence.text = 'Forged source text.' },
    evidence => { evidence.location = 'Forged location.' },
    evidence => { evidence.sourceFileName = 'forged.pdf' },
    evidence => { evidence.fileId = 'another-file' },
    evidence => { evidence.sourceId = 'another-source' },
    evidence => { evidence.blockId = 'another-block' },
    evidence => { evidence.order = 99 },
  ]
  for (const mutation of mutations) {
    const record = projectRecord()
    const originalRequest = requestBody(record)
    const evidence = record.evidenceIndex!.items[0] as unknown as Record<string, unknown>
    mutation(evidence)
    const result = await callEndpoint(record, { requestBody: originalRequest })
    expect(result.response.statusCode).toBe(409)
    expect(JSON.parse(result.response.body).code).toBe('EVIDENCE_INDEX_INVALID')
    expect(result.providerCalls).toBe(0)
    expect(result.savedModel).toBeUndefined()
  }
})

test('accepts explicitly cited style-only findings without factual evidence citations', async () => {
  const record = projectRecord()
  const output = providerOutput(record, {
    kind: 'style',
    rationale: 'This wording does not follow the configured concise active-language standard.',
    evidenceIds: [],
    sourceIds: [],
    styleIds: ['writing-rules'],
  })
  const result = await callEndpoint(record, { output })
  expect(result.response.statusCode).toBe(200)
  const body = JSON.parse(result.response.body)
  expect(body.findings[0].evidenceReferences).toEqual([])
  expect(body.findings[0].sourceReferences).toEqual([])
  expect(body.findings[0].styleReferences).toMatchObject([{ standardId: 'writing-rules' }])
})

test('rejects unexpected request fields and restricts execution to workspace writers', async () => {
  const requestRecord = projectRecord()
  const extra = await callEndpoint(requestRecord, {
    requestBody: { ...requestBody(requestRecord), authoredContent: 'browser-controlled' },
  })
  expect(extra.response.statusCode).toBe(400)
  expect(JSON.parse(extra.response.body).code).toBe('UNEXPECTED_FIELD')
  expect(extra.providerCalls).toBe(0)

  for (const role of ['viewer', 'guest']) {
    const denied = await callEndpoint(projectRecord(), { role })
    expect(denied.response.statusCode).toBe(403)
    expect(JSON.parse(denied.response.body).code).toBe('FORBIDDEN')
    expect(denied.providerCalls).toBe(0)
  }

  for (const role of ['owner', 'admin', 'editor']) {
    const allowed = await callEndpoint(projectRecord(), { role })
    expect(allowed.response.statusCode).toBe(200)
  }
})

test('fails closed for stale input and concurrent edits while provider is running', async () => {
  const stale = projectRecord()
  const originalRequest = requestBody(stale)
  stale.contentRevision++
  const staleResult = await callEndpoint(stale, {
    requestBody: originalRequest,
  })
  expect(staleResult.response.statusCode).toBe(409)
  expect(JSON.parse(staleResult.response.body).code).toBe('REVIEW_INPUT_STALE')
  expect(staleResult.providerCalls).toBe(0)

  const concurrent = projectRecord()
  const result = await callEndpoint(concurrent, {
    afterProvider: () => {
      concurrent.recordRevision++
      concurrent.sourcesRevision++
    },
  })
  expect(result.response.statusCode).toBe(409)
  expect(JSON.parse(result.response.body).code).toBe('PROJECT_CONFLICT')
  expect(result.savedModel).toBeUndefined()
})

test('requires exact published AI Review workflow dependencies and pinned model', async () => {
  const wrongCapability = await callEndpoint(projectRecord(), { workflow: workflowBundle('Rewrite Topic') })
  expect(wrongCapability.response.statusCode).toBe(400)
  expect(JSON.parse(wrongCapability.response.body).code).toBe('INVALID_WORKFLOW_CAPABILITY')
  expect(wrongCapability.providerCalls).toBe(0)

  const wrongStep = workflowBundle()
  ;(wrongStep.workflow.definition as { steps: Array<{ capability: string }> }).steps[0].capability = 'Generate Topic'
  const invalidStep = await callEndpoint(projectRecord(), { workflow: wrongStep })
  expect(invalidStep.response.statusCode).toBe(400)
  expect(invalidStep.providerCalls).toBe(0)

  const unpublished = workflowBundle()
  unpublished.blueprint.state = 'draft'
  const notPublished = await callEndpoint(projectRecord(), { workflow: unpublished })
  expect(notPublished.response.statusCode).toBe(409)
  expect(notPublished.providerCalls).toBe(0)

  const wrongDependency = workflowBundle()
  wrongDependency.promptPack.version++
  const notPinned = await callEndpoint(projectRecord(), { workflow: wrongDependency })
  expect(notPinned.response.statusCode).toBe(409)
  expect(notPinned.providerCalls).toBe(0)

  const unpinned = workflowBundle()
  ;(unpinned.workflow.definition as { model: { mode: string } }).model.mode = 'latest'
  const modelNotPinned = await callEndpoint(projectRecord(), { workflow: unpinned })
  expect(modelNotPinned.response.statusCode).toBe(409)
  expect(modelNotPinned.providerCalls).toBe(0)
})

test('redacts provider errors/refusals and fails on oversized packets or output', async () => {
  const failure = await callEndpoint(projectRecord(), {
    providerError: new GroundedTocProviderError('REFUSED', SECRET),
  })
  expect(failure.response.statusCode).toBe(502)
  expect(JSON.parse(failure.response.body).code).toBe('REFUSED')
  expect(failure.response.body).not.toContain(SECRET)

  const oversized = await callEndpoint(projectRecord(), { output: ' '.repeat(24_001) })
  expect(oversized.response.statusCode).toBe(502)
  expect(JSON.parse(oversized.response.body).code).toBe('MODEL_OUTPUT_INVALID')

  const largeWorkflow = workflowBundle()
  ;(largeWorkflow.referenceSet.definition as { entry: string }).entry = 'x'.repeat(100_000)
  const packet = await callEndpoint(projectRecord(), { workflow: largeWorkflow })
  expect(packet.response.statusCode).toBe(413)
  expect(JSON.parse(packet.response.body).code).toBe('REVIEW_PACKET_TOO_LARGE')
})

test('isolates workflow resolution to the authoritative project workspace', async () => {
  const record = projectRecord()
  const bundle = workflowBundle()
  bundle.workflow.workspaceId = 'another-workspace'
  const result = await callEndpoint(record, { workflow: bundle })
  expect(result.response.statusCode).toBe(409)
  expect(JSON.parse(result.response.body).code).toBe('WORKFLOW_NOT_READY')
  expect(result.providerCalls).toBe(0)
})
