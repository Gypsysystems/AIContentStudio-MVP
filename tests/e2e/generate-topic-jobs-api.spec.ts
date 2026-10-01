import { expect, test } from '@playwright/test'
import { createHmac, hkdfSync, X509Certificate } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { rootCertificates } from 'node:tls'
import {
  executeGenerateTopicJobCommand,
  GenerateTopicJobsApiError,
} from '../../server/generateTopicJobsApi'
import {
  encryptCredential,
} from '../../server/aiConnectionsApi'
import {
  GenerateTopicWorker,
  workerDatabaseConfig,
} from '../../server/generateTopicWorker'
import { GroundedTopicApiError } from '../../server/groundedTopicApi'
import { GroundedTocProviderError } from '../../server/groundedTocProvider'
import { createWorkerLogEntry, safeWorkerLog } from '../../server/workerSafeLogging'

const JOB_ID = '6f97e277-4549-4c9a-9da7-10194cc6551c'
const PROJECT_ID = 'job-project'
const TOPIC_ID = 'topic-install'
const WORKFLOW_ID = 'workflow-topic'
const LEASE_TOKEN = 'bb790955-2990-4dbe-8bed-b32a1fb6af75'
const TESTED_AT = '2026-01-02T03:04:05.000Z'

function connectionProof(
  key: Buffer,
  workspaceId: string,
  providerId: string,
  revision: number,
  state: string,
  testedAt: string,
): string {
  const macKey = Buffer.from(hkdfSync(
    'sha256',
    key,
    Buffer.alloc(0),
    'ai-connection-test-proof-v1',
    32,
  ))
  return createHmac('sha256', macKey)
    .update(JSON.stringify([workspaceId, providerId, revision, state, new Date(testedAt).toISOString()]))
    .digest('hex')
}

function request(): IncomingMessage {
  return { headers: { cookie: 'sb_access_token=authenticated-session' } } as unknown as IncomingMessage
}

function publicJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
    inputRevision: 15,
    status: 'queued',
    phase: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  }
}

function workerFixtures(key = Buffer.alloc(32, 7)) {
  const job = {
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
    inputRevision: 15,
  }
  const workflow = {
    id: WORKFLOW_ID,
    version: 2,
    kind: 'workflow',
    state: 'published',
    definition: {
      capability: 'Generate Topic',
      model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-test' },
      steps: [{ id: 'step', capability: 'Generate Topic' }],
    },
  }
  const context = {
    job,
    record: { projectId: PROJECT_ID, workspaceId: 'workspace-a', recordRevision: 15 },
    assets: {
      workflow,
      promptPack: { id: 'prompts', version: 1, kind: 'prompt-pack', state: 'published', definition: {} },
      referenceSet: { id: 'references', version: 1, kind: 'reference-set', state: 'published', definition: {} },
      blueprint: { id: 'blueprint', version: 1, kind: 'blueprint', state: 'published', definition: {} },
    },
    connectionMetadata: {
      providerId: 'openai',
      revision: 4,
      state: 'verified',
      proof: connectionProof(key, 'workspace-a', 'openai', 4, 'verified', TESTED_AT),
      testedAt: TESTED_AT,
    },
  }
  const encryptedParts = encryptCredential(key, 'workspace-a', 'openai', 4, 'worker-secret')
  const encrypted = {
    workspaceId: 'workspace-a',
    providerId: 'openai',
    revision: 4,
    ciphertext: Buffer.from(encryptedParts.ciphertext, 'base64'),
    nonce: Buffer.from(encryptedParts.nonce, 'base64'),
    tag: Buffer.from(encryptedParts.tag, 'base64'),
    keyVersion: 'v1',
  }
  return { key, job, context, encrypted }
}

type RpcCall = { name: string; args: unknown[] }

function mockWorkerClient(options: {
  context?: unknown
  contextError?: Error
  finishError?: Error
  finishResult?: unknown
  claim?: unknown
  failError?: Error
} = {}) {
  const calls: RpcCall[] = []
  const client = {
    async query(text: string, args: unknown[] = []) {
      const match = text.match(/public\.(gt_job_[a-z_]+)/u)
      const name = match?.[1] ?? 'gt_job_worker_heartbeat'
      calls.push({ name, args })
      if (name === 'gt_job_claim') {
        return { rows: [{ result: options.claim ?? { job: null } }] }
      }
      if (name === 'gt_job_context' && options.contextError) throw options.contextError
      if (name === 'gt_job_context') return { rows: [{ result: options.context }] }
      if (name === 'gt_job_finish' && options.finishError) throw options.finishError
      if (name === 'gt_job_finish') {
        return {
          rows: [{
            result: options.finishResult ?? {
              job: { jobId: JOB_ID, status: 'succeeded' },
            },
          }],
        }
      }
      if (name === 'gt_job_fail' && options.failError) throw options.failError
      return { rows: [{ result: null }] }
    },
  }
  return { client, calls }
}

function claimFor(job: ReturnType<typeof workerFixtures>['job']): unknown {
  return { job, leaseToken: LEASE_TOKEN }
}

test('enqueue derives the expected revision from the authenticated project record', async () => {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const result = await executeGenerateTopicJobCommand({
    action: 'enqueue',
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
  }, request(), {
    loadProject: async (_request, projectId) => {
      expect(projectId).toBe(PROJECT_ID)
      return { record: { recordRevision: 15 } }
    },
    rpc: async (_request, name, args) => {
      rpcCalls.push({ name, args })
      return { job: publicJob() }
    },
  })
  expect(rpcCalls).toEqual([{
    name: 'gt_job_enqueue',
    args: {
      p_project_id: PROJECT_ID,
      p_topic_id: TOPIC_ID,
      p_workflow_id: WORKFLOW_ID,
      p_workflow_version: 2,
      p_expected_revision: 15,
    },
  }])
  expect(result).toEqual({ job: publicJob() })
})

test('get and list return only validated public job fields', async () => {
  const calls: string[] = []
  const get = await executeGenerateTopicJobCommand({
    action: 'get', jobId: JOB_ID,
  }, request(), {
    rpc: async (_request, name) => {
      calls.push(name)
      return publicJob()
    },
  })
  const list = await executeGenerateTopicJobCommand({
    action: 'list', projectId: PROJECT_ID, topicId: TOPIC_ID,
  }, request(), {
    rpc: async (_request, name) => {
      calls.push(name)
      return [publicJob(), publicJob({ status: 'running', phase: 'generating' })]
    },
  })
  expect(calls).toEqual(['gt_job_get', 'gt_job_list'])
  expect(get).toEqual({ job: publicJob() })
  expect(list).toEqual({ jobs: [publicJob(), publicJob({ status: 'running', phase: 'generating' })] })
})

test('job API rejects unexpected request and storage fields', async () => {
  await expect(executeGenerateTopicJobCommand({
    action: 'get', jobId: JOB_ID, leaseToken: 'no',
  }, request())).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

  await expect(executeGenerateTopicJobCommand({
    action: 'get', jobId: JOB_ID,
  }, request(), {
    rpc: async () => ({ ...publicJob(), credential: 'must-not-leak' }),
  })).rejects.toBeInstanceOf(GenerateTopicJobsApiError)
})

test('enqueue maps a stale worker heartbeat to a safe unavailable response', async () => {
  const previousFetch = globalThis.fetch
  const previousUrl = process.env.SUPABASE_URL
  const previousKey = process.env.SUPABASE_ANON_KEY
  process.env.SUPABASE_URL = 'https://storage.example'
  process.env.SUPABASE_ANON_KEY = 'public-anon-key'
  globalThis.fetch = async () => Response.json({
    code: 'GT_WORKER_UNAVAILABLE',
    message: 'worker heartbeat expired',
  }, { status: 400 })
  try {
    await expect(executeGenerateTopicJobCommand({
      action: 'enqueue',
      projectId: PROJECT_ID,
      topicId: TOPIC_ID,
      workflowId: WORKFLOW_ID,
      workflowVersion: 2,
    }, request(), {
      loadProject: async () => ({ record: { recordRevision: 15 } }),
    })).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE',
      message: 'Generate Topic jobs are temporarily unavailable',
    })
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = previousKey
  }
})

test('worker connection validation requires its dedicated restricted database identity', () => {
  expect(() => workerDatabaseConfig('postgresql://user:password@db.example/worker')).toThrow()
  expect(() => workerDatabaseConfig('postgresql://generate_topic_worker:password@db.example/worker?sslmode=disable')).toThrow()
})

const workerDatabaseUrl = 'postgresql://generate_topic_worker:fixture-password@db.example/worker'

function withWorkerCaSecrets(workerCa: string | undefined, fallbackCa: string | undefined, check: () => void) {
  const previousWorkerCa = process.env.GENERATE_TOPIC_WORKER_DATABASE_CA
  const previousFallbackCa = process.env.AI_CONNECTION_DATABASE_CA
  try {
    if (workerCa === undefined) delete process.env.GENERATE_TOPIC_WORKER_DATABASE_CA
    else process.env.GENERATE_TOPIC_WORKER_DATABASE_CA = workerCa
    if (fallbackCa === undefined) delete process.env.AI_CONNECTION_DATABASE_CA
    else process.env.AI_CONNECTION_DATABASE_CA = fallbackCa
    check()
  } finally {
    if (previousWorkerCa === undefined) delete process.env.GENERATE_TOPIC_WORKER_DATABASE_CA
    else process.env.GENERATE_TOPIC_WORKER_DATABASE_CA = previousWorkerCa
    if (previousFallbackCa === undefined) delete process.env.AI_CONNECTION_DATABASE_CA
    else process.env.AI_CONNECTION_DATABASE_CA = previousFallbackCa
  }
}

test('explicit worker CA takes precedence over the AI connection CA', () => {
  const workerCa = rootCertificates[0]
  const fallbackCa = rootCertificates[1]
  withWorkerCaSecrets(workerCa, fallbackCa, () => {
    const ssl = workerDatabaseConfig(workerDatabaseUrl).ssl
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(new X509Certificate(ssl.ca!).fingerprint256)
      .toBe(new X509Certificate(workerCa).fingerprint256)
    expect(new X509Certificate(ssl.ca!).fingerprint256)
      .not.toBe(new X509Certificate(fallbackCa).fingerprint256)
  })
})

test('worker falls back to the AI connection CA when its own CA is absent', () => {
  const fallbackCa = rootCertificates[0]
  withWorkerCaSecrets(undefined, fallbackCa, () => {
    const ssl = workerDatabaseConfig(workerDatabaseUrl).ssl
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(new X509Certificate(ssl.ca!).fingerprint256)
      .toBe(new X509Certificate(fallbackCa).fingerprint256)
  })
})

test('invalid fallback CA fails closed', () => {
  withWorkerCaSecrets(undefined, 'not-a-certificate', () => {
    expect(() => workerDatabaseConfig(workerDatabaseUrl))
      .toThrow('Generate Topic worker database is not configured')
  })
})

test('worker uses system trust with certificate verification when both CAs are absent', () => {
  withWorkerCaSecrets(undefined, undefined, () => {
    expect(workerDatabaseConfig(workerDatabaseUrl).ssl)
      .toEqual({ rejectUnauthorized: true })
  })
})

test('worker structured logs contain only allowlisted safe IDs and operational facts', () => {
  const entry = createWorkerLogEntry('warn', 'worker.job.failed', {
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
    inputRevision: 15,
    errorCode: 'RATE_LIMITED',
    retryable: true,
    message: 'provider content password=do-not-log',
  } as never, '2026-01-02T03:04:05.000Z')
  expect(entry).toEqual({
    timestamp: '2026-01-02T03:04:05.000Z',
    level: 'warn',
    event: 'worker.job.failed',
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
    inputRevision: 15,
    errorCode: 'RATE_LIMITED',
    retryable: true,
  })

  const unsafe = createWorkerLogEntry('error', 'worker.poll_failed', {
    jobId: 'password=secret-value',
    projectId: 'sk-12345678901234567890',
    errorCode: 'provider response password=private-value',
  }, '2026-01-02T03:04:05.000Z')
  expect(unsafe).toEqual({
    timestamp: '2026-01-02T03:04:05.000Z',
    level: 'error',
    event: 'worker.poll_failed',
  })
  expect(JSON.stringify([entry, unsafe])).not.toMatch(/do-not-log|secret-value|private-value/u)

  expect(() => createWorkerLogEntry('info', 'worker.unrecognized', {}, 'fixed'))
    .toThrow('Worker log event is not allowlisted')
  expect(() => safeWorkerLog('info', 'worker.started', {}, () => {
    throw new Error('unavailable test sink')
  })).not.toThrow()
})

test('worker startup logging classifies database failures without logging driver messages', async () => {
  const logs: unknown[] = []
  const driverMessage = 'db.example connection password=private and credential=secret-value'
  const worker = new GenerateTopicWorker({
    client: {
      async connect() { throw new Error(driverMessage) },
      async end() {},
    } as never,
    key: Buffer.alloc(32, 1),
    logger: entry => logs.push(entry),
  })

  await expect(worker.run()).rejects.toThrow(driverMessage)
  expect(logs).toEqual([{
    timestamp: expect.any(String),
    level: 'error',
    event: 'worker.startup_failed',
    errorCode: 'DATABASE_UNAVAILABLE',
  }])
  expect(JSON.stringify(logs)).not.toContain('db.example')
  expect(JSON.stringify(logs)).not.toContain('private')
  expect(JSON.stringify(logs)).not.toContain('secret-value')
})

test('worker poll failures are logged safely while the existing retry delay and shutdown remain intact', async () => {
  const logs: unknown[] = []
  const privateDriverDetail = 'database password=must-not-appear'
  let queryCount = 0
  let worker!: GenerateTopicWorker
  worker = new GenerateTopicWorker({
    client: {
      async connect() {},
      async end() {},
      async query() {
        queryCount++
        if (queryCount === 3) throw new Error(privateDriverDetail)
        return { rows: [{ result: null }] }
      },
    } as never,
    key: Buffer.alloc(32, 1),
    logger: entry => logs.push(entry),
    sleep: async () => worker.stop(),
  })

  await expect(worker.run()).resolves.toBeUndefined()
  expect(logs).toContainEqual({
    timestamp: expect.any(String),
    level: 'warn',
    event: 'worker.poll_failed',
    errorCode: 'WORKER_OPERATION_FAILED',
  })
  expect(JSON.stringify(logs)).not.toContain('must-not-appear')
  expect(queryCount).toBe(3)
})

test('worker refreshes the SQL liveness heartbeat when the queue is idle', async () => {
  const queries: string[] = []
  const client = {
    async query(text: string) {
      queries.push(text)
      return { rows: [{ result: text.includes('gt_job_claim') ? { job: null } : null }] }
    },
  }
  const worker = new GenerateTopicWorker({
    client: client as never,
    key: Buffer.alloc(32, 1),
  })
  await expect(worker.runOnce()).resolves.toBe(false)
  expect(queries.some(query => query.includes('gt_job_worker_heartbeat'))).toBe(true)
})

test('worker claims trusted project/catalog/connection context and completes with its fencing token', async () => {
  const fixtures = workerFixtures()
  const rpc = mockWorkerClient({
    context: fixtures.context,
    claim: claimFor(fixtures.job),
  })
  let executions = 0
  let providerCalls = 0
  const worker = new GenerateTopicWorker({
    client: rpc.client as never,
    key: fixtures.key,
    leaseHeartbeatIntervalMs: 5,
    readEncrypted: async (workspaceId, providerId) => {
      expect([workspaceId, providerId]).toEqual(['workspace-a', 'openai'])
      return fixtures.encrypted
    },
    generateText: async input => {
      providerCalls++
      expect(input).toMatchObject({
        providerId: 'openai',
        modelId: 'gpt-test',
        credential: 'worker-secret',
      })
      return '{"blocks":[]}'
    },
    execute: async (input, project, bundle, store, executionDependencies) => {
      executions++
      expect(input).toMatchObject({
        projectId: PROJECT_ID,
        topicId: TOPIC_ID,
        workflowId: WORKFLOW_ID,
        workflowVersion: 2,
      })
      expect(project).toMatchObject({
        workspaceId: 'workspace-a',
        role: 'editor',
        record: { recordRevision: 15 },
      })
      expect(bundle).toMatchObject({
        workflow: { id: WORKFLOW_ID, version: 2, state: 'published' },
        promptPack: { id: 'prompts', state: 'published' },
        referenceSet: { id: 'references', state: 'published' },
        blueprint: { id: 'blueprint', state: 'published' },
        credential: 'worker-secret',
        connectionRevision: 4,
      })
      expect(typeof store.loadGroundedTopicProject).toBe('function')
      const generateText = executionDependencies?.generateText
      expect(generateText).toBeDefined()
      await generateText!({
        providerId: 'openai',
        modelId: 'gpt-test',
        credential: bundle.credential,
        systemInstructions: 'trusted test instructions',
        userContent: 'trusted test packet',
      })
      await new Promise(resolve => setTimeout(resolve, 25))
      return {
        draft: {
          draftId: 'safe-draft',
          blocks: [],
          variableSnapshot: {},
          styleProvenance: { brandNames: [] },
        },
        recordRevision: 15,
      } as never
    },
  })

  await expect(worker.runOnce()).resolves.toBe(true)
  expect(executions).toBe(1)
  expect(providerCalls).toBe(1)
  expect(rpc.calls.map(call => call.name)).toEqual(expect.arrayContaining([
    'gt_job_worker_heartbeat',
    'gt_job_claim',
    'gt_job_context',
    'gt_job_heartbeat',
    'gt_job_finish',
  ]))
  const finish = rpc.calls.find(call => call.name === 'gt_job_finish')!
  expect(finish.args).toEqual([JOB_ID, LEASE_TOKEN, {
    draftId: 'safe-draft',
    blocks: [],
    variableSnapshot: {},
    styleProvenance: { brandNames: [] },
  }])
  expect(rpc.calls.some(call => call.name === 'gt_job_fail')).toBe(false)
  expect(JSON.stringify(rpc.calls)).not.toContain('worker-secret')
})

test('worker finish logs the persisted job outcome instead of assuming RPC success means generation success', async () => {
  async function runFinish(finishResult: unknown) {
    const fixtures = workerFixtures()
    const rpc = mockWorkerClient({
      context: fixtures.context,
      claim: claimFor(fixtures.job),
      finishResult,
    })
    const logs: unknown[] = []
    const worker = new GenerateTopicWorker({
      client: rpc.client as never,
      key: fixtures.key,
      readEncrypted: async () => fixtures.encrypted,
      execute: async () => ({
        draft: {
          variableSnapshot: {},
          styleProvenance: { brandNames: [] },
          blocks: [],
        },
        recordRevision: 15,
      }) as never,
      logger: entry => logs.push(entry),
    })

    await expect(worker.runOnce()).resolves.toBe(true)
    expect(rpc.calls.some(call => call.name === 'gt_job_fail')).toBe(false)
    return logs
  }

  const succeeded = await runFinish({
    job: { jobId: JOB_ID, status: 'succeeded' },
  })
  expect(succeeded).toContainEqual(expect.objectContaining({
    event: 'worker.job.succeeded',
    jobId: JOB_ID,
  }))
  expect(succeeded.some(entry => (entry as { event?: string }).event === 'worker.job.finish_failed')).toBe(false)

  for (const errorCode of ['STALE_PROJECT', 'PERMISSION_REVOKED'] as const) {
    const persistedFailure = await runFinish({
      job: {
        jobId: JOB_ID,
        status: 'failed',
        errorCode,
        errorMessage: 'private project details must not be logged',
      },
    })
    expect(persistedFailure).toContainEqual(expect.objectContaining({
      level: 'warn',
      event: 'worker.job.finish_failed',
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      errorCode,
      retryable: false,
    }))
    expect(persistedFailure.some(entry => (entry as { event?: string }).event === 'worker.job.succeeded')).toBe(false)
    expect(JSON.stringify(persistedFailure)).not.toContain('private project details')
  }
})

test('worker filters packet-detected secrets from draft variables and brand names before public retrieval', async () => {
  const fixtures = workerFixtures()
  const rpc = mockWorkerClient({ context: fixtures.context, claim: claimFor(fixtures.job) })
  const secret = 'sk-12345678901234567890'
  const worker = new GenerateTopicWorker({
    client: rpc.client as never,
    key: fixtures.key,
    readEncrypted: async () => fixtures.encrypted,
    execute: async () => ({
      draft: {
        variableSnapshot: { campaignTheme: secret, tone: 'calm', api_token: 'ordinary setting' },
        styleProvenance: { brandNames: ['Northwind', `Bearer password=${secret}`] },
        blocks: [{ type: 'para', content: 'A safe grounded paragraph.', evidenceIds: ['evidence-1'] }],
      },
      recordRevision: 15,
    }) as never,
  })

  await expect(worker.runOnce()).resolves.toBe(true)
  const finish = rpc.calls.find(call => call.name === 'gt_job_finish')!
  const storedDraft = finish.args[2] as Record<string, unknown>
  expect(storedDraft.variableSnapshot).toEqual({ tone: 'calm' })
  expect(storedDraft.styleProvenance).toEqual({ brandNames: ['Northwind'] })
  expect(JSON.stringify(storedDraft)).not.toContain(secret)

  const publicResult = await executeGenerateTopicJobCommand({
    action: 'get',
    jobId: JOB_ID,
  }, request(), {
    rpc: async () => ({
      ...publicJob({ status: 'succeeded', phase: 'succeeded' }),
      draft: storedDraft,
    }),
  })
  expect(JSON.stringify(publicResult)).not.toContain(secret)
  expect(publicResult).toMatchObject({
    job: {
      status: 'succeeded',
      draft: {
        variableSnapshot: { tone: 'calm' },
        styleProvenance: { brandNames: ['Northwind'] },
      },
    },
  })
})

test('worker heuristic secret checks exempt validated long structural identifiers', async () => {
  const fixtures = workerFixtures()
  const longTopicId = '0123456789abcdef0123456789abcdef'
  fixtures.job.topicId = longTopicId
  fixtures.context.job.topicId = longTopicId
  const rpc = mockWorkerClient({ context: fixtures.context, claim: claimFor(fixtures.job) })
  const worker = new GenerateTopicWorker({
    client: rpc.client as never,
    key: fixtures.key,
    readEncrypted: async () => fixtures.encrypted,
    execute: async () => ({
      draft: {
        draftId: `ai-topic-${longTopicId}`,
        topicId: longTopicId,
        groundingContextId: longTopicId,
        variableSnapshot: { tone: 'calm' },
        styleProvenance: { styleProfileId: longTopicId, brandNames: ['Northwind'] },
        aiProvenance: { workflow: { id: longTopicId } },
        blocks: [{
          id: longTopicId,
          type: 'para',
          content: 'A safe grounded paragraph.',
          evidenceIds: [longTopicId],
        }],
      },
      recordRevision: 15,
    }) as never,
  })

  await expect(worker.runOnce()).resolves.toBe(true)
  const finish = rpc.calls.find(call => call.name === 'gt_job_finish')
  expect(finish?.args[2]).toMatchObject({
    topicId: longTopicId,
    draftId: `ai-topic-${longTopicId}`,
  })
})

test('worker rejects forged secret-bearing generated text or procedure steps without persisting a draft', async () => {
  const fixtures = workerFixtures()
  const cases = [
    {
      content: 'password=forged-provider-secret',
      procedureSteps: ['Read the approved instructions.'],
    },
    {
      content: 'A safe paragraph.',
      procedureSteps: ['Use password=forged-provider-secret to continue.'],
    },
  ]
  for (const block of cases) {
    const rpc = mockWorkerClient({ context: fixtures.context, claim: claimFor(fixtures.job) })
    const worker = new GenerateTopicWorker({
      client: rpc.client as never,
      key: fixtures.key,
      readEncrypted: async () => fixtures.encrypted,
      execute: async () => ({
        draft: {
          variableSnapshot: { campaignTheme: 'sk-12345678901234567890' },
          styleProvenance: { brandNames: ['Bearer forged-provider-secret'] },
          blocks: [{ type: 'procedure', ...block, evidenceIds: ['evidence-1'] }],
        },
        recordRevision: 15,
      }) as never,
    })

    await expect(worker.runOnce()).resolves.toBe(true)
    expect(rpc.calls.some(call => call.name === 'gt_job_finish')).toBe(false)
    const fail = rpc.calls.find(call => call.name === 'gt_job_fail')!
    expect(fail.args).toEqual([
      JOB_ID,
      LEASE_TOKEN,
      'INVALID_DRAFT',
      'The generated draft could not be validated.',
      false,
    ])
    expect(JSON.stringify(rpc.calls)).not.toContain('forged-provider-secret')
    const publicResult = await executeGenerateTopicJobCommand({
      action: 'get',
      jobId: JOB_ID,
    }, request(), {
      rpc: async () => publicJob({
        status: 'failed',
        phase: 'failed',
        errorCode: 'INVALID_DRAFT',
        errorMessage: 'The generated draft could not be validated.',
      }),
    })
    expect(JSON.stringify(publicResult)).not.toContain('forged-provider-secret')
    expect(publicResult).toMatchObject({ job: { status: 'failed', errorCode: 'INVALID_DRAFT' } })
  }
})

test('provider rate limiting is retryable while invalid model output is permanent and safe', async () => {
  async function runFailure(error: Error) {
    const fixtures = workerFixtures()
    const rpc = mockWorkerClient({ context: fixtures.context, claim: claimFor(fixtures.job) })
    const worker = new GenerateTopicWorker({
      client: rpc.client as never,
      key: fixtures.key,
      readEncrypted: async () => fixtures.encrypted,
      execute: async () => { throw error },
    })
    await expect(worker.runOnce()).resolves.toBe(true)
    return rpc.calls.find(call => call.name === 'gt_job_fail')!
  }

  const transient = await runFailure(new GroundedTocProviderError(
    'RATE_LIMITED',
    'Provider response contains worker-secret and private details',
  ))
  expect(transient.args).toEqual([
    JOB_ID,
    LEASE_TOKEN,
    'RATE_LIMITED',
    'The configured AI provider could not complete this Generate Topic job.',
    true,
  ])
  const permanent = await runFailure(new GroundedTopicApiError(
    502,
    'MODEL_OUTPUT_INVALID',
    'Unsafe raw provider response included worker-secret',
  ))
  expect(permanent.args).toEqual([
    JOB_ID,
    LEASE_TOKEN,
    'INVALID_DRAFT',
    'The generated draft could not be validated.',
    false,
  ])
  expect(JSON.stringify([transient.args, permanent.args])).not.toContain('worker-secret')
})

test('worker failure logs traceable IDs and safe categories without provider details', async () => {
  const fixtures = workerFixtures()
  const rpc = mockWorkerClient({
    context: fixtures.context,
    claim: claimFor(fixtures.job),
  })
  const logs: unknown[] = []
  const unsafeProviderMessage = 'worker-secret provider response password=do-not-log'
  const worker = new GenerateTopicWorker({
    client: rpc.client as never,
    key: fixtures.key,
    readEncrypted: async () => fixtures.encrypted,
    execute: async () => {
      throw new GroundedTocProviderError('RATE_LIMITED', unsafeProviderMessage)
    },
    logger: entry => logs.push(entry),
  })

  await expect(worker.runOnce()).resolves.toBe(true)
  expect(logs).toContainEqual({
    timestamp: expect.any(String),
    level: 'warn',
    event: 'worker.job.failed',
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: 2,
    inputRevision: 15,
    errorCode: 'RATE_LIMITED',
    retryable: true,
  })
  expect(JSON.stringify(logs)).not.toContain('worker-secret')
  expect(JSON.stringify(logs)).not.toContain('do-not-log')
  expect(rpc.calls.find(call => call.name === 'gt_job_fail')?.args).toEqual([
    JOB_ID,
    LEASE_TOKEN,
    'RATE_LIMITED',
    'The configured AI provider could not complete this Generate Topic job.',
    true,
  ])
})

test('worker rejects forged or stale connection test proofs before reading credentials or calling provider', async () => {
  const fixtures = workerFixtures()
  const cases = [
    {
      name: 'forged',
      metadata: {
        ...fixtures.context.connectionMetadata,
        proof: 'a'.repeat(64),
      },
    },
    {
      name: 'stale',
      metadata: {
        ...fixtures.context.connectionMetadata,
        testedAt: '2025-12-31T23:59:59.000Z',
      },
    },
  ]

  for (const { name, metadata } of cases) {
    const context = { ...fixtures.context, connectionMetadata: metadata }
    const rpc = mockWorkerClient({ context, claim: claimFor(fixtures.job) })
    let credentialReads = 0
    let providerCalls = 0
    let executions = 0
    const worker = new GenerateTopicWorker({
      client: rpc.client as never,
      key: fixtures.key,
      readEncrypted: async () => {
        credentialReads++
        return fixtures.encrypted
      },
      generateText: async () => {
        providerCalls++
        return '{}'
      },
      execute: async () => {
        executions++
        return { draft: {}, recordRevision: 15 } as never
      },
    })

    await expect(worker.runOnce()).resolves.toBe(true)
    expect(credentialReads, name).toBe(0)
    expect(providerCalls, name).toBe(0)
    expect(executions, name).toBe(0)
    expect(rpc.calls.some(call => call.name === 'gt_job_finish'), name).toBe(false)
    const fail = rpc.calls.find(call => call.name === 'gt_job_fail')
    expect(fail?.args).toEqual([
      JOB_ID,
      LEASE_TOKEN,
      'GENERATION_FAILED',
      'Topic generation could not be completed.',
      false,
    ])
    expect(JSON.stringify(fail?.args)).not.toContain(fixtures.encrypted.ciphertext.toString('base64'))
    expect(JSON.stringify(fail?.args)).not.toContain(metadata.proof)
  }
})

test('expired lease and stale project context never reach execution or completion', async () => {
  const expired = workerFixtures()
  const expiredRpc = mockWorkerClient({
    claim: claimFor(expired.job),
    contextError: Object.assign(new Error('job lease is stale or expired'), { code: '40001' }),
    failError: Object.assign(new Error('job lease is stale or expired'), { code: '40001' }),
  })
  const expiredLogs: unknown[] = []
  let expiredExecution = false
  const expiredWorker = new GenerateTopicWorker({
    client: expiredRpc.client as never,
    key: expired.key,
    logger: entry => expiredLogs.push(entry),
    execute: async () => {
      expiredExecution = true
      return { draft: {}, recordRevision: 15 } as never
    },
  })
  await expect(expiredWorker.runOnce()).resolves.toBe(true)
  expect(expiredExecution).toBe(false)
  expect(expiredRpc.calls.some(call => call.name === 'gt_job_finish')).toBe(false)
  expect(expiredRpc.calls.some(call => call.name === 'gt_job_fail')).toBe(true)
  expect(expiredLogs).toContainEqual(expect.objectContaining({
    event: 'worker.job.failure_fenced',
    jobId: JOB_ID,
    projectId: PROJECT_ID,
  }))

  const stale = workerFixtures()
  const staleContext = {
    ...stale.context,
    record: { ...stale.context.record, recordRevision: 16 },
  }
  const staleRpc = mockWorkerClient({ context: staleContext, claim: claimFor(stale.job) })
  let staleExecution = false
  const staleWorker = new GenerateTopicWorker({
    client: staleRpc.client as never,
    key: stale.key,
    execute: async () => {
      staleExecution = true
      return { draft: {}, recordRevision: 15 } as never
    },
  })
  await expect(staleWorker.runOnce()).resolves.toBe(true)
  expect(staleExecution).toBe(false)
  expect(staleRpc.calls.some(call => call.name === 'gt_job_finish')).toBe(false)
  expect(staleRpc.calls.find(call => call.name === 'gt_job_fail')?.args).toEqual([
    JOB_ID,
    LEASE_TOKEN,
    'GENERATE_TOPIC_FAILED',
    'Generate Topic could not complete this job.',
    false,
  ])
})