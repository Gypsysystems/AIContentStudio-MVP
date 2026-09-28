import type { IncomingMessage, ServerResponse } from 'node:http'
import { CloudApiError, CloudProjectApi } from './cloudProjectApi'

type Json = Record<string, unknown>
type ActionInput =
  | { action: 'enqueue'; projectId: string; topicId: string; workflowId: string; workflowVersion: number }
  | { action: 'get'; jobId: string }
  | { action: 'list'; projectId: string; topicId: string }
type GenerateTopicJobApiDependencies = {
  rpc?: typeof rpc
  loadProject?: (request: IncomingMessage, projectId: string) => Promise<{ record: Json }>
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ACCESS_COOKIE = 'sb_access_token'

export class GenerateTopicJobsApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'GenerateTopicJobsApiError'
  }
}

function object(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(status: number, code: string, message: string): never {
  throw new GenerateTopicJobsApiError(status, code, message)
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function validateInput(value: unknown): ActionInput {
  if (!object(value) || typeof value.action !== 'string')
    return fail(400, 'INVALID_REQUEST', 'A Generate Topic job action is required')
  const exact = (keys: string[]) => {
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
      fail(400, 'INVALID_REQUEST', 'Generate Topic job request fields are invalid')
  }
  if (value.action === 'enqueue') {
    exact(['action', 'projectId', 'topicId', 'workflowId', 'workflowVersion'])
    if (!stableId(value.projectId) || !stableId(value.topicId) || !stableId(value.workflowId)
      || !Number.isSafeInteger(value.workflowVersion) || Number(value.workflowVersion) < 1)
      return fail(400, 'INVALID_REQUEST', 'Generate Topic job identifiers or workflow version are invalid')
    return value as ActionInput
  }
  if (value.action === 'get') {
    exact(['action', 'jobId'])
    if (typeof value.jobId !== 'string' || !UUID.test(value.jobId))
      return fail(400, 'INVALID_REQUEST', 'jobId must be a valid job identifier')
    return value as ActionInput
  }
  if (value.action === 'list') {
    exact(['action', 'projectId', 'topicId'])
    if (!stableId(value.projectId) || !stableId(value.topicId))
      return fail(400, 'INVALID_REQUEST', 'Project and topic identifiers are invalid')
    return value as ActionInput
  }
  return fail(400, 'INVALID_ACTION', 'Unsupported Generate Topic job action')
}

function configuration(): { url: string; anonKey: string } {
  const rawUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!rawUrl || !anonKey || /^sb_secret_/iu.test(anonKey))
    return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
  try {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
    const jwt = anonKey.split('.')
    if (jwt.length === 3 && JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')).role === 'service_role')
      return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
    return { url: url.origin, anonKey }
  } catch {
    return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
  }
}

function sessionToken(request: IncomingMessage): string {
  const matches = (request.headers.cookie ?? '').split(';')
    .filter(part => part.trim().startsWith(`${ACCESS_COOKIE}=`))
  if (matches.length !== 1) return fail(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
  try {
    const token = decodeURIComponent(matches[0].trim().slice(ACCESS_COOKIE.length + 1))
    if (token && token.length <= 8192) return token
  } catch { /* malformed cookie */ }
  return fail(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
}

async function rpc(request: IncomingMessage, name: string, args: Json): Promise<unknown> {
  const settings = configuration()
  const token = sessionToken(request)
  let response: Response
  try {
    response = await fetch(`${settings.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: settings.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    })
  } catch {
    return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
  }
  const result = await response.json().catch(() => null) as unknown
  if (response.ok) return result
  const code = object(result) && typeof result.code === 'string' ? result.code : ''
  const detail = object(result) ? `${String(result.message ?? '')} ${String(result.details ?? '')}` : ''
  if (response.status === 401) return fail(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
  if (response.status === 403 || code === '42501')
    return fail(403, 'FORBIDDEN', 'Active workspace write permission is required')
  if (code === 'P0002' || response.status === 404)
    return fail(404, 'JOB_NOT_FOUND', 'Generate Topic job was not found')
  if (code === 'GT_WORKER_UNAVAILABLE' || code === '55000'
    || /worker.{0,40}(heartbeat|unavailable|alive)/iu.test(detail)
    || /topic generation is temporarily unavailable/iu.test(detail))
    return fail(503, 'WORKER_UNAVAILABLE', 'Generate Topic jobs are temporarily unavailable')
  if (['PGRST202', 'PGRST203', 'PGRST205', '42P01', '42883'].includes(code)
    || (response.status === 404 && name.startsWith('gt_job_')))
    return fail(503, 'JOBS_SCHEMA_UNAVAILABLE', 'Generate Topic job storage is not installed')
  if (code === '40001' || code === '23505')
    return fail(409, 'JOB_CONFLICT', 'A current Generate Topic job conflicts with this request')
  if (code === '22023')
    return fail(409, 'JOB_CONFLICT', 'Project grounding or workflow changed; refresh before enqueueing')
  if (/membership|permission/i.test(detail))
    return fail(403, 'FORBIDDEN', 'Active workspace write permission is required')
  return fail(503, 'JOBS_UNAVAILABLE', 'Generate Topic job storage is unavailable')
}

function publicJob(value: unknown): Json {
  const raw = object(value) && object(value.job) ? value.job : value
  if (!object(raw)) return fail(503, 'JOB_RESPONSE_INVALID', 'Generate Topic job storage returned an invalid response')
  const allowed = [
    'jobId', 'projectId', 'topicId', 'workflowId', 'workflowVersion', 'inputRevision',
    'status', 'phase', 'attemptCount', 'maxAttempts', 'nextAttemptAt', 'createdAt',
    'updatedAt', 'draft', 'errorCode', 'errorMessage',
  ]
  if (Object.keys(raw).some(key => !allowed.includes(key))
    || typeof raw.jobId !== 'string' || !UUID.test(raw.jobId)
    || !stableId(raw.projectId) || !stableId(raw.topicId) || !stableId(raw.workflowId)
    || !Number.isSafeInteger(raw.workflowVersion) || Number(raw.workflowVersion) < 1
    || !Number.isSafeInteger(raw.inputRevision) || Number(raw.inputRevision) < 0
    || !['queued', 'running', 'retry-wait', 'succeeded', 'failed'].includes(String(raw.status))
    || typeof raw.phase !== 'string' || raw.phase.length > 80
    || !Number.isSafeInteger(raw.attemptCount) || Number(raw.attemptCount) < 0
    || !Number.isSafeInteger(raw.maxAttempts) || Number(raw.maxAttempts) < 1
    || (raw.nextAttemptAt !== null && (typeof raw.nextAttemptAt !== 'string' || Number.isNaN(Date.parse(raw.nextAttemptAt))))
    || typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))
    || typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))
    || (raw.status === 'succeeded' && !Object.prototype.hasOwnProperty.call(raw, 'draft'))
    || (raw.status !== 'succeeded' && Object.prototype.hasOwnProperty.call(raw, 'draft'))
    || (raw.status === 'succeeded' && (!object(raw.draft)
      || Buffer.byteLength(JSON.stringify(raw.draft), 'utf8') > 160_000))
    || (raw.errorCode !== undefined && raw.errorCode !== null
      && (typeof raw.errorCode !== 'string' || raw.errorCode.length > 80))
    || (raw.errorMessage !== undefined && raw.errorMessage !== null
      && (typeof raw.errorMessage !== 'string' || raw.errorMessage.length > 300
        || /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:bearer|password|passwd|secret|credential|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b)/iu.test(raw.errorMessage)))) {
    return fail(503, 'JOB_RESPONSE_INVALID', 'Generate Topic job storage returned an invalid response')
  }
  const job: Json = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) job[key] = raw[key]
  }
  return job
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 4096) {
        reject(new GenerateTopicJobsApiError(413, 'REQUEST_TOO_LARGE', 'Generate Topic job request is too large'))
        request.resume()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
      catch { reject(new GenerateTopicJobsApiError(400, 'INVALID_JSON', 'Request body must be valid JSON')) }
    })
    request.on('error', () => reject(new GenerateTopicJobsApiError(400, 'REQUEST_READ_FAILED', 'Request body could not be read')))
  })
}

export async function executeGenerateTopicJobCommand(
  inputValue: unknown,
  request: IncomingMessage,
  dependencies: GenerateTopicJobApiDependencies = {},
): Promise<{ job: Json } | { jobs: Json[] }> {
  const input = validateInput(inputValue)
  const runRpc = dependencies.rpc ?? rpc
  if (input.action === 'enqueue') {
    let project: { record: Json }
    try {
      project = await (dependencies.loadProject ?? (async (req, projectId) => {
        const store = await CloudProjectApi.fromRequest(req)
        return store.loadGroundedTopicProject(projectId)
      }))(request, input.projectId)
    } catch (error) {
      if (error instanceof CloudApiError)
        return fail(error.status, error.code, error.message)
      return fail(503, 'PROJECT_STORAGE_UNAVAILABLE', 'Project storage is unavailable')
    }
    const value = await runRpc(request, 'gt_job_enqueue', {
      p_project_id: input.projectId,
      p_topic_id: input.topicId,
      p_workflow_id: input.workflowId,
      p_workflow_version: input.workflowVersion,
      p_expected_revision: project.record.recordRevision,
    })
    return { job: publicJob(value) }
  }
  if (input.action === 'get') {
    const value = await runRpc(request, 'gt_job_get', { p_job_id: input.jobId })
    if (value === null) return fail(404, 'JOB_NOT_FOUND', 'Generate Topic job was not found')
    return { job: publicJob(value) }
  }
  const value = await runRpc(request, 'gt_job_list', {
    p_project_id: input.projectId,
    p_topic_id: input.topicId,
  })
  const rows = Array.isArray(value) ? value : object(value) && Array.isArray(value.jobs) ? value.jobs : null
  if (!rows) return fail(503, 'JOB_RESPONSE_INVALID', 'Generate Topic job storage returned an invalid list')
  return { jobs: rows.map(publicJob) }
}

export async function handleGenerateTopicJobs(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const result = await executeGenerateTopicJobCommand(await readBody(request), request)
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(result))
  } catch (error) {
    const safe = error instanceof GenerateTopicJobsApiError
      ? error
      : new GenerateTopicJobsApiError(503, 'JOBS_UNAVAILABLE', 'Generate Topic job service is unavailable')
    response.statusCode = safe.status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ code: safe.code, error: safe.message }))
  }
}