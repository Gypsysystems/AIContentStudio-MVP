import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import path from 'node:path'
import type { MembershipRole } from '../src/ownership'
import {
  ProjectAccessServiceError,
  createProjectAccessService,
  type MembershipLookupResult,
  type ProjectAccessService,
  type ProjectOwnershipDirectory,
  type VerifiedSession,
  type VerifiedSessionVerifier,
  type WorkspaceMembershipLookup,
} from './projectAccess'
import { JsonFileProjectOwnershipDirectory } from './localDevProjectAccess'

const AUTH_PREFIX = '/api/auth/'
const AUTH_ROUTES = new Set(['login', 'logout', 'refresh', 'session', 'profile'])
const ACCESS_COOKIE = 'sb_access_token'
const REFRESH_COOKIE = 'sb_refresh_token'
const MAX_BODY_BYTES = 16 * 1024
const MAX_TOKEN_LENGTH = 8192
const VALID_ROLES = new Set<MembershipRole>(['owner', 'admin', 'editor', 'viewer'])

interface SupabaseConfig {
  url: string
  anonKey: string
}

interface SupabaseUser {
  id: string
  email?: string
}

interface WorkspaceMembership {
  workspace_id: string
  role: MembershipRole
}

interface WorkspaceIdentity {
  organizationName: string
  workspaceName: string
}

interface SupabaseTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

function supabaseConfig(): SupabaseConfig | null {
  const rawUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!rawUrl || !anonKey || !isPublicAnonKey(anonKey)) return null
  try {
    const parsed = new URL(rawUrl)
    if (!['https:', 'http:'].includes(parsed.protocol)
      || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash) return null
    return { url: parsed.origin, anonKey }
  } catch {
    return null
  }
}

function isPublicAnonKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return false
  const jwtParts = key.split('.')
  if (jwtParts.length !== 3) return true
  try {
    const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8')) as unknown
    return !isRecord(payload) || payload.role !== 'service_role'
  } catch {
    return true
  }
}

/** True only when a valid URL and public anon key are both configured. */
export function isSupabaseConfigured(): boolean {
  return supabaseConfig() !== null
}

/** Local identity is opt-in and is never permitted in production. */
export function isLocalDevAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEV_AUTH === 'true'
}

function parseCookies(request: IncomingMessage): Map<string, string> {
  const values = new Map<string, string>()
  const seen = new Set<string>()
  const header = request.headers.cookie
  if (!header) return values
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const encoded = part.slice(separator + 1).trim()
    if (seen.has(name)) {
      values.delete(name)
      seen.add(name)
      continue
    }
    seen.add(name)
    try {
      values.set(name, decodeURIComponent(encoded))
    } catch {
      values.delete(name)
    }
  }
  return values
}

function cookieToken(request: IncomingMessage, name: string): string | null {
  const token = parseCookies(request).get(name)
  return token && token.length <= MAX_TOKEN_LENGTH ? token : null
}

function cookieOptions(request: IncomingMessage): string {
  const secure = process.env.NODE_ENV === 'production' || Boolean((request.socket as { encrypted?: boolean }).encrypted)
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

function setSessionCookies(
  request: IncomingMessage,
  response: ServerResponse,
  tokens: SupabaseTokenResponse,
): void {
  const options = cookieOptions(request)
  response.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${encodeURIComponent(tokens.access_token)}; Max-Age=${Math.max(0, Math.floor(tokens.expires_in))}; ${options}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(tokens.refresh_token)}; ${options}`,
  ])
}

function clearSessionCookies(request: IncomingMessage, response: ServerResponse): void {
  const options = cookieOptions(request)
  response.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=; Max-Age=0; ${options}`,
    `${REFRESH_COOKIE}=; Max-Age=0; ${options}`,
  ])
}

function clearAccessCookie(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Set-Cookie', `${ACCESS_COOKIE}=; Max-Age=0; ${cookieOptions(request)}`)
}

function sendJson(response: ServerResponse, status: number, payload: object): void {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function isSameOrigin(request: IncomingMessage): boolean {
  const originHeader = request.headers.origin
  const host = request.headers.host
  if (typeof originHeader !== 'string' || !host || host !== host.trim() || /[,/@\\\s]/.test(host)) return false
  try {
    const origin = new URL(originHeader)
    const requestAuthority = new URL(`${origin.protocol}//${host}`)
    const hostname = requestAuthority.hostname.toLowerCase()
    const normalizedHostname = hostname.replace(/^\[|\]$/g, '')
    const localHost = normalizedHostname === 'localhost'
      || normalizedHostname === '::1'
      || (isIP(normalizedHostname) === 4 && normalizedHostname.startsWith('127.'))
    const configuredDomain = process.env.REPLIT_DEV_DOMAIN?.trim().split(',')[0]
    const configuredAppOrigin = process.env.APP_ORIGIN
    let trustedDevHost: string | null = null
    if (configuredDomain) {
      try {
        trustedDevHost = new URL(configuredDomain.includes('://') ? configuredDomain : `https://${configuredDomain}`)
          .hostname.toLowerCase()
      } catch {
        trustedDevHost = null
      }
    }
    const schemeAllowed = localHost
      ? origin.protocol === 'http:' || origin.protocol === 'https:'
      : origin.protocol === 'https:'
    const trustedHost = localHost
      || (trustedDevHost !== null && hostname === trustedDevHost)
      || configuredAppOrigin === origin.origin
    return trustedHost
      && schemeAllowed
      && (origin.protocol === 'http:' || origin.protocol === 'https:')
      && originHeader === origin.origin
      && origin.origin === requestAuthority.origin
      && !requestAuthority.username
      && !requestAuthority.password
      && !origin.username
      && !origin.password
  } catch {
    return false
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        reject(new Error('BODY_TOO_LARGE'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      if (tooLarge) return
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    request.on('error', () => reject(new Error('REQUEST_READ_FAILED')))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return null
  }
}

class SupabaseHttpClient {
  private readonly config: SupabaseConfig

  constructor(config: SupabaseConfig) {
    this.config = config
  }

  async call(pathname: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.config.url}${pathname}`, {
      ...init,
      headers: {
        apikey: this.config.anonKey,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })
  }

  async user(accessToken: string): Promise<SupabaseUser | null> {
    let response: Response
    try {
      response = await this.call('/auth/v1/user', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error('SUPABASE_UNAVAILABLE')
    const body = await parseResponse(response)
    if (!isRecord(body) || typeof body.id !== 'string' || body.id.length === 0) return null
    return {
      id: body.id,
      ...(typeof body.email === 'string' ? { email: body.email } : {}),
    }
  }

  async memberships(accessToken: string, userId: string): Promise<WorkspaceMembership[]> {
    const query = new URLSearchParams({
      select: 'workspace_id,role',
      user_id: `eq.${userId}`,
      order: 'workspace_id.asc',
    })
    let response: Response
    try {
      response = await this.call(`/rest/v1/workspace_memberships?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    if (response.status === 401 || response.status === 403) return []
    if (!response.ok) throw new Error('SUPABASE_UNAVAILABLE')
    const body = await parseResponse(response)
    if (!Array.isArray(body)) throw new Error('SUPABASE_UNAVAILABLE')
    const result: WorkspaceMembership[] = []
    for (const item of body) {
      if (!isRecord(item)
        || typeof item.workspace_id !== 'string'
        || typeof item.role !== 'string'
        || !VALID_ROLES.has(item.role as MembershipRole)) {
        throw new Error('SUPABASE_UNAVAILABLE')
      }
      result.push({ workspace_id: item.workspace_id, role: item.role as MembershipRole })
    }
    return result
  }

  async workspaceIdentity(accessToken: string, workspaceId: string): Promise<WorkspaceIdentity> {
    const query = new URLSearchParams({
      select: 'id,name,orgs(name)',
      id: `eq.${workspaceId}`,
      limit: '1',
    })
    let response: Response
    try {
      response = await this.call(`/rest/v1/workspaces?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    if (!response.ok) throw new Error('SUPABASE_UNAVAILABLE')
    const body = await parseResponse(response)
    if (!Array.isArray(body) || body.length !== 1) throw new Error('SUPABASE_UNAVAILABLE')
    const workspace = body[0]
    if (!isRecord(workspace)
      || workspace.id !== workspaceId
      || typeof workspace.name !== 'string'
      || !workspace.name.trim()
      || !isRecord(workspace.orgs)
      || typeof workspace.orgs.name !== 'string'
      || !workspace.orgs.name.trim()) throw new Error('SUPABASE_UNAVAILABLE')
    return {
      organizationName: workspace.orgs.name,
      workspaceName: workspace.name,
    }
  }

  async tokenGrant(grant: 'password' | 'refresh_token', body: Record<string, unknown>): Promise<SupabaseTokenResponse | null> {
    let response: Response
    try {
      response = await this.call(`/auth/v1/token?grant_type=${grant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    const payload = await parseResponse(response)
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) return null
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    if (!isRecord(payload)
      || typeof payload.access_token !== 'string'
      || typeof payload.refresh_token !== 'string'
      || typeof payload.expires_in !== 'number'
      || !Number.isFinite(payload.expires_in)
      || payload.expires_in <= 0
      || payload.access_token.length > MAX_TOKEN_LENGTH
      || payload.refresh_token.length > MAX_TOKEN_LENGTH) {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_in: payload.expires_in,
    }
  }

  async logout(accessToken: string): Promise<void> {
    try {
      await this.call('/auth/v1/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      // Local cookies are still cleared even if remote revocation is unavailable.
    }
  }
}

class SupabaseSessionVerifier implements VerifiedSessionVerifier {
  constructor(private readonly client: SupabaseHttpClient) {}

  async verify(request: IncomingMessage): Promise<VerifiedSession | null> {
    const accessToken = cookieToken(request, ACCESS_COOKIE)
    if (!accessToken) return null
    const user = await this.client.user(accessToken)
    if (!user) return null
    const memberships = await this.client.memberships(accessToken, user.id)
    const firstMembership = memberships[0]
    if (!firstMembership) {
      throw new ProjectAccessServiceError(
        403,
        'MEMBERSHIP_INACTIVE',
        'An active workspace membership is required',
      )
    }
    return {
      userId: user.id,
      activeWorkspaceId: firstMembership.workspace_id,
      // Supabase validates every request; this bounded value satisfies the
      // existing service contract without trusting client/JWT expiry claims.
      expiresAt: Date.now() + 30_000,
    }
  }
}

class SupabaseMembershipLookup implements WorkspaceMembershipLookup {
  constructor(private readonly client: SupabaseHttpClient) {}

  async lookup(
    userId: string,
    workspaceId: string,
    request?: IncomingMessage,
  ): Promise<MembershipLookupResult> {
    const accessToken = request ? cookieToken(request, ACCESS_COOKIE) : null
    if (!accessToken) return { status: 'missing' }
    const query = new URLSearchParams({
      select: 'workspace_id,role',
      user_id: `eq.${userId}`,
      workspace_id: `eq.${workspaceId}`,
      limit: '1',
    })
    let response: Response
    try {
      response = await this.client.call(`/rest/v1/workspace_memberships?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new Error('SUPABASE_UNAVAILABLE')
    }
    if (response.status === 401 || response.status === 403) return { status: 'missing' }
    if (!response.ok) throw new Error('SUPABASE_UNAVAILABLE')
    const body = await parseResponse(response)
    if (!Array.isArray(body)) throw new Error('SUPABASE_UNAVAILABLE')
    if (body.length === 0) return { status: 'missing' }
    const row = body[0]
    if (!isRecord(row)
      || row.workspace_id !== workspaceId
      || typeof row.role !== 'string'
      || !VALID_ROLES.has(row.role as MembershipRole)) throw new Error('SUPABASE_UNAVAILABLE')
    return { status: 'active', role: row.role as MembershipRole }
  }
}

/**
 * Factory for plugin integration. Returns null unless both server-only
 * SUPABASE_URL and SUPABASE_ANON_KEY are present and valid.
 */
export function createSupabaseProjectAccessService(): ProjectAccessService | null {
  const config = supabaseConfig()
  if (!config) return null
  const client = new SupabaseHttpClient(config)
  const membershipLookup = new SupabaseMembershipLookup(client)
  const verifier: VerifiedSessionVerifier = new SupabaseSessionVerifier(client)
  const directory: ProjectOwnershipDirectory = new JsonFileProjectOwnershipDirectory(
    path.join(process.cwd(), '.local', 'project-access-metadata.json'),
  )
  return createProjectAccessService({
    sessionVerifier: verifier,
    membershipLookup,
    projectDirectory: directory,
  })
}

function extractPasswordCredentials(value: unknown): { email: string; password: string } | null {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['email', 'password'].includes(key))
    || typeof value.email !== 'string'
    || typeof value.password !== 'string'
    || !value.email.trim()
    || value.email.length > 320
    || value.password.length === 0
    || value.password.length > 1024) return null
  return { email: value.email.trim(), password: value.password }
}

function authError(response: ServerResponse, error: unknown): void {
  const code = error instanceof Error ? error.message : ''
  if (code === 'BODY_TOO_LARGE') {
    sendJson(response, 413, { error: 'Request body exceeds the 16 KB limit', code })
  } else if (code === 'INVALID_JSON') {
    sendJson(response, 400, { error: 'Request body must be valid JSON', code })
  } else if (code === 'REQUEST_READ_FAILED') {
    sendJson(response, 400, { error: 'Could not read request body', code })
  } else if (code === 'SUPABASE_UNAVAILABLE') {
    sendJson(response, 503, { error: 'Authentication provider is unavailable', code })
  } else {
    sendJson(response, 503, { error: 'Authentication provider is unavailable', code: 'AUTH_PROVIDER_UNAVAILABLE' })
  }
}

async function handleLocalDevAuth(route: string, response: ServerResponse): Promise<void> {
  if (route === 'profile') {
    sendJson(response, 403, { error: 'Local development has no persisted cloud profile', code: 'PROFILE_CLOUD_ONLY' })
    return
  }
  const profile = {
    authenticated: route !== 'logout',
    mode: 'local-dev',
    userId: route === 'logout' ? null : 'local-user',
    workspaceIds: route === 'logout' ? [] : ['local-workspace'],
  }
  sendJson(response, 200, profile)
}

async function handleProfileRoute(
  input: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  client: SupabaseHttpClient,
): Promise<void> {
  if (!isRecord(input) || (input.action !== 'read' && input.action !== 'update')
    || Object.keys(input).some(key => !['action', 'displayName', 'expectedUpdatedAt'].includes(key))
    || (input.action === 'read' && Object.keys(input).length !== 1)
    || (input.action === 'update' && (typeof input.displayName !== 'string'
      || typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 80
      || !Number.isFinite(Date.parse(input.expectedUpdatedAt))))) {
    sendJson(response, 400, { error: 'Invalid profile request', code: 'INVALID_PROFILE_REQUEST' })
    return
  }
  const displayName = input.action === 'update' ? (input.displayName as string).trim() : null
  if (input.action === 'update' && (!displayName || displayName.length > 100)) {
    sendJson(response, 400, { error: 'Display name must contain 1 to 100 characters', code: 'INVALID_DISPLAY_NAME' })
    return
  }
  const token = cookieToken(request, ACCESS_COOKIE)
  const user = token ? await client.user(token) : null
  if (!token || !user) {
    sendJson(response, 401, { error: 'Sign in to manage your profile', code: 'UNAUTHENTICATED' })
    return
  }
  // Reread membership on every request. No browser-supplied user or role is trusted.
  if (!(await client.memberships(token, user.id)).length) {
    sendJson(response, 403, { error: 'An active workspace membership is required', code: 'MEMBERSHIP_INACTIVE' })
    return
  }
  const query = new URLSearchParams({
    select: 'id,display_name,updated_at',
    id: `eq.${user.id}`,
    ...(input.action === 'update' ? { updated_at: `eq.${input.expectedUpdatedAt as string}` } : { limit: '1' }),
  })
  const result = await client.call(`/rest/v1/profiles?${query}`, {
    method: input.action === 'update' ? 'PATCH' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(input.action === 'update' ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
    },
    ...(input.action === 'update' ? { body: JSON.stringify({ display_name: displayName }) } : {}),
  })
  if (result.status === 401 || result.status === 403) {
    sendJson(response, result.status, { error: 'Profile access is not authorized', code: 'PROFILE_FORBIDDEN' })
    return
  }
  if (!result.ok) {
    sendJson(response, 503, { error: 'Profile settings could not be saved or loaded', code: 'PROFILE_UNAVAILABLE' })
    return
  }
  const rows = await parseResponse(result)
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])
    || rows[0].id !== user.id
    || (rows[0].display_name !== null && typeof rows[0].display_name !== 'string')
    || typeof rows[0].updated_at !== 'string' || !rows[0].updated_at) {
    sendJson(response, input.action === 'update' && Array.isArray(rows) && rows.length === 0 ? 409 : 503, {
      error: input.action === 'update' && Array.isArray(rows) && rows.length === 0
        ? 'Profile changed since it was loaded. Reload before saving.'
        : 'Profile settings could not be confirmed',
      code: input.action === 'update' && Array.isArray(rows) && rows.length === 0 ? 'PROFILE_CONFLICT' : 'PROFILE_UNAVAILABLE',
    })
    return
  }
  sendJson(response, 200, { displayName: rows[0].display_name, updatedAt: rows[0].updated_at })
}

async function handleSupabaseRoute(
  route: string,
  request: IncomingMessage,
  response: ServerResponse,
  client: SupabaseHttpClient,
): Promise<void> {
  const input = await readJsonBody(request)
  if (route === 'profile') {
    await handleProfileRoute(input, request, response, client)
    return
  }

  if (route === 'logout') {
    const accessToken = cookieToken(request, ACCESS_COOKIE)
    if (accessToken) await client.logout(accessToken)
    clearSessionCookies(request, response)
    sendJson(response, 200, { authenticated: false, mode: 'supabase' })
    return
  }

  let tokens: SupabaseTokenResponse | null = null
  if (route === 'login') {
    const credentials = extractPasswordCredentials(input)
    if (!credentials) {
      sendJson(response, 400, { error: 'Email and password are required', code: 'INVALID_CREDENTIALS' })
      return
    }
    tokens = await client.tokenGrant('password', credentials)
  } else if (route === 'refresh') {
    const refreshToken = cookieToken(request, REFRESH_COOKIE)
    if (refreshToken) tokens = await client.tokenGrant('refresh_token', { refresh_token: refreshToken })
  } else if (route === 'session') {
    const accessToken = cookieToken(request, ACCESS_COOKIE)
    if (!accessToken) {
      sendJson(response, 401, { authenticated: false, mode: 'supabase', code: 'UNAUTHENTICATED' })
      return
    }
    const user = await client.user(accessToken)
    if (!user) {
      clearAccessCookie(request, response)
      sendJson(response, 401, { authenticated: false, mode: 'supabase', code: 'UNAUTHENTICATED' })
      return
    }
    const memberships = await client.memberships(accessToken, user.id)
    if (memberships.length === 0) {
      clearSessionCookies(request, response)
      sendJson(response, 403, {
        authenticated: false,
        mode: 'supabase',
        error: 'An active workspace membership is required',
        code: 'MEMBERSHIP_INACTIVE',
      })
      return
    }
    const activeWorkspace = memberships[0]
    const identity = await client.workspaceIdentity(accessToken, activeWorkspace.workspace_id)
    sendJson(response, 200, {
      authenticated: true,
      mode: 'supabase',
      userId: user.id,
      workspaceIds: memberships.map(({ workspace_id }) => workspace_id),
      activeWorkspaceId: activeWorkspace.workspace_id,
      activeRole: activeWorkspace.role,
      activeOrganizationName: identity.organizationName,
      activeWorkspaceName: identity.workspaceName,
    })
    return
  }

  if (!tokens) {
    if (route === 'refresh') clearSessionCookies(request, response)
    sendJson(response, 401, {
      authenticated: false,
      mode: 'supabase',
      error: route === 'login' ? 'Email or password is incorrect' : 'Session is not authenticated',
      code: route === 'login' ? 'INVALID_CREDENTIALS' : 'UNAUTHENTICATED',
    })
    return
  }

  const user = await client.user(tokens.access_token)
  if (!user) {
    clearSessionCookies(request, response)
    sendJson(response, 401, { authenticated: false, mode: 'supabase', code: 'UNAUTHENTICATED' })
    return
  }
  const memberships = await client.memberships(tokens.access_token, user.id)
  if (memberships.length === 0) {
    clearSessionCookies(request, response)
    sendJson(response, 403, {
      authenticated: false,
      mode: 'supabase',
      error: 'An active workspace membership is required',
      code: 'MEMBERSHIP_INACTIVE',
    })
    return
  }
  const activeWorkspace = memberships[0]
  const identity = await client.workspaceIdentity(tokens.access_token, activeWorkspace.workspace_id)
  setSessionCookies(request, response, tokens)
  sendJson(response, 200, {
    authenticated: true,
    mode: 'supabase',
    userId: user.id,
    workspaceIds: memberships.map(({ workspace_id }) => workspace_id),
    activeWorkspaceId: activeWorkspace.workspace_id,
    activeRole: activeWorkspace.role,
    activeOrganizationName: identity.organizationName,
    activeWorkspaceName: identity.workspaceName,
  })
}

/**
 * Handles the auth API endpoints and returns false for all unrelated paths.
 * Every route is a same-origin JSON POST. Tokens are never returned in JSON.
 */
export async function handleSupabaseAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const pathname = request.url?.split('?', 1)[0]
  if (!pathname?.startsWith(AUTH_PREFIX)) return false
  const route = pathname.slice(AUTH_PREFIX.length)
  if (!AUTH_ROUTES.has(route)) return false
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
    return true
  }
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: 'Same-origin request required', code: 'ORIGIN_REJECTED' })
    return true
  }
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    sendJson(response, 415, { error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' })
    return true
  }
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
    request.resume()
    sendJson(response, 413, { error: 'Request body exceeds the 16 KB limit', code: 'BODY_TOO_LARGE' })
    return true
  }
  if (!isSupabaseConfigured() && !isLocalDevAllowed()) {
    sendJson(response, 503, {
      error: 'Supabase authentication is not configured',
      code: 'AUTH_PROVIDER_UNAVAILABLE',
    })
    return true
  }
  try {
    if (!isSupabaseConfigured() && isLocalDevAllowed()) {
      // The local profile is available only through explicit non-production opt-in.
      await handleLocalDevAuth(route, response)
    } else {
      const config = supabaseConfig()
      if (!config) {
        sendJson(response, 503, {
          error: 'Supabase authentication is not configured',
          code: 'AUTH_PROVIDER_UNAVAILABLE',
        })
      } else {
        await handleSupabaseRoute(route, request, response, new SupabaseHttpClient(config))
      }
    }
  } catch (error) {
    authError(response, error)
  }
  return true
}