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

async function invokeApiError(body: unknown) {
  const recorded = responseRecorder()
  const error = await handleAiCatalog(requestFor(body), recorded.response).then(() => null, value => value)
  sendAiCatalogError(recorded.response, error)
  return { statusCode: recorded.response.statusCode, body: JSON.parse(recorded.response.body) }
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
      return error instanceof repository.AiCatalogApiError && error.code === 'FOREIGN_WORKSPACE'
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
        return Response.json({
          asset: asset({
            ...rpc.p_payload,
            id: `created-${role}`,
          }),
        })
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

test('API maps storage, membership, conflict, reference, and outage failures to safe codes', async () => {
  const responseFor = async (failure: string) => withSupabaseConfig(() => withMockFetch(async url => {
    if (failure === 'service-outage' && url.endsWith('/rest/v1/rpc/ai_catalog_command'))
      throw new Error('upstream details must not leak')
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
    if (url.includes('/rest/v1/workspace_memberships?')) {
      if (failure === 'schema-outage')
        return Response.json({ code: 'PGRST205', message: 'missing table internal details' }, { status: 404 })
      return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
    }
    if (url.endsWith('/rest/v1/rpc/ai_catalog_command')) {
      const errors: Record<string, [string, number, string]> = {
        'role-denial': ['42501', 403, 'Owner or admin role required'],
        'revoked-membership': ['42501', 403, 'Active workspace membership required'],
        conflict: ['40001', 409, 'stale internal details'],
        'invalid-reference': ['22023', 400, 'Workflow references must resolve to exact versions'],
        'schema-outage': ['PGRST202', 404, 'missing function internal details'],
      }
      const [code, status, message] = errors[failure]
      return Response.json({ code, message }, { status })
    }
    throw new Error(`Unexpected Supabase request: ${url}`)
  }, () => invokeApiError({ action: 'list' })))
  const expected: Record<string, [number, string]> = {
    'role-denial': [403, 'FORBIDDEN'],
    'revoked-membership': [403, 'MEMBERSHIP_INACTIVE'],
    conflict: [409, 'VERSION_CONFLICT'],
    'invalid-reference': [400, 'WORKFLOW_REFERENCE_INVALID'],
    'schema-outage': [503, 'AI_CATALOG_SCHEMA_UNAVAILABLE'],
    'service-outage': [503, 'AI_CATALOG_UNAVAILABLE'],
  }
  for (const [failure, [status, code]] of Object.entries(expected)) {
    const result = await responseFor(failure)
    expect(result.statusCode).toBe(status)
    expect(result.body).toMatchObject({ code })
    expect(JSON.stringify(result.body)).not.toMatch(/internal details|upstream details/)
  }
})

test('API rejects foreign and malformed successful storage rows without forwarding them', async () => {
  for (const invalidAsset of [
    asset({ workspaceId: 'foreign-workspace' }),
    asset({ definition: { contentType: 'Unknown', sections: [] } }),
    asset({ version: '1' }),
  ]) {
    await withSupabaseConfig(() => withMockFetch(async url => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
      if (url.includes('/rest/v1/workspace_memberships?'))
        return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
      if (url.endsWith('/rest/v1/rpc/ai_catalog_command'))
        return Response.json({ assets: [invalidAsset] })
      throw new Error(`Unexpected Supabase request: ${url}`)
    }, async () => {
      const result = await invokeApiError({ action: 'list' })
      expect(result.statusCode).toBe(503)
      expect(result.body).toMatchObject({ code: 'STORAGE_RESPONSE_INVALID' })
      expect(JSON.stringify(result.body)).not.toContain('foreign-workspace')
    }))
  }
  for (const malformed of ['envelope', 'json']) {
    await withSupabaseConfig(() => withMockFetch(async url => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId })
      if (url.includes('/rest/v1/workspace_memberships?'))
        return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
      if (url.endsWith('/rest/v1/rpc/ai_catalog_command')) {
        return malformed === 'envelope'
          ? Response.json({ assets: 'not-an-array' })
          : new Response('{bad-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected Supabase request: ${url}`)
    }, async () => {
      const result = await invokeApiError({ action: 'list' })
      expect(result.statusCode).toBe(503)
      expect(result.body).toMatchObject({ code: 'STORAGE_RESPONSE_INVALID' })
    }))
  }
})

test('cloud repository performs immutable lifecycle for all four asset kinds and reloads history', async ({ page }) => {
  await page.goto('/')
  const workspace = 'client-cloud-workspace'
  const histories = new Map<string, Record<string, unknown>[]>()
  let nextId = 1
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON() as {
      action: string
      id?: string
      expectedVersion?: number
      state?: string
      asset?: { kind: string; name: string; description: string; definition: Record<string, unknown> }
    }
    if (command.action === 'list') {
      const assets = [...histories.values()].map(history => history[history.length - 1])
        .filter(item => item.state !== 'archived')
      await route.fulfill({ json: { assets } })
      return
    }
    if (command.action === 'history') {
      await route.fulfill({ json: { versions: histories.get(command.id!) ?? [] } })
      return
    }
    let record: Record<string, unknown>
    if (command.action === 'create') {
      record = {
        workspaceId: workspace, id: `cloud-asset-${nextId++}`, ...command.asset,
        version: 1, state: 'draft', createdAt: '2026-09-26T12:00:00.000Z', createdBy: 'test-user',
      }
      histories.set(String(record.id), [record])
    } else {
      const history = histories.get(command.id!)!
      const latest = history[history.length - 1]
      record = {
        ...latest,
        version: Number(command.expectedVersion) + 1,
        state: command.action === 'delete' ? 'archived' : command.action === 'transition' ? command.state : 'draft',
        ...(command.action === 'revise' ? command.asset : {}),
        createdAt: '2026-09-26T12:00:00.000Z',
      }
      history.push(record)
    }
    await route.fulfill({ json: { asset: record } })
  })

  const result = await page.evaluate(async () => {
    const auth = await import('/src/authSession.ts' as string)
    const projectMode = await import('/src/authorizedProjectService.ts' as string)
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    auth.setCloudAuthSession({
      user: { id: 'test-user' },
      workspace: { id: 'client-cloud-workspace' },
      membership: { userId: 'test-user', workspaceId: 'client-cloud-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(true)
    const inputs = [
      { kind: 'workflow', name: 'Workflow', description: '',
        definition: { capability: 'draft', model: { mode: 'auto' }, promptPack: null, referenceSet: null, blueprint: null, steps: [] } },
      { kind: 'prompt-pack', name: 'Prompt pack', description: '', definition: { prompts: [] } },
      { kind: 'reference-set', name: 'Reference set', description: '', definition: { entries: [] } },
      { kind: 'blueprint', name: 'Blueprint', description: '',
        definition: { contentType: 'Quick Start', sections: [] } },
    ] as const
    const runs = []
    for (const input of inputs) {
      const created = await repository.executeAiCatalog({ action: 'create', asset: input })
      const revised = await repository.executeAiCatalog({
        action: 'revise', id: created.id, expectedVersion: created.version,
        asset: { ...input, name: `${input.name} revised` },
      })
      const tested = await repository.executeAiCatalog({
        action: 'transition', id: revised.id, expectedVersion: revised.version, state: 'test',
      })
      const published = await repository.executeAiCatalog({
        action: 'transition', id: tested.id, expectedVersion: tested.version, state: 'published',
      })
      const archived = await repository.executeAiCatalog({
        action: 'delete', id: published.id, expectedVersion: published.version,
      })
      runs.push({
        kind: input.kind, created, revised, tested, published, archived,
        history: await repository.historyAiAsset(created.id),
      })
    }
    projectMode.setCloudProjectMode(false)
    return runs
  })
  expect(result).toHaveLength(4)
  for (const run of result) {
    expect(run.created).toMatchObject({ version: 1, state: 'draft', kind: run.kind })
    expect(run.revised).toMatchObject({ version: 2, state: 'draft' })
    expect(run.tested).toMatchObject({ version: 3, state: 'test' })
    expect(run.published).toMatchObject({ version: 4, state: 'published' })
    expect(run.archived).toMatchObject({ version: 5, state: 'archived' })
    expect(run.history.map(asset => asset.version)).toEqual([1, 2, 3, 4, 5])
  }
  await page.reload()
  const reload = await page.evaluate(async () => {
    const auth = await import('/src/authSession.ts' as string)
    const projectMode = await import('/src/authorizedProjectService.ts' as string)
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    auth.setCloudAuthSession({
      user: { id: 'test-user' },
      workspace: { id: 'client-cloud-workspace' },
      membership: { userId: 'test-user', workspaceId: 'client-cloud-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(true)
    const list = await repository.listAiAssets()
    const histories = await Promise.all([1, 2, 3, 4].map(index =>
      repository.historyAiAsset(`cloud-asset-${index}`)))
    projectMode.setCloudProjectMode(false)
    return { list, histories }
  })
  expect(reload.list).toEqual([])
  expect(reload.histories).toHaveLength(4)
  expect(reload.histories.every(history => history.map(asset => asset.version).join(',') === '1,2,3,4,5')).toBe(true)
})

test('cloud repository exposes typed safe errors and rejects malformed or foreign upstream data', async ({ page }) => {
  await page.goto('/')
  const listFailures = ['schema-outage', 'revoked-membership', 'unavailable-fetch', 'foreign-row', 'malformed-row']
  let listFailureIndex = 0
  const cloudAsset = {
    workspaceId: 'client-error-workspace',
    id: 'error-blueprint',
    kind: 'blueprint',
    version: 1,
    state: 'draft',
    name: 'Error blueprint',
    description: '',
    definition: { contentType: 'Quick Start', sections: [] },
    createdAt: '2026-09-26T12:00:00.000Z',
    createdBy: 'test-user',
  }
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON() as {
      action: string
      asset?: { name?: string }
    }
    const failure = command.action === 'list'
      ? listFailures[listFailureIndex++]
      : command.action === 'revise' ? 'conflict'
        : command.asset?.name === 'Role denial' ? 'role-denial'
          : command.asset?.name === 'Invalid reference' ? 'invalid-reference'
            : command.asset?.name === 'Bad confirmation' ? 'bad-confirmation' : ''
    if (failure === 'unavailable-fetch') {
      await route.abort('failed')
      return
    }
    if (command.action === 'history') {
      await route.fulfill({ json: { versions: [cloudAsset] } })
      return
    }
    if (failure === 'foreign-row') {
      await route.fulfill({ json: { assets: [{ ...cloudAsset, workspaceId: 'outside-workspace' }] } })
      return
    }
    if (failure === 'malformed-row') {
      await route.fulfill({ json: { assets: [{ ...cloudAsset, definition: { invalid: true } }] } })
      return
    }
    if (failure === 'bad-confirmation') {
      await route.fulfill({ json: { asset: { ...cloudAsset, id: 'different-id', name: 'Changed by server' } } })
      return
    }
    const errors: Record<string, { status: number; code: string; error: string }> = {
      'role-denial': { status: 403, code: 'FORBIDDEN', error: 'do not expose upstream details' },
      conflict: { status: 409, code: 'VERSION_CONFLICT', error: 'stale upstream detail' },
      'invalid-reference': { status: 400, code: 'WORKFLOW_REFERENCE_INVALID', error: 'invalid upstream detail' },
      'schema-outage': { status: 503, code: 'AI_CATALOG_SCHEMA_UNAVAILABLE', error: 'schema internals' },
      'revoked-membership': { status: 403, code: 'MEMBERSHIP_INACTIVE', error: 'membership internals' },
    }
    const error = errors[failure]
    await route.fulfill({ status: error.status, json: { code: error.code, error: error.error } })
  })
  const results = await page.evaluate(async () => {
    const auth = await import('/src/authSession.ts' as string)
    const projectMode = await import('/src/authorizedProjectService.ts' as string)
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    auth.setCloudAuthSession({
      user: { id: 'test-user' },
      workspace: { id: 'client-error-workspace' },
      membership: { userId: 'test-user', workspaceId: 'client-error-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(true)
    const readFailure = async (scenario: string) => {
      try {
        if (scenario === 'conflict') {
          await repository.executeAiCatalog({
            action: 'revise', id: 'error-blueprint', expectedVersion: 1,
            asset: { kind: 'blueprint', name: 'Revised', description: '',
              definition: { contentType: 'Quick Start', sections: [] } },
          })
        } else if (scenario === 'role-denial' || scenario === 'invalid-reference' || scenario === 'bad-confirmation') {
          const asset = scenario === 'invalid-reference'
            ? { kind: 'workflow', name: 'Invalid reference', description: '',
              definition: { capability: 'draft', model: { mode: 'auto' }, promptPack: null,
                referenceSet: null, blueprint: null, steps: [] } }
            : { kind: 'blueprint', name: scenario === 'role-denial' ? 'Role denial' : 'Bad confirmation', description: '',
              definition: { contentType: 'Quick Start', sections: [] } }
          await repository.executeAiCatalog({ action: 'create', asset })
        } else {
          await repository.listAiAssets()
        }
        return null
      } catch (error) {
        return {
          typed: error instanceof repository.AiCatalogApiError,
          code: error instanceof repository.AiCatalogApiError ? error.code : '',
          status: error instanceof repository.AiCatalogApiError ? error.status : -1,
          message: error instanceof Error ? error.message : '',
        }
      }
    }
    const output: Record<string, unknown> = {}
    for (const scenario of [
      'role-denial', 'conflict', 'invalid-reference', 'schema-outage', 'revoked-membership',
      'unavailable-fetch', 'foreign-row', 'malformed-row', 'bad-confirmation',
    ]) {
      output[scenario] = await readFailure(scenario)
    }
    projectMode.setCloudProjectMode(false)
    return output
  })
  const expected: Record<string, [string, number]> = {
    'role-denial': ['FORBIDDEN', 403],
    conflict: ['VERSION_CONFLICT', 409],
    'invalid-reference': ['WORKFLOW_REFERENCE_INVALID', 400],
    'schema-outage': ['AI_CATALOG_SCHEMA_UNAVAILABLE', 503],
    'revoked-membership': ['MEMBERSHIP_INACTIVE', 403],
    'unavailable-fetch': ['API_UNAVAILABLE', 0],
    'foreign-row': ['FOREIGN_WORKSPACE', 503],
    'malformed-row': ['STORAGE_RESPONSE_INVALID', 503],
    'bad-confirmation': ['BAD_CONFIRMATION', 503],
  }
  for (const [scenario, [code, status]] of Object.entries(expected)) {
    expect(results[scenario]).toMatchObject({ typed: true, code, status })
    expect((results[scenario] as { message: string }).message).not.toMatch(/internal|upstream|schema internals|stale upstream/)
  }
})

test('cloud preflight validation and malformed envelopes always reject with typed API errors', async ({ page }) => {
  await page.goto('/')
  const blueprint = {
    workspaceId: 'preflight-workspace',
    id: 'preflight-blueprint',
    kind: 'blueprint',
    version: 1,
    state: 'draft',
    name: 'Preflight blueprint',
    description: '',
    definition: { contentType: 'Quick Start', sections: [] },
    createdAt: '2026-09-26T12:00:00.000Z',
    createdBy: 'test-user',
  }
  let historyIndex = 0
  let mutationCalls = 0
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON() as { action: string }
    if (command.action !== 'history') {
      mutationCalls++
      await route.fulfill({ status: 500, json: { code: 'AI_CATALOG_UNAVAILABLE' } })
      return
    }
    const history = historyIndex++ === 3
      ? [blueprint, { ...blueprint, version: 2, state: 'archived' }]
      : [blueprint]
    await route.fulfill({ json: { versions: history } })
  })
  const preflight = await page.evaluate(async () => {
    const auth = await import('/src/authSession.ts' as string)
    const projectMode = await import('/src/authorizedProjectService.ts' as string)
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    auth.setCloudAuthSession({
      user: { id: 'test-user' },
      workspace: { id: 'preflight-workspace' },
      membership: { userId: 'test-user', workspaceId: 'preflight-workspace', role: 'owner' },
    })
    projectMode.setCloudProjectMode(true)
    const capture = async (operation: () => Promise<unknown>) => {
      try {
        await operation()
        return null
      } catch (error) {
        return {
          typed: error instanceof repository.AiCatalogApiError,
          code: error instanceof repository.AiCatalogApiError ? error.code : '',
          message: error instanceof Error ? error.message : '',
        }
      }
    }
    const results = [
      await capture(() => repository.executeAiCatalog({
        action: 'revise', id: 'preflight-blueprint', expectedVersion: 2,
        asset: { kind: 'blueprint', name: 'Stale', description: '',
          definition: { contentType: 'Quick Start', sections: [] } },
      })),
      await capture(() => repository.executeAiCatalog({
        action: 'revise', id: 'preflight-blueprint', expectedVersion: 1,
        asset: { kind: 'prompt-pack', name: 'Wrong kind', description: '', definition: { prompts: [] } },
      })),
      await capture(() => repository.executeAiCatalog({
        action: 'transition', id: 'preflight-blueprint', expectedVersion: 1, state: 'draft',
      })),
      await capture(() => repository.executeAiCatalog({
        action: 'delete', id: 'preflight-blueprint', expectedVersion: 2,
      })),
    ]
    projectMode.setCloudProjectMode(false)
    return results
  })
  expect(preflight.map(error => error?.code)).toEqual([
    'VERSION_CONFLICT', 'INVALID_REVISION', 'INVALID_TRANSITION', 'INVALID_TRANSITION',
  ])
  expect(preflight.every(error => error?.typed)).toBe(true)
  expect(mutationCalls).toBe(0)

  await page.unroute('**/api/ai-catalog')
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON() as { action: string }
    await route.fulfill({
      json: command.action === 'list' ? { assets: 'invalid-envelope' } : { versions: {} },
    })
  })
  const malformed = await page.evaluate(async () => {
    const projectMode = await import('/src/authorizedProjectService.ts' as string)
    const repository = await import('/src/aiCatalogRepository.ts' as string)
    projectMode.setCloudProjectMode(true)
    const capture = async (operation: () => Promise<unknown>) => {
      try {
        await operation()
        return null
      } catch (error) {
        return {
          typed: error instanceof repository.AiCatalogApiError,
          code: error instanceof repository.AiCatalogApiError ? error.code : '',
        }
      }
    }
    const results = [
      await capture(() => repository.listAiAssets()),
      await capture(() => repository.historyAiAsset('preflight-blueprint')),
    ]
    projectMode.setCloudProjectMode(false)
    return results
  })
  expect(malformed).toEqual([
    { typed: true, code: 'STORAGE_RESPONSE_INVALID' },
    { typed: true, code: 'STORAGE_RESPONSE_INVALID' },
  ])
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