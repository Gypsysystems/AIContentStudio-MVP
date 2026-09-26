import {
  createProjectCopySnapshot,
  createProjectRecord,
  migrateProjectRecord,
  ProjectConflictError,
  validateProjectSnapshot,
  type ProjectRecord,
  type ProjectSnapshot,
  type ProjectSummary,
  type RestoreProjectSnapshotOptions,
  type StoredFile,
} from './projectRepository'
import { LOCAL_ACCESS_CONTEXT, authorizeWorkspace, type ProjectAccessContext, type ProjectPermission } from './ownership'
import { getAccessContext } from './authSession'
import { validateRestorableProjectRecord } from './projectMigrations'
import { normalizeProjectName, projectNameKey, suggestUniqueProjectName } from './projectNames'
import {
  checkpointSha256, validateCheckpointReason,
  verifyCheckpointRead, type CheckpointVerification, type ProjectCheckpoint,
  type ProjectCheckpointRead, type ProjectCheckpointSummary,
} from './projectCheckpoint'

type CloudAction = 'ready' | 'list' | 'create' | 'read' | 'backup' | 'save' | 'delete'
  | 'duplicate' | 'load-files' | 'load-file' | 'remove-file'
  | 'restore-new' | 'restore-replace' | 'finalize-restore' | 'abandon-restore'
  | 'capture-checkpoint' | 'list-checkpoints' | 'get-checkpoint' | 'cleanup-checkpoint-stage'
  | 'cleanup-project-deletion'

export class CloudProjectApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly suggestedName?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CloudProjectApiError'
  }
}

const knownProjectNames = new Map<string, string>()

function projectNameConflictError(name: string, existingNames: readonly string[]): CloudProjectApiError {
  const suggestedName = suggestUniqueProjectName(name, [...existingNames, name])
  return new CloudProjectApiError(409, 'PROJECT_NAME_CONFLICT',
    `A project with this name already exists in the workspace. Choose a different name. Suggested name: “${suggestedName}”.`,
    suggestedName)
}

function isProjectNameConflict(error: unknown): error is CloudProjectApiError {
  return error instanceof CloudProjectApiError
    && error.status === 409 && error.code === 'PROJECT_NAME_CONFLICT'
}

async function workspaceProjectRecords(): Promise<ProjectRecord[]> {
  const reply = await cloudRequest('list')
  if (!Array.isArray(reply.projects)) throw new Error('Cloud project server returned an invalid project list.')
  return reply.projects.map(value => validateCloudRecord(value))
}

async function assertUniqueProjectName(name: string, exceptProjectId?: string): Promise<void> {
  const key = projectNameKey(normalizeProjectName(name))
  if (!key) throw new Error('Project name is required.')
  const records = await workspaceProjectRecords()
  for (const record of records) knownProjectNames.set(record.projectId, record.projectName)
  const existingNames = records.filter(record => record.projectId !== exceptProjectId).map(record => record.projectName)
  if (existingNames.some(existing => projectNameKey(existing) === key))
    throw projectNameConflictError(name, existingNames)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Cloud project server returned an invalid response.')
  return value as Record<string, unknown>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function blobDigest(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function requireClientPermission(permission: ProjectPermission): void {
  // This is a conservative UI-side restriction only; the server independently authorizes every request.
  authorizeWorkspace(getAccessContext(), permission)
}

async function cloudRequest(action: CloudAction, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('/api/cloud-projects', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
    })
  } catch {
    throw new CloudProjectApiError(0, 'API_UNAVAILABLE', 'Cloud project server is unavailable; no local fallback was used.')
  }
  let body: Record<string, unknown>
  try { body = object(await response.json()) } catch {
    throw new CloudProjectApiError(response.status, 'INVALID_RESPONSE', 'Cloud project server returned an invalid response.')
  }
  if (!response.ok)
    throw new CloudProjectApiError(response.status, String(body.code ?? 'CLOUD_REQUEST_FAILED'),
      String(body.code === 'PROJECT_NAME_CONFLICT' && typeof body.suggestedName === 'string'
        ? `${String(body.error ?? body.message ?? 'A project with this name already exists in the workspace.')} Try “${body.suggestedName}”.`
        : body.error ?? body.message ?? 'Cloud project request failed.'),
      typeof body.suggestedName === 'string' ? body.suggestedName : undefined, body)
  return body
}

function validateCloudRecord(value: unknown): ProjectRecord {
  const migrated = migrateProjectRecord(value).record
  validateRestorableProjectRecord(migrated)
  return migrated
}

function normaliseFile(value: unknown): Omit<StoredFile, 'blob'> {
  const raw = object(value)
  const fileId = raw.fileId ?? raw.file_id
  const projectId = raw.projectId ?? raw.project_id
  const uploadedAt = raw.uploadedAt ?? raw.uploaded_at
  if (typeof fileId !== 'string' || typeof projectId !== 'string'
    || typeof raw.name !== 'string' || typeof raw.type !== 'string'
    || !Number.isSafeInteger(raw.size) || !Number.isSafeInteger(uploadedAt))
    throw new Error('Cloud project server returned invalid file metadata.')
  return { fileId, projectId, name: raw.name, type: raw.type, size: raw.size as number, uploadedAt: uploadedAt as number }
}

async function binaryFile(fileId: string): Promise<Blob> {
  const response = await fetch(`/api/cloud-files?fileId=${encodeURIComponent(fileId)}`, {
    credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) throw new CloudProjectApiError(response.status, 'FILE_DOWNLOAD_FAILED', 'Could not download a cloud project file.')
  return response.blob()
}

async function checkpointBinaryFile(checkpointId: string, fileId: string): Promise<Blob> {
  const response = await fetch(`/api/cloud-files?checkpointId=${encodeURIComponent(checkpointId)}&fileId=${encodeURIComponent(fileId)}`, {
    credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) throw new CloudProjectApiError(response.status, 'CHECKPOINT_FILE_DOWNLOAD_FAILED', 'Could not download a checkpoint file.')
  return response.blob()
}

function checkpointFromApi(value: unknown, summary = false): ProjectCheckpoint {
  const raw = object(value)
  if (!Array.isArray(raw.files) || (!summary && (!raw.record || typeof raw.record !== 'object' || Array.isArray(raw.record)))
    || typeof raw.checkpointId !== 'string' || typeof raw.projectId !== 'string'
    || typeof raw.workspaceId !== 'string' || typeof raw.actorUserId !== 'string'
    || typeof raw.reason !== 'string' || !Number.isSafeInteger(raw.createdAt)
    || !Number.isSafeInteger(raw.originatingRecordRevision) || !Number.isSafeInteger(raw.recordSchemaVersion)
    || typeof raw.recordDigest !== 'string' || typeof raw.integrityDigest !== 'string'
    || !(raw.parentCheckpointId === null || typeof raw.parentCheckpointId === 'string'))
    throw new Error('Cloud checkpoint server returned invalid checkpoint metadata.')
  const files = raw.files.map(value => {
    const file = object(value)
    if (typeof file.fileId !== 'string' || typeof file.name !== 'string' || typeof file.type !== 'string'
      || !Number.isSafeInteger(file.size) || !Number.isSafeInteger(file.uploadedAt)
      || typeof file.sha256 !== 'string' || typeof file.storageRef !== 'string')
      throw new Error('Cloud checkpoint server returned invalid file metadata.')
    return {
      fileId: file.fileId, name: file.name, type: file.type, size: file.size as number,
      uploadedAt: file.uploadedAt as number, sha256: file.sha256, storageRef: file.storageRef,
    }
  })
  let checkpointRecord: ProjectRecord
  if (summary) {
    checkpointRecord = {} as ProjectRecord
  } else {
    // Keep the server record untouched so digest verification always hashes
    // the exact immutable snapshot, including schemas this client cannot restore.
    checkpointRecord = raw.record as ProjectRecord
  }
  return {
    checkpointId: raw.checkpointId, projectId: raw.projectId, workspaceId: raw.workspaceId,
    parentCheckpointId: raw.parentCheckpointId as string | null, reason: raw.reason, actorUserId: raw.actorUserId,
    createdAt: raw.createdAt as number, originatingRecordRevision: raw.originatingRecordRevision as number,
    recordSchemaVersion: raw.recordSchemaVersion as number, recordDigest: raw.recordDigest,
    integrityDigest: raw.integrityDigest, record: checkpointRecord, files,
  }
}

async function uploadFile(projectId: string, file: StoredFile, stageId?: string): Promise<StoredFile> {
  const fileId = file.fileId
  const response = await fetch(`/api/cloud-files?fileId=${encodeURIComponent(fileId)}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {
      'X-Project-Id': projectId,
      'X-File-Name': encodeURIComponent(file.name),
      'Content-Type': file.type || 'application/octet-stream',
      ...(stageId ? { 'X-Stage-Id': stageId } : {}),
    },
    body: file.blob,
  })
  const result = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const body = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    throw new CloudProjectApiError(response.status, String(body.code ?? 'FILE_UPLOAD_FAILED'),
      String(body.error ?? body.message ?? 'Could not upload a cloud project file.'))
  }
  const metadata = normaliseFile(object(result).file)
  if (metadata.fileId !== fileId || metadata.projectId !== projectId || metadata.size !== file.size)
    throw new Error('Cloud project server did not confirm the uploaded file metadata.')
  return { ...metadata, blob: file.blob }
}

async function readCloudFiles(projectId: string): Promise<StoredFile[]> {
  const reply = await cloudRequest('load-files', { projectId })
  if (!Array.isArray(reply.files)) throw new Error('Cloud project server returned an invalid file set.')
  const metadata = reply.files.map(normaliseFile)
  if (metadata.some(file => file.projectId !== projectId) || new Set(metadata.map(file => file.fileId)).size !== metadata.length)
    throw new Error('Cloud project server returned an inconsistent file set.')
  const files: StoredFile[] = []
  for (const file of metadata) {
    const blob = await binaryFile(file.fileId)
    if (blob.size !== file.size) throw new Error(`Cloud file "${file.name}" did not match its stored size.`)
    files.push({ ...file, blob })
  }
  return files
}

async function fetchSnapshot(projectId: string, action: 'read' | 'backup' = 'read'): Promise<ProjectSnapshot | null> {
  let reply: Record<string, unknown>
  try { reply = await cloudRequest(action, { projectId }) } catch (error) {
    if (error instanceof CloudProjectApiError && error.status === 404) return null
    throw error
  }
  const record = validateCloudRecord(reply.record)
  if (record.projectId !== projectId) throw new Error('Cloud project server returned a mismatched project ID.')
  return validateProjectSnapshot({ record, files: await readCloudFiles(projectId) })
}

function makeFileMap(files: StoredFile[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [file.fileId, `file-${crypto.randomUUID()}`]))
}

function cloudOwnership() {
  const context = getAccessContext()
  return { ownerUserId: context.user.id, workspaceId: context.workspace.id }
}

async function stageSnapshot(snapshot: ProjectSnapshot, options:
  | { mode: 'new' }
  | { mode: 'replace'; expectedRevision: number; expectedFileIds: string[] }): Promise<ProjectRecord> {
  validateProjectSnapshot(snapshot)
  if (snapshot.files.length > 1000)
    throw new Error('Cloud project import supports at most 1,000 files.')
  if (snapshot.files.some(file => !file.name.trim() || file.name.length > 512 || file.size > 100 * 1024 * 1024))
    throw new Error('Cloud project import contains an invalid filename or a file larger than 100 MiB.')
  if (new TextEncoder().encode(JSON.stringify(snapshot.record)).byteLength > 16 * 1024 * 1024)
    throw new Error('Cloud project record exceeds the 16 MiB cloud storage limit.')
  const { record } = snapshot
  if (options.mode === 'new') await assertUniqueProjectName(record.projectName)
  const staged = options.mode === 'new'
    ? await cloudRequest('restore-new', { record, fileIds: snapshot.files.map(file => file.fileId), projectId: record.projectId })
    : await cloudRequest('restore-replace', {
      record, projectId: record.projectId, expectedRevision: options.expectedRevision,
      expectedFileIds: options.expectedFileIds, fileIds: snapshot.files.map(file => file.fileId),
    })
  if (typeof staged.stageId !== 'string')
    throw new Error('Cloud server did not start a valid staged restore.')
  const stageId = staged.stageId
  let finalizedSuccessfully = false
  try {
    if (typeof staged.projectId !== 'string' || !Array.isArray(staged.expectedFileIds))
      throw new Error('Cloud server did not start a valid staged restore.')
    const projectId = staged.projectId
    const expectedFileIds = staged.expectedFileIds
    const submittedFileIds = snapshot.files.map(file => file.fileId).sort()
    if (expectedFileIds.length !== submittedFileIds.length
      || [...expectedFileIds].sort().some((id, index) => id !== submittedFileIds[index]))
      throw new Error('Cloud restore stage did not confirm the exact file set.')
    const sourceDigests = new Map(await Promise.all(snapshot.files.map(async file =>
      [file.fileId, await blobDigest(file.blob)] as const)))
    for (const file of snapshot.files) await uploadFile(projectId, file, stageId)
    const finalized = await cloudRequest('finalize-restore', { stageId, fileIds: submittedFileIds })
    if (finalized.ready !== true || finalized.record === undefined)
      throw new Error('Cloud restore finalization was not confirmed.')
    finalizedSuccessfully = true
    const saved = validateCloudRecord(finalized.record)
    const verified = await fetchSnapshot(saved.projectId)
    const expectedRecord = {
      ...record,
      ownerUserId: saved.ownerUserId,
      workspaceId: saved.workspaceId,
      recordRevision: saved.recordRevision,
    }
    if (canonical(verified?.record) !== canonical(expectedRecord))
      throw new Error('Cloud restore verification failed: the saved project record did not match the validated import.')
    if (!verified || verified.files.length !== snapshot.files.length
      || new Set(verified.files.map(file => file.fileId)).size !== snapshot.files.length
      || snapshot.files.some(file => !verified.files.some(stored => stored.fileId === file.fileId
        && stored.size === file.size && stored.name === file.name
        && stored.type === (file.type || 'application/octet-stream'))))
      throw new Error('Cloud restore verification failed: the complete file set was not stored.')
    for (const stored of verified.files) {
      const expectedDigest = sourceDigests.get(stored.fileId)
      if (!expectedDigest || await blobDigest(stored.blob) !== expectedDigest)
        throw new Error(`Cloud restore verification failed: file "${stored.name}" does not match its source bytes.`)
    }
    return verified.record
  } catch (error) {
    if (finalizedSuccessfully) throw error
    try {
      const abandoned = await cloudRequest('abandon-restore', { stageId })
      if (abandoned.abandoned !== true)
        throw new Error('Cloud server did not confirm that the restore stage was abandoned.')
    } catch (cleanupError) {
      const originalMessage = error instanceof Error ? error.message : String(error)
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      throw new Error(`${originalMessage} Staged restore cleanup also failed: ${cleanupMessage}. Stage "${stageId}" may require administrator cleanup.`)
    }
    throw error
  }
}

export const cloudProjectRepository = {
  async createProject(partial: Partial<ProjectRecord> & { projectId: string; projectName: string }, context?: ProjectAccessContext) {
    void context
    requireClientPermission('create')
    const record = createProjectRecord(partial, getAccessContext())
    await assertUniqueProjectName(record.projectName)
    const created = validateCloudRecord((await cloudRequest('create', { projectId: record.projectId, record })).record)
    knownProjectNames.set(created.projectId, created.projectName)
    return created
  },
  async saveProject(record: ProjectRecord, context?: ProjectAccessContext) {
    void context
    requireClientPermission('write')
    return cloudProjectRepository.saveProjectIfCurrent(record, record.recordRevision)
  },
  async saveProjectIfCurrent(record: ProjectRecord, expectedRevision: number, context?: ProjectAccessContext) {
    void context
    requireClientPermission('write')
    const normalizedName = normalizeProjectName(record.projectName)
    if (!normalizedName) throw new Error('Project name is required.')
    const knownName = knownProjectNames.get(record.projectId)
    if (knownName === undefined || projectNameKey(knownName) !== projectNameKey(normalizedName))
      await assertUniqueProjectName(normalizedName, record.projectId)
    let reply: Record<string, unknown>
    try {
      reply = await cloudRequest('save', { projectId: record.projectId, expectedRevision, record })
    } catch (error) {
      if (isProjectNameConflict(error)) throw error
      if (error instanceof CloudProjectApiError && error.status === 409) {
        if (error.code !== 'PROJECT_CONFLICT') throw error
        let actual: number
        try {
          actual = validateCloudRecord((await cloudRequest('read', { projectId: record.projectId })).record).recordRevision
        } catch {
          throw error
        }
        throw new ProjectConflictError(record.projectId, expectedRevision, actual)
      }
      throw error
    }
    if (reply.record === undefined) throw new Error('Cloud project server did not return the saved project.')
    const saved = validateCloudRecord(reply.record)
    if (saved.recordRevision !== expectedRevision + 1)
      throw new Error('Cloud project server returned an unexpected project revision.')
    knownProjectNames.set(saved.projectId, saved.projectName)
    return saved
  },
  async loadProject(projectId: string, context?: ProjectAccessContext) {
    void context
    try {
      const reply = await cloudRequest('read', { projectId })
      const record = validateCloudRecord(reply.record)
      if (record.projectId !== projectId) throw new Error('Cloud project server returned a mismatched project ID.')
      knownProjectNames.set(record.projectId, record.projectName)
      return record
    } catch (error) {
      if (error instanceof CloudProjectApiError && error.status === 404) return null
      throw error
    }
  },
  async loadProjectSnapshot(projectId: string, context?: ProjectAccessContext) {
    void context
    return fetchSnapshot(projectId, 'backup')
  },
  async listProjects(context?: ProjectAccessContext): Promise<ProjectSummary[]> {
    void context
    const records = await workspaceProjectRecords()
    return records.map(record => {
      return {
        projectId: record.projectId, ownerUserId: record.ownerUserId, workspaceId: record.workspaceId,
        projectName: record.projectName, documentType: record.documentType, version: record.version,
        createdAt: record.createdAt, modifiedAt: record.modifiedAt,
      }
    })
  },
  async deleteProject(projectId: string, context?: ProjectAccessContext) {
    void context
    requireClientPermission('delete')
    await cloudRequest('delete', { projectId })
  },
  async retryProjectDeletionCleanup(deletionId: string, context?: ProjectAccessContext): Promise<void> {
    void context
    requireClientPermission('delete')
    await cloudRequest('cleanup-project-deletion', { deletionId })
  },
  async duplicateProject(sourceId: string, newName: string, context?: ProjectAccessContext) {
    void context
    requireClientPermission('duplicate')
    const source = await fetchSnapshot(sourceId, 'backup')
    if (!source) return null
    const newId = `project-${crypto.randomUUID()}`
    const copy = createProjectCopySnapshot(source, newId, newName, Date.now(), makeFileMap(source.files), cloudOwnership())
    const created = await stageSnapshot(copy, { mode: 'new' })
    knownProjectNames.set(created.projectId, created.projectName)
    return created
  },
  async restoreProjectSnapshot(input: ProjectSnapshot, options: RestoreProjectSnapshotOptions, context?: ProjectAccessContext) {
    void context
    const snapshot = validateProjectSnapshot(input)
    if (options.mode === 'replace') {
      requireClientPermission('replace')
      const current = await fetchSnapshot(snapshot.record.projectId, 'backup')
      if (!current) throw new Error(`Project "${snapshot.record.projectId}" does not exist; replacement was not performed.`)
      if (snapshot.record.workspaceId !== current.record.workspaceId)
        throw new Error('A backup from another workspace cannot replace this project; restore it as new.')
      if (current.record.recordRevision !== options.expectedRevision)
        throw new ProjectConflictError(snapshot.record.projectId, options.expectedRevision, current.record.recordRevision)
      if (current.files.length !== options.expectedFileIds.length
        || options.expectedFileIds.some(id => !current.files.some(file => file.fileId === id)))
        throw new Error('Destination files changed since restore confirmation; replacement was not performed.')
      const replacement: ProjectSnapshot = {
        record: {
          ...snapshot.record,
          projectId: current.record.projectId,
          ownerUserId: current.record.ownerUserId,
          workspaceId: current.record.workspaceId,
          createdAt: current.record.createdAt,
          schemaVersion: current.record.schemaVersion,
          recordRevision: current.record.recordRevision,
          modifiedAt: Date.now(),
        },
        files: snapshot.files.map(file => ({ ...file, projectId: current.record.projectId })),
      }
      return stageSnapshot(replacement, { mode: 'replace', expectedRevision: options.expectedRevision, expectedFileIds: options.expectedFileIds })
    }
    requireClientPermission('restore-new')
    const newId = `project-${crypto.randomUUID()}`
    const requestedName = (options as RestoreProjectSnapshotOptions & { newName?: string }).newName
    const defaultName = `${snapshot.record.projectName} (Restored)`
    const copy = createProjectCopySnapshot(snapshot, newId, requestedName ?? defaultName,
      Date.now(), makeFileMap(snapshot.files), cloudOwnership())
    const created = await stageSnapshot(copy, { mode: 'new' })
    knownProjectNames.set(created.projectId, created.projectName)
    return created
  },
  async saveFile(projectId: string, file: File, context?: ProjectAccessContext): Promise<StoredFile> {
    void context
    requireClientPermission('write')
    const stored: StoredFile = {
      fileId: `file-${crypto.randomUUID()}`, projectId, name: file.name, type: file.type,
      size: file.size, uploadedAt: Date.now(), blob: file,
    }
    return uploadFile(projectId, stored)
  },
  async loadProjectFiles(projectId: string, context?: ProjectAccessContext) {
    void context
    return readCloudFiles(projectId)
  },
  async loadFile(fileId: string, context?: ProjectAccessContext): Promise<StoredFile | null> {
    void context
    let reply: Record<string, unknown>
    try { reply = await cloudRequest('load-file', { fileId }) } catch (error) {
      if (error instanceof CloudProjectApiError && error.status === 404) return null
      throw error
    }
    if (!Array.isArray(reply.files) || !reply.files.length) return null
    const metadata = normaliseFile(reply.files[0])
    const blob = await binaryFile(fileId)
    if (blob.size !== metadata.size) throw new Error(`Cloud file "${metadata.name}" did not match its stored size.`)
    return { ...metadata, blob }
  },
  async removeFile(fileId: string, context?: ProjectAccessContext) {
    void context
    requireClientPermission('write')
    await cloudRequest('remove-file', { fileId })
  },
  async captureProjectCheckpoint(
    projectId: string,
    expectedRevision: number,
    expectedFileIds: string[],
    reason: string,
    context?: ProjectAccessContext,
  ): Promise<ProjectCheckpoint> {
    void context
    requireClientPermission('write')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('Checkpoint expectedRevision must be a nonnegative integer.')
    const reply = await cloudRequest('capture-checkpoint', {
      projectId, expectedRevision, expectedFileIds, reason: validateCheckpointReason(reason),
    })
    return checkpointFromApi(reply.checkpoint)
  },
  async listProjectCheckpoints(projectId: string, context?: ProjectAccessContext): Promise<ProjectCheckpointSummary[]> {
    void context
    const reply = await cloudRequest('list-checkpoints', { projectId })
    if (!Array.isArray(reply.checkpoints)) throw new Error('Cloud checkpoint server returned an invalid checkpoint list.')
    return reply.checkpoints.map(value => {
      const checkpoint = checkpointFromApi(value, true)
      const { record: _record, ...summary } = checkpoint
      return summary
    })
  },
  async getProjectCheckpoint(projectId: string, checkpointId: string, context?: ProjectAccessContext): Promise<ProjectCheckpointRead | null> {
    void context
    let reply: Record<string, unknown>
    try {
      reply = await cloudRequest('get-checkpoint', { projectId, checkpointId })
    } catch (error) {
      if (error instanceof CloudProjectApiError && error.status === 404) return null
      throw error
    }
    const checkpoint = checkpointFromApi(reply.checkpoint)
    const files: StoredFile[] = []
    for (const item of checkpoint.files) {
      const blob = await checkpointBinaryFile(checkpointId, item.fileId)
      if (blob.size !== item.size || await checkpointSha256(blob) !== item.sha256)
        throw new Error(`Checkpoint file "${item.name}" failed its stored digest verification.`)
      files.push({
        fileId: item.fileId, projectId, name: item.name, type: item.type,
        size: item.size, uploadedAt: item.uploadedAt, blob,
      })
    }
    return { checkpoint, files }
  },
  async getProjectCheckpointRecord(projectId: string, checkpointId: string, context?: ProjectAccessContext): Promise<ProjectCheckpoint | null> {
    void context
    let reply: Record<string, unknown>
    try {
      reply = await cloudRequest('get-checkpoint', { projectId, checkpointId })
    } catch (error) {
      if (error instanceof CloudProjectApiError && error.status === 404) return null
      throw error
    }
    const checkpoint = checkpointFromApi(reply.checkpoint)
    if (checkpoint.projectId !== projectId || checkpoint.checkpointId !== checkpointId)
      throw new Error('Cloud checkpoint server returned a mismatched checkpoint scope.')
    return checkpoint
  },
  async verifyProjectCheckpoint(projectId: string, checkpointId: string, context?: ProjectAccessContext): Promise<CheckpointVerification> {
    try {
      const read = await cloudProjectRepository.getProjectCheckpoint(projectId, checkpointId, context)
      if (!read) return { valid: false, issues: ['Checkpoint was not found.'] }
      return verifyCheckpointRead(read)
    } catch (error) {
      return {
        valid: false,
        issues: [error instanceof Error ? `Checkpoint could not be fully verified: ${error.message}` : 'Checkpoint could not be fully verified.'],
      }
    }
  },
  async cleanupProjectCheckpointStage(checkpointId: string, context?: ProjectAccessContext): Promise<void> {
    void context
    requireClientPermission('write')
    await cloudRequest('cleanup-checkpoint-stage', { checkpointId })
  },
  getActiveProjectId() { return localStorage.getItem(activeKey()) },
  setActiveProjectId(projectId: string | null) {
    const key = activeKey()
    if (projectId) localStorage.setItem(key, projectId)
    else localStorage.removeItem(key)
  },
}

function activeKey(): string {
  const workspaceId = getAccessContext().workspace.id
  if (!workspaceId) throw new Error('Cloud session has no verified active workspace.')
  return `docflow-active-project:${workspaceId}`
}

export async function importLocalProjectToCloud(projectId: string, confirmedName?: string): Promise<ProjectRecord> {
  const { indexedDbProjectRepository: local } = await import('./projectService')
  const snapshot = await local.loadProjectSnapshot(projectId, LOCAL_ACCESS_CONTEXT)
  if (!snapshot) throw new Error('Selected local project no longer exists.')
  // Validate the entire project, all file metadata, and every source reference before upload.
  const validated = validateProjectSnapshot(snapshot)
  const localFileIds = new Set(validated.files.map(file => file.fileId))
  if (validated.files.some(file => file.projectId !== projectId || file.blob.size !== file.size)
    || validated.record.sourceFileIds.some(id => !localFileIds.has(id)))
    throw new Error('Local project validation failed: a project blob is missing or inconsistent.')
  const cloudId = `project-${crypto.randomUUID()}`
  const copy = createProjectCopySnapshot(validated, cloudId,
    confirmedName ?? validated.record.projectName,
    Date.now(), makeFileMap(validated.files), cloudOwnership())
  const created = await stageSnapshot(copy, { mode: 'new' })
  knownProjectNames.set(created.projectId, created.projectName)
  return created
}

export async function isCloudProjectStorageReady(): Promise<boolean> {
  const reply = await cloudRequest('ready')
  return reply.ready === true
}

export { ProjectConflictError }