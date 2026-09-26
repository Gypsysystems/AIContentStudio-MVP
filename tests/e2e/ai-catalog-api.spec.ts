import { expect, test } from '@playwright/test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAiCatalog, sendAiCatalogError } from '../../server/aiCatalogApi'
import { isSameOriginRequest } from '../../server/projectAccessPlugin'

const workspaceId = 'api-workspace-alpha'
const userId = 'api-user-alpha'
const sessionToken = 'opaque-test-session'
const anonKey = 'public-test-anon-key'

function asset(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId,
    id: 'api-blueprint',
    kind: 'blueprint',
    version: 1,
    state: 'draft',
    name: 'API blueprint',
    description: '',
    definition: { contentType: 'User Guide', sections: [] },
    createdAt: '2026-09-26T12:00:00.000Z',
    createdBy: userId,
    ...overrides,
  }
}

function requestFor(body: unknown, cookie = `sb_access_token=${encodeURIComponent(sessionToken)}`) {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage
  Object.assign(request, { headers: { cookie, host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' } })
  return request
}

function responseRecorder() {
  const headers = new Map<string, string>()
  const target = {
    statusCode: 200,
    body: '',
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end(body?: string) { target.body = body ?? '' },
  }
  return {
    headers,
    response: target as unknown as ServerResponse & { body: string },
  }
}

function withSupabaseConfig<T>(work: () => Promise<T>, key = anonKey) {
  const before = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    nodeEnv: process.env.NODE_ENV,
  }
  process.env.SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_ANON_KEY = key
  process.env.NODE_ENV = 'test'
  return work().finally(() => {
    if (before.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = before.url
    if (before.key === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = before.key
    if (before.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before.nodeEnv
  })
}

async function withMockFetch<T>(mock: (url: string, init?: RequestInit) => Response | Promise<Response>, work: () => Promise<T>) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    mock(String(input), init)) as typeof fetch
  try {
    return await work()
  } finally {
    globalThis.fetch = original
  }
}

async function invokeApi(body: unknown) {
  const recorded = responseRecorder()
  await handleAiCatalog(requestFor(body), recorded.response)
  return { ...recorded, statusCode: recorded.response.statusCode, body: JSON.parse(recorded.response.body) }
}

test('cloud API uses a same-origin endpoint and forwards only a server session, not browser identity claims', async ({ page }) => {
  const calls: { url: string; method: string | null; body: unknown; origin: string | undefined }[] = []
  await page.route('**/api/ai-catalog', async route => {
    calls.push({
      url: route.request().url(),
      method: route.request().method(),
      body: route.request().postDataJSON(),
      origin: (await route.request().allHeaders()).origin,
    })
    await route.fulfill({ json: calls.length === 1 ? { assets: [] } : { assets: [{
      workspaceId: 'different-workspace',
      id: 'foreign-blueprint',
      kind: 'blueprint',
      version: 1,
      state: 'draft',
      name: 'Foreign workspace asset',
      description: '',
      definition: { contentType: 'User Guide', sections: [] },
      createdAt: '2026-09-26T12:00:00.000Z',
      createdBy: 'other-user',
    }] } })
  })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [auth, projectMode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/aiCatalogRepository.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'browser-claim-user' },
      workspace: { id: 'browser-claim-workspace' },
      membership: { userId: 'browser-claim-user', workspaceId: 'browser-claim-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(true)
    return repository.listAiAssets()
  })
  expect(result).toEqual([])
  expect(calls).toHaveLength(1)
  expect(new URL(calls[0].url).origin).toBe(new URL(page.url()).origin)
  expect(calls[0].method).toBe('POST')
  expect(calls[0].body).toEqual({ action: 'list' })
  expect(JSON.stringify(calls[0].body)).not.toMatch(/browser-claim|workspace|role|token/i)
  expect(calls[0].origin).toBe(new URL(page.url()).origin)
  const rejectedForeignAsset = await page.evaluate(async () => {
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    try {
      await repository.listAiAssets()
      return false
    } catch (error) {
      return error instanceof Error && /workspace scope/.test(error.message)
    }
  })
  expect(rejectedForeignAsset).toBe(true)
  expect(calls).toHaveLength(2)
  expect(calls[1].body).toEqual({ action: 'list' })
})

test('server resolves workspace from cookie identity and never accepts a client workspace claim', async () => {
  await withSupabaseConfig(() => withMockFetch(async (url, init) => {
    if (url.endsWith('/auth/v1/user')) {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${sessionToken}`)
      return Response.json({ id: userId })
    }
    if (url.includes('/rest/v1/workspace_memberships?')) {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${sessionToken}`)
      return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
    }
    if (url.endsWith('/rest/v1/rpc/ai_catalog_command')) {
      const rpc = JSON.parse(String(init?.body))
      expect(rpc.p_workspace_id).toBe(workspaceId)
      return Response.json({ assets: [asset()] })
    }
    throw new Error(`Unexpected Supabase request: ${url}`)
  }, async () => {
    const result = await invokeApi({ action: 'list' })
    expect(result.statusCode).toBe(200)
    expect(result.body.assets).toEqual([asset()])
    expect(result.headers.get('cache-control')).toBe('no-store')
  }))

  const calls: string[] = []
  await withSupabaseConfig(() => withMockFetch(async url => {
    calls.push(url)
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
    if (url.includes('/rest/v1/workspace_memberships?')) return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
    throw new Error('A forged workspace must be rejected before an RPC')
  }, async () => {
    const recorded = responseRecorder()
    const error = await handleAiCatalog(requestFor({ action: 'list', workspaceId: 'attacker-workspace' }), recorded.response)
      .then(() => null, value => value)
    sendAiCatalogError(recorded.response, error)
    expect(recorded.response.statusCode).toBe(400)
    expect(JSON.parse(recorded.response.body)).toMatchObject({ code: 'UNEXPECTED_FIELD' })
    expect(calls.some(url => url.includes('/rpc/'))).toBe(false)
  }))
})

test('cookie session is mandatory and secret or service-role keys fail closed', async () => {
  let fetchCount = 0
  const mock = async () => {
    fetchCount++
    return Response.json({ id: userId })
  }
  await withSupabaseConfig(() => withMockFetch(mock, async () => {
    const missingCookie = responseRecorder()
    const unauthenticated = await handleAiCatalog(requestFor({ action: 'list' }, ''), missingCookie.response)
      .then(() => null, value => value)
    sendAiCatalogError(missingCookie.response, unauthenticated)
    expect(missingCookie.response.statusCode).toBe(401)
    expect(JSON.parse(missingCookie.response.body)).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fetchCount).toBe(0)
  }))
  await withSupabaseConfig(() => withMockFetch(mock, async () => {
    const unavailable = responseRecorder()
    const error = await handleAiCatalog(requestFor({ action: 'list' }), unavailable.response)
      .then(() => null, value => value)
    sendAiCatalogError(unavailable.response, error)
    expect(unavailable.response.statusCode).toBe(503)
    expect(JSON.parse(unavailable.response.body)).toMatchObject({ code: 'AI_CATALOG_UNAVAILABLE' })
    expect(fetchCount).toBe(0)
  }), 'sb_secret_not-a-public-key')
})

test('workspace membership role is sent to authoritative storage and denied writes never report success', async () => {
  for (const role of ['owner', 'admin'] as const) {
    await withSupabaseConfig(() => withMockFetch(async (url, init) => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
      if (url.includes('/rest/v1/workspace_memberships?')) return Response.json([{ workspace_id: workspaceId, role }])
      if (url.endsWith('/rest/v1/rpc/ai_catalog_command')) {
        const rpc = JSON.parse(String(init?.body))
        expect(rpc.p_workspace_id).toBe(workspaceId)
        expect(rpc.p_action).toBe('create')
        return Response.json({ asset: asset({ id: `created-${role}` }) })
      }
      throw new Error(`Unexpected Supabase request: ${url}`)
    }, async () => {
      const recorded = responseRecorder()
      await handleAiCatalog(requestFor({
        action: 'create',
        asset: { kind: 'blueprint', name: `Created by ${role}`, description: '',
          definition: { contentType: 'User Guide', sections: [] } },
      }), recorded.response)
      expect(recorded.response.statusCode).toBe(200)
      expect(JSON.parse(recorded.response.body).asset.id).toBe(`created-${role}`)
    }))
  }

  await withSupabaseConfig(() => withMockFetch(async url => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
    if (url.includes('/rest/v1/workspace_memberships?')) return Response.json([{ workspace_id: workspaceId, role: 'editor' }])
    if (url.endsWith('/rest/v1/rpc/ai_catalog_command'))
      return Response.json({ code: '42501', message: 'role denied' }, { status: 403 })
    throw new Error(`Unexpected Supabase request: ${url}`)
  }, async () => {
    const recorded = responseRecorder()
    const error = await handleAiCatalog(requestFor({
      action: 'create',
      asset: { kind: 'blueprint', name: 'Denied editor create', description: '',
        definition: { contentType: 'User Guide', sections: [] } },
    }), recorded.response).then(() => null, value => value)
    sendAiCatalogError(recorded.response, error)
    expect(recorded.response.statusCode).toBe(403)
    expect(JSON.parse(recorded.response.body)).toMatchObject({ code: 'FORBIDDEN' })
    expect(recorded.response.body).not.toContain('saved')
  }))
})

test('same-origin validation rejects forged origins and ignores untrusted forwarded-host substitution', () => {
  const base = { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }
  expect(isSameOriginRequest({ headers: base } as unknown as IncomingMessage)).toBe(true)
  expect(isSameOriginRequest({ headers: { ...base, origin: 'https://attacker.example' } } as unknown as IncomingMessage)).toBe(false)
  expect(isSameOriginRequest({ headers: { ...base, origin: 'http://user@127.0.0.1:4173' } } as unknown as IncomingMessage)).toBe(false)
  expect(isSameOriginRequest({
    headers: { ...base, 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' },
  } as unknown as IncomingMessage)).toBe(true)
  expect(isSameOriginRequest({
    headers: { host: 'attacker.example', origin: base.origin, 'x-forwarded-host': '127.0.0.1:4173' },
  } as unknown as IncomingMessage)).toBe(false)
})