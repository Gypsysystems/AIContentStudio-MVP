import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

const ACCESS_COOKIE = 'sb_access_token'
const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 100 * 1024 * 1024
const PERMISSIONS: Record<string, readonly string[]> = {
  owner: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
  admin: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
  editor: ['create', 'read', 'write', 'duplicate', 'backup', 'restore-new'],
  viewer: ['read', 'backup'],
}

type Json = Record<string, unknown>
type User = { id: string }
type Membership = { workspace_id: string; role: string }
type FileRow = { file_id: string; project_id: string; name: string; type: string; size: number; uploaded_at: number; storage_path: string; state: string }

export class CloudApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'CloudApiError'
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getConfig(): { url: string; anonKey: string } | null {
  const raw = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!raw || !anonKey || /^sb_secret_/i.test(anonKey)) return null
  try {
    const parsed = new URL(raw)
    if (!['https:', 'http:'].includes(parsed.protocol)
      || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
      || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    const jwt = anonKey.split('.')
    if (jwt.length === 3) {
      const payload = JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')) as Json
      if (payload.role === 'service_role') return null
    }
    return { url: parsed.origin, anonKey }
  } catch {
    return null
  }
}

function readCookie(request: IncomingMessage, name: string): string | null {
  const chunks = request.headers.cookie?.split(';') ?? []
  const found = chunks.filter(part => part.trim().startsWith(`${name}=`))
  if (found.length !== 1) return null
  try {
    const value = decodeURIComponent(found[0].trim().slice(name.length + 1))
    return value.length <= 8192 ? value : null
  } catch {
    return null
  }
}

function validateId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256
    || value.trim() !== value || /[\u0000-\u001f\u007f/\\]/.test(value)) {
    throw new CloudApiError(400, 'INVALID_ID', `${field} must be a valid stable ID`)
  }
  return value
}

function validateFileIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new CloudApiError(400, 'INVALID_FILE_IDS', `${field} must be an array of up to 1000 stable file IDs`)
  const ids = value.map((id, index) => validateId(id, `${field}[${index}]`))
  if (new Set(ids).size !== ids.length)
    throw new CloudApiError(400, 'DUPLICATE_FILE_IDS', `${field} must not contain duplicate IDs`)
  return ids
}

function safeRecord(value: unknown): Json {
  if (!isObject(value)) throw new CloudApiError(400, 'INVALID_RECORD', 'record must be a JSON object')
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded) > MAX_JSON_BYTES) throw new CloudApiError(413, 'RECORD_TOO_LARGE', 'Project record exceeds the 16 MB limit')
  return value
}

function ownRecord(record: Json, projectId: string, userId: string, workspaceId: string, revision: number): Json {
  return { ...record, projectId, ownerUserId: userId, workspaceId, recordRevision: revision }
}

function remapStableReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map(item => remapStableReferences(item, ids))
  if (!isObject(value)) return value
  const result: Json = {}
  for (const [key, item] of Object.entries(value))
    result[ids.get(key) ?? key] = remapStableReferences(item, ids)
  return result
}

class SupabaseCloudClient {
  constructor(readonly url: string, readonly anonKey: string, readonly token: string) {}

  async call(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      ...init,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })
  }

  async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.call(path, init)
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const message = isObject(body) && typeof body.message === 'string' ? body.message : 'Cloud project storage is unavailable'
      const databaseCode = isObject(body) && typeof body.code === 'string' ? body.code : ''
      if (response.status === 401) throw new CloudApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
      if (response.status === 403) throw new CloudApiError(403, 'FORBIDDEN', 'The current workspace role does not allow this action')
      if (response.status === 404 || databaseCode === 'P0002')
        throw new CloudApiError(404, 'RESOURCE_NOT_FOUND', message)
      if (databaseCode === '40001')
        throw new CloudApiError(409, 'RESTORE_CONFLICT', message)
      if (response.status === 409) throw new CloudApiError(409, 'RESOURCE_CONFLICT', message)
      throw new CloudApiError(503, 'CLOUD_STORAGE_ERROR', message)
    }
    return body
  }

  async identity(): Promise<{ user: User; membership: Membership }> {
    const response = await this.call('/auth/v1/user')
    const user = await response.json().catch(() => null) as unknown
    if (!response.ok || !isObject(user) || typeof user.id !== 'string' || !user.id)
      throw new CloudApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
    const query = new URLSearchParams({ select: 'workspace_id,role', user_id: `eq.${user.id}`, order: 'workspace_id.asc' })
    let memberships: unknown
    try {
      memberships = await this.json(`/rest/v1/workspace_memberships?${query}`)
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 404)
        throw new CloudApiError(503, 'CLOUD_STORAGE_UNAVAILABLE', 'Workspace membership migrations are not ready')
      throw error
    }
    if (!Array.isArray(memberships) || !memberships.length)
      throw new CloudApiError(403, 'MEMBERSHIP_INACTIVE', 'An active workspace membership is required')
    const membership = memberships[0] as Membership
    if (!membership || typeof membership.workspace_id !== 'string' || !(membership.role in PERMISSIONS))
      throw new CloudApiError(503, 'MEMBERSHIP_LOOKUP_FAILED', 'Could not verify current workspace membership')
    return { user: { id: user.id }, membership }
  }

  async readiness(role: string): Promise<boolean> {
    // These checks are intentionally per authenticated request. A missing table,
    // migration marker, or bucket means the cloud API remains unavailable.
    const settle = <T>(promise: Promise<T>) => promise.then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    )
    const markerQuery = new URLSearchParams({ select: 'component,version', component: 'eq.project-storage', version: 'eq.1', limit: '1' })
    const markerCheck = settle(this.call(`/rest/v1/cloud_schema_versions?${markerQuery}`))
    const permissionsQuery = new URLSearchParams({ select: 'permission', role: `eq.${role}` })
    const permissionCheck = settle(this.call(`/rest/v1/workspace_role_permissions?${permissionsQuery}`))
    const markerResult = await markerCheck
    if (!markerResult.ok) throw markerResult.error
    const marker = markerResult.value
    if (!marker.ok) return false
    const markerBody = await marker.json().catch(() => null) as unknown
    if (!Array.isArray(markerBody) || markerBody.length !== 1) return false
    const permissionResult = await permissionCheck
    if (!permissionResult.ok) throw permissionResult.error
    const permissions = permissionResult.value
    if (!permissions.ok) return false
    const permissionRows = await permissions.json().catch(() => null) as unknown
    const expected = PERMISSIONS[role]
    if (!expected || !Array.isArray(permissionRows)) return false
    const actual = permissionRows
      .filter(isObject)
      .map(row => row.permission)
      .filter((permission): permission is string => typeof permission === 'string')
      .sort()
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) return false
    const projectsCheck = settle(this.call('/rest/v1/cloud_projects?select=project_id&limit=0'))
    const filesCheck = settle(this.call('/rest/v1/cloud_project_files?select=file_id&limit=0'))
    const bucketCheck = settle(this.call('/storage/v1/bucket/project-files'))
    const projectsResult = await projectsCheck
    if (!projectsResult.ok) throw projectsResult.error
    const projects = projectsResult.value
    const filesResult = await filesCheck
    if (!filesResult.ok) throw filesResult.error
    const files = filesResult.value
    if (!projects.ok || !files.ok) return false
    const bucketResult = await bucketCheck
    if (!bucketResult.ok) throw bucketResult.error
    const bucket = bucketResult.value
    if (!bucket.ok) return false
    const bucketBody = await bucket.json().catch(() => null) as unknown
    return isObject(bucketBody) && bucketBody.id === 'project-files' && bucketBody.public === false
  }

  assertPermission(role: string, permission: string): void {
    if (!PERMISSIONS[role]?.includes(permission))
      throw new CloudApiError(403, 'FORBIDDEN', `Workspace role "${role}" cannot ${permission}`)
  }

  async listProjects(workspaceId: string): Promise<unknown[]> {
    const query = new URLSearchParams({ select: 'project_id,record', workspace_id: `eq.${workspaceId}`, status: 'eq.active', order: 'updated_at.desc' })
    const rows = await this.json(`/rest/v1/cloud_projects?${query}`)
    if (!Array.isArray(rows)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid project list')
    return rows.map(row => isObject(row) ? row.record : null).filter(Boolean)
  }

  async getProject(projectId: string, workspaceId: string): Promise<Json | null> {
    const query = new URLSearchParams({ select: 'project_id,workspace_id,owner_user_id,record_revision,record', project_id: `eq.${projectId}`, workspace_id: `eq.${workspaceId}`, status: 'eq.active', limit: '1' })
    const rows = await this.json(`/rest/v1/cloud_projects?${query}`)
    if (!Array.isArray(rows)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid project')
    const row = rows[0]
    if (!isObject(row) || !isObject(row.record)) return null
    return row.record
  }

  async fileRows(projectId: string, workspaceId: string): Promise<FileRow[]> {
    const query = new URLSearchParams({ select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state', project_id: `eq.${projectId}`, workspace_id: `eq.${workspaceId}`, state: 'eq.ready', order: 'uploaded_at.asc' })
    const rows = await this.json(`/rest/v1/cloud_project_files?${query}`)
    if (!Array.isArray(rows)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid file list')
    return rows as FileRow[]
  }

  async cleanupRows(projectId: string, workspaceId: string): Promise<FileRow[]> {
    const query = new URLSearchParams({ select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state', project_id: `eq.${projectId}`, workspace_id: `eq.${workspaceId}`, state: 'eq.cleanup', order: 'uploaded_at.asc' })
    const rows = await this.json(`/rest/v1/cloud_project_files?${query}`)
    if (!Array.isArray(rows)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid cleanup file set')
    return rows as FileRow[]
  }

  async uploadingRows(projectId: string, workspaceId: string): Promise<FileRow[]> {
    const query = new URLSearchParams({ select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state', project_id: `eq.${projectId}`, workspace_id: `eq.${workspaceId}`, state: 'eq.uploading', order: 'uploaded_at.asc' })
    const rows = await this.json(`/rest/v1/cloud_project_files?${query}`)
    if (!Array.isArray(rows)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid in-progress file set')
    return rows as FileRow[]
  }

  async removeStoredFile(file: FileRow): Promise<void> {
    const removed = await this.call(`/storage/v1/object/${file.storage_path}`, { method: 'DELETE' })
    if (!removed.ok && removed.status !== 404)
      throw new CloudApiError(503, 'FILE_DELETE_FAILED', `Could not remove stored file "${file.file_id}"`)
    await this.json('/rest/v1/rpc/delete_cloud_project_file_metadata', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_storage_path: file.storage_path }),
    })
  }

  async insertProject(projectId: string, workspaceId: string, ownerId: string, record: Json): Promise<Json> {
    const body = ownRecord(record, projectId, ownerId, workspaceId, 0)
    const rows = await this.json('/rest/v1/cloud_projects?select=record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ project_id: projectId, workspace_id: workspaceId, owner_user_id: ownerId, record_revision: 0, record: body }),
    })
    if (!Array.isArray(rows) || !isObject(rows[0]) || !isObject(rows[0].record))
      throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage did not confirm project creation')
    return rows[0].record
  }

  async saveProject(projectId: string, workspaceId: string, record: Json, expectedRevision: number): Promise<Json> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new CloudApiError(400, 'INVALID_REVISION', 'expectedRevision must be a nonnegative integer')
    const current = await this.getProject(projectId, workspaceId)
    if (!current) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
    if (typeof current.ownerUserId !== 'string')
      throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Stored project ownership is invalid')
    if (current.recordRevision !== expectedRevision)
      throw new CloudApiError(409, 'PROJECT_CONFLICT', `Project changed; expected revision ${expectedRevision}, found ${String(current.recordRevision)}`)
    const query = new URLSearchParams({ project_id: `eq.${projectId}`, workspace_id: `eq.${workspaceId}`, record_revision: `eq.${expectedRevision}`, select: 'record' })
    const next = ownRecord(record, projectId, current.ownerUserId, workspaceId, expectedRevision + 1)
    const rows = await this.json(`/rest/v1/cloud_projects?${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ record_revision: expectedRevision + 1, record: next, updated_at: new Date().toISOString() }),
    })
    if (Array.isArray(rows) && isObject(rows[0]) && isObject(rows[0].record)) return rows[0].record
    const latest = await this.getProject(projectId, workspaceId)
    if (!latest) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
    throw new CloudApiError(409, 'PROJECT_CONFLICT', `Project changed; expected revision ${expectedRevision}, found ${String(latest.recordRevision)}`)
  }
}

function requireRecord(value: unknown): Json {
  if (!isObject(value)) throw new CloudApiError(400, 'INVALID_REQUEST', 'A JSON object request is required')
  return value
}

function assertExactKeys(input: Json, keys: string[]): void {
  if (Object.keys(input).some(key => !keys.includes(key)))
    throw new CloudApiError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
}

export class CloudProjectApi {
  private readonly client: SupabaseCloudClient
  private readonly userId: string
  private readonly workspaceId: string
  private readonly role: string

  private constructor(client: SupabaseCloudClient, userId: string, membership: Membership) {
    this.client = client
    this.userId = userId
    this.workspaceId = membership.workspace_id
    this.role = membership.role
  }

  static async fromRequest(request: IncomingMessage): Promise<CloudProjectApi> {
    const config = getConfig()
    const token = readCookie(request, ACCESS_COOKIE)
    if (!config) throw new CloudApiError(503, 'CLOUD_STORAGE_UNAVAILABLE', 'Supabase project storage is not configured')
    if (!token) throw new CloudApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
    const client = new SupabaseCloudClient(config.url, config.anonKey, token)
    const { user, membership } = await client.identity()
    return new CloudProjectApi(client, user.id, membership)
  }

  async execute(value: unknown): Promise<Json> {
    const input = requireRecord(value)
    if (typeof input.action !== 'string') throw new CloudApiError(400, 'INVALID_REQUEST', 'A supported action is required')
    const ready = await this.client.readiness(this.role)
    if (input.action === 'ready') {
      assertExactKeys(input, ['action'])
      return { ready }
    }
    if (!ready) throw new CloudApiError(503, 'STORAGE_NOT_READY', 'Apply the cloud project migrations and create the private project-files bucket before using cloud projects')

    switch (input.action) {
      case 'list':
        assertExactKeys(input, ['action'])
        this.client.assertPermission(this.role, 'read')
        return { projects: await this.client.listProjects(this.workspaceId) }
      case 'create': {
        assertExactKeys(input, ['action', 'projectId', 'record'])
        this.client.assertPermission(this.role, 'create')
        const record = safeRecord(input.record)
        const projectId = validateId(input.projectId ?? record.projectId ?? `project-${randomUUID()}`, 'projectId')
        return { record: await this.client.insertProject(projectId, this.workspaceId, this.userId, record) }
      }
      case 'read':
      case 'backup': {
        assertExactKeys(input, ['action', 'projectId'])
        this.client.assertPermission(this.role, input.action === 'backup' ? 'backup' : 'read')
        const projectId = validateId(input.projectId, 'projectId')
        const record = await this.client.getProject(projectId, this.workspaceId)
        if (!record) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
        return { record }
      }
      case 'save': {
        assertExactKeys(input, ['action', 'projectId', 'expectedRevision', 'record'])
        this.client.assertPermission(this.role, 'write')
        const projectId = validateId(input.projectId, 'projectId')
        const record = safeRecord(input.record)
        return { record: await this.client.saveProject(projectId, this.workspaceId, record, input.expectedRevision as number) }
      }
      case 'delete': {
        assertExactKeys(input, ['action', 'projectId'])
        this.client.assertPermission(this.role, 'delete')
        const projectId = validateId(input.projectId, 'projectId')
        const stagesQuery = new URLSearchParams({ select: 'stage_id,mode', project_id: `eq.${projectId}`, workspace_id: `eq.${this.workspaceId}` })
        const stages = await this.client.json(`/rest/v1/cloud_project_restore_stages?${stagesQuery}`)
        let removedStagingProject = false
        if (Array.isArray(stages)) {
          for (const stage of stages) {
            if (!isObject(stage) || typeof stage.stage_id !== 'string')
              throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned invalid restore stage metadata')
            try {
              await this.abandonRestoreStage(stage.stage_id)
              if (stage.mode === 'new') removedStagingProject = true
            } catch (error) {
              // A finalizer may have completed while deletion was enumerating
              // stages; in that case continue to remove the now-active project.
              if (!(error instanceof CloudApiError) || error.status !== 404) throw error
            }
          }
        }
        if (removedStagingProject) return { projects: [] }
        const files = [
          ...await this.client.fileRows(projectId, this.workspaceId),
          ...await this.client.uploadingRows(projectId, this.workspaceId),
          ...await this.client.cleanupRows(projectId, this.workspaceId),
        ]
        for (const file of files) {
          await this.client.removeStoredFile(file)
        }
        const query = new URLSearchParams({ project_id: `eq.${projectId}`, workspace_id: `eq.${this.workspaceId}` })
        const rows = await this.client.json(`/rest/v1/cloud_projects?${query}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })
        if (!Array.isArray(rows) || !rows.length) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
        return { projects: [] }
      }
      case 'abandon-restore': {
        assertExactKeys(input, ['action', 'stageId'])
        const stageId = validateId(input.stageId, 'stageId')
        const projectId = await this.abandonRestoreStage(stageId)
        return { abandoned: true, projectId }
      }
      case 'duplicate': {
        assertExactKeys(input, ['action', 'projectId', 'newProjectId', 'newName'])
        this.client.assertPermission(this.role, 'duplicate')
        const sourceId = validateId(input.projectId, 'projectId')
        const source = await this.client.getProject(sourceId, this.workspaceId)
        if (!source) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
        const id = validateId(input.newProjectId ?? `project-${randomUUID()}`, 'newProjectId')
        const sourceFiles = await this.client.fileRows(sourceId, this.workspaceId)
        const remappedFileIds = new Map(sourceFiles.map(file => [file.file_id, `file-${randomUUID()}`]))
        const copy = remapStableReferences(source, remappedFileIds) as Json
        if (typeof input.newName === 'string') copy.projectName = input.newName
        const created = await this.client.insertProject(id, this.workspaceId, this.userId, copy)
        const copiedPaths: string[] = []
        try {
          for (const file of sourceFiles) {
            const fileId = remappedFileIds.get(file.file_id)!
            const path = `${this.workspaceId}/${id}/${fileId}`
            await this.client.json('/rest/v1/cloud_project_files', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file_id: fileId, project_id: id, workspace_id: this.workspaceId, name: file.name, type: file.type, size: file.size, uploaded_at: Date.now(), storage_path: `project-files/${path}`, state: 'uploading' }),
            })
            copiedPaths.push(`project-files/${path}`)
            const copied = await this.client.call('/storage/v1/object/copy', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bucketId: 'project-files', sourceKey: file.storage_path.replace(/^project-files\//, ''), destinationKey: path }),
            })
            if (!copied.ok) throw new CloudApiError(503, 'FILE_COPY_FAILED', 'Could not copy every project file')
            await this.client.json('/rest/v1/rpc/finish_cloud_project_file_upload', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ p_file_id: fileId }),
            })
          }
        } catch (error) {
          for (const path of copiedPaths) {
            const removed = await this.client.call(`/storage/v1/object/${path}`, { method: 'DELETE' }).catch(() => null)
            if (removed && (removed.ok || removed.status === 404)) {
              await this.client.json('/rest/v1/rpc/delete_cloud_project_file_metadata', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_storage_path: path }),
              }).catch(() => undefined)
            }
          }
          throw error
        }
        return { record: created }
      }
      case 'restore-new':
      case 'restore-replace': {
        const isNew = input.action === 'restore-new'
        assertExactKeys(input, isNew
          ? ['action', 'record', 'fileIds', 'projectId']
          : ['action', 'projectId', 'record', 'expectedRevision', 'expectedFileIds', 'fileIds'])
        this.client.assertPermission(this.role, isNew ? 'restore-new' : 'replace')
        const record = safeRecord(input.record)
        const projectId = validateId(isNew
          ? input.projectId ?? `project-${randomUUID()}`
          : input.projectId, 'projectId')
        const fileIds = validateFileIdList(input.fileIds, 'fileIds')
        const stageId = randomUUID()
        let destinationFileIds: string[] = []
        let expectedRevision: number | null = null
        if (!isNew) {
          if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0)
            throw new CloudApiError(400, 'INVALID_REVISION', 'expectedRevision must be a nonnegative integer')
          expectedRevision = input.expectedRevision as number
          destinationFileIds = validateFileIdList(input.expectedFileIds, 'expectedFileIds')
          const current = await this.client.getProject(projectId, this.workspaceId)
          if (!current) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Replacement destination was not found in the active workspace')
          if (current.recordRevision !== expectedRevision)
            throw new CloudApiError(409, 'PROJECT_CONFLICT', `Project changed; expected revision ${expectedRevision}, found ${String(current.recordRevision)}`)
          const currentFiles = (await this.client.fileRows(projectId, this.workspaceId)).map(file => file.file_id).sort()
          if (currentFiles.join('\0') !== [...destinationFileIds].sort().join('\0'))
            throw new CloudApiError(409, 'FILE_SET_CONFLICT', 'Destination file set changed; replacement was not staged')
        } else {
          const stagedRecord = ownRecord(record, projectId, this.userId, this.workspaceId, 0)
          await this.client.json('/rest/v1/cloud_projects', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, workspace_id: this.workspaceId, owner_user_id: this.userId, record_revision: 0, record: stagedRecord, status: 'staging' }),
          })
        }
        const stagedRecord = ownRecord(record, projectId, this.userId, this.workspaceId, isNew ? 0 : expectedRevision! + 1)
        try {
          await this.client.json('/rest/v1/cloud_project_restore_stages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stage_id: stageId, workspace_id: this.workspaceId, owner_user_id: this.userId,
              project_id: projectId, mode: isNew ? 'new' : 'replace',
              expected_revision: expectedRevision, expected_file_ids: destinationFileIds,
              staged_file_ids: fileIds, staged_record: stagedRecord,
            }),
          })
        } catch (error) {
          if (isNew) {
            const query = new URLSearchParams({ project_id: `eq.${projectId}`, workspace_id: `eq.${this.workspaceId}` })
            await this.client.json(`/rest/v1/cloud_projects?${query}`, { method: 'DELETE' }).catch(() => undefined)
          }
          throw error
        }
        return { ready: false, stageId, projectId, expectedFileIds: fileIds }
      }
      case 'finalize-restore': {
        assertExactKeys(input, ['action', 'stageId', 'fileIds'])
        this.client.assertPermission(this.role, 'write')
        const stageId = validateId(input.stageId, 'stageId')
        const fileIds = validateFileIdList(input.fileIds, 'fileIds')
        const query = new URLSearchParams({ select: 'workspace_id,project_id,mode,staged_file_ids', stage_id: `eq.${stageId}`, workspace_id: `eq.${this.workspaceId}`, owner_user_id: `eq.${this.userId}`, limit: '1' })
        const stages = await this.client.json(`/rest/v1/cloud_project_restore_stages?${query}`)
        if (!Array.isArray(stages) || !isObject(stages[0]))
          throw new CloudApiError(404, 'RESTORE_STAGE_NOT_FOUND', 'Restore stage was not found')
        const stage = stages[0]
        if (JSON.stringify([...(stage.staged_file_ids as string[])].sort()) !== JSON.stringify([...fileIds].sort()))
          throw new CloudApiError(409, 'FILE_SET_CONFLICT', 'Finalize file IDs differ from the staged manifest')
        const stagedFiles = await this.client.json(`/rest/v1/cloud_project_files?${new URLSearchParams({
          select: 'file_id,storage_path', stage_id: `eq.${stageId}`, workspace_id: `eq.${this.workspaceId}`, state: 'eq.staged',
        })}`)
        if (!Array.isArray(stagedFiles) || stagedFiles.length !== fileIds.length)
          throw new CloudApiError(409, 'FILE_SET_INCOMPLETE', 'Upload every file in the staged manifest before finalizing restore')
        for (const file of stagedFiles) {
          if (!isObject(file)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned invalid staged file metadata')
          const exists = await this.client.call(`/storage/v1/object/info/${String(file.storage_path)}`)
          if (!exists.ok) throw new CloudApiError(409, 'STAGED_FILE_MISSING', 'A staged file is missing; the project was not restored')
        }
        const finalized = await this.client.json('/rest/v1/rpc/finalize_cloud_project_restore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_stage_id: stageId, p_expected_file_ids: fileIds }),
        })
        if (!isObject(finalized)) throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage did not confirm restore finalization')
        let cleanupPending = false
        if (stage.mode === 'replace') {
          cleanupPending = (await this.cleanupOldFiles(String(stage.project_id))).length > 0
        }
        return { ready: true, record: finalized, ...(stage.mode === 'replace' ? { cleanupPending } : {}) }
      }
      case 'cleanup-files': {
        assertExactKeys(input, ['action', 'projectId'])
        this.client.assertPermission(this.role, 'replace')
        const projectId = validateId(input.projectId, 'projectId')
        const pendingFileIds = await this.cleanupOldFiles(projectId)
        return { cleanupPending: pendingFileIds.length > 0, files: pendingFileIds }
      }
      case 'load-files': {
        assertExactKeys(input, ['action', 'projectId'])
        this.client.assertPermission(this.role, 'read')
        const projectId = validateId(input.projectId, 'projectId')
        if (!await this.client.getProject(projectId, this.workspaceId))
          throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
        return { files: (await this.client.fileRows(projectId, this.workspaceId)).map(({ storage_path: _path, state: _state, ...file }) => file) }
      }
      case 'load-file': {
        assertExactKeys(input, ['action', 'fileId'])
        this.client.assertPermission(this.role, 'read')
        const fileId = validateId(input.fileId, 'fileId')
        const query = new URLSearchParams({ select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state', file_id: `eq.${fileId}`, workspace_id: `eq.${this.workspaceId}`, state: 'eq.ready', limit: '1' })
        const rows = await this.client.json(`/rest/v1/cloud_project_files?${query}`)
        if (!Array.isArray(rows) || !isObject(rows[0])) throw new CloudApiError(404, 'FILE_NOT_FOUND', 'File was not found in the active workspace')
        const { storage_path: _path, state: _state, ...file } = rows[0] as FileRow
        return { files: [file] }
      }
      case 'remove-file': {
        assertExactKeys(input, ['action', 'fileId'])
        this.client.assertPermission(this.role, 'write')
        const fileId = validateId(input.fileId, 'fileId')
        const query = new URLSearchParams({ select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state', file_id: `eq.${fileId}`, workspace_id: `eq.${this.workspaceId}`, state: 'eq.ready', limit: '1' })
        const rows = await this.client.json(`/rest/v1/cloud_project_files?${query}`)
        if (!Array.isArray(rows) || !isObject(rows[0])) return { files: [] }
        const file = rows[0]
        await this.client.removeStoredFile(file as FileRow)
        return { files: [] }
      }
      default:
        throw new CloudApiError(400, 'INVALID_ACTION', 'Unsupported cloud project action')
    }
  }

  private async cleanupOldFiles(projectId: string): Promise<string[]> {
    const rows = await this.client.cleanupRows(projectId, this.workspaceId)
    const pending: string[] = []
    for (const file of rows) {
      try {
        await this.client.removeStoredFile(file)
      } catch {
        pending.push(file.file_id)
      }
    }
    return pending
  }

  private async abandonRestoreStage(stageId: string): Promise<string> {
    const query = new URLSearchParams({
      select: 'stage_id,project_id,mode,owner_user_id',
      stage_id: `eq.${stageId}`,
      workspace_id: `eq.${this.workspaceId}`,
      limit: '1',
    })
    const stages = await this.client.json(`/rest/v1/cloud_project_restore_stages?${query}`)
    if (!Array.isArray(stages) || !isObject(stages[0]))
      throw new CloudApiError(404, 'RESTORE_STAGE_NOT_FOUND', 'Restore stage was not found')
    const stage = stages[0]
    const mayAbandonAny = PERMISSIONS[this.role]?.includes('replace') ?? false
    const mayAbandonOwnedNew = stage.mode === 'new'
      && stage.owner_user_id === this.userId
      && (PERMISSIONS[this.role]?.includes('restore-new') ?? false)
    if (!mayAbandonAny && !mayAbandonOwnedNew)
      throw new CloudApiError(403, 'FORBIDDEN', 'Only an owner/admin or the editor who owns a new restore stage can abandon it')

    await this.client.json('/rest/v1/rpc/begin_cloud_project_restore_abandon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_stage_id: stageId }),
    })
    const fileQuery = new URLSearchParams({
      select: 'file_id,project_id,name,type,size,uploaded_at,storage_path,state',
      stage_id: `eq.${stageId}`,
      workspace_id: `eq.${this.workspaceId}`,
      state: 'eq.staged',
    })
    const files = await this.client.json(`/rest/v1/cloud_project_files?${fileQuery}`)
    if (!Array.isArray(files))
      throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned invalid staged file metadata')
    for (const value of files) {
      if (!isObject(value) || typeof value.storage_path !== 'string')
        throw new CloudApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned invalid staged file metadata')
      const removed = await this.client.call(`/storage/v1/object/${value.storage_path}`, { method: 'DELETE' })
      if (!removed.ok && removed.status !== 404)
        throw new CloudApiError(503, 'STAGE_ABANDON_CLEANUP_PENDING', 'A staged Storage object could not be removed; retry abandon after resolving the Storage error')
    }
    await this.client.json('/rest/v1/rpc/finish_cloud_project_restore_abandon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_stage_id: stageId }),
    })
    return String(stage.project_id)
  }

  async binary(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!await this.client.readiness(this.role)) throw new CloudApiError(503, 'STORAGE_NOT_READY', 'Apply the cloud project migrations and create the private project-files bucket before using cloud files')
    const url = new URL(request.url ?? '/api/cloud-files', 'http://localhost')
    const fileId = validateId(url.searchParams.get('fileId'), 'fileId')
    if (request.method === 'GET') {
      this.client.assertPermission(this.role, 'read')
      const query = new URLSearchParams({ select: 'storage_path,name,type', file_id: `eq.${fileId}`, workspace_id: `eq.${this.workspaceId}`, state: 'eq.ready', limit: '1' })
      const rows = await this.client.json(`/rest/v1/cloud_project_files?${query}`)
      if (!Array.isArray(rows) || !isObject(rows[0])) throw new CloudApiError(404, 'FILE_NOT_FOUND', 'File was not found in the active workspace')
      const file = rows[0]
      const download = await this.client.call(`/storage/v1/object/${String(file.storage_path)}`)
      if (!download.ok) throw new CloudApiError(503, 'FILE_DOWNLOAD_FAILED', 'Could not download the stored file')
      response.statusCode = 200
      response.setHeader('Content-Type', typeof file.type === 'string' ? file.type : 'application/octet-stream')
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(String(file.name ?? fileId))}`)
      response.setHeader('Cache-Control', 'no-store')
      response.end(Buffer.from(await download.arrayBuffer()))
      return
    }
    if (request.method !== 'POST') throw new CloudApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to upload and GET to download files')
    this.client.assertPermission(this.role, 'write')
    const projectId = validateId(request.headers['x-project-id'], 'X-Project-Id')
    const stageIdValue = request.headers['x-stage-id']
    const stageId = stageIdValue ? validateId(stageIdValue, 'X-Stage-Id') : null
    let targetProjectId = projectId
    if (stageId) {
      const stageQuery = new URLSearchParams({ select: 'project_id,staged_file_ids', stage_id: `eq.${stageId}`, workspace_id: `eq.${this.workspaceId}`, owner_user_id: `eq.${this.userId}`, limit: '1' })
      const stages = await this.client.json(`/rest/v1/cloud_project_restore_stages?${stageQuery}`)
      if (!Array.isArray(stages) || !isObject(stages[0]))
        throw new CloudApiError(404, 'RESTORE_STAGE_NOT_FOUND', 'Restore stage was not found')
      targetProjectId = String(stages[0].project_id)
      const manifest = stages[0].staged_file_ids
      if (!Array.isArray(manifest) || !manifest.includes(fileId))
        throw new CloudApiError(400, 'FILE_NOT_IN_MANIFEST', 'File ID is not part of the staged restore manifest')
    } else {
      const project = await this.client.getProject(projectId, this.workspaceId)
      if (!project) throw new CloudApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found in the active workspace')
    }
    const length = Number(request.headers['content-length'] ?? 0)
    if (!Number.isFinite(length) || length < 0 || length > MAX_FILE_BYTES)
      throw new CloudApiError(413, 'FILE_TOO_LARGE', 'File uploads are limited to 100 MB')
    const chunks: Buffer[] = []
    let size = 0
    for await (const part of request) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      size += chunk.length
      if (size > MAX_FILE_BYTES) throw new CloudApiError(413, 'FILE_TOO_LARGE', 'File uploads are limited to 100 MB')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    let name = String(request.headers['x-file-name'] ?? fileId)
    try { name = decodeURIComponent(name) } catch {
      throw new CloudApiError(400, 'INVALID_FILE_NAME', 'X-File-Name must be percent-encoded UTF-8')
    }
    name = name.slice(0, 512)
    if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name))
      throw new CloudApiError(400, 'INVALID_FILE_NAME', 'X-File-Name must be a non-empty filename without control characters')
    const type = (request.headers['content-type'] ?? 'application/octet-stream').toString().slice(0, 255)
    const storagePath = stageId
      ? `${this.workspaceId}/_staging/${stageId}/${fileId}`
      : `${this.workspaceId}/${projectId}/${fileId}`
    const uploadedAt = Date.now()
    let metadataCreated = false
    let storageCreated = false
    let fileResponse: unknown
    try {
      await this.client.json('/rest/v1/cloud_project_files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId, project_id: targetProjectId, workspace_id: this.workspaceId,
          stage_id: stageId, name, type, size: bytes.byteLength, uploaded_at: uploadedAt,
          storage_path: `project-files/${storagePath}`, state: stageId ? 'staged' : 'uploading',
        }),
      })
      metadataCreated = true
      const uploaded = await this.client.call(`/storage/v1/object/project-files/${storagePath}`, {
        method: 'POST', headers: { 'Content-Type': type, 'x-upsert': 'false' }, body: bytes,
      })
      if (!uploaded.ok) throw new CloudApiError(uploaded.status === 409 ? 409 : 503, 'FILE_UPLOAD_FAILED', 'Could not store the uploaded file')
      storageCreated = true
      if (!stageId) {
        fileResponse = await this.client.json('/rest/v1/rpc/finish_cloud_project_file_upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_file_id: fileId }),
        })
      }
    } catch (error) {
      if (metadataCreated) {
        let objectGone = !storageCreated
        if (storageCreated) {
          const removed = await this.client.call(`/storage/v1/object/project-files/${storagePath}`, { method: 'DELETE' }).catch(() => null)
          objectGone = Boolean(removed && (removed.ok || removed.status === 404))
        }
        if (objectGone) {
          await this.client.json('/rest/v1/rpc/delete_cloud_project_file_metadata', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_storage_path: `project-files/${storagePath}` }),
          }).catch(() => undefined)
        } else {
          throw new CloudApiError(503, 'UPLOAD_CLEANUP_PENDING', 'The failed upload remains hidden and requires cleanup; no existing object was removed')
        }
      }
      throw error
    }
    response.statusCode = 201
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ file: stageId
      ? { fileId, projectId: targetProjectId, name, type, size: bytes.byteLength, uploadedAt }
      : fileResponse, ...(stageId ? { stageId, staged: true } : {}) }))
  }
}

export async function handleCloudProjects(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const api = await CloudProjectApi.fromRequest(request)
    const body = await readJsonRequest(request, MAX_JSON_BYTES)
    const result = await api.execute(body)
    sendJson(response, 200, result)
  } catch (error) {
    sendCloudError(response, error)
  }
}

export async function handleCloudFiles(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const api = await CloudProjectApi.fromRequest(request)
    await api.binary(request, response)
  } catch (error) {
    sendCloudError(response, error)
  }
}

function readJsonRequest(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (part: Buffer | string) => {
      if (tooLarge) return
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        reject(new CloudApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds the 16 MB limit'))
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
      catch { reject(new CloudApiError(400, 'INVALID_JSON', 'Request body must be valid JSON')) }
    })
    request.on('error', () => reject(new CloudApiError(400, 'REQUEST_READ_FAILED', 'Could not read request body')))
  })
}

function sendJson(response: ServerResponse, status: number, payload: object): void {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function sendCloudError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) return
  if (error instanceof CloudApiError) {
    sendJson(response, error.status, { error: error.message, code: error.code })
    return
  }
  sendJson(response, 503, { error: 'Cloud project storage is unavailable', code: 'CLOUD_STORAGE_UNAVAILABLE' })
}