import type { IncomingMessage, ServerResponse } from 'node:http'
import { copyCatalogAsset, ContentCopyError, type CopyJson, type CopySourceItem } from './contentCatalogCopy'

const ACCESS_COOKIE = 'sb_access_token'
const MAX_TOKEN_LENGTH = 8192
const MAX_REQUEST_BYTES = 16_384
const MAX_PAYLOAD_BYTES = 512_000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const MAX_OFFSET = 100_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KNOWN_ROLES = ['owner', 'admin', 'editor', 'viewer']
const ASSET_TYPES = ['topic', 'snippet', 'variable', 'condition', 'reference', 'media'] as const
const MAX_METADATA_BYTES = 16_384

type Json = Record<string, unknown>
type Settings = { url: string; anonKey: string }
type Membership = { workspace_id: string; role: string }

const ITEM_SELECT = [
  'item_id', 'workspace_id', 'project_id', 'asset_type', 'local_asset_id',
  'display_name', 'status', 'current_version', 'current_hash',
  'origin_item_id', 'origin_project_id', 'origin_version', 'created_at', 'updated_at',
].join(',')
const VERSION_SELECT = [
  'item_id', 'version', 'workspace_id', 'project_id', 'content_hash',
  'payload', 'source_project_revision', 'created_by', 'created_at',
].join(',')

export class ContentCatalogApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ContentCatalogApiError'
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function config(): Settings | null {
  const rawUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!rawUrl || !anonKey || /^sb_secret_/i.test(anonKey)) return null
  try {
    const url = new URL(rawUrl)
    if (!['https:', 'http:'].includes(url.protocol)
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    const jwt = anonKey.split('.')
    if (jwt.length === 3) {
      const payload = JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')) as Json
      if (payload.role === 'service_role') return null
    }
    return { url: url.origin, anonKey }
  } catch {
    return null
  }
}

function cookieToken(request: IncomingMessage): string | null {
  const parts = request.headers.cookie?.split(';') ?? []
  const matching = parts.filter(part => part.trim().startsWith(`${ACCESS_COOKIE}=`))
  if (matching.length !== 1) return null
  try {
    const token = decodeURIComponent(matching[0].trim().slice(ACCESS_COOKIE.length + 1))
    return token && token.length <= MAX_TOKEN_LENGTH ? token : null
  } catch {
    return null
  }
}

function validateUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value))
    throw new ContentCatalogApiError(400, 'INVALID_ID', `${field} must be a valid UUID`)
  return value
}

function validateTextId(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value))
    throw new ContentCatalogApiError(400, 'INVALID_ID', `${field} must be a valid stable ID`)
  return value
}

function validateCopyId(value: unknown, field: string, maximum = 512): string {
  const id = validateTextId(value, field, maximum)
  if (/[\\/]/.test(id))
    throw new ContentCatalogApiError(400, 'INVALID_ID', `${field} must be a valid stable ID`)
  return id
}

function assertKeys(input: Json, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key)))
    throw new ContentCatalogApiError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
}

type ListInput = {
  action: 'list'
  workspaceId: string
  projectId?: string
  excludeProjectId?: string
  assetType?: string
  search?: string
  limit: number
  offset: number
}
type VersionInput = { action: 'version'; workspaceId: string; itemId: string; version: number }
type CopyInput = {
  action: 'copy'
  workspaceId: string
  sourceItemId: string
  sourceVersion: number
  destinationProjectId: string
  expectedRevision: number
  insertion?: { afterTopicId: string }
}
type CatalogInput = ListInput | VersionInput | CopyInput

function validateRequest(value: unknown): CatalogInput {
  if (!isObject(value) || typeof value.action !== 'string')
    throw new ContentCatalogApiError(400, 'INVALID_REQUEST', 'A JSON content catalog request is required')
  if (value.action === 'list') {
    assertKeys(value, ['action', 'workspaceId', 'projectId', 'excludeProjectId', 'assetType', 'search', 'limit', 'offset'])
    const workspaceId = validateUuid(value.workspaceId, 'workspaceId')
    const projectId = value.projectId === undefined ? undefined : validateTextId(value.projectId, 'projectId')
    const excludeProjectId = value.excludeProjectId === undefined
      ? undefined : validateTextId(value.excludeProjectId, 'excludeProjectId')
    if (projectId !== undefined && projectId === excludeProjectId)
      throw new ContentCatalogApiError(400, 'PROJECT_FILTER_CONFLICT', 'projectId cannot match excludeProjectId')
    const assetType = value.assetType === undefined ? undefined : validateTextId(value.assetType, 'assetType', 100)
    if (assetType !== undefined && !ASSET_TYPES.includes(assetType as typeof ASSET_TYPES[number]))
      throw new ContentCatalogApiError(400, 'INVALID_ASSET_TYPE', 'assetType must be a supported content catalog type')
    let search: string | undefined
    if (value.search !== undefined) {
      if (typeof value.search !== 'string' || value.search.trim() !== value.search
        || value.search.length > 120 || /[\u0000-\u001f\u007f]/.test(value.search))
        throw new ContentCatalogApiError(400, 'INVALID_SEARCH', 'search must be at most 120 printable characters')
      search = value.search || undefined
    }
    const limit = value.limit === undefined ? DEFAULT_PAGE_SIZE : value.limit
    const offset = value.offset === undefined ? 0 : value.offset
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_PAGE_SIZE)
      throw new ContentCatalogApiError(400, 'INVALID_LIMIT', `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > MAX_OFFSET)
      throw new ContentCatalogApiError(400, 'INVALID_OFFSET', `offset must be an integer from 0 to ${MAX_OFFSET}`)
    return {
      action: 'list', workspaceId, projectId, excludeProjectId, assetType, search,
      limit: limit as number, offset: offset as number,
    }
  }
  if (value.action === 'version') {
    assertKeys(value, ['action', 'workspaceId', 'itemId', 'version'])
    const workspaceId = validateUuid(value.workspaceId, 'workspaceId')
    const itemId = validateUuid(value.itemId, 'itemId')
    if (!Number.isSafeInteger(value.version) || (value.version as number) < 1 || (value.version as number) > 2_147_483_647)
      throw new ContentCatalogApiError(400, 'INVALID_VERSION', 'version must be a positive 32-bit integer')
    return { action: 'version', workspaceId, itemId, version: value.version as number }
  }
  if (value.action === 'copy') {
    assertKeys(value, [
      'action', 'workspaceId', 'sourceItemId', 'sourceVersion',
      'destinationProjectId', 'expectedRevision', 'insertion',
    ])
    const workspaceId = validateUuid(value.workspaceId, 'workspaceId')
    const sourceItemId = validateUuid(value.sourceItemId, 'sourceItemId')
    const destinationProjectId = validateCopyId(value.destinationProjectId, 'destinationProjectId', 256)
    if (!Number.isSafeInteger(value.sourceVersion) || (value.sourceVersion as number) < 1
      || (value.sourceVersion as number) > 2_147_483_647)
      throw new ContentCatalogApiError(400, 'INVALID_VERSION', 'sourceVersion must be a positive 32-bit integer')
    if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0)
      throw new ContentCatalogApiError(400, 'INVALID_REVISION', 'expectedRevision must be a nonnegative integer')
    let insertion: CopyInput['insertion']
    if (value.insertion !== undefined) {
      if (!isObject(value.insertion))
        throw new ContentCatalogApiError(400, 'INVALID_INSERTION', 'insertion must contain afterTopicId')
      assertKeys(value.insertion, ['afterTopicId'])
      insertion = { afterTopicId: validateCopyId(value.insertion.afterTopicId, 'afterTopicId') }
    }
    return {
      action: 'copy', workspaceId, sourceItemId, sourceVersion: value.sourceVersion as number,
      destinationProjectId, expectedRevision: value.expectedRevision as number, insertion,
    }
  }
  throw new ContentCatalogApiError(400, 'INVALID_ACTION', 'Unsupported content catalog action')
}

class ContentCatalogRepository {
  constructor(private readonly settings: Settings, private readonly token: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${this.settings.url}${path}`, {
        ...init,
        headers: {
          apikey: this.settings.anonKey,
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
      })
    } catch {
      throw new ContentCatalogApiError(503, 'CONTENT_CATALOG_UNAVAILABLE', 'Content catalog storage is unavailable')
    }
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      if (response.status === 401)
        throw new ContentCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
      if (response.status === 403)
        throw new ContentCatalogApiError(403, 'FORBIDDEN', 'The current workspace role does not allow this action')
      if (response.status === 404)
        throw new ContentCatalogApiError(404, 'ITEM_NOT_FOUND', 'Content catalog item was not found in the workspace')
      if (response.status === 409)
        throw new ContentCatalogApiError(409, 'PROJECT_CONFLICT', 'Destination project changed during copy; reload before retrying')
      throw new ContentCatalogApiError(503, 'CONTENT_CATALOG_UNAVAILABLE', 'Content catalog storage could not complete the request')
    }
    return body
  }

  async verifyMembership(workspaceId: string): Promise<Membership> {
    const userResponse = await this.request('/auth/v1/user')
    if (!isObject(userResponse) || typeof userResponse.id !== 'string' || !userResponse.id)
      throw new ContentCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
    const membershipQuery = new URLSearchParams({
      select: 'workspace_id,role',
      user_id: `eq.${userResponse.id}`,
      workspace_id: `eq.${workspaceId}`,
      limit: '1',
    })
    const memberships = await this.request(`/rest/v1/workspace_memberships?${membershipQuery}`)
    if (!Array.isArray(memberships) || !memberships.length)
      throw new ContentCatalogApiError(403, 'MEMBERSHIP_INACTIVE', 'An active workspace membership is required')
    const membership = memberships[0]
    if (!isObject(membership) || membership.workspace_id !== workspaceId
      || typeof membership.role !== 'string' || !KNOWN_ROLES.includes(membership.role))
      throw new ContentCatalogApiError(503, 'MEMBERSHIP_LOOKUP_FAILED', 'Could not verify current workspace membership')

    const permissionQuery = new URLSearchParams({
      select: 'permission',
      role: `eq.${membership.role}`,
      permission: 'eq.read',
      limit: '1',
    })
    const permissions = await this.request(`/rest/v1/workspace_role_permissions?${permissionQuery}`)
    if (!Array.isArray(permissions) || !permissions.some(row => isObject(row) && row.permission === 'read'))
      throw new ContentCatalogApiError(403, 'FORBIDDEN', 'Workspace read permission is required')
    return membership as Membership
  }

  async verifyWriteRole(membership: Membership): Promise<void> {
    if (!['owner', 'admin', 'editor'].includes(membership.role))
      throw new ContentCatalogApiError(403, 'FORBIDDEN', 'Workspace editor permission is required to copy content')
    const permissionQuery = new URLSearchParams({
      select: 'permission',
      role: `eq.${membership.role}`,
      permission: 'eq.write',
      limit: '1',
    })
    const permissions = await this.request(`/rest/v1/workspace_role_permissions?${permissionQuery}`)
    if (!Array.isArray(permissions) || !permissions.some(row => isObject(row) && row.permission === 'write'))
      throw new ContentCatalogApiError(403, 'FORBIDDEN', 'Workspace write permission is required to copy content')
  }

  async list(input: ListInput): Promise<Json> {
    const query = new URLSearchParams({
      select: ITEM_SELECT,
      workspace_id: `eq.${input.workspaceId}`,
      status: 'eq.active',
      order: 'display_name.asc,item_id.asc',
      limit: String(input.limit),
      offset: String(input.offset),
    })
    if (input.projectId !== undefined) query.set('project_id', `eq.${input.projectId}`)
    if (input.excludeProjectId !== undefined) {
      if (input.projectId === undefined) query.set('project_id', `neq.${input.excludeProjectId}`)
      else query.append('project_id', `neq.${input.excludeProjectId}`)
    }
    if (input.assetType !== undefined) query.set('asset_type', `eq.${input.assetType}`)
    if (input.search !== undefined) {
      const escaped = input.search.replace(/[\\%_*"]/g, character => `\\${character}`)
      query.set('display_name', `ilike."*${escaped}*"`)
    }
    const rows = await this.request(`/rest/v1/content_catalog_items?${query}`)
    if (!Array.isArray(rows) || rows.length > input.limit || rows.some(row => !isObject(row)
      || row.workspace_id !== input.workspaceId || row.status !== 'active'
      || !validItemMetadata(row, input.workspaceId))) {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid item metadata')
    }
    return { items: rows.map(itemMetadata) }
  }

  async version(input: VersionInput): Promise<Json> {
    const itemQuery = new URLSearchParams({
      select: ITEM_SELECT,
      item_id: `eq.${input.itemId}`,
      workspace_id: `eq.${input.workspaceId}`,
      limit: '1',
    })
    const itemRows = await this.request(`/rest/v1/content_catalog_items?${itemQuery}`)
    if (!Array.isArray(itemRows))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid item metadata')
    const item = itemRows[0]
    if (!isObject(item) || item.item_id !== input.itemId || item.workspace_id !== input.workspaceId)
      throw new ContentCatalogApiError(404, 'ITEM_NOT_FOUND', 'Content catalog item was not found in the workspace')
    if (!validItemMetadata(item, input.workspaceId))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid item metadata')

    const versionQuery = new URLSearchParams({
      select: VERSION_SELECT,
      item_id: `eq.${input.itemId}`,
      workspace_id: `eq.${input.workspaceId}`,
      version: `eq.${input.version}`,
      limit: '1',
    })
    const versions = await this.request(`/rest/v1/content_catalog_versions?${versionQuery}`)
    if (!Array.isArray(versions))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version data')
    const version = versions[0]
    if (!isObject(version) || version.item_id !== input.itemId || version.workspace_id !== input.workspaceId
      || version.version !== input.version || version.project_id !== item.project_id) {
      throw new ContentCatalogApiError(404, 'VERSION_NOT_FOUND', 'Content catalog version was not found in the workspace')
    }
    let payloadBytes: number
    try {
      payloadBytes = Buffer.byteLength(JSON.stringify(version.payload))
    } catch {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version content')
    }
    if (payloadBytes > MAX_PAYLOAD_BYTES)
      throw new ContentCatalogApiError(413, 'PAYLOAD_TOO_LARGE', 'Content catalog version payload exceeds the 512 KB response limit')
    if (typeof version.content_hash !== 'string' || !version.content_hash || version.content_hash.length > 256
      || !Number.isSafeInteger(version.source_project_revision) || (version.source_project_revision as number) < 0
      || typeof version.created_at !== 'string' || Number.isNaN(Date.parse(version.created_at))
      || (version.created_by !== null
        && !(typeof version.created_by === 'string' && UUID_PATTERN.test(version.created_by)))) {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version metadata')
    }
    const result = {
      item: itemMetadata(item),
      version: {
        itemId: version.item_id,
        version: version.version,
        workspaceId: version.workspace_id,
        projectId: version.project_id,
        contentHash: version.content_hash,
        payload: version.payload,
        sourceProjectRevision: version.source_project_revision,
        createdBy: version.created_by ?? null,
        createdAt: version.created_at,
      },
    }
    if (Buffer.byteLength(JSON.stringify({ item: result.item, version: { ...result.version, payload: undefined } })) > MAX_METADATA_BYTES)
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned oversized version metadata')
    return result
  }

  async copy(input: CopyInput, membership: Membership): Promise<Json> {
    await this.verifyWriteRole(membership)
    const itemQuery = new URLSearchParams({
      select: ITEM_SELECT,
      item_id: `eq.${input.sourceItemId}`,
      workspace_id: `eq.${input.workspaceId}`,
      limit: '1',
    })
    const itemRows = await this.request(`/rest/v1/content_catalog_items?${itemQuery}`)
    if (!Array.isArray(itemRows))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid item metadata')
    const item = itemRows[0]
    if (!isObject(item) || item.item_id !== input.sourceItemId || item.workspace_id !== input.workspaceId)
      throw new ContentCatalogApiError(404, 'ITEM_NOT_FOUND', 'Active source item was not found in the workspace')
    if (!validItemMetadata(item, input.workspaceId))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid item metadata')
    if (item.status !== 'active')
      throw new ContentCatalogApiError(404, 'ITEM_NOT_FOUND', 'Active source item was not found in the workspace')
    if (item.project_id === input.destinationProjectId)
      throw new ContentCatalogApiError(400, 'SAME_PROJECT_COPY', 'Content cannot be copied into its source project')

    const versionQuery = new URLSearchParams({
      select: VERSION_SELECT,
      item_id: `eq.${input.sourceItemId}`,
      workspace_id: `eq.${input.workspaceId}`,
      version: `eq.${input.sourceVersion}`,
      limit: '1',
    })
    const versions = await this.request(`/rest/v1/content_catalog_versions?${versionQuery}`)
    if (!Array.isArray(versions))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version data')
    const sourceVersion = versions[0]
    if (!isObject(sourceVersion) || sourceVersion.item_id !== item.item_id
      || sourceVersion.workspace_id !== input.workspaceId || sourceVersion.project_id !== item.project_id
      || sourceVersion.version !== input.sourceVersion)
      throw new ContentCatalogApiError(404, 'VERSION_NOT_FOUND', 'Exact source version was not found in the workspace')
    let payloadBytes: number
    try {
      payloadBytes = Buffer.byteLength(JSON.stringify(sourceVersion.payload))
    } catch {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version content')
    }
    if (payloadBytes > MAX_PAYLOAD_BYTES)
      throw new ContentCatalogApiError(413, 'PAYLOAD_TOO_LARGE', 'Content catalog version payload exceeds the 512 KB limit')
    if (typeof sourceVersion.content_hash !== 'string' || !sourceVersion.content_hash
      || sourceVersion.content_hash.length > 256
      || !Number.isSafeInteger(sourceVersion.source_project_revision)
      || (sourceVersion.source_project_revision as number) < 0
      || typeof sourceVersion.created_at !== 'string' || Number.isNaN(Date.parse(sourceVersion.created_at))
      || (sourceVersion.created_by !== null && sourceVersion.created_by !== undefined
        && !(typeof sourceVersion.created_by === 'string' && UUID_PATTERN.test(sourceVersion.created_by))))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Content catalog returned invalid version metadata')

    const destinationQuery = new URLSearchParams({
      select: 'project_id,workspace_id,owner_user_id,record_revision,status,record',
      project_id: `eq.${input.destinationProjectId}`,
      workspace_id: `eq.${input.workspaceId}`,
      status: 'eq.active',
      limit: '1',
    })
    const destinationRows = await this.request(`/rest/v1/cloud_projects?${destinationQuery}`)
    if (!Array.isArray(destinationRows))
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Cloud storage returned an invalid destination project')
    const destination = destinationRows[0]
    if (!isObject(destination) || destination.project_id !== input.destinationProjectId
      || destination.workspace_id !== input.workspaceId || destination.status !== 'active') {
      throw new ContentCatalogApiError(404, 'PROJECT_NOT_FOUND', 'Destination project was not found in the active workspace')
    }
    if (typeof destination.owner_user_id !== 'string' || !destination.owner_user_id
      || !Number.isSafeInteger(destination.record_revision) || (destination.record_revision as number) < 0
      || !isObject(destination.record)) {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Stored destination project identity or revision is invalid')
    }
    let destinationBytes: number
    try {
      destinationBytes = Buffer.byteLength(JSON.stringify(destination.record))
    } catch {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Stored destination record is invalid')
    }
    if (destinationBytes > 16 * 1024 * 1024)
      throw new ContentCatalogApiError(413, 'PROJECT_TOO_LARGE', 'Destination project record exceeds the 16 MB limit')
    const current = destination.record as CopyJson
    if (current.projectId !== input.destinationProjectId || current.workspaceId !== input.workspaceId
      || current.ownerUserId !== destination.owner_user_id
      || current.recordRevision !== destination.record_revision) {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Stored destination project identity or revision is invalid')
    }
    if (destination.record_revision !== input.expectedRevision)
      throw new ContentCatalogApiError(409, 'PROJECT_CONFLICT', 'Destination project changed; reload before copying')

    const sourceForCopy: CopySourceItem = {
      item_id: item.item_id as string,
      workspace_id: item.workspace_id as string,
      project_id: item.project_id as string,
      asset_type: item.asset_type as string,
      local_asset_id: item.local_asset_id as string,
      display_name: item.display_name as string,
      status: item.status as string,
      current_version: input.sourceVersion,
    }
    const copied = copyCatalogAsset(current, sourceVersion.payload, sourceForCopy, input.insertion)
    if (copied.asset.alreadyAvailable === true) {
      return {
        projectId: input.destinationProjectId,
        recordRevision: input.expectedRevision,
        assetType: item.asset_type,
        asset: copied.asset,
      }
    }
    const nextRevision = input.expectedRevision + 1
    const updated = {
      ...copied.record,
      projectId: input.destinationProjectId,
      workspaceId: input.workspaceId,
      ownerUserId: destination.owner_user_id,
      recordRevision: nextRevision,
      modifiedAt: Date.now(),
    }
    let nextBytes: number
    try {
      nextBytes = Buffer.byteLength(JSON.stringify(updated))
    } catch {
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Updated destination record is invalid')
    }
    if (nextBytes > 16 * 1024 * 1024)
      throw new ContentCatalogApiError(413, 'PROJECT_TOO_LARGE', 'Updated destination record exceeds the 16 MB limit')
    const updateQuery = new URLSearchParams({
      project_id: `eq.${input.destinationProjectId}`,
      workspace_id: `eq.${input.workspaceId}`,
      status: 'eq.active',
      record_revision: `eq.${input.expectedRevision}`,
      select: 'project_id,record_revision',
    })
    const updatedRows = await this.request(`/rest/v1/cloud_projects?${updateQuery}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        record_revision: nextRevision,
        record: updated,
        updated_at: new Date().toISOString(),
      }),
    })
    if (!Array.isArray(updatedRows) || !isObject(updatedRows[0])
      || updatedRows[0].project_id !== input.destinationProjectId
      || updatedRows[0].record_revision !== nextRevision) {
      throw new ContentCatalogApiError(409, 'PROJECT_CONFLICT', 'Destination project changed during copy; reload before retrying')
    }
    const result = {
      projectId: input.destinationProjectId,
      recordRevision: nextRevision,
      assetType: item.asset_type,
      asset: copied.asset,
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024)
      throw new ContentCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'Copy result exceeds the response limit')
    return result
  }

}

function validItemMetadata(row: Json, workspaceId: string): boolean {
  const validNullableUuid = (value: unknown) => value === null || value === undefined
    || (typeof value === 'string' && UUID_PATTERN.test(value))
  const validNullableText = (value: unknown) => value === null || value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= 256
      && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value))
  const validNullableVersion = (value: unknown) => value === null || value === undefined
    || (Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647)
  return row.workspace_id === workspaceId
    && typeof row.item_id === 'string' && UUID_PATTERN.test(row.item_id)
    && typeof row.project_id === 'string' && row.project_id.length > 0 && row.project_id.length <= 256
    && row.project_id.trim() === row.project_id && !/[\u0000-\u001f\u007f]/.test(row.project_id)
    && typeof row.asset_type === 'string' && ASSET_TYPES.includes(row.asset_type as typeof ASSET_TYPES[number])
    && typeof row.local_asset_id === 'string' && row.local_asset_id.length > 0 && row.local_asset_id.length <= 512
    && row.local_asset_id.trim() === row.local_asset_id && !/[\u0000-\u001f\u007f]/.test(row.local_asset_id)
    && typeof row.display_name === 'string' && row.display_name.length > 0 && row.display_name.length <= 1024
    && row.display_name.trim() === row.display_name && !/[\u0000-\u001f\u007f]/.test(row.display_name)
    && (row.status === 'active' || row.status === 'retired')
    && Number.isSafeInteger(row.current_version) && (row.current_version as number) > 0
    && (row.current_version as number) <= 2_147_483_647
    && typeof row.current_hash === 'string' && row.current_hash.length > 0 && row.current_hash.length <= 256
    && validNullableUuid(row.origin_item_id)
    && validNullableText(row.origin_project_id)
    && validNullableVersion(row.origin_version)
    && typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at))
    && typeof row.updated_at === 'string' && !Number.isNaN(Date.parse(row.updated_at))
}

function itemMetadata(row: Json): Json {
  return {
    itemId: row.item_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    assetType: row.asset_type,
    localAssetId: row.local_asset_id,
    displayName: row.display_name,
    status: row.status,
    currentVersion: row.current_version,
    currentHash: row.current_hash,
    originItemId: row.origin_item_id ?? null,
    originProjectId: row.origin_project_id ?? null,
    originVersion: row.origin_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_REQUEST_BYTES) {
        tooLarge = true
        reject(new ContentCatalogApiError(413, 'REQUEST_TOO_LARGE', 'Content catalog request exceeds the 16 KB limit'))
        request.resume()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new ContentCatalogApiError(400, 'INVALID_JSON', 'Request body must be valid JSON'))
      }
    })
    request.on('error', () => {
      if (!tooLarge) reject(new ContentCatalogApiError(400, 'REQUEST_READ_FAILED', 'Could not read request body'))
    })
  })
}

export async function handleContentCatalog(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  const settings = config()
  if (!settings) throw new ContentCatalogApiError(503, 'CONTENT_CATALOG_UNAVAILABLE', 'Content catalog storage is not configured')
  const token = cookieToken(request)
  if (!token) throw new ContentCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
  const input = validateRequest(await readBody(request))
  const repository = new ContentCatalogRepository(settings, token)
  const membership = await repository.verifyMembership(input.workspaceId)
  const result = input.action === 'list'
    ? await repository.list(input)
    : input.action === 'version'
      ? await repository.version(input)
      : await repository.copy(input, membership)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(result))
}

export function sendContentCatalogError(response: ServerResponse, error: unknown): void {
  const apiError = error instanceof ContentCatalogApiError
    ? error
    : error instanceof ContentCopyError
      ? new ContentCatalogApiError(error.status, error.code, error.message)
      : new ContentCatalogApiError(503, 'CONTENT_CATALOG_UNAVAILABLE', 'Content catalog storage is unavailable')
  response.statusCode = apiError.status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ error: apiError.message, code: apiError.code }))
}