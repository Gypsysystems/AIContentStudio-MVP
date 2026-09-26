import type { IncomingMessage, ServerResponse } from 'node:http'
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { Client } from 'pg'
import type { ConnectionCommand, ConnectionMetadata, ConnectionState } from '../src/aiConnectionModel'

type Json = Record<string, unknown>
type Encrypted = { workspaceId: string; providerId: string; revision: number; ciphertext: Buffer; nonce: Buffer; tag: Buffer; keyVersion: string }
type Stored = ConnectionMetadata & { proof: string | null }
type Session = { userId: string; workspaceId: string; role: string }
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/
const COOKIE = 'sb_access_token'
const LIMIT = 12_000

export class ConnectionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}
const fail = (status: number, code: string, message: string): never => { throw new ConnectionError(status, code, message) }
const object = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

export function encryptionKey(raw = process.env.AI_CONNECTION_ENCRYPTION_KEY): Buffer {
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return fail(503, 'ENCRYPTION_UNAVAILABLE', 'Connection encryption is not configured')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32 || key.toString('base64') !== raw)
    return fail(503, 'ENCRYPTION_UNAVAILABLE', 'Connection encryption is not configured')
  return key
}
function aad(workspaceId: string, providerId: string, revision: number): Buffer {
  return Buffer.from(JSON.stringify(['ai-connection-v1', workspaceId, providerId, revision]))
}
export function encryptCredential(key: Buffer, workspaceId: string, providerId: string, revision: number, credential: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(workspaceId, providerId, revision))
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}
export function decryptCredential(key: Buffer, row: Encrypted): string {
  if (row.keyVersion !== 'v1' || row.nonce.length !== 12 || row.tag.length !== 16 || row.ciphertext.length < 1)
    return fail(503, 'CREDENTIAL_INVALID', 'Stored connection could not be verified')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, row.nonce)
    decipher.setAAD(aad(row.workspaceId, row.providerId, row.revision))
    decipher.setAuthTag(row.tag)
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return fail(503, 'CREDENTIAL_INVALID', 'Stored connection could not be verified')
  }
}
function proof(key: Buffer, row: Pick<Stored, 'workspaceId' | 'providerId' | 'revision' | 'state' | 'testedAt'>): string {
  const macKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'ai-connection-test-proof-v1', 32))
  return createHmac('sha256', macKey)
    .update(JSON.stringify([row.workspaceId, row.providerId, row.revision, row.state,
      row.testedAt === null ? null : new Date(row.testedAt).toISOString()]))
    .digest('hex')
}
function metadata(value: unknown, workspaceId: string, key: Buffer): ConnectionMetadata {
  if (!object(value) || Object.keys(value).some(k => ![
    'workspaceId', 'providerId', 'revision', 'state', 'proof', 'testedAt', 'updatedAt', 'updatedBy',
  ].includes(k)) || value.workspaceId !== workspaceId || typeof value.providerId !== 'string'
    || !ID.test(value.providerId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['untested', 'verified', 'failed', 'unavailable'].includes(String(value.state))
    || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))
    || typeof value.updatedBy !== 'string' || !value.updatedBy
    || (value.testedAt !== null && (typeof value.testedAt !== 'string' || Number.isNaN(Date.parse(value.testedAt))))) {
    return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection storage returned an invalid record')
  }
  const row = value as unknown as Stored
  if (row.state === 'untested'
    ? row.proof !== null || row.testedAt !== null
    : typeof row.proof !== 'string' || !/^[0-9a-f]{64}$/.test(row.proof) || row.testedAt === null
      || !timingSafeEqual(Buffer.from(row.proof, 'hex'), Buffer.from(proof(key, row), 'hex')))
    return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection test status could not be verified')
  const { proof: _proof, ...safe } = row
  return safe
}
function validate(input: unknown): asserts input is ConnectionCommand {
  if (!object(input) || !['list', 'create', 'replace', 'test', 'delete'].includes(String(input.action)))
    return fail(400, 'INVALID_REQUEST', 'Invalid connection action')
  const action = input.action
  const allowed = action === 'list' ? ['action']
    : action === 'create' ? ['action', 'providerId', 'credential']
      : action === 'replace' ? ['action', 'providerId', 'expectedRevision', 'credential']
        : ['action', 'providerId', 'expectedRevision']
  if (Object.keys(input).some(k => !allowed.includes(k))
    || (action !== 'list' && (typeof input.providerId !== 'string' || !ID.test(input.providerId)))
    || (action !== 'list' && action !== 'create' && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1))
    || (action === 'create' || action === 'replace')
      && (typeof input.credential !== 'string' || input.credential.trim().length === 0
        || Buffer.byteLength(input.credential) > 4096))
    return fail(400, 'INVALID_REQUEST', 'Invalid connection request fields')
}

export type ConnectionDependencies = {
  command: (args: Json) => Promise<unknown>
  readEncrypted: (workspaceId: string, providerId: string) => Promise<Encrypted | null>
  verify: (providerId: string, credential: string) => Promise<'verified' | 'failed' | 'unavailable'>
}
export async function executeConnections(input: unknown, workspaceId: string, role: string, key: Buffer, deps: ConnectionDependencies): Promise<Json> {
  validate(input)
  if (input.action !== 'list' && role !== 'owner' && role !== 'admin')
    return fail(403, 'FORBIDDEN', 'Owner or admin role required')
  const base: Json = { p_action: input.action, p_workspace_id: workspaceId }
  if (input.action !== 'list') base.p_provider_id = input.providerId
  if (input.action !== 'list' && input.action !== 'create') base.p_expected_revision = input.expectedRevision
  if (input.action === 'create' || input.action === 'replace') {
    const encrypted = encryptCredential(key, workspaceId, input.providerId,
      input.action === 'create' ? 1 : input.expectedRevision + 1, input.credential)
    Object.assign(base, {
      p_ciphertext: encrypted.ciphertext,
      p_nonce: encrypted.nonce,
      p_tag: encrypted.tag,
    })
  }
  if (input.action === 'test') {
    const row = await deps.readEncrypted(workspaceId, input.providerId)
    if (!row) return fail(404, 'NOT_FOUND', 'Connection not found')
    if (row.workspaceId !== workspaceId || row.providerId !== input.providerId)
      return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection storage returned another workspace')
    if (row.revision !== input.expectedRevision)
      return fail(409, 'REVISION_CONFLICT', 'Connection changed; reload before retrying')
    const credential = decryptCredential(key, row)
    let state: 'verified' | 'failed' | 'unavailable' = 'unavailable'
    try {
      const result = await deps.verify(input.providerId, credential)
      if (['verified', 'failed', 'unavailable'].includes(result)) state = result
    } catch { state = 'unavailable' }
    const testedAt = new Date().toISOString()
    Object.assign(base, {
      p_state: state, p_tested_at: testedAt,
      p_proof: proof(key, { workspaceId, providerId: input.providerId, revision: row.revision, state, testedAt }),
    })
  }
  const result = await deps.command(base)
  if (input.action === 'delete') {
    if (!object(result) || Object.keys(result).sort().join(',') !== 'deleted,providerId,revision'
      || result.deleted !== true || result.providerId !== input.providerId || result.revision !== input.expectedRevision)
      return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection deletion was not confirmed')
    return { deleted: true, providerId: input.providerId, revision: input.expectedRevision }
  }
  if (!object(result)) return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection storage returned an invalid response')
  if (input.action === 'list') {
    if (Object.keys(result).join(',') !== 'connections' || !Array.isArray(result.connections))
      return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection list could not be verified')
    const connections = result.connections.map(item => metadata(item, workspaceId, key))
    if (new Set(connections.map(c => c.providerId)).size !== connections.length)
      return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection list contains duplicates')
    return { connections }
  }
  if (Object.keys(result).join(',') !== 'connection') return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection save was not confirmed')
  const connection = metadata(result.connection, workspaceId, key)
  if (connection.providerId !== input.providerId
    || connection.revision !== (input.action === 'create' ? 1 : input.action === 'replace' ? input.expectedRevision + 1 : input.expectedRevision)
    || ((input.action === 'create' || input.action === 'replace') && connection.state !== 'untested')
    || (input.action === 'test' && connection.state !== base.p_state))
    return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection change was not confirmed')
  return { connection }
}

function settings() {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey || /^sb_secret_/i.test(anonKey)) return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection service is unavailable')
  try {
    const parsed = new URL(url)
    if ((process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
      || !['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/'
      || parsed.username || parsed.password || parsed.search || parsed.hash)
      return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection service is unavailable')
    const jwt = anonKey.split('.')
    if (jwt.length === 3 && JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')).role === 'service_role')
      return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection service is unavailable')
    return { url: parsed.origin, anonKey }
  } catch { return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection service is unavailable') }
}
function tokenFrom(request: IncomingMessage): string {
  const found = (request.headers.cookie ?? '').split(';').filter(x => x.trim().startsWith(`${COOKIE}=`))
  if (found.length !== 1) return fail(401, 'UNAUTHENTICATED', 'Sign in required')
  try {
    const token = decodeURIComponent(found[0].trim().slice(COOKIE.length + 1))
    if (token && token.length <= 8192) return token
  } catch { /* invalid cookie */ }
  return fail(401, 'UNAUTHENTICATED', 'Sign in required')
}
async function supabase(url: string, anonKey: string, token: string, path: string, body?: Json): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    })
  } catch { return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection storage is unavailable') }
  const value = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const code = object(value) && typeof value.code === 'string' ? value.code : ''
    if (response.status === 401) return fail(401, 'UNAUTHENTICATED', 'Sign in required')
    if (code === '42501' || response.status === 403) return fail(403, 'FORBIDDEN', 'Active owner or admin membership required')
    if (code === '40001' || code === '23505') return fail(409, 'REVISION_CONFLICT', 'Connection changed; reload before retrying')
    if (code === 'P0002') return fail(404, 'NOT_FOUND', 'Connection not found')
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code) || response.status === 404)
      return fail(503, 'SCHEMA_UNAVAILABLE', 'Connection schema is unavailable')
    return fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connection storage is unavailable')
  }
  return value
}
async function session(url: string, anonKey: string, token: string, workspaceId: string): Promise<Session> {
  const user = await supabase(url, anonKey, token, '/auth/v1/user')
  if (!object(user) || typeof user.id !== 'string' || !user.id)
    return fail(401, 'UNAUTHENTICATED', 'Sign in required')
  const query = new URLSearchParams({ select: 'workspace_id,role', user_id: `eq.${user.id}`,
    workspace_id: `eq.${workspaceId}` })
  const memberships = await supabase(url, anonKey, token, `/rest/v1/workspace_memberships?${query}`)
  if (!Array.isArray(memberships)) return fail(503, 'STORAGE_RESPONSE_INVALID', 'Membership lookup failed')
  if (!memberships.length) return fail(403, 'FORBIDDEN', 'Active membership required')
  if (memberships.length !== 1) return fail(503, 'STORAGE_RESPONSE_INVALID', 'Membership lookup failed')
  const first = memberships[0]
  if (!object(first) || first.workspace_id !== workspaceId
    || !['owner', 'admin', 'editor', 'viewer'].includes(String(first.role)))
    return fail(503, 'STORAGE_RESPONSE_INVALID', 'Membership lookup failed')
  return { userId: user.id, workspaceId: first.workspace_id, role: String(first.role) }
}
export async function readEncryptedFromDatabase(workspaceId: string, providerId: string): Promise<Encrypted | null> {
  const raw = process.env.AI_CONNECTION_DATABASE_URL
  if (!raw) return fail(503, 'READER_UNAVAILABLE', 'Secure connection reader is not configured')
  try {
    const url = new URL(raw)
    // pg's connection-string parser can override the explicit TLS configuration
    // with sslmode query parameters. Do not accept any URL options.
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password || !url.hostname
      || url.search || url.hash
      || !/^ai_connection_reader(?:\.[a-z0-9]+)?$/.test(url.username))
      return fail(503, 'READER_UNAVAILABLE', 'Secure connection reader is not configured')
  } catch { return fail(503, 'READER_UNAVAILABLE', 'Secure connection reader is not configured') }
  const client = new Client({ connectionString: raw, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000,
    query_timeout: 5000, statement_timeout: 5000 })
  try {
    await client.connect()
    const result = await client.query(
      'select workspace_id, provider_id, revision, ciphertext, nonce, tag, key_version from public.ai_connections where workspace_id = $1 and provider_id = $2',
      [workspaceId, providerId],
    )
    if (result.rows.length > 1) return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection reader returned duplicates')
    if (!result.rows.length) return null
    const row = result.rows[0]
    if (!row || typeof row !== 'object' || row.workspace_id !== workspaceId || row.provider_id !== providerId
      || !Number.isSafeInteger(row.revision) || !Buffer.isBuffer(row.ciphertext)
      || !Buffer.isBuffer(row.nonce) || !Buffer.isBuffer(row.tag) || row.key_version !== 'v1')
      return fail(503, 'STORAGE_RESPONSE_INVALID', 'Connection reader returned invalid data')
    return { workspaceId, providerId, revision: row.revision, ciphertext: row.ciphertext,
      nonce: row.nonce, tag: row.tag, keyVersion: row.key_version }
  } catch (error) {
    if (error instanceof ConnectionError) throw error
    return fail(503, 'READER_UNAVAILABLE', 'Secure connection reader is unavailable')
  } finally { await client.end().catch(() => {}) }
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > LIMIT) { tooLarge = true; reject(new ConnectionError(413, 'REQUEST_TOO_LARGE', 'Connection request is too large')); return }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
      catch { reject(new ConnectionError(400, 'INVALID_REQUEST', 'Invalid JSON request')) }
    })
    request.on('error', () => reject(new ConnectionError(400, 'INVALID_REQUEST', 'Request could not be read')))
  })
}
export async function handleAiConnections(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  const key = encryptionKey()
  const { url, anonKey } = settings()
  const token = tokenFrom(request)
  const input = await readBody(request)
  if (!object(input) || typeof input.workspaceId !== 'string' || !ID.test(input.workspaceId))
    return fail(400, 'INVALID_REQUEST', 'Workspace ID is required')
  const { workspaceId, ...commandInput } = input
  const { role } = await session(url, anonKey, token, workspaceId)
  const result = await executeConnections(commandInput, workspaceId, role, key, {
    command: args => supabase(url, anonKey, token, '/rest/v1/rpc/ai_connection_command', args),
    readEncrypted: readEncryptedFromDatabase,
    // No adapter is configured in this provider-neutral batch. Never pretend a key
    // was verified or call an arbitrary destination supplied by the browser.
    verify: async () => 'unavailable',
  })
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(result))
}
export function sendConnectionError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) return
  const known = error instanceof ConnectionError ? error : new ConnectionError(503, 'CONNECTIONS_UNAVAILABLE', 'Connection service is unavailable')
  response.statusCode = known.status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ code: known.code, error: known.message }))
}