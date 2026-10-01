export type WorkerLogLevel = 'info' | 'warn' | 'error'
export type WorkerLogCode =
  | 'RATE_LIMITED'
  | 'INVALID_DRAFT'
  | 'STALE_PROJECT'
  | 'PERMISSION_REVOKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'GENERATION_FAILED'
  | 'GENERATE_TOPIC_FAILED'
  | 'WORKER_OPERATION_FAILED'
  | 'DATABASE_UNAVAILABLE'
  | 'WORKER_STARTUP_FAILED'

export type WorkerLogEntry = {
  timestamp: string
  level: WorkerLogLevel
  event: string
  jobId?: string
  projectId?: string
  topicId?: string
  workflowId?: string
  workflowVersion?: number
  inputRevision?: number
  errorCode?: WorkerLogCode
  retryable?: boolean
}

export type WorkerLogger = (entry: WorkerLogEntry) => void

type WorkerLogContext = {
  jobId?: unknown
  projectId?: unknown
  topicId?: unknown
  workflowId?: unknown
  workflowVersion?: unknown
  inputRevision?: unknown
  errorCode?: unknown
  retryable?: unknown
}

const EVENTS = new Set([
  'worker.started',
  'worker.stopped',
  'worker.startup_failed',
  'worker.fatal_exit',
  'worker.poll_failed',
  'worker.liveness_heartbeat_failed',
  'worker.job.succeeded',
  'worker.job.failed',
  'worker.job.finish_failed',
  'worker.job.finish_outcome_unknown',
  'worker.job.failure_fenced',
  'worker.job.failure_transition_failed',
  'worker.lease.heartbeat_failed',
])
const CODES = new Set<WorkerLogCode>([
  'RATE_LIMITED',
  'INVALID_DRAFT',
  'STALE_PROJECT',
  'PERMISSION_REVOKED',
  'PROVIDER_UNAVAILABLE',
  'GENERATION_FAILED',
  'GENERATE_TOPIC_FAILED',
  'WORKER_OPERATION_FAILED',
  'DATABASE_UNAVAILABLE',
  'WORKER_STARTUP_FAILED',
])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/u
const SAFE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SAFE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SECRET_SHAPE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:bearer|password|passwd|secret|credential|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\b[A-Za-z0-9+/=_-]{32,}\b)/iu

function safeTimestamp(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value) return value
  }
  return new Date().toISOString()
}

function safeId(value: unknown, jobId = false): string | undefined {
  if (typeof value !== 'string' || !(jobId ? SAFE_JOB_ID : SAFE_ID).test(value)
    || (SECRET_SHAPE.test(value) && !SAFE_UUID.test(value))) return undefined
  return value
}

export function createWorkerLogEntry(
  level: WorkerLogLevel,
  event: string,
  context: WorkerLogContext = {},
  timestamp = new Date().toISOString(),
): WorkerLogEntry {
  if (!['info', 'warn', 'error'].includes(level))
    throw new Error('Worker log level is not allowlisted')
  if (!EVENTS.has(event)) throw new Error('Worker log event is not allowlisted')
  const entry: WorkerLogEntry = { timestamp: safeTimestamp(timestamp), level, event }
  const jobId = safeId(context.jobId, true)
  const projectId = safeId(context.projectId)
  const topicId = safeId(context.topicId)
  const workflowId = safeId(context.workflowId)
  if (jobId) entry.jobId = jobId
  if (projectId) entry.projectId = projectId
  if (topicId) entry.topicId = topicId
  if (workflowId) entry.workflowId = workflowId
  if (Number.isSafeInteger(context.workflowVersion) && Number(context.workflowVersion) > 0)
    entry.workflowVersion = Number(context.workflowVersion)
  if (Number.isSafeInteger(context.inputRevision) && Number(context.inputRevision) >= 0)
    entry.inputRevision = Number(context.inputRevision)
  if (typeof context.errorCode === 'string' && CODES.has(context.errorCode as WorkerLogCode))
    entry.errorCode = context.errorCode as WorkerLogCode
  if (typeof context.retryable === 'boolean') entry.retryable = context.retryable
  return entry
}

function defaultLogger(entry: WorkerLogEntry): void {
  const write = entry.level === 'error' ? console.error
    : entry.level === 'warn' ? console.warn : console.info
  write(JSON.stringify(entry))
}

/** Emits only allowlisted operational fields; logging cannot change worker behavior. */
export function safeWorkerLog(
  level: WorkerLogLevel,
  event: string,
  context: WorkerLogContext = {},
  logger: WorkerLogger = defaultLogger,
): void {
  try {
    logger(createWorkerLogEntry(level, event, context))
  } catch {
    // An unavailable log sink must not alter job completion or retry semantics.
  }
}
