import { expect, test } from '@playwright/test'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSupabaseAuthRequest } from '../../server/supabaseProjectAccess'

interface FakeResponse {
  statusCode: number
  body: string
  headers: Map<string, string | string[]>
}

function makeRequest(url: string, cookie: string): PassThrough & IncomingMessage {
  const request = new PassThrough() as PassThrough & Partial<IncomingMessage>
  Object.assign(request, {
    url,
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4173',
      host: '127.0.0.1:4173',
      'content-type': 'application/json',
      cookie,
    },
    socket: { encrypted: false },
  })
  return request as PassThrough & IncomingMessage
}

function makeResponse(): { response: ServerResponse; state: FakeResponse } {
  const state: FakeResponse = { statusCode: 200, body: '', headers: new Map() }
  const response = {
    get statusCode() {
      return state.statusCode
    },
    set statusCode(value: number) {
      state.statusCode = value
    },
    setHeader(name: string, value: string | number | string[]) {
      state.headers.set(name.toLowerCase(), String(value))
    },
    end(body?: string) {
      state.body = body ?? ''
    },
    get headersSent() {
      return Boolean(state.body)
    },
  } as unknown as ServerResponse
  return { response, state }
}

async function invokeAuthEndpoint(url: string, cookie: string): Promise<FakeResponse> {
  const request = makeRequest(url, cookie)
  const { response, state } = makeResponse()
  const handled = handleSupabaseAuthRequest(request, response)
  request.end('{}')
  expect(await handled).toBe(true)
  return state
}

test('rejected access token preserves refresh cookie for successful refresh', async () => {
  const previousUrl = process.env.SUPABASE_URL
  const previousAnonKey = process.env.SUPABASE_ANON_KEY
  const previousNodeEnv = process.env.NODE_ENV
  const previousFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://supabase.example'
  process.env.SUPABASE_ANON_KEY = 'public-anon-key'
  process.env.NODE_ENV = 'test'

  const refreshRequests: Array<{ url: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/v1/user')) {
      const authorization = new Headers(init?.headers).get('Authorization')
      if (authorization === 'Bearer expired-access') {
        return new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 })
      }
      if (authorization === 'Bearer fresh-access') {
        return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 })
      }
      throw new Error(`Unexpected auth user token: ${authorization}`)
    }
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
      const body = String(init?.body ?? '')
      refreshRequests.push({ url, body })
      return new Response(JSON.stringify({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      }), { status: 200 })
    }
    if (url.includes('/rest/v1/workspace_memberships?')) {
      return new Response(JSON.stringify([{ workspace_id: 'workspace-123', role: 'owner' }]), { status: 200 })
    }
    if (url.includes('/rest/v1/workspaces?')) {
      return new Response(JSON.stringify([{
        id: 'workspace-123',
        name: 'AI Content Studio',
        orgs: { name: 'GypsySystems' },
      }]), { status: 200 })
    }
    throw new Error(`Unexpected Supabase request: ${url}`)
  }

  try {
    const rejectedSession = await invokeAuthEndpoint(
      '/api/auth/session',
      'sb_access_token=expired-access; sb_refresh_token=still-valid-refresh',
    )
    expect(rejectedSession.statusCode).toBe(401)
    const rejectedSetCookie = rejectedSession.headers.get('set-cookie')
    expect(rejectedSetCookie).toContain('sb_access_token=; Max-Age=0')
    expect(rejectedSetCookie).not.toContain('sb_refresh_token')

    const refreshed = await invokeAuthEndpoint(
      '/api/auth/refresh',
      'sb_refresh_token=still-valid-refresh',
    )
    expect(refreshed.statusCode).toBe(200)
    expect(JSON.parse(refreshed.body)).toMatchObject({
      authenticated: true,
      mode: 'supabase',
      userId: 'user-123',
      activeWorkspaceId: 'workspace-123',
      activeOrganizationName: 'GypsySystems',
      activeWorkspaceName: 'AI Content Studio',
    })
    expect(refreshRequests).toEqual([{
      url: 'https://supabase.example/auth/v1/token?grant_type=refresh_token',
      body: JSON.stringify({ refresh_token: 'still-valid-refresh' }),
    }])
    expect(refreshed.headers.get('set-cookie')).toContain('sb_refresh_token=rotated-refresh')
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousUrl
    if (previousAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = previousAnonKey
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})