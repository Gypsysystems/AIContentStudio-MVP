import { Client } from 'pg'
import type { AiAssetVersion, WorkflowDefinition } from '../src/aiCatalogModel'
import {
  decryptCredential,
  encryptionKey,
  readEncryptedFromDatabase,
  readerSslConfig,
  verifyConnectionTestProof,
} from './aiConnectionsApi'
import type { AiWorkflowExecutionBundle } from './aiCatalogApi'
import {
  executeGroundedTopicWithTrustedContext,
  GroundedTopicApiError,
} from './groundedTopicApi'
import {
  generateGroundedTocText,
  GroundedTocProviderError,
} from './groundedTocProvider'
import {
  isLikelySecret,
  isSensitiveVariableName,
} from './groundedTopicPacket'

type Json = Record<string, unknown>
type WorkerJob = {
  jobId: string
  projectId: string
  topicId: string
  workflowId: string
  workflowVersion: number
  inputRevision: number
}
type ClaimedJob = { job: WorkerJob; leaseToken: string }
type WorkerContext = {
  job: Json
  record: Json
  assets: {
    workflow: Json
    promptPack: Json
    referenceSet: Json
    blueprint: Json
  }
  connectionMetadata: Json
}

const WORKER_ID = /^generate_topic_worker(?:\.[a-z0-9]+)?$/u

function object(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failConfig(): never {
  throw new Error('Generate Topic worker database is not configured')
}

export function workerDatabaseConfig(
  raw = process.env.GENERATE_TOPIC_WORKER_DATABASE_URL,
  ca = process.env.GENERATE_TOPIC_WORKER_DATABASE_CA ?? process.env.AI_CONNECTION_DATABASE_CA,
): { connectionString: string; ssl: { rejectUnauthorized: true; ca?: string } } {
  if (!raw) return failConfig()
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password
      || !url.hostname || url.search || url.hash || !WORKER_ID.test(url.username))
      return failConfig()
  } catch {
    return failConfig()
  }
  try {
    return { connectionString: raw, ssl: readerSslConfig(ca) }
  } catch {
    return failConfig()
  }
}

function jsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as unknown } catch { return value }
  }
  return value
}

function unwrap(value: unknown): unknown {
  const parsed = jsonValue(value)
  if (Array.isArray(parsed)) return parsed[0] ?? null
  return parsed
}

function claimedJob(value: unknown): ClaimedJob | null {
  const data = unwrap(value)
  if (data === null) return null
  if (!object(data)) throw new Error('Worker claim response invalid')
  if (data.job === null) return null
  const jobValue = object(data.job) ? data.job : data
  const leaseToken = data.leaseToken ?? data.lease_token
  if (!object(jobValue) || typeof jobValue.jobId !== 'string'
    || typeof jobValue.projectId !== 'string' || typeof jobValue.topicId !== 'string'
    || typeof jobValue.workflowId !== 'string' || !Number.isSafeInteger(jobValue.workflowVersion)
    || !Number.isSafeInteger(jobValue.inputRevision)
    || typeof leaseToken !== 'string' || !/^[0-9a-f-]{36}$/iu.test(leaseToken))
    throw new Error('Worker claim response invalid')
  return {
    job: jobValue as unknown as WorkerJob,
    leaseToken,
  }
}

function jobContext(value: unknown): WorkerContext {
  const data = unwrap(value)
  if (!object(data) || !object(data.job) || !object(data.record) || !object(data.assets)
    || !object(data.connectionMetadata)
    || !object(data.assets.workflow) || !object(data.assets.promptPack)
    || !object(data.assets.referenceSet) || !object(data.assets.blueprint)
    || typeof data.connectionMetadata.providerId !== 'string'
    || !Number.isSafeInteger(data.connectionMetadata.revision)
    || typeof data.connectionMetadata.state !== 'string')
    throw new Error('Worker context response invalid')
  return data as unknown as WorkerContext
}

function hasCredential(
  value: unknown,
  credential: string,
  seen = new Set<object>(),
): boolean {
  if (typeof value === 'string') return !!credential && value.includes(credential)
  if (typeof value !== 'object' || value === null) return false
  if (seen.has(value)) return true
  seen.add(value)
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value)
  return entries.some(([key, entry]) => (!!credential && key.includes(credential))
    || hasCredential(entry, credential, seen))
}

function workerSafeDraft(value: unknown, credential: string): Json {
  const sensitiveText = (text: string) =>
    isLikelySecret(text) || (!!credential && text.includes(credential))
  const reject = (): never => {
    throw new GroundedTopicApiError(
      502,
      'MODEL_OUTPUT_INVALID',
      'The generated draft could not be validated.',
    )
  }
  if (!object(value) || !object(value.variableSnapshot)
    || !object(value.styleProvenance) || !Array.isArray(value.styleProvenance.brandNames)
    || value.styleProvenance.brandNames.some(name => typeof name !== 'string')
    || !Array.isArray(value.blocks))
    return reject()

  const variableEntries = Object.entries(value.variableSnapshot)
  if (variableEntries.some(([, variableValue]) => typeof variableValue !== 'string'))
    return reject()
  const variableSnapshot = Object.fromEntries(variableEntries.filter(([name, variableValue]) =>
    !isSensitiveVariableName(name) && !isLikelySecret(name)
      && !sensitiveText(variableValue as string)))
  const brandNames = value.styleProvenance.brandNames
    .filter((name): name is string => typeof name === 'string' && !sensitiveText(name))
  const guidanceText = [
    value.contentType,
    value.language,
    value.styleProvenance.styleProfileName,
    value.styleProvenance.styleProfileScope,
  ]
  if (guidanceText.some(text => typeof text === 'string' && isLikelySecret(text)))
    return reject()

  for (const block of value.blocks) {
    if (!object(block) || typeof block.content !== 'string' || sensitiveText(block.content))
      return reject()
    if (block.procedureSteps !== undefined
      && (!Array.isArray(block.procedureSteps)
        || block.procedureSteps.some(step => typeof step !== 'string' || sensitiveText(step))))
      return reject()
  }

  const safeDraft = {
    ...value,
    variableSnapshot,
    styleProvenance: { ...value.styleProvenance, brandNames },
  }
  if (hasCredential(safeDraft, credential))
    return reject()
  return safeDraft
}

function asset(value: Json, expectedKind: AiAssetVersion['kind']): AiAssetVersion {
  if (value.kind !== expectedKind || typeof value.id !== 'string'
    || !Number.isSafeInteger(value.version) || typeof value.state !== 'string'
    || !object(value.definition))
    throw new Error('Worker context asset invalid')
  return value as unknown as AiAssetVersion
}

function transient(error: unknown): boolean {
  if (error instanceof GroundedTopicApiError) {
    return ['GENERATE_TOPIC_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_FAILURE']
      .includes(error.code)
  }
  if (error instanceof GroundedTocProviderError)
    return ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_FAILURE'].includes(error.code)
  return false
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof GroundedTopicApiError) {
    const code = error.code === 'RATE_LIMITED' ? 'RATE_LIMITED'
      : error.code === 'MODEL_OUTPUT_INVALID' ? 'INVALID_DRAFT'
        : error.code === 'PROJECT_CONFLICT' ? 'STALE_PROJECT'
          : ['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_FAILURE', 'GENERATE_TOPIC_UNAVAILABLE'].includes(error.code)
            ? 'PROVIDER_UNAVAILABLE'
          : 'GENERATION_FAILED'
    const messages: Record<string, string> = {
      RATE_LIMITED: 'The generation provider is temporarily rate limited.',
      INVALID_DRAFT: 'The generated draft could not be validated.',
      STALE_PROJECT: 'The project changed before generation could be saved.',
      PROVIDER_UNAVAILABLE: 'The generation provider is temporarily unavailable.',
      GENERATION_FAILED: 'Topic generation could not be completed.',
    }
    return { code, message: messages[code] }
  }
  if (error instanceof GroundedTocProviderError) {
    const code = error.code === 'RATE_LIMITED' ? 'RATE_LIMITED'
      : ['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_FAILURE'].includes(error.code) ? 'PROVIDER_UNAVAILABLE'
        : 'GENERATION_FAILED'
    return {
      code,
      message: 'The configured AI provider could not complete this Generate Topic job.',
    }
  }
  return { code: 'GENERATE_TOPIC_FAILED', message: 'Generate Topic could not complete this job.' }
}

export type GenerateTopicWorkerOptions = {
  client?: Client
  leaseSeconds?: number
  idleDelayMs?: number
  heartbeatIntervalMs?: number
  leaseHeartbeatIntervalMs?: number
  execute?: typeof executeGroundedTopicWithTrustedContext
  readEncrypted?: typeof readEncryptedFromDatabase
  generateText?: typeof generateGroundedTocText
  key?: Buffer
  sleep?: (milliseconds: number) => Promise<void>
}

export class GenerateTopicWorker {
  private readonly client: Client
  private readonly leaseSeconds: number
  private readonly idleDelayMs: number
  private readonly heartbeatIntervalMs: number
  private readonly leaseHeartbeatIntervalMs: number
  private readonly execute: typeof executeGroundedTopicWithTrustedContext
  private readonly readEncrypted: typeof readEncryptedFromDatabase
  private readonly generateText: typeof generateGroundedTocText
  private readonly key: Buffer
  private readonly sleep: (milliseconds: number) => Promise<void>
  private stopping = false

  constructor(options: GenerateTopicWorkerOptions = {}) {
    this.client = options.client ?? new Client({
      ...workerDatabaseConfig(),
      connectionTimeoutMillis: 5_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    })
    this.leaseSeconds = options.leaseSeconds ?? 180
    this.idleDelayMs = options.idleDelayMs ?? 1_000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000
    this.leaseHeartbeatIntervalMs = options.leaseHeartbeatIntervalMs
      ?? Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3))
    this.execute = options.execute ?? executeGroundedTopicWithTrustedContext
    this.readEncrypted = options.readEncrypted ?? readEncryptedFromDatabase
    this.generateText = options.generateText ?? generateGroundedTocText
    this.key = options.key ?? encryptionKey()
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  stop(): void {
    this.stopping = true
  }

  private async call(name: string, args: Json): Promise<unknown> {
    const names = Object.keys(args)
    const placeholders = names.map((_, index) => `$${index + 1}`).join(', ')
    const result = await this.client.query(
      `select public.${name}(${placeholders}) as result`,
      names.map(name => args[name]),
    )
    return result.rows[0]?.result
  }

  async heartbeat(): Promise<void> {
    await this.client.query('select public.gt_job_worker_heartbeat()')
  }

  async processClaim(claim: ClaimedJob): Promise<void> {
    const { job, leaseToken } = claim
    let leaseHeartbeatInFlight = false
    const leaseTimer = setInterval(() => {
      if (leaseHeartbeatInFlight) return
      leaseHeartbeatInFlight = true
      void this.call('gt_job_heartbeat', {
        p_job_id: job.jobId,
        p_lease_token: leaseToken,
        p_lease_seconds: this.leaseSeconds,
      }).catch(() => {
        // Finish/fail RPCs still enforce ownership if a lease extension fails.
      }).finally(() => { leaseHeartbeatInFlight = false })
    }, this.leaseHeartbeatIntervalMs)
    try {
      const rawContext = await this.call('gt_job_context', {
        p_job_id: job.jobId,
        p_lease_token: leaseToken,
      })
      const context = jobContext(rawContext)
      const contextJob = context.job as Json
      if (contextJob.jobId !== job.jobId
        || contextJob.projectId !== job.projectId
        || contextJob.topicId !== job.topicId
        || contextJob.workflowId !== job.workflowId
        || contextJob.workflowVersion !== job.workflowVersion
        || contextJob.inputRevision !== job.inputRevision
        || context.record.recordRevision !== job.inputRevision)
        throw new Error('Worker context job mismatch')

      const workflow = asset(context.assets.workflow as Json, 'workflow')
      const promptPack = asset(context.assets.promptPack as Json, 'prompt-pack')
      const referenceSet = asset(context.assets.referenceSet as Json, 'reference-set')
      const blueprint = asset(context.assets.blueprint as Json, 'blueprint')
      if (workflow.id !== job.workflowId || workflow.version !== job.workflowVersion)
        throw new Error('Worker context workflow mismatch')
      const definition = workflow.definition as unknown as WorkflowDefinition
      const metadata = context.connectionMetadata as Json
      if (metadata.state !== 'verified'
        || !verifyConnectionTestProof(this.key, {
          workspaceId: String(context.record.workspaceId),
          providerId: String(metadata.providerId),
          revision: Number(metadata.revision),
          state: metadata.state,
          proof: metadata.proof,
          testedAt: metadata.testedAt,
        })
        || !definition.model || definition.model.mode !== 'pinned'
        || definition.model.providerId !== metadata.providerId)
        throw new GroundedTopicApiError(409, 'WORKFLOW_NOT_READY', 'The published workflow model is not ready for execution')
      const encrypted = await this.readEncrypted(
        String(context.record.workspaceId),
        String(metadata.providerId),
      )
      if (!encrypted || encrypted.revision !== metadata.revision)
        throw new GroundedTopicApiError(409, 'WORKFLOW_NOT_READY', 'The configured provider connection changed; publish a ready workflow before retrying')
      const credential = decryptCredential(this.key, encrypted)
      const bundle = {
        readiness: {
          status: 'ready',
          workflow: { id: workflow.id, version: workflow.version },
          model: { providerId: metadata.providerId, modelId: definition.model.modelId },
          blockers: [],
        },
        workflow: workflow as AiAssetVersion & { kind: 'workflow' },
        promptPack: promptPack as AiAssetVersion & { kind: 'prompt-pack' },
        referenceSet: referenceSet as AiAssetVersion & { kind: 'reference-set' },
        blueprint: blueprint as AiAssetVersion & { kind: 'blueprint' },
        credential,
        connectionRevision: Number(metadata.revision),
      } as unknown as AiWorkflowExecutionBundle
      const project = {
        workspaceId: String(context.record.workspaceId),
        role: 'editor',
        record: context.record,
      }
      const projectStore = {
        async loadGroundedTopicProject() {
          return project
        },
      }
      const result = await this.execute({
        projectId: job.projectId,
        topicId: job.topicId,
        workflowId: job.workflowId,
        workflowVersion: job.workflowVersion,
      }, project, bundle, projectStore, { generateText: this.generateText })
      const draft = workerSafeDraft(result.draft, credential)
      await this.call('gt_job_finish', {
        p_job_id: job.jobId,
        p_lease_token: leaseToken,
        p_draft: draft,
      })
    } catch (error) {
      const safe = safeFailure(error)
      try {
        await this.call('gt_job_fail', {
          p_job_id: job.jobId,
          p_lease_token: leaseToken,
          p_error_code: safe.code,
          p_error_message: safe.message,
          p_retryable: transient(error),
        })
      } catch (failError) {
        // A stale/expired fencing token means this worker must not mutate the
        // job; another claim or the lease reaper owns its next transition.
        if (!object(failError) || failError.code !== '40001') throw failError
      }
    } finally {
      clearInterval(leaseTimer)
    }
  }

  async runOnce(): Promise<boolean> {
    await this.heartbeat()
    const result = await this.call('gt_job_claim', { p_lease_seconds: this.leaseSeconds })
    const claim = claimedJob(result)
    if (!claim) return false
    await this.processClaim(claim)
    return true
  }

  async run(): Promise<void> {
    await this.client.connect()
    await this.heartbeat()
    let heartbeatInFlight = false
    const timer = setInterval(() => {
      if (heartbeatInFlight || this.stopping) return
      heartbeatInFlight = true
      void this.heartbeat().catch(() => {
        this.stopping = true
      }).finally(() => { heartbeatInFlight = false })
    }, this.heartbeatIntervalMs)
    try {
      while (!this.stopping) {
        try {
          const claimed = await this.runOnce()
          if (!claimed && !this.stopping) await this.sleep(this.idleDelayMs)
        } catch {
          if (!this.stopping) await this.sleep(this.idleDelayMs)
        }
      }
    } finally {
      clearInterval(timer)
      await this.client.end()
    }
  }
}