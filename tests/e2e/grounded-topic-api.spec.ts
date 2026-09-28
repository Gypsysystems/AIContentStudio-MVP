import { expect, test } from '@playwright/test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildConceptAnalysis } from '../../src/conceptAnalysis'
import { buildEvidenceIndex } from '../../src/evidenceIndex'
import { buildTopicGroundingContext } from '../../src/authorGroundingContext'
import type { ProjectRecord } from '../../src/projectRepository'
import type { SourceExtraction } from '../../src/sourceExtractor'
import type { AiWorkflowExecutionBundle } from '../../server/aiCatalogApi'
import {
  handleGroundedTopic,
} from '../../server/groundedTopicApi'
import { GroundedTocProviderError } from '../../server/groundedTocProvider'

const WORKSPACE = 'topic-workspace'
const PROJECT = 'topic-project'
const TOPIC = 'topic-install'
const SECRET = 'never-return-the-provider-credential'
const PRIVATE_INPUT = 'Reference metadata prompt that must not appear in response'

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const sourceExtractions: Record<string, SourceExtraction> = {
    'source-a': {
      sourceId: 'source-a',
      fileName: 'install-guide.md',
      fileType: 'text/markdown',
      status: 'extracted',
      blocks: [
        {
          id: 'install-heading',
          sourceId: 'source-a',
          type: 'heading',
          text: 'Install the application',
          order: 0,
          headingLevel: 1,
          sectionPath: ['Install the application'],
        },
        {
          id: 'install-description',
          sourceId: 'source-a',
          type: 'paragraph',
          text: 'Download the application from the Downloads page before installation.',
          order: 1,
          sectionPath: ['Install the application'],
        },
        {
          id: 'install-step-1',
          sourceId: 'source-a',
          type: 'list-item',
          text: 'Open the downloaded installer.',
          order: 2,
          sectionPath: ['Install the application'],
          listLevel: 1,
          orderedList: true,
        },
        {
          id: 'install-step-2',
          sourceId: 'source-a',
          type: 'list-item',
          text: 'Follow the on-screen setup instructions.',
          order: 3,
          sectionPath: ['Install the application'],
          listLevel: 1,
          orderedList: true,
        },
      ],
      extractedText: 'Install the application',
      warnings: [],
      sourceRevision: 1,
      extractionRevision: 1,
    },
  }
  const evidenceIndex = buildEvidenceIndex(sourceExtractions, 1)
  const conceptAnalysis = buildConceptAnalysis(evidenceIndex)
  const topic = {
    id: 1,
    topicId: TOPIC,
    title: 'Install the application',
    level: 1 as const,
    words: 200,
    rationale: 'The source documents application installation.',
    proposalKind: 'evidence-backed' as const,
    supportingEvidenceIds: evidenceIndex.items
      .filter(item => item.blockType !== 'heading')
      .map(item => item.id),
    sourceSectionPaths: [['Install the application']],
  }
  const context = buildTopicGroundingContext({
    topic,
    evidenceIndex,
    sourceExtractions,
    sourcesRevision: 1,
    conceptAnalysis,
    analysisRevision: 2,
    tocRevision: 3,
    contentType: 'User Guide',
    variables: [],
    selectedSourceFileIds: ['source-a'],
    writingGuidance: {
      language: 'English',
      styleProfileId: 'safe-default-rich-profile',
      styleProfileName: 'Safe Default',
      styleProfileScope: 'project',
      brandNames: [],
    },
  })
  return {
    projectId: PROJECT,
    schemaVersion: 1,
    recordRevision: 8,
    projectName: 'Topic project',
    documentType: 'User Guide',
    version: '1',
    createdAt: 1,
    modifiedAt: 1,
    isDemoMode: false,
    ownerUserId: 'authoritative-owner',
    workspaceId: WORKSPACE,
    themes: [],
    projectMeta: {
      themeId: 'plain',
      contentType: 'User Guide',
      language: 'English',
    },
    activeStyleProfileId: 'safe-default-rich-profile',
    themeVariables: { plain: [] },
    sourceFileIds: ['source-a'],
    sourcesRevision: 1,
    analysisRevision: 2,
    conceptAnalysis,
    appToc: [topic],
    tocRevision: 3,
    sourceExtractions,
    evidenceIndex,
    authorTopicMetadata: {
      [TOPIC]: {
        topicId: TOPIC,
        sourceFileIds: ['source-a'],
        groundingContext: context,
      },
    },
    topicContent: {},
    docBlocks: [],
    ...overrides,
  } as unknown as ProjectRecord
}

function workflowBundle(capability = 'Generate Topic'): AiWorkflowExecutionBundle {
  const asset = (id: string, kind: 'workflow' | 'prompt-pack' | 'reference-set' | 'blueprint', definition: unknown) => ({
    workspaceId: WORKSPACE,
    id,
    kind,
    version: 1,
    state: 'published' as const,
    name: id,
    description: '',
    definition,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test-user',
  })
  const workflow = asset('workflow-topic', 'workflow', {
    capability,
    model: { mode: 'pinned', providerId: 'openai', modelId: 'test-topic-model' },
    promptPack: { id: 'topic-prompts', version: 1 },
    referenceSet: { id: 'topic-references', version: 1 },
    blueprint: { id: 'topic-blueprint', version: 1 },
    steps: [{ id: 'topic', capability }],
  })
  const promptPack = asset('topic-prompts', 'prompt-pack', {
    prompts: [{
      id: 'topic-draft',
      version: 1,
      state: 'published',
      name: 'Topic draft',
      template: 'Write a concise draft.',
      variables: [],
    }],
  })
  const referenceSet = asset('topic-references', 'reference-set', {
    entries: [{ id: 'glossary', type: 'terminology', title: 'Glossary', locator: 'private', note: PRIVATE_INPUT }],
  })
  const blueprint = asset('topic-blueprint', 'blueprint', {
    contentType: 'User Guide',
    sections: [{ id: 'details', title: 'Details', required: false, rules: [] }],
  })
  return {
    readiness: {
      status: 'ready',
      workflow: { id: workflow.id, version: workflow.version },
      dependencies: {
        promptPack: { id: promptPack.id, version: 1, name: promptPack.id, state: 'published' },
        referenceSet: { id: referenceSet.id, version: 1, name: referenceSet.id, state: 'published' },
        blueprint: { id: blueprint.id, version: 1, name: blueprint.id, state: 'published' },
      },
      model: { providerId: 'openai', modelId: 'test-topic-model' },
      checkedAt: '2026-01-01T00:00:00.000Z',
      blockers: [],
    },
    workflow,
    promptPack,
    referenceSet,
    blueprint,
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
  return {
    headers,
    response: target as unknown as ServerResponse & { body: string },
  }
}

function validOutput(record: ProjectRecord) {
  const evidence = record.evidenceIndex!.items.filter(item => item.blockType !== 'heading')
  return JSON.stringify({
    blocks: [{
      type: 'para',
      content: 'Download the application from the Downloads page.',
      evidenceIds: [evidence[0].id],
    }],
  })
}

function validProcedureOutput(record: ProjectRecord) {
  const evidence = record.evidenceIndex!.items.filter(item => item.orderedList)
  return JSON.stringify({
    blocks: [{
      type: 'procedure',
      content: 'Follow the on-screen setup instructions.',
      steps: ['Open the downloaded installer.', 'Follow the on-screen setup instructions.'],
      evidenceIds: evidence.map(item => item.id),
    }],
  })
}

async function callEndpoint(
  record: ProjectRecord,
  options: {
    role?: string
    workflow?: AiWorkflowExecutionBundle
    output?: string
    response?: (input: { userContent: string; credential: string }) => string
    providerError?: Error
    afterProvider?: () => void
    requestBody?: unknown
  } = {},
) {
  let reads = 0
  let providerCalls = 0
  const request = requestFor(options.requestBody ?? {
    projectId: PROJECT,
    topicId: TOPIC,
    workflowId: 'workflow-topic',
    workflowVersion: 1,
  })
  const recorded = responseRecorder()
  await handleGroundedTopic(request, recorded.response, {
    createProjectStore: async () => ({
      async loadGroundedTopicProject(projectId: unknown) {
        expect(projectId).toBe(PROJECT)
        reads++
        return {
          workspaceId: WORKSPACE,
          role: options.role ?? 'editor',
          record: record as unknown as Record<string, unknown>,
        }
      },
    }),
    loadWorkflow: async (_request, workspaceId, workflowId, version) => {
      expect(workspaceId).toBe(WORKSPACE)
      expect(workflowId).toBe('workflow-topic')
      expect(version).toBe(1)
      return options.workflow ?? workflowBundle()
    },
    generateText: async input => {
      providerCalls++
      expect(input.credential).toBe(SECRET)
      options.afterProvider?.()
      if (options.providerError) throw options.providerError
      return options.response?.(input) ?? options.output ?? validOutput(record)
    },
    now: () => 1_700_000_000_000,
  })
  return { ...recorded, providerCalls, reads }
}

test('accepts exactly the four browser IDs and returns only a safe authoritative draft', async () => {
  const record = projectRecord()
  const result = await callEndpoint(record, {
    response: input => {
      expect(input.userContent).toContain('untrusted source data')
      expect(input.userContent).not.toContain(SECRET)
      expect(input.userContent).toContain(PRIVATE_INPUT)
      return validOutput(record)
    },
  })
  expect(result.response.statusCode, result.response.body).toBe(200)
  const body = JSON.parse(result.response.body)
  expect(Object.keys(body).sort()).toEqual(['draft', 'recordRevision'])
  expect(body.recordRevision).toBe(8)
  expect(body.draft).toMatchObject({
    method: 'ai-grounded-topic-v1',
    topicId: TOPIC,
    aiProvenance: {
      providerId: 'openai',
      modelId: 'test-topic-model',
      workflow: { id: 'workflow-topic', version: 1 },
      promptPack: { id: 'topic-prompts', version: 1 },
      referenceSet: { id: 'topic-references', version: 1 },
      blueprint: { id: 'topic-blueprint', version: 1 },
    },
  })
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(JSON.stringify(body)).not.toContain(SECRET)
  expect(JSON.stringify(body)).not.toContain(PRIVATE_INPUT)
  expect(result.reads).toBe(2)
  expect(result.providerCalls).toBe(1)
})

test('sends bounded non-factual writing guidance, including the authoritative non-default language', async () => {
  const record = projectRecord()
  const variables = [
    { name: 'tone', value: 'Concise and reassuring' },
    { name: 'api_token', value: SECRET },
  ]
  record.themeVariables = { plain: variables } as unknown as ProjectRecord['themeVariables']
  const styleProfile = {
    id: 'topic-style',
    name: 'Topic Style',
    clientId: 'plain',
    scope: 'project',
    body: {},
    h1: {},
    h2: {},
    h3: {},
    h4: {},
    caption: {},
    code: {},
    links: {},
    lists: {},
    tables: {},
    callouts: {},
  }
  record.themes = [{
    id: 'plain',
    clientName: 'Acme',
    organizationName: 'Example Org',
    productName: 'Widget',
    styleProfiles: [styleProfile],
    brandProfiles: [],
  }] as unknown as ProjectRecord['themes']
  record.projectMeta = { ...record.projectMeta!, language: 'Español', styleProfileId: 'topic-style' }
  record.activeStyleProfileId = 'topic-style'
  const metadata = (record.authorTopicMetadata as unknown as Record<string, {
    sourceFileIds: string[]
    groundingContext: unknown
  }>)[TOPIC]
  const topic = record.appToc![0]
  metadata.groundingContext = buildTopicGroundingContext({
    topic,
    evidenceIndex: record.evidenceIndex!,
    sourceExtractions: record.sourceExtractions!,
    sourcesRevision: record.sourcesRevision!,
    conceptAnalysis: record.conceptAnalysis!,
    analysisRevision: record.analysisRevision!,
    tocRevision: record.tocRevision!,
    contentType: 'User Guide',
    variables,
    selectedSourceFileIds: ['source-a'],
    writingGuidance: {
      language: 'Español',
      styleProfileId: 'topic-style',
      styleProfileName: 'Topic Style',
      styleProfileScope: 'project',
      brandNames: ['Acme', 'Example Org', 'Widget'],
    },
  })
  const result = await callEndpoint(record, {
    response: input => {
      const packet = JSON.parse(input.userContent).packet
      expect(packet.writingGuidance).toMatchObject({
        language: 'Español',
        contentType: 'User Guide',
        variables: { tone: 'Concise and reassuring' },
        brandNames: ['Acme', 'Example Org', 'Widget'],
        styleProfile: { id: 'topic-style', name: 'Topic Style', scope: 'project' },
      })
      expect(JSON.stringify(packet.writingGuidance)).not.toContain(SECRET)
      expect(packet.writingGuidance.trust).toContain('non-factual')
      return validOutput(record)
    },
  })
  expect(result.response.statusCode, result.response.body).toBe(200)
})

test('rejects all extra browser claims and denies Viewer before workflow execution', async () => {
  const extra = await callEndpoint(projectRecord(), {
    requestBody: {
      projectId: PROJECT,
      topicId: TOPIC,
      workflowId: 'workflow-topic',
      workflowVersion: 1,
      sourceText: 'authoritative? no',
    },
  })
  expect(extra.response.statusCode).toBe(400)
  expect(JSON.parse(extra.response.body).code).toBe('UNEXPECTED_FIELD')
  expect(extra.providerCalls).toBe(0)

  const viewer = await callEndpoint(projectRecord(), { role: 'viewer' })
  expect(viewer.response.statusCode).toBe(403)
  expect(JSON.parse(viewer.response.body).code).toBe('FORBIDDEN')
  expect(viewer.providerCalls).toBe(0)
})

test('rejects missing topic evidence, stale grounding, and stale source analysis', async () => {
  const noEvidence = projectRecord()
  noEvidence.appToc[0] = { ...(noEvidence.appToc[0] as object), supportingEvidenceIds: [] }
  const noEvidenceResult = await callEndpoint(noEvidence)
  expect(noEvidenceResult.response.statusCode).toBe(409)
  expect(JSON.parse(noEvidenceResult.response.body).code).toBe('NO_SUPPORTING_EVIDENCE')
  expect(noEvidenceResult.providerCalls).toBe(0)

  const stale = projectRecord()
  stale.tocRevision++
  const staleResult = await callEndpoint(stale)
  expect(staleResult.response.statusCode).toBe(409)
  expect(JSON.parse(staleResult.response.body).code).toBe('GROUNDING_STALE')
  expect(staleResult.providerCalls).toBe(0)

  const staleEvidence = projectRecord()
  staleEvidence.sourcesRevision++
  const staleEvidenceResult = await callEndpoint(staleEvidence)
  expect(staleEvidenceResult.response.statusCode).toBe(409)
  expect(staleEvidenceResult.providerCalls).toBe(0)

  const staleVariables = projectRecord()
  staleVariables.themeVariables = { plain: [{ name: 'audience', value: 'admins' }] }
  const staleVariablesResult = await callEndpoint(staleVariables)
  expect(staleVariablesResult.response.statusCode).toBe(409)
  expect(JSON.parse(staleVariablesResult.response.body).code).toBe('GROUNDING_STALE')
  expect(staleVariablesResult.providerCalls).toBe(0)
})

test('rejects a workflow with the wrong capability and validates exact topic evidence citations', async () => {
  const wrongWorkflow = await callEndpoint(projectRecord(), { workflow: workflowBundle('Generate TOC') })
  expect(wrongWorkflow.response.statusCode).toBe(400)
  expect(JSON.parse(wrongWorkflow.response.body).code).toBe('INVALID_WORKFLOW_CAPABILITY')
  expect(wrongWorkflow.providerCalls).toBe(0)

  const wrongStep = workflowBundle()
  ;(wrongStep.workflow.definition as { steps: Array<{ capability: string }> }).steps[0].capability = 'Generate TOC'
  const wrongStepResult = await callEndpoint(projectRecord(), { workflow: wrongStep })
  expect(wrongStepResult.response.statusCode).toBe(400)
  expect(JSON.parse(wrongStepResult.response.body).code).toBe('INVALID_WORKFLOW_CAPABILITY')
  expect(wrongStepResult.providerCalls).toBe(0)

  const unpublished = workflowBundle()
  unpublished.workflow.state = 'draft'
  const unpublishedResult = await callEndpoint(projectRecord(), { workflow: unpublished })
  expect(unpublishedResult.response.statusCode).toBe(409)
  expect(JSON.parse(unpublishedResult.response.body).code).toBe('WORKFLOW_NOT_READY')
  expect(unpublishedResult.providerCalls).toBe(0)

  const record = projectRecord()
  const unknownEvidence = JSON.stringify({
    blocks: [{ type: 'para', content: 'Unsupported claim.', evidenceIds: ['ev-not-in-packet'] }],
  })
  const invalid = await callEndpoint(record, { output: unknownEvidence })
  expect(invalid.response.statusCode).toBe(502)
  expect(JSON.parse(invalid.response.body).code).toBe('MODEL_OUTPUT_INVALID')
  expect(invalid.providerCalls).toBe(2)
})

test('accepts a procedure only when cited evidence supplies ordered actions', async () => {
  const record = projectRecord()
  const valid = await callEndpoint(record, { output: validProcedureOutput(record) })
  expect(valid.response.statusCode, valid.response.body).toBe(200)
  expect(JSON.parse(valid.response.body).draft.blocks[0]).toMatchObject({
    type: 'procedure',
    procedureSteps: ['Open the downloaded installer.', 'Follow the on-screen setup instructions.'],
  })

  const unsupported = await callEndpoint(record, {
    output: JSON.stringify({
      blocks: [{
        type: 'procedure',
        content: 'Unsupported procedure',
        steps: ['Click Settings.', 'Choose Add Account.'],
        evidenceIds: [record.evidenceIndex!.items.find(item => item.blockType === 'paragraph')!.id],
      }],
    }),
  })
  expect(unsupported.response.statusCode).toBe(502)
  expect(unsupported.providerCalls).toBe(2)

  const citedButFabricatedStep = await callEndpoint(record, {
    output: JSON.stringify({
      blocks: [{
        type: 'procedure',
        content: 'Follow the on-screen setup instructions.',
        steps: ['Erase all existing user data from the device.', 'Follow the on-screen setup instructions.'],
        evidenceIds: record.evidenceIndex!.items.filter(item => item.orderedList).map(item => item.id),
      }],
    }),
  })
  expect(citedButFabricatedStep.response.statusCode).toBe(502)
  expect(citedButFabricatedStep.providerCalls).toBe(2)
})

test('rejects unsupported and contradictory claims even when citations are valid', async () => {
  const record = projectRecord()
  const paragraphId = record.evidenceIndex!.items.find(item => item.blockType === 'paragraph')!.id
  const outputs = [
    'The application includes automatic cloud backups.',
    'Do not download the application from the Downloads page.',
  ]
  for (const content of outputs) {
    const result = await callEndpoint(record, {
      output: JSON.stringify({ blocks: [{ type: 'para', content, evidenceIds: [paragraphId] }] }),
    })
    expect(result.response.statusCode).toBe(502)
    expect(JSON.parse(result.response.body).code).toBe('MODEL_OUTPUT_INVALID')
    expect(result.providerCalls).toBe(2)
  }
})

test('retries only strict output validation once, and never falls back on provider failure', async () => {
  const record = projectRecord()
  const calls: string[] = []
  const retried = await callEndpoint(record, {
    response: input => {
      calls.push(input.userContent)
      return calls.length === 1 ? '{ malformed' : validOutput(record)
    },
  })
  expect(retried.response.statusCode).toBe(200)
  expect(retried.providerCalls).toBe(2)
  expect(calls[1]).toContain('previous output failed strict schema')

  const providerFailure = await callEndpoint(record, {
    providerError: new GroundedTocProviderError('NETWORK_ERROR', 'network'),
  })
  expect(providerFailure.response.statusCode).toBe(502)
  expect(JSON.parse(providerFailure.response.body).code).toBe('NETWORK_ERROR')
  expect(providerFailure.providerCalls).toBe(1)

  const secretOutput = await callEndpoint(record, {
    output: JSON.stringify({
      blocks: [{
        type: 'para',
        content: SECRET,
        evidenceIds: [record.evidenceIndex!.items.find(item => item.blockType === 'paragraph')!.id],
      }],
    }),
  })
  expect(secretOutput.response.statusCode).toBe(502)
  expect(secretOutput.providerCalls).toBe(2)
  expect(secretOutput.response.body).not.toContain(SECRET)
})

test('returns a conflict without a draft when project grounding changes during generation', async () => {
  const record = projectRecord()
  const result = await callEndpoint(record, {
    afterProvider: () => { record.recordRevision++ },
  })
  expect(result.response.statusCode).toBe(409)
  expect(JSON.parse(result.response.body).code).toBe('PROJECT_CONFLICT')
  expect(JSON.parse(result.response.body)).not.toHaveProperty('draft')
  expect(result.providerCalls).toBe(1)
})