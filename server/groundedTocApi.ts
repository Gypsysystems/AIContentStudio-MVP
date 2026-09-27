import type { IncomingMessage, ServerResponse } from 'node:http'
import { isConceptAnalysisFresh, buildConceptAnalysis, type ConceptAnalysis } from '../src/conceptAnalysis'
import { buildEvidenceIndex, isEvidenceIndexFresh, type EvidenceIndex } from '../src/evidenceIndex'
import type { AiAssetVersion, BlueprintDefinition, PromptPackDefinition, ReferenceSetDefinition, WorkflowDefinition } from '../src/aiCatalogModel'
import type { TocProposal, ProposedTopic } from '../src/tocProposal'
import { isExtractionFresh, type SourceExtraction } from '../src/sourceExtractor'
import {
  AiCatalogApiError,
  loadAiWorkflowExecutionBundle,
  type AiWorkflowExecutionBundle,
} from './aiCatalogApi'
import { CloudApiError, CloudProjectApi } from './cloudProjectApi'
import {
  buildGroundedTocPacket,
  GroundedTocPacketError,
  GroundedTocWorkflowCapabilityError,
} from './groundedTocPacket'
import {
  GroundedTocProviderError,
  generateGroundedTocText,
} from './groundedTocProvider'
import {
  GroundedTocOutputError,
  validateGroundedTocOutput,
  type GeneratedTocItem,
} from './groundedTocOutput'

type Json = Record<string, unknown>
type ProjectContext = { workspaceId: string; role: string; record: Json }
type GroundedTocProjectStore = {
  loadGroundedTocProject(projectId: unknown): Promise<ProjectContext>
  saveGroundedTocProposal(projectId: unknown, expectedRevision: number, proposal: Json): Promise<Json>
}
type GroundedTocDependencies = {
  createProjectStore?: (request: IncomingMessage) => Promise<GroundedTocProjectStore>
  loadWorkflow?: typeof loadAiWorkflowExecutionBundle
  generateText?: typeof generateGroundedTocText
  now?: () => number
}

export class GroundedTocApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly blockers?: unknown[],
  ) {
    super(message)
    this.name = 'GroundedTocApiError'
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value: Json, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key)))
    throw new GroundedTocApiError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
  if (Object.keys(value).length !== keys.length)
    throw new GroundedTocApiError(400, 'INVALID_REQUEST', 'All required Generate TOC fields must be supplied')
}

function assertStableId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/u.test(value))
    throw new GroundedTocApiError(400, 'INVALID_REQUEST', `${field} is invalid`)
}

function validateInput(value: unknown): asserts value is {
  projectId: string
  workflowId: string
  workflowVersion: number
} {
  if (!isObject(value)) throw new GroundedTocApiError(400, 'INVALID_REQUEST', 'A JSON object is required')
  assertExactKeys(value, ['projectId', 'workflowId', 'workflowVersion'])
  assertStableId(value.projectId, 'projectId')
  assertStableId(value.workflowId, 'workflowId')
  if (!Number.isSafeInteger(value.workflowVersion) || Number(value.workflowVersion) < 1)
    throw new GroundedTocApiError(400, 'INVALID_REQUEST', 'workflowVersion must be a positive integer')
}

function contentTypeFor(record: Json): string | null {
  const meta = isObject(record.projectMeta) ? record.projectMeta : null
  const value = meta?.contentType ?? record.documentType
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
    ? value.trim()
    : null
}

type GroundedProjectSnapshot = {
  evidenceIndex: EvidenceIndex
  analysis: ConceptAnalysis
  contentType: string
  sourcesRevision: number
  extractionRevision: string
  recordRevision: number
}

function verifyFreshProject(record: Json): GroundedProjectSnapshot {
  if (record.isDemoMode === true)
    throw new GroundedTocApiError(403, 'DEMO_PROJECT_UNSUPPORTED', 'Generate TOC requires a cloud project with current source evidence')
  if (!Number.isSafeInteger(record.recordRevision) || Number(record.recordRevision) < 0
    || !Number.isSafeInteger(record.sourcesRevision) || Number(record.sourcesRevision) < 0
    || !isObject(record.sourceExtractions)
    || !Array.isArray(record.sourceFileIds)
    || !isObject(record.evidenceIndex)
    || !isObject(record.conceptAnalysis)) {
    throw new GroundedTocApiError(409, 'EVIDENCE_NOT_READY', 'Build current source evidence and grounded analysis before generating a TOC')
  }
  const contentType = contentTypeFor(record)
  if (!contentType)
    throw new GroundedTocApiError(409, 'CONTENT_TYPE_UNAVAILABLE', 'Choose a content type before generating a TOC')
  const evidenceIndex = record.evidenceIndex as unknown as EvidenceIndex
  const analysis = record.conceptAnalysis as unknown as ConceptAnalysis
  const extractionEntries = Object.entries(record.sourceExtractions)
  const sourceIds = record.sourceFileIds as unknown[]
  const sourcesRevision = record.sourcesRevision as number
  if (sourceIds.length > 1_000
    || sourceIds.some(id => typeof id !== 'string')
    || new Set(sourceIds).size !== sourceIds.length
    || extractionEntries.length !== sourceIds.length
    || extractionEntries.some(([sourceId, value]) => {
      if (!isObject(value) || value.sourceId !== sourceId || !sourceIds.includes(sourceId)) return true
      const extraction = value as unknown as SourceExtraction
      return !isExtractionFresh(extraction, sourcesRevision)
        || (extraction.status !== 'extracted' && extraction.status !== 'partial')
    })) {
    throw new GroundedTocApiError(409, 'EVIDENCE_STALE', 'Source extraction changed; rebuild the Evidence Index before generating a TOC')
  }
  if (!Array.isArray(evidenceIndex.items) || evidenceIndex.items.length === 0)
    throw new GroundedTocApiError(409, 'EVIDENCE_EMPTY', 'Build a non-empty Evidence Index before generating a TOC')
  let evidenceIsFresh = false
  let analysisIsFresh = false
  try {
    evidenceIsFresh = isEvidenceIndexFresh(
      evidenceIndex,
      record.sourceExtractions as never,
      record.sourcesRevision as number,
    )
    if (evidenceIsFresh) {
      const rebuiltIndex = buildEvidenceIndex(record.sourceExtractions as never, record.sourcesRevision as number)
      evidenceIsFresh = JSON.stringify(rebuiltIndex.items) === JSON.stringify(evidenceIndex.items)
    }
    analysisIsFresh = evidenceIsFresh && isConceptAnalysisFresh(analysis, evidenceIndex)
    if (analysisIsFresh) {
      const rebuiltAnalysis = buildConceptAnalysis(evidenceIndex)
      const { builtAt: _rebuiltAt, ...rebuiltContent } = rebuiltAnalysis
      const { builtAt: _storedAt, ...storedContent } = analysis
      analysisIsFresh = JSON.stringify(rebuiltContent) === JSON.stringify(storedContent)
    }
  } catch {
    evidenceIsFresh = false
    analysisIsFresh = false
  }
  if (!evidenceIsFresh)
    throw new GroundedTocApiError(409, 'EVIDENCE_STALE', 'Source extraction changed; rebuild the Evidence Index before generating a TOC')
  if (!analysisIsFresh)
    throw new GroundedTocApiError(409, 'ANALYSIS_STALE', 'Grounded analysis changed; rebuild it before generating a TOC')
  if (record.tocProposal !== null && record.tocProposal !== undefined)
    throw new GroundedTocApiError(409, 'TOC_PROPOSAL_EXISTS', 'A proposed TOC already exists; explicitly replace it before generating another')
  if (typeof evidenceIndex.extractionRevision !== 'string'
    || !evidenceIndex.extractionRevision
    || !Number.isSafeInteger(analysis.builtAt)) {
    throw new GroundedTocApiError(409, 'EVIDENCE_NOT_READY', 'Current evidence provenance is incomplete')
  }
  return {
    evidenceIndex,
    analysis,
    contentType,
    sourcesRevision: record.sourcesRevision as number,
    extractionRevision: evidenceIndex.extractionRevision,
    recordRevision: record.recordRevision as number,
  }
}

function capabilityIsGenerateToc(workflow: AiAssetVersion): workflow is AiAssetVersion & { kind: 'workflow' } {
  if (workflow.kind !== 'workflow' || !isObject(workflow.definition)) return false
  const definition = workflow.definition as unknown as WorkflowDefinition
  const capability = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '')
  return capability(definition.capability) === 'generatetoc'
    && definition.steps.every(step => capability(step.capability) === 'generatetoc')
}

function normalizeSubject(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, ' ').trim()
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function makeProposal(
  items: GeneratedTocItem[],
  snapshot: GroundedProjectSnapshot,
  bundle: AiWorkflowExecutionBundle,
  now: number,
  candidates: ProposedTopic[],
): TocProposal {
  const evidenceById = new Map(snapshot.evidenceIndex.items.map(item => [item.id, item]))
  const candidateByTitle = new Map(candidates.map(candidate => [normalizeSubject(candidate.title), candidate]))
  const topicIdByKey = new Map(items.map(item => {
    const candidate = candidateByTitle.get(normalizeSubject(item.title))
    return [item.key, candidate?.topicId ?? `ai-${stableHash(item.key)}`]
  }))
  const numericIdByKey = new Map(items.map((item, index) => [item.key, 1_000 + index]))
  const proposed: ProposedTopic[] = items.map((item, index) => {
    const candidate = candidateByTitle.get(normalizeSubject(item.title))
    const sourceSectionPaths = [...new Map(item.supportingEvidenceIds
      .flatMap(id => {
        const path = evidenceById.get(id)?.sectionPath
        if (!path?.length) return []
        return [[path.join('\u001f'), [...path]] as const]
      })).values()].map(path => [...path])
    const parentTopicId = item.parentKey ? topicIdByKey.get(item.parentKey) : undefined
    const parentId = item.parentKey ? numericIdByKey.get(item.parentKey) : undefined
    return {
      id: numericIdByKey.get(item.key) ?? index + 1,
      topicId: topicIdByKey.get(item.key) ?? `ai-${stableHash(item.key)}`,
      title: item.title,
      level: item.level,
      words: candidate?.words ?? 0,
      ...(parentId !== undefined ? { parentId } : {}),
      ...(parentTopicId ? { parentTopicId } : {}),
      order: index,
      rationale: item.rationale,
      supportingEvidenceIds: [...item.supportingEvidenceIds],
      proposalKind: item.classification,
      ...(sourceSectionPaths.length ? { sourceSectionPaths } : {}),
      ...(candidate?.hasGap ? { hasGap: true } : {}),
    }
  })
  return {
    version: 1,
    method: 'ai-grounded-toc-v1',
    contentType: snapshot.contentType,
    evidenceSourcesRevision: snapshot.sourcesRevision,
    evidenceExtractionRevision: snapshot.extractionRevision,
    groundedAnalysisBuiltAt: snapshot.analysis.builtAt,
    generatedAt: now,
    items: proposed,
    aiProvenance: {
      providerId: bundle.readiness.model!.providerId,
      modelId: bundle.readiness.model!.modelId,
      workflow: { id: bundle.workflow.id, version: bundle.workflow.version },
      promptPack: { id: bundle.promptPack.id, version: bundle.promptPack.version },
      referenceSet: { id: bundle.referenceSet.id, version: bundle.referenceSet.version },
      blueprint: { id: bundle.blueprint.id, version: bundle.blueprint.version },
      evidenceSourcesRevision: snapshot.sourcesRevision,
      evidenceExtractionRevision: snapshot.extractionRevision,
      analysisBuiltAt: snapshot.analysis.builtAt,
    },
  }
}

function toSafeError(error: unknown): GroundedTocApiError {
  if (error instanceof GroundedTocApiError) return error
  if (error instanceof CloudApiError) return new GroundedTocApiError(error.status, error.code, error.message)
  if (error instanceof AiCatalogApiError) {
    return new GroundedTocApiError(
      error.status,
      error.code,
      error.message,
      error.readinessBlockers,
    )
  }
  if (error instanceof GroundedTocWorkflowCapabilityError)
    return new GroundedTocApiError(400, error.code, error.message)
  if (error instanceof GroundedTocPacketError)
    return new GroundedTocApiError(413, 'TOO_LARGE', error.message)
  if (error instanceof GroundedTocProviderError) {
    const messages: Record<GroundedTocProviderError['code'], string> = {
      UNSUPPORTED_PROVIDER: 'The configured provider is not supported for Generate TOC.',
      INVALID_REQUEST: 'The provider request is invalid.',
      TOO_LARGE: 'The provider request or response exceeds the supported size limit.',
      AUTH_FAILED: 'The provider rejected the configured connection.',
      REFUSED: 'The provider refused to generate a proposed TOC.',
      RATE_LIMITED: 'The provider rate limit was reached.',
      NETWORK_ERROR: 'The provider could not be reached.',
      TIMEOUT: 'The provider request timed out.',
      PROVIDER_FAILURE: 'The provider returned an incomplete response.',
      PROVIDER_ERROR: 'The provider could not generate a proposed TOC.',
    }
    return new GroundedTocApiError(
      error.code === 'TOO_LARGE' ? 413 : 502,
      error.code,
      messages[error.code],
    )
  }
  if (error instanceof GroundedTocOutputError)
    return new GroundedTocApiError(502, 'MODEL_OUTPUT_INVALID', 'The provider did not return a valid grounded TOC proposal')
  return new GroundedTocApiError(503, 'GENERATE_TOC_UNAVAILABLE', 'Generate TOC is temporarily unavailable')
}

export async function executeGroundedToc(
  value: unknown,
  request: IncomingMessage,
  dependencies: GroundedTocDependencies = {},
): Promise<{ proposal: TocProposal; recordRevision: number }> {
  validateInput(value)
  const createProjectStore = dependencies.createProjectStore
    ?? (async input => CloudProjectApi.fromRequest(input))
  const projectStore = await createProjectStore(request)
  const project = await projectStore.loadGroundedTocProject(value.projectId)
  const preCallRecord = project.record
  const snapshot = verifyFreshProject(preCallRecord)
  const workflowBundle = await (dependencies.loadWorkflow ?? loadAiWorkflowExecutionBundle)(
    request,
    project.workspaceId,
    value.workflowId,
    value.workflowVersion,
  )
  if (!capabilityIsGenerateToc(workflowBundle.workflow))
    throw new GroundedTocWorkflowCapabilityError()
  const workflow = workflowBundle.workflow.definition as WorkflowDefinition
  if (workflow.model.mode !== 'pinned'
    || workflow.model.providerId !== workflowBundle.readiness.model?.providerId
    || workflow.model.modelId !== workflowBundle.readiness.model?.modelId) {
    throw new GroundedTocApiError(409, 'WORKFLOW_NOT_READY', 'The published workflow model is not ready for execution')
  }
  const packet = buildGroundedTocPacket({
    evidenceIndex: snapshot.evidenceIndex,
    analysis: snapshot.analysis,
    contentType: snapshot.contentType,
    workflow,
    promptPack: workflowBundle.promptPack.definition as PromptPackDefinition,
    referenceSet: workflowBundle.referenceSet.definition as ReferenceSetDefinition,
    blueprint: workflowBundle.blueprint.definition as BlueprintDefinition,
  })
  const generateText = dependencies.generateText ?? generateGroundedTocText
  let generatedItems: GeneratedTocItem[] | null = null
  let userContent = packet.userContent
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      raw = await generateText({
        providerId: workflow.model.providerId,
        modelId: workflow.model.modelId,
        credential: workflowBundle.credential,
        systemInstructions: packet.systemInstructions,
        userContent,
      })
    } catch (error) {
      if (error instanceof GroundedTocProviderError) throw error
      throw new GroundedTocApiError(
        503,
        'GENERATE_TOC_UNAVAILABLE',
        'The Generate TOC provider request failed',
      )
    }
    try {
      generatedItems = validateGroundedTocOutput(
        raw,
        snapshot.evidenceIndex,
        snapshot.analysis,
        snapshot.contentType,
      ).items
      break
    } catch (error) {
      if (!(error instanceof GroundedTocOutputError)) throw error
      if (attempt === 1) throw error
      userContent += '\nThe previous output did not pass strict schema and grounding validation. Return a corrected JSON object only.'
    }
  }
  if (!generatedItems)
    throw new GroundedTocApiError(502, 'MODEL_OUTPUT_INVALID', 'The provider did not return a valid grounded TOC proposal')
  const proposal = makeProposal(
    generatedItems,
    snapshot,
    workflowBundle,
    (dependencies.now ?? Date.now)(),
    packet.candidates,
  )

  const afterCall = await projectStore.loadGroundedTocProject(value.projectId)
  if (afterCall.workspaceId !== project.workspaceId
    || afterCall.record.recordRevision !== snapshot.recordRevision) {
    throw new GroundedTocApiError(409, 'PROJECT_CONFLICT', 'Project changed during TOC generation; no proposal was saved')
  }
  const afterSnapshot = verifyFreshProject(afterCall.record)
  if (afterSnapshot.sourcesRevision !== snapshot.sourcesRevision
    || afterSnapshot.extractionRevision !== snapshot.extractionRevision
    || afterSnapshot.analysis.builtAt !== snapshot.analysis.builtAt
    || afterSnapshot.contentType !== snapshot.contentType) {
    throw new GroundedTocApiError(409, 'PROJECT_CONFLICT', 'Project evidence changed during TOC generation; no proposal was saved')
  }
  const saved = await projectStore.saveGroundedTocProposal(
    value.projectId,
    snapshot.recordRevision,
    proposal as unknown as Json,
  )
  if (saved.tocProposal === null || saved.tocProposal === undefined
    || saved.recordRevision !== snapshot.recordRevision + 1) {
    throw new GroundedTocApiError(503, 'SAVE_NOT_CONFIRMED', 'The generated proposal was not confirmed by cloud storage')
  }
  return { proposal: saved.tocProposal as TocProposal, recordRevision: saved.recordRevision as number }
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) {
        tooLarge = true
        reject(new GroundedTocApiError(413, 'REQUEST_TOO_LARGE', 'Generate TOC request exceeds the supported limit'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new GroundedTocApiError(400, 'INVALID_JSON', 'Request body must be valid JSON'))
      }
    })
    request.on('error', () => reject(new GroundedTocApiError(400, 'REQUEST_READ_FAILED', 'Request body could not be read')))
  })
}

export async function handleGroundedToc(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: GroundedTocDependencies = {},
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const body = await readBody(request, 4_096)
    const result = await executeGroundedToc(body, request, dependencies)
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(result))
  } catch (error) {
    const safe = toSafeError(error)
    response.statusCode = safe.status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      error: safe.message,
      code: safe.code,
      ...(safe.blockers ? { blockers: safe.blockers } : {}),
    }))
  }
}