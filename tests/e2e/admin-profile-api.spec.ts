import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'
import { handleSupabaseAuthRequest } from '../../server/supabaseProjectAccess'

test.describe('session-bound profile settings API', () => {
  test.describe.configure({ mode: 'serial' })

  const config = { url: 'https://supabase.test', anonKey: 'public-anon-for-test' }
  const timestamp = '2026-09-26T12:00:00+00:00'

  async function request(body: unknown, cookie = 'sb_access_token=alice-token') {
    const req = new EventEmitter() as EventEmitter & Partial<IncomingMessage>
    req.url = '/api/auth/profile'
    req.method = 'POST'
    req.headers = { host: 'localhost:4173', origin: 'http://localhost:4173',
      'content-type': 'application/json', cookie }
    req.socket = {} as IncomingMessage['socket']
    req.resume = () => req as IncomingMessage
    queueMicrotask(() => { req.emit('data', JSON.stringify(body)); req.emit('end') })
    let result: { status: number; body: Record<string, unknown> } | null = null
    const response = {
      statusCode: 0,
      setHeader() {},
      end(value: string) {
        result = { status: this.statusCode, body: JSON.parse(value) as Record<string, unknown> }
      },
    } as unknown as ServerResponse
    expect(await handleSupabaseAuthRequest(req as IncomingMessage, response)).toBe(true)
    if (!result) throw new Error('Profile route did not respond')
    return result as { status: number; body: Record<string, unknown> }
  }

  async function withProvider(run: (calls: Array<{ path: string; method: string; query: URLSearchParams }>) => Promise<void>,
    options: { membership?: boolean; patchStatus?: number; conflict?: boolean } = {}) {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY,
      local: process.env.LOCAL_DEV_AUTH, mode: process.env.NODE_ENV }
    const originalFetch = globalThis.fetch
    process.env.SUPABASE_URL = config.url
    process.env.SUPABASE_ANON_KEY = config.anonKey
    delete process.env.LOCAL_DEV_AUTH
    process.env.NODE_ENV = 'test'
    const calls: Array<{ path: string; method: string; query: URLSearchParams }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      const method = init?.method ?? 'GET'
      calls.push({ path: url.pathname, method, query: url.searchParams })
      expect(headers.get('apikey')).toBe(config.anonKey)
      expect(headers.get('authorization')).toBe('Bearer alice-token')
      if (url.pathname === '/auth/v1/user') return Response.json({ id: 'alice' })
      if (url.pathname === '/rest/v1/workspace_memberships') {
        expect(url.searchParams.get('user_id')).toBe('eq.alice')
        return Response.json(options.membership === false ? [] : [{ workspace_id: 'workspace', role: 'viewer' }])
      }
      if (url.pathname === '/rest/v1/profiles') {
        expect(url.searchParams.get('id')).toBe('eq.alice')
        expect(url.searchParams.get('select')).toBe('id,display_name,updated_at')
        if (method === 'PATCH') {
          expect(headers.get('prefer')).toBe('return=representation')
          expect(url.searchParams.get('updated_at')).toBe(`eq.${timestamp}`)
          expect(JSON.parse(String(init?.body))).toEqual({ display_name: 'Alice Cooper' })
          if (options.patchStatus) return Response.json({ message: 'denied' }, { status: options.patchStatus })
          return Response.json(options.conflict ? [] : [{
            id: 'alice', display_name: 'Alice Cooper', updated_at: '2026-09-26T12:05:00+00:00',
          }])
        }
        return Response.json([{ id: 'alice', display_name: 'Alice', updated_at: timestamp }])
      }
      throw new Error(`Unexpected provider request ${url.pathname}`)
    }) as typeof fetch
    try { await run(calls) } finally {
      globalThis.fetch = originalFetch
      if (previous.url === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = previous.url
      if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY
      else process.env.SUPABASE_ANON_KEY = previous.key
      if (previous.local === undefined) delete process.env.LOCAL_DEV_AUTH
      else process.env.LOCAL_DEV_AUTH = previous.local
      if (previous.mode === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous.mode
    }
  }

  test('reads and updates only the cookie-authenticated self profile, confirming the returned row', async () => {
    await withProvider(async calls => {
      expect(await request({ action: 'read' })).toEqual({
        status: 200, body: { displayName: 'Alice', updatedAt: timestamp },
      })
      expect(await request({ action: 'update', displayName: '  Alice Cooper  ', expectedUpdatedAt: timestamp }))
        .toEqual({ status: 200, body: { displayName: 'Alice Cooper', updatedAt: '2026-09-26T12:05:00+00:00' } })
      expect(calls.filter(call => call.method === 'PATCH').map(call => call.path)).toEqual(['/rest/v1/profiles'])
      expect(calls.some(call => /workspace_memberships|workspaces|orgs/.test(call.path) && call.method !== 'GET')).toBe(false)
    })
  })

  test('rejects arbitrary user IDs and invalid, empty, or overlong names without profile writes', async () => {
    await withProvider(async calls => {
      const invalid = [
        { action: 'read', userId: 'bob' },
        { action: 'update', userId: 'bob', displayName: 'Alice Cooper', expectedUpdatedAt: timestamp },
        { action: 'update', displayName: '', expectedUpdatedAt: timestamp },
        { action: 'update', displayName: '  ', expectedUpdatedAt: timestamp },
        { action: 'update', displayName: 'a'.repeat(101), expectedUpdatedAt: timestamp },
        { action: 'update', displayName: 123, expectedUpdatedAt: timestamp },
        { action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: 'not-a-timestamp' },
      ]
      for (const body of invalid) expect((await request(body)).status).toBe(400)
      expect(calls).toHaveLength(0)
    })
  })

  test('fails closed without a verified session or active membership', async () => {
    await withProvider(async calls => {
      expect((await request({ action: 'read' }, '')).status).toBe(401)
      expect(calls).toHaveLength(0)
    })
    await withProvider(async calls => {
      expect((await request({ action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: timestamp })).status).toBe(403)
      expect(calls.some(call => call.path === '/rest/v1/profiles')).toBe(false)
    }, { membership: false })
  })

  test('never reports success when RLS denies the write or the profile changed', async () => {
    await withProvider(async () => {
      expect((await request({ action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: timestamp })).status).toBe(403)
    }, { patchStatus: 403 })
    await withProvider(async () => {
      expect(await request({ action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: timestamp }))
        .toMatchObject({ status: 409, body: { code: 'PROFILE_CONFLICT' } })
    }, { conflict: true })
  })

  test('local development rejects profile writes rather than inventing a saved setting', async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY,
      local: process.env.LOCAL_DEV_AUTH, mode: process.env.NODE_ENV }
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    process.env.LOCAL_DEV_AUTH = 'true'
    process.env.NODE_ENV = 'test'
    try {
      expect(await request({ action: 'update', displayName: 'Alice Cooper', expectedUpdatedAt: timestamp }))
        .toMatchObject({ status: 403, body: { code: 'PROFILE_CLOUD_ONLY' } })
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = previous.url
      if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY
      else process.env.SUPABASE_ANON_KEY = previous.key
      if (previous.local === undefined) delete process.env.LOCAL_DEV_AUTH
      else process.env.LOCAL_DEV_AUTH = previous.local
      if (previous.mode === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous.mode
    }
  })
})