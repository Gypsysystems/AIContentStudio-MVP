import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AiAssetVersion, BlueprintDefinition, PromptPackDefinition, ReferenceSetDefinition, WorkflowDefinition } from '../src/aiCatalogModel'
import {
  AiCatalogApiError,
  loadAiWorkflowExecutionBundle,
  type AiWorkflowExecutionBundle,
} from './aiCatalogApi'
import { CloudApiError, CloudProjectApi } from './cloudProjectApi'
import {
  buildGroundedTopicPacket,
  buildGroundedTopicSnapshot,
  GroundedTopicGroundingError,
  GroundedTopicPacketError,
  sanitizedGroundedBrandNames,
  sanitizedGroundedVariables,
  type GroundedTopicSnapshot,
} from './groundedTopicPacket'
import {
  GroundedTocProviderError,
  generateGroundedTocText,
} from './groundedTocProvider'
import {
  GroundedTopicOutputError,
  validateGroundedTopicOutput,
  type GeneratedTopicBlock,
} from './groundedTopicOutput'

type Json = Record<string, unknown>
type ProjectContext = { workspaceId: string; role: string; record: Json }
type GroundedTopicProjectStore = {
  loadGroundedTopicProject(projectId: unknown): Promise<ProjectContext>
}
type GroundedTopicDependencies = {
  createProjectStore?: (request: IncomingMessage) => Promise<GroundedTopicProjectStore>
  loadWorkflow?: typeof loadAiWorkflowExecutionBundle
  generateText?: typeof generateGroundedTocText
  now?: () => number
}

export class GroundedTopicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly blockers?: unknown[],
  ) {
    super(message)
    this.name = 'GroundedTopicApiError'
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertStableId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/u.test(value))
    throw new GroundedTopicApiError(400, 'INVALID_REQUEST', `${field} is invalid`)
}

function validateInput(value: unknown): asserts value is {
  projectId: string
  topicId: string
  workflowId: string
  workflowVersion: number
} {
  if (!isObject(value)) throw new GroundedTopicApiError(400, 'INVALID_REQUEST', 'A JSON object is required')
  const keys = ['projectId', 'topicId', 'workflowId', 'workflowVersion']
  if (Object.keys(value).some(key => !keys.includes(key)))
    throw new GroundedTopicApiError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
  if (Object.keys(value).length !== keys.length)
    throw new GroundedTopicApiError(400, 'INVALID_REQUEST', 'All required Generate Topic fields must be supplied')
  assertStableId(value.projectId, 'projectId')
  assertStableId(value.topicId, 'topicId')
  assertStableId(value.workflowId, 'workflowId')
  if (!Number.isSafeInteger(value.workflowVersion) || Number(value.workflowVersion) < 1)
    throw new GroundedTopicApiError(400, 'INVALID_REQUEST', 'workflowVersion must be a positive integer')
}

function capabilityIsGenerateTopic(workflow: AiAssetVersion): workflow is AiAssetVersion & { kind: 'workflow' } {
  if (workflow.kind !== 'workflow' || !isObject(workflow.definition)) return false
  const definition = workflow.definition as unknown as WorkflowDefinition
  const capability = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '')
  return capability(definition.capability) === 'generatetopic'
    && definition.steps.length > 0
    && definition.steps.every(step => capability(step.capability) === 'generatetopic')
}

function makeDraft(
  blocks: GeneratedTopicBlock[],
  snapshot: GroundedTopicSnapshot,
  bundle: AiWorkflowExecutionBundle,
  now: number,
) {
  const evidenceIdsUsed = [...new Set(blocks.flatMap(block => block.evidenceIds))]
  const safeReference = (asset: AiWorkflowExecutionBundle['promptPack']) => ({
    id: asset.id,
    version: asset.version,
  })
  const context = snapshot.groundingContext
  const variables = { ...context.writingGuidance.variables }
  const provenance = {
    providerId: bundle.readiness.model!.providerId,
    modelId: bundle.readiness.model!.modelId,
    workflow: { id: bundle.workflow.id, version: bundle.workflow.version },
    promptPack: safeReference(bundle.promptPack),
    referenceSet: { id: bundle.referenceSet.id, version: bundle.referenceSet.version },
    blueprint: { id: bundle.blueprint.id, version: bundle.blueprint.version },
  }
  return {
    version: 1 as const,
    draftId: `ai-topic-${now.toString(36)}-${snapshot.topicId}`,
    topicId: snapshot.topicId,
    method: 'ai-grounded-topic-v1' as const,
    modelLabel: `${provenance.providerId} · ${provenance.modelId}`,
    generatedAt: now,
    groundingContextId: context.contextId,
    groundingRevision: [
      snapshot.sourcesRevision,
      snapshot.extractionRevision,
      snapshot.analysisBuiltAt,
      snapshot.tocRevision,
    ].join(':'),
    contentType: context.writingGuidance.contentType,
    language: context.writingGuidance.language,
    variableSnapshot: sanitizedGroundedVariables(variables),
    styleProvenance: {
      styleProfileId: context.writingGuidance.styleProfileId,
      styleProfileName: context.writingGuidance.styleProfileName,
      styleProfileScope: context.writingGuidance.styleProfileScope,
      styleFingerprint: context.provenance.styleFingerprint,
      brandNames: sanitizedGroundedBrandNames(context.writingGuidance.brandNames),
    },
    evidenceIdsUsed,
    requiredEvidenceIdsUsed: evidenceIdsUsed.filter(id => snapshot.requiredEvidenceIds.includes(id)),
    optionalEvidenceIdsUsed: evidenceIdsUsed.filter(id => snapshot.optionalEvidenceIds.includes(id)),
    warnings: [],
    blocks,
    aiProvenance: provenance,
  }
}

function snapshotMatches(left: GroundedTopicSnapshot, right: GroundedTopicSnapshot): boolean {
  return left.recordRevision === right.recordRevision
    && left.topicId === right.topicId
    && JSON.stringify(left.topic) === JSON.stringify(right.topic)
    && left.sourcesRevision === right.sourcesRevision
    && left.extractionRevision === right.extractionRevision
    && left.analysisBuiltAt === right.analysisBuiltAt
    && left.analysisRevision === right.analysisRevision
    && left.tocRevision === right.tocRevision
    && left.groundingContext.contextId === right.groundingContext.contextId
    && JSON.stringify(left.requiredEvidenceIds) === JSON.stringify(right.requiredEvidenceIds)
    && JSON.stringify(left.optionalEvidenceIds) === JSON.stringify(right.optionalEvidenceIds)
}

function toSafeError(error: unknown): GroundedTopicApiError {
  if (error instanceof GroundedTopicApiError) return error
  if (error instanceof CloudApiError) return new GroundedTopicApiError(error.status, error.code, error.message)
  if (error instanceof AiCatalogApiError) {
    return new GroundedTopicApiError(error.status, error.code, error.message, error.readinessBlockers)
  }
  if (error instanceof GroundedTopicGroundingError)
    return new GroundedTopicApiError(error.code === 'DEMO_PROJECT_UNSUPPORTED' ? 403 : 409, error.code, error.message)
  if (error instanceof GroundedTopicPacketError)
    return new GroundedTopicApiError(413, 'TOO_LARGE', error.message)
  if (error instanceof GroundedTocProviderError) {
    const messages: Record<GroundedTocProviderError['code'], string> = {
      UNSUPPORTED_PROVIDER: 'The configured provider is not supported for Generate Topic.',
      INVALID_REQUEST: 'The provider request is invalid.',
      TOO_LARGE: 'The provider request or response exceeds the supported size limit.',
      AUTH_FAILED: 'The provider rejected the configured connection.',
      REFUSED: 'The provider refused to generate a topic draft.',
      RATE_LIMITED: 'The provider rate limit was reached.',
      NETWORK_ERROR: 'The provider could not be reached.',
      TIMEOUT: 'The provider request timed out.',
      PROVIDER_FAILURE: 'The provider returned an incomplete response.',
      PROVIDER_ERROR: 'The provider could not generate a topic draft.',
    }
    return new GroundedTopicApiError(error.code === 'TOO_LARGE' ? 413 : 502, error.code, messages[error.code])
  }
  if (error instanceof GroundedTopicOutputError)
    return new GroundedTopicApiError(502, 'MODEL_OUTPUT_INVALID', 'The provider did not return a valid grounded topic draft')
  return new GroundedTopicApiError(503, 'GENERATE_TOPIC_UNAVAILABLE', 'Generate Topic is temporarily unavailable')
}

export async function executeGroundedTopic(
  value: unknown,
  request: IncomingMessage,
  dependencies: GroundedTopicDependencies = {},
): Promise<{ draft: ReturnType<typeof makeDraft>; recordRevision: number }> {
  validateInput(value)
  const projectStore = await (dependencies.createProjectStore
    ?? (async input => CloudProjectApi.fromRequest(input)))(request)
  const project = await projectStore.loadGroundedTopicProject(value.projectId)
  if (!['owner', 'admin', 'editor'].includes(project.role))
    throw new GroundedTopicApiError(403, 'FORBIDDEN', 'Workspace write permission is required to generate a topic draft')
  const snapshot = buildGroundedTopicSnapshot(project.record, value.topicId)
  const bundle = await (dependencies.loadWorkflow ?? loadAiWorkflowExecutionBundle)(
    request,
    project.workspaceId,
    value.workflowId,
    value.workflowVersion,
    undefined,
    true,
  )
  return executeGroundedTopicWithTrustedContext(value, project, bundle, projectStore, dependencies, snapshot)
}

export async function executeGroundedTopicWithTrustedContext(
  value: unknown,
  project: ProjectContext,
  bundle: AiWorkflowExecutionBundle,
  projectStore: GroundedTopicProjectStore,
  dependencies: Pick<GroundedTopicDependencies, 'generateText' | 'now'> = {},
  expectedSnapshot?: GroundedTopicSnapshot,
): Promise<{ draft: ReturnType<typeof makeDraft>; recordRevision: number }> {
  validateInput(value)
  if (!['owner', 'admin', 'editor'].includes(project.role))
    throw new GroundedTopicApiError(403, 'FORBIDDEN', 'Workspace write permission is required to generate a topic draft')
  const snapshot = expectedSnapshot ?? buildGroundedTopicSnapshot(project.record, value.topicId)
  if (bundle.workflow.state !== 'published'
    || bundle.promptPack.state !== 'published'
    || bundle.referenceSet.state !== 'published'
    || bundle.blueprint.state !== 'published'
    || bundle.readiness.status !== 'ready') {
    throw new GroundedTopicApiError(409, 'WORKFLOW_NOT_READY', 'A published ready Generate Topic workflow is required')
  }
  if (!capabilityIsGenerateTopic(bundle.workflow))
    throw new GroundedTopicApiError(400, 'INVALID_WORKFLOW_CAPABILITY', 'Only a Generate Topic workflow can be used for grounded topic generation')
  const workflow = bundle.workflow.definition as WorkflowDefinition
  if (workflow.model.mode !== 'pinned'
    || workflow.model.providerId !== bundle.readiness.model?.providerId
    || workflow.model.modelId !== bundle.readiness.model?.modelId) {
    throw new GroundedTopicApiError(409, 'WORKFLOW_NOT_READY', 'The published workflow model is not ready for execution')
  }
  const packet = buildGroundedTopicPacket(
    snapshot,
    workflow,
    bundle.promptPack.definition as PromptPackDefinition,
    bundle.referenceSet.definition as ReferenceSetDefinition,
    bundle.blueprint.definition as BlueprintDefinition,
  )
  const generateText = dependencies.generateText ?? generateGroundedTocText
  let generatedBlocks: GeneratedTopicBlock[] | null = null
  let userContent = packet.userContent
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      raw = await generateText({
        providerId: workflow.model.providerId,
        modelId: workflow.model.modelId,
        credential: bundle.credential,
        systemInstructions: packet.systemInstructions,
        userContent,
      })
    } catch (error) {
      if (error instanceof GroundedTocProviderError) throw error
      throw new GroundedTopicApiError(503, 'GENERATE_TOPIC_UNAVAILABLE', 'The Generate Topic provider request failed')
    }
    try {
      generatedBlocks = validateGroundedTopicOutput(raw, snapshot.evidenceIndex, packet.evidenceIds)
      if (generatedBlocks.some(block =>
        block.content.includes(bundle.credential)
        || block.procedureSteps?.some(step => step.includes(bundle.credential)))) {
        throw new GroundedTopicOutputError()
      }
      break
    } catch (error) {
      if (!(error instanceof GroundedTopicOutputError)) throw error
      if (attempt === 1) throw error
      userContent += '\nThe previous output failed strict schema or evidence validation. Return corrected JSON only.'
    }
  }
  if (!generatedBlocks)
    throw new GroundedTopicApiError(502, 'MODEL_OUTPUT_INVALID', 'The provider did not return a valid grounded topic draft')
  const draft = makeDraft(generatedBlocks, snapshot, bundle, (dependencies.now ?? Date.now)())

  let after: ProjectContext
  let afterSnapshot: GroundedTopicSnapshot
  try {
    after = await projectStore.loadGroundedTopicProject(value.projectId)
    if (after.workspaceId !== project.workspaceId)
      throw new Error('workspace changed')
    afterSnapshot = buildGroundedTopicSnapshot(after.record, value.topicId)
  } catch {
    throw new GroundedTopicApiError(409, 'PROJECT_CONFLICT', 'Project grounding changed during generation; no proposal was installed')
  }
  if (!snapshotMatches(snapshot, afterSnapshot))
    throw new GroundedTopicApiError(409, 'PROJECT_CONFLICT', 'Project or topic grounding changed during generation; no proposal was installed')
  return { draft, recordRevision: snapshot.recordRevision }
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
        reject(new GroundedTopicApiError(413, 'REQUEST_TOO_LARGE', 'Generate Topic request exceeds the supported limit'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new GroundedTopicApiError(400, 'INVALID_JSON', 'Request body must be valid JSON'))
      }
    })
    request.on('error', () => reject(new GroundedTopicApiError(400, 'REQUEST_READ_FAILED', 'Request body could not be read')))
  })
}

export async function handleGroundedTopic(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: GroundedTopicDependencies = {},
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const body = await readBody(request, 4_096)
    const result = await executeGroundedTopic(body, request, dependencies)
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