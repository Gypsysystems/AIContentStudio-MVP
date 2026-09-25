import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'
import { createSupabaseProjectAccessService, handleSupabaseAuthRequest } from '../../server/supabaseProjectAccess'

const SUPABASE_URL = 'https://supabase.test'
const ANON_KEY = 'test-public-anon-key'
const USER_ID = 'provider-test-user'
const WORKSPACE_ID = 'provider-test-workspace'

test.describe('Supabase project-access provider integration', () => {
  test.describe.configure({ mode: 'serial' })

  function withSupabaseConfig(): () => void {
    const previous = {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      localDevAuth: process.env.LOCAL_DEV_AUTH,
      nodeEnv: process.env.NODE_ENV,
    }
    process.env.SUPABASE_URL = SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = ANON_KEY
    delete process.env.LOCAL_DEV_AUTH
    process.env.NODE_ENV = 'test'
    return () => {
      if (previous.url === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = previous.url
      if (previous.anonKey === undefined) delete process.env.SUPABASE_ANON_KEY
      else process.env.SUPABASE_ANON_KEY = previous.anonKey
      if (previous.localDevAuth === undefined) delete process.env.LOCAL_DEV_AUTH
      else process.env.LOCAL_DEV_AUTH = previous.localDevAuth
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous.nodeEnv
    }
  }

  function setFetch(
    implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ): () => void {
    const original = globalThis.fetch
    globalThis.fetch = implementation as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  function httpRequest(options: {
    url?: string
    method?: string
    headers?: IncomingMessage['headers']
    body?: unknown
  } = {}): IncomingMessage {
    const request = new EventEmitter() as EventEmitter & Partial<IncomingMessage>
    request.url = options.url ?? '/api/auth/session'
    request.method = options.method ?? 'POST'
    request.headers = {
      host: 'localhost:4173',
      origin: 'http://localhost:4173',
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    }
    request.socket = {} as IncomingMessage['socket']
    request.resume = () => request as IncomingMessage
    const body = JSON.stringify(options.body ?? {})
    queueMicrotask(() => {
      request.emit('data', body)
      request.emit('end')
    })
    return request as IncomingMessage
  }

  async function callAuth(
    request: IncomingMessage,
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Map<string, unknown> }> {
    const headers = new Map<string, unknown>()
    let responseBody = ''
    let status = 0
    const response = {
      statusCode: 0,
      setHeader(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value)
      },
      end(body?: string) {
        responseBody = body ?? ''
        status = this.statusCode
      },
      get headersSent() {
        return responseBody.length > 0
      },
    } as unknown as ServerResponse
    await handleSupabaseAuthRequest(request, response)
    return { status, body: JSON.parse(responseBody) as Record<string, unknown>, headers }
  }

  function cookieValue(setCookie: unknown, name: string): string {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    const cookie = cookies.find((entry) => typeof entry === 'string' && entry.startsWith(`${name}=`))
    if (typeof cookie !== 'string') throw new Error(`Missing ${name} cookie`)
    return decodeURIComponent(cookie.split(';', 1)[0].slice(name.length + 1))
  }

  test('login sets HttpOnly cookies and a cookie-authenticated request verifies through Supabase', async () => {
    const restoreEnv = withSupabaseConfig()
    const calls: Array<{ url: URL; init: RequestInit }> = []
    const restoreFetch = setFetch(async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      if (url.pathname === '/auth/v1/token') {
        expect(url.searchParams.get('grant_type')).toBe('password')
        expect(JSON.parse(String(init.body))).toEqual({ email: 'member@example.test', password: 'not-a-real-secret' })
        return new Response(JSON.stringify({
          access_token: 'request-access-token',
          refresh_token: 'request-refresh-token',
          expires_in: 3600,
        }), { status: 200 })
      }
      if (url.pathname === '/auth/v1/user') {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer request-access-token')
        return new Response(JSON.stringify({ id: USER_ID, email: 'member@example.test' }), { status: 200 })
      }
      if (url.pathname === '/rest/v1/workspace_memberships') {
        expect(url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`)
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer request-access-token')
        return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'owner' }]), { status: 200 })
      }
      if (url.pathname === '/rest/v1/workspaces') {
        expect(url.searchParams.get('id')).toBe(`eq.${WORKSPACE_ID}`)
        expect(url.searchParams.get('select')).toBe('id,name,orgs(name)')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer request-access-token')
        return new Response(JSON.stringify([{
          id: WORKSPACE_ID,
          name: 'AI Content Studio',
          orgs: { name: 'GypsySystems' },
        }]), { status: 200 })
      }
      throw new Error(`Unexpected Supabase endpoint ${url.pathname}`)
    })
    try {
      const login = await callAuth(httpRequest({
        url: '/api/auth/login',
        body: { email: 'member@example.test', password: 'not-a-real-secret' },
      }))
      expect(login.status).toBe(200)
      expect(login.body).toMatchObject({
        authenticated: true,
        userId: USER_ID,
        activeWorkspaceId: WORKSPACE_ID,
        activeOrganizationName: 'GypsySystems',
        activeWorkspaceName: 'AI Content Studio',
      })
      expect(JSON.stringify(login.body)).not.toContain('request-access-token')
      const setCookie = login.headers.get('set-cookie')
      expect(setCookie).toEqual(expect.arrayContaining([
        expect.stringContaining('sb_access_token='),
        expect.stringContaining('sb_refresh_token='),
      ]))
      expect((setCookie as string[]).every((cookie) => cookie.includes('HttpOnly'))).toBe(true)

      const service = createSupabaseProjectAccessService()
      expect(service).not.toBeNull()
      const result = await service!.execute(
        { action: 'list' },
        { headers: { cookie: `sb_access_token=${encodeURIComponent(cookieValue(setCookie, 'sb_access_token'))}` } } as IncomingMessage,
      )
      expect(result).toEqual({ projectIds: [] })
      expect(calls.map(({ url }) => url.pathname)).toEqual([
        '/auth/v1/token',
        '/auth/v1/user',
        '/rest/v1/workspace_memberships',
        '/rest/v1/workspaces',
        '/auth/v1/user',
        '/rest/v1/workspace_memberships',
        '/rest/v1/workspace_memberships',
      ])
      for (const { init } of calls) {
        const headers = new Headers(init.headers)
        expect(headers.get('apikey')).toBe(ANON_KEY)
        expect(headers.get('apikey')).not.toMatch(/service.?role|secret/i)
        expect(headers.get('authorization') ?? '').not.toContain('service_role')
        expect(init.cache).toBe('no-store')
      }
      await expect(service!.execute(
        { action: 'list', userId: USER_ID, role: 'owner' },
        { headers: { cookie: 'sb_access_token=request-access-token' } } as IncomingMessage,
      )).rejects.toMatchObject({ code: 'UNEXPECTED_FIELD' })
    } finally {
      restoreFetch()
      restoreEnv()
    }
  })

  test('workspace identity must be visible through the member token before cookies are issued', async () => {
    const restoreEnv = withSupabaseConfig()
    const restoreFetch = setFetch(async (input) => {
      const pathname = new URL(String(input)).pathname
      if (pathname === '/auth/v1/token') return new Response(JSON.stringify({
        access_token: 'member-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }), { status: 200 })
      if (pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: USER_ID }), { status: 200 })
      if (pathname === '/rest/v1/workspace_memberships')
        return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'owner' }]), { status: 200 })
      if (pathname === '/rest/v1/workspaces') return new Response('[]', { status: 200 })
      throw new Error(`Unexpected Supabase endpoint ${pathname}`)
    })
    try {
      const login = await callAuth(httpRequest({
        url: '/api/auth/login',
        body: { email: 'member@example.test', password: 'not-a-real-secret' },
      }))
      expect(login.status).toBe(503)
      expect(login.body).toMatchObject({ code: 'SUPABASE_UNAVAILABLE' })
      expect(login.headers.has('set-cookie')).toBe(false)
    } finally {
      restoreFetch()
      restoreEnv()
    }
  })

  test('each request is verified with its own cookie and current membership role', async () => {
    const restoreEnv = withSupabaseConfig()
    const restoreFetch = setFetch(async (input, init = {}) => {
      const url = new URL(String(input))
      if (url.pathname !== '/auth/v1/user' && url.pathname !== '/rest/v1/workspace_memberships') {
        throw new Error(`Unexpected Supabase endpoint ${url.pathname}`)
      }
      const token = new Headers(init.headers).get('authorization')?.replace('Bearer ', '')
      if (url.pathname === '/auth/v1/user') {
        if (token === 'expired-token') return new Response('{}', { status: 401 })
        if (token === 'alice-token') return new Response(JSON.stringify({ id: 'alice' }), { status: 200 })
        if (token === 'bob-token') return new Response(JSON.stringify({ id: 'bob' }), { status: 200 })
        return new Response('{}', { status: 401 })
      }
      expect(url.searchParams.get('user_id')).toBe(`eq.${token === 'alice-token' ? 'alice' : 'bob'}`)
      if (token === 'bob-token') return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'viewer' }]), { status: 200 })
      return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'owner' }]), { status: 200 })
    })
    try {
      const service = createSupabaseProjectAccessService()!
      const aliceRequest = { headers: { cookie: 'sb_access_token=alice-token' } } as IncomingMessage
      const bobRequest = { headers: { cookie: 'sb_access_token=bob-token' } } as IncomingMessage

      const created = await service.execute({ action: 'create', projectId: 'provider-role-change-project' }, aliceRequest)
      expect(created).toMatchObject({ ownerUserId: 'alice', workspaceId: WORKSPACE_ID })
      await expect(service.execute(
        { action: 'create', projectId: 'viewer-must-not-create' },
        bobRequest,
      )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
      await expect(service.execute(
        { action: 'list' },
        { headers: { cookie: 'sb_access_token=expired-token' } } as IncomingMessage,
      )).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

      const revoked = setFetch(async (input, init = {}) => {
        const url = new URL(String(input))
        if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'alice' }), { status: 200 })
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer alice-token')
        return new Response('[]', { status: 200 })
      })
      try {
        await expect(service.execute({ action: 'list' }, aliceRequest))
          .rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_INACTIVE' })
      } finally {
        revoked()
      }

      // The current role is looked up again rather than retained from Alice's first request.
      const restoredRole = setFetch(async (input, init = {}) => {
        const url = new URL(String(input))
        if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'alice' }), { status: 200 })
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer alice-token')
        return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'viewer' }]), { status: 200 })
      })
      try {
        await expect(service.execute(
          { action: 'create', projectId: 'role-downgrade-project' },
          aliceRequest,
        )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
      } finally {
        restoredRole()
      }

      // Remove the unique metadata entry created in this test using the real service path.
      const ownerAgain = setFetch(async (input) => {
        const url = new URL(String(input))
        if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'alice' }), { status: 200 })
        return new Response(JSON.stringify([{ workspace_id: WORKSPACE_ID, role: 'owner' }]), { status: 200 })
      })
      try {
        await service.execute({ action: 'delete-complete', projectId: 'provider-role-change-project' }, aliceRequest)
      } finally {
        ownerAgain()
      }
    } finally {
      restoreFetch()
      restoreEnv()
    }
  })

  test('provider failures fail closed and missing configuration requires explicit local-dev opt-in', async () => {
    const restoreEnv = withSupabaseConfig()
    const restoreFetch = setFetch(async () => {
      throw new Error('provider offline')
    })
    try {
      const service = createSupabaseProjectAccessService()!
      await expect(service.execute(
        { action: 'list' },
        { headers: { cookie: 'sb_access_token=valid-looking-token' } } as IncomingMessage,
      )).rejects.toMatchObject({ status: 503, code: 'SESSION_VERIFIER_UNAVAILABLE' })
      const authFailure = await callAuth(httpRequest({ url: '/api/auth/session', headers: { cookie: 'sb_access_token=token' } }))
      expect(authFailure.status).toBe(503)
      expect(authFailure.body).toMatchObject({ code: 'SUPABASE_UNAVAILABLE' })
    } finally {
      restoreFetch()
      restoreEnv()
    }

    const previous = {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      localDevAuth: process.env.LOCAL_DEV_AUTH,
      nodeEnv: process.env.NODE_ENV,
    }
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.LOCAL_DEV_AUTH
    process.env.NODE_ENV = 'test'
    try {
      expect(createSupabaseProjectAccessService()).toBeNull()
      const unavailable = await callAuth(httpRequest({ url: '/api/auth/session' }))
      expect(unavailable.status).toBe(503)
      expect(unavailable.body).toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' })

      process.env.LOCAL_DEV_AUTH = 'true'
      const local = await callAuth(httpRequest({
        url: '/api/auth/session',
        body: { userId: 'browser-forgery', role: 'owner' },
      }))
      expect(local.status).toBe(200)
      expect(local.body).toEqual({
        authenticated: true,
        mode: 'local-dev',
        userId: 'local-user',
        workspaceIds: ['local-workspace'],
      })

      process.env.NODE_ENV = 'production'
      const production = await callAuth(httpRequest({ url: '/api/auth/session' }))
      expect(production.status).toBe(503)
      expect(production.body).toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' })
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = previous.url
      if (previous.anonKey === undefined) delete process.env.SUPABASE_ANON_KEY
      else process.env.SUPABASE_ANON_KEY = previous.anonKey
      if (previous.localDevAuth === undefined) delete process.env.LOCAL_DEV_AUTH
      else process.env.LOCAL_DEV_AUTH = previous.localDevAuth
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous.nodeEnv
    }
  })
})