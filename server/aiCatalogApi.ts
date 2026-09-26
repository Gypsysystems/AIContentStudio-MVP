import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  aiDefinitionsEqual,
  canTransitionAiVersion,
  validateAiAssetInput,
  validateAiInitialAsset,
  validateAiRevision,
  validateAiTransition,
  type AiAssetVersion,
  type AiCatalogCommand,
  type AiVersionState,
} from '../src/aiCatalogModel'

const ACCESS_COOKIE = 'sb_access_token'
const MAX_TOKEN_LENGTH = 8192
const MAX_ASSET_BYTES = 32_000
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/

type Json = Record<string, unknown>
type Config = { url: string; anonKey: string }
type Membership = { workspace_id: string; role: string }

export class AiCatalogApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'AiCatalogApiError'
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function config(): Config | null {
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
  const chunks = request.headers.cookie?.split(';') ?? []
  const matching = chunks.filter((part) => part.trim().startsWith(`${ACCESS_COOKIE}=`))
  if (matching.length !== 1) return null
  try {
    const token = decodeURIComponent(matching[0].trim().slice(ACCESS_COOKIE.length + 1))
    return token && token.length <= MAX_TOKEN_LENGTH ? token : null
  } catch {
    return null
  }
}

class SupabaseClient {
  constructor(private readonly settings: Config, private readonly token: string) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.settings.url}${path}`, {
        ...init,
        headers: {
          apikey: this.settings.anonKey,
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
      })
    } catch {
      throw new AiCatalogApiError(503, 'AI_CATALOG_UNAVAILABLE', 'AI catalog storage is unavailable')
    }
  }

  async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.request(path, init)
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const code = isObject(body) && typeof body.code === 'string' ? body.code : ''
      const details = isObject(body) ? `${String(body.message ?? '')} ${String(body.details ?? '')}` : ''
      if (['PGRST202', 'PGRST203', 'PGRST205', '42P01', '42883'].includes(code)
        || (response.status === 404 && (path.includes('/rpc/') || path.includes('/workspace_memberships')))) {
        throw new AiCatalogApiError(503, 'AI_CATALOG_SCHEMA_UNAVAILABLE', 'AI catalog storage schema is unavailable')
      }
      if (response.status === 401) throw new AiCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
      if (code === '42501' && /membership/i.test(details))
        throw new AiCatalogApiError(403, 'MEMBERSHIP_INACTIVE', 'An active workspace membership is required')
      if (response.status === 403 || code === '42501') throw new AiCatalogApiError(403, 'FORBIDDEN', 'The current workspace role does not allow this action')
      if (code === '40001' || code === '23505')
        throw new AiCatalogApiError(409, 'VERSION_CONFLICT', 'The asset changed; reload its latest version before retrying')
      if (code === '22023') {
        if (/workflow references/i.test(details))
          throw new AiCatalogApiError(400, 'WORKFLOW_REFERENCE_INVALID', 'Workflow references must resolve to exact asset versions in this workspace')
        throw new AiCatalogApiError(400, 'INVALID_CATALOG_COMMAND', 'AI catalog command is invalid for the current asset version')
      }
      if (code === 'P0002' || response.status === 404) throw new AiCatalogApiError(404, 'ASSET_NOT_FOUND', 'AI catalog asset was not found in the active workspace')
      throw new AiCatalogApiError(503, 'AI_CATALOG_UNAVAILABLE', 'AI catalog storage could not complete the request')
    }
    return body
  }

  async identity(): Promise<{ userId: string; membership: Membership }> {
    const userResponse = await this.request('/auth/v1/user')
    const user = await userResponse.json().catch(() => null) as unknown
    if (!userResponse.ok || !isObject(user) || typeof user.id !== 'string' || !user.id)
      throw new AiCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
    const query = new URLSearchParams({
      select: 'workspace_id,role', user_id: `eq.${user.id}`, order: 'workspace_id.asc',
    })
    let rows: unknown
    try {
      rows = await this.json(`/rest/v1/workspace_memberships?${query}`)
    } catch (error) {
      if (error instanceof AiCatalogApiError && error.status === 404)
        throw new AiCatalogApiError(503, 'AI_CATALOG_UNAVAILABLE', 'Workspace membership storage is not ready')
      throw error
    }
    if (!Array.isArray(rows) || !rows.length)
      throw new AiCatalogApiError(403, 'MEMBERSHIP_INACTIVE', 'An active workspace membership is required')
    const membership = rows[0]
    if (!isObject(membership) || typeof membership.workspace_id !== 'string'
      || !membership.workspace_id || !['owner', 'admin', 'editor', 'viewer'].includes(String(membership.role)))
      throw new AiCatalogApiError(503, 'MEMBERSHIP_LOOKUP_FAILED', 'Could not verify current workspace membership')
    return { userId: user.id, membership: membership as Membership }
  }

  async command(input: Json, workspaceId: string): Promise<unknown> {
    const action = input.action as string
    const rpc: Json = { p_action: action, p_workspace_id: workspaceId }
    if (action === 'history') rpc.p_asset_id = input.id
    if (action === 'create') {
      rpc.p_asset_id = `asset-${randomUUID()}`
      rpc.p_payload = input.asset
    }
    if (action === 'revise') {
      rpc.p_asset_id = input.id
      rpc.p_expected_version = input.expectedVersion
      rpc.p_payload = input.asset
    }
    if (action === 'transition') {
      rpc.p_asset_id = input.id
      rpc.p_expected_version = input.expectedVersion
      rpc.p_state = input.state
    }
    if (action === 'delete') {
      rpc.p_asset_id = input.id
      rpc.p_expected_version = input.expectedVersion
    }
    return this.json('/rest/v1/rpc/ai_catalog_command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpc),
    })
  }
}

function assertKeys(value: Json, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new AiCatalogApiError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function assertNoSensitiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveKeys)
    return
  }
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (/(credential|secret|token|api.?key|password|authorization|private.?key)/i.test(key))
      throw new AiCatalogApiError(400, 'SENSITIVE_FIELD', 'AI catalog assets cannot contain credentials or secret fields')
    assertNoSensitiveKeys(nested)
  }
}

function validateCommand(value: unknown): asserts value is Json & AiCatalogCommand {
  if (!isObject(value) || typeof value.action !== 'string')
    throw new AiCatalogApiError(400, 'INVALID_REQUEST', 'A JSON AI catalog command is required')
  switch (value.action) {
    case 'list':
      assertKeys(value, ['action'])
      break
    case 'history':
      assertKeys(value, ['action', 'id'])
      if (!stableId(value.id)) throw new AiCatalogApiError(400, 'INVALID_ID', 'id must be a valid stable ID')
      break
    case 'create':
      assertKeys(value, ['action', 'asset'])
      if (!validateAiInitialAsset(value.asset)) throw new AiCatalogApiError(400, 'INVALID_ASSET', 'Initial asset shape is invalid or exceeds the supported limits')
      break
    case 'revise':
      assertKeys(value, ['action', 'id', 'expectedVersion', 'asset'])
      if (!stableId(value.id)) throw new AiCatalogApiError(400, 'INVALID_ID', 'id must be a valid stable ID')
      assertVersion(value.expectedVersion)
      if (!validateAiAssetInput(value.asset)) throw new AiCatalogApiError(400, 'INVALID_ASSET', 'Asset shape is invalid or exceeds the supported limits')
      break
    case 'transition':
      assertKeys(value, ['action', 'id', 'expectedVersion', 'state'])
      if (!stableId(value.id)) throw new AiCatalogApiError(400, 'INVALID_ID', 'id must be a valid stable ID')
      assertVersion(value.expectedVersion)
      if (!['draft', 'test', 'published', 'archived'].includes(String(value.state)))
        throw new AiCatalogApiError(400, 'INVALID_STATE', 'state must be a supported AI asset state')
      break
    case 'delete':
      assertKeys(value, ['action', 'id', 'expectedVersion'])
      if (!stableId(value.id)) throw new AiCatalogApiError(400, 'INVALID_ID', 'id must be a valid stable ID')
      assertVersion(value.expectedVersion)
      break
    default:
      throw new AiCatalogApiError(400, 'INVALID_ACTION', 'Unsupported AI catalog action')
  }
  assertNoSensitiveKeys(value)
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_ASSET_BYTES)
    throw new AiCatalogApiError(413, 'REQUEST_TOO_LARGE', 'AI catalog request exceeds the 32 KB limit')
}

function assertVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new AiCatalogApiError(400, 'INVALID_VERSION', 'expectedVersion must be a positive integer')
}

function asAsset(value: unknown, workspaceId: string): AiAssetVersion {
  if (!isObject(value)
    || Object.keys(value).some(key => ![
      'workspaceId', 'id', 'kind', 'version', 'state', 'name', 'description',
      'definition', 'createdAt', 'createdBy',
    ].includes(key))
    || value.workspaceId !== workspaceId
    || !stableId(value.id)
    || !['workflow', 'prompt-pack', 'reference-set', 'blueprint'].includes(String(value.kind))
    || !Number.isSafeInteger(value.version) || (value.version as number) < 1
    || !['draft', 'test', 'published', 'archived'].includes(String(value.state))
    || typeof value.name !== 'string' || typeof value.description !== 'string'
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.createdBy !== 'string' || !value.createdBy)
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned an invalid asset')
  const input = {
    kind: value.kind,
    name: value.name,
    description: value.description,
    definition: value.definition,
  }
  if (!validateAiAssetInput(input))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned an invalid asset')
  return value as unknown as AiAssetVersion
}

function validateHistory(values: unknown[], workspaceId: string, expectedId?: string): AiAssetVersion[] {
  const items = values.map(value => asAsset(value, workspaceId))
  if ((expectedId && items.some(item => item.id !== expectedId))
    || new Set(items.map(item => item.id)).size > (expectedId ? 1 : items.length)
    || new Set(items.map(item => `${item.id}:${item.version}`)).size !== items.length) {
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned an invalid asset scope')
  }
  const versions = items.map(item => item.version)
  if (versions.some((version, index) => index > 0 && version <= versions[index - 1])
    || (expectedId && versions.some((version, index) => version !== index + 1))) {
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned invalid version history')
  }
  return items
}

export async function executeAiCatalog(value: unknown, client: SupabaseClient, workspaceId: string): Promise<Json> {
  validateCommand(value)
  const input = value as Json & AiCatalogCommand
  if (input.action === 'revise' || input.action === 'transition' || input.action === 'delete') {
    const historyResult = await client.command({ action: 'history', id: input.id }, workspaceId)
    const history = isObject(historyResult) && Array.isArray(historyResult.versions) ? historyResult.versions : null
    if (!history || history.length === 0) throw new AiCatalogApiError(404, 'ASSET_NOT_FOUND', 'AI catalog asset was not found in the active workspace')
    const historyAssets = validateHistory(history, workspaceId, input.id)
    if (!historyAssets.length) throw new AiCatalogApiError(404, 'ASSET_NOT_FOUND', 'AI catalog asset was not found in the active workspace')
    const latest = historyAssets[historyAssets.length - 1]
    if (latest.version !== input.expectedVersion)
      throw new AiCatalogApiError(409, 'VERSION_CONFLICT', `Asset changed; expected version ${input.expectedVersion}, found ${latest.version}`)
    if (input.action === 'revise') {
      if (!validateAiRevision(latest, input.asset, historyAssets))
        throw new AiCatalogApiError(400, 'INVALID_REVISION', 'Asset revision is not valid for the current version')
    } else if (input.action === 'transition') {
      if (!validateAiTransition(latest, input.state as AiVersionState))
        throw new AiCatalogApiError(400, 'INVALID_TRANSITION', 'Asset cannot transition from its current state')
    } else if (latest.state === 'archived' || !canTransitionAiVersion(latest.state, 'archived')) {
      throw new AiCatalogApiError(400, 'INVALID_TRANSITION', 'Asset cannot be archived from its current state')
    }
  }
  const result = await client.command(input, workspaceId)
  if (input.action === 'list' || input.action === 'history') {
    const responseField = input.action === 'history' ? 'versions' : 'assets'
    if (!isObject(result) || !Array.isArray(result[responseField]))
      throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned an invalid asset list')
    const items = input.action === 'history'
      ? validateHistory(result[responseField] as unknown[], workspaceId, input.id)
      : (result[responseField] as unknown[]).map(item => asAsset(item, workspaceId))
    if (input.action === 'list' && (new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => item.state === 'archived')))
      throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage returned an invalid asset list')
    return input.action === 'history' ? { versions: items } : { assets: items }
  }
  if (!isObject(result) || !result.asset)
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage did not confirm the mutation')
  const asset = asAsset(result.asset, workspaceId)
  if (input.action === 'create') {
    if (asset.version !== 1 || asset.state !== 'draft' || !validateAiInitialAsset(input.asset)
      || asset.kind !== input.asset.kind || asset.name !== input.asset.name
      || asset.description !== input.asset.description
      || !aiDefinitionsEqual(asset.definition, input.asset.definition))
      throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage did not confirm the requested asset')
  } else {
    const expectedVersion = input.expectedVersion + 1
    if (asset.id !== input.id || asset.version !== expectedVersion
      || (input.action === 'revise' && (asset.state !== 'draft'
        || asset.kind !== input.asset.kind || asset.name !== input.asset.name
        || asset.description !== input.asset.description
        || !aiDefinitionsEqual(asset.definition, input.asset.definition)))
      || (input.action === 'transition' && asset.state !== input.state)
      || (input.action === 'delete' && asset.state !== 'archived')) {
      throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog storage did not confirm the requested asset version')
    }
  }
  return { asset }
}

export async function handleAiCatalog(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  const settings = config()
  if (!settings) throw new AiCatalogApiError(503, 'AI_CATALOG_UNAVAILABLE', 'Cloud AI catalog storage is not configured')
  const token = cookieToken(request)
  if (!token) throw new AiCatalogApiError(401, 'UNAUTHENTICATED', 'A valid authenticated session is required')
  const client = new SupabaseClient(settings, token)
  const { membership } = await client.identity()
  const chunks: Buffer[] = []
  let size = 0
  const body = await new Promise<unknown>((resolve, reject) => {
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_ASSET_BYTES) {
        reject(new AiCatalogApiError(413, 'REQUEST_TOO_LARGE', 'AI catalog request exceeds the 32 KB limit'))
        request.resume()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
      catch { reject(new AiCatalogApiError(400, 'INVALID_JSON', 'Request body must be valid JSON')) }
    })
    request.on('error', () => reject(new AiCatalogApiError(400, 'REQUEST_READ_FAILED', 'Could not read request body')))
  })
  const result = await executeAiCatalog(body, client, membership.workspace_id)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(result))
}

export function sendAiCatalogError(response: ServerResponse, error: unknown): void {
  const apiError = error instanceof AiCatalogApiError
    ? error
    : new AiCatalogApiError(503, 'AI_CATALOG_UNAVAILABLE', 'Cloud AI catalog storage is unavailable')
  response.statusCode = apiError.status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ error: apiError.message, code: apiError.code }))
}