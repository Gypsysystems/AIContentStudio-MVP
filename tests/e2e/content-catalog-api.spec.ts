import { expect, test } from '@playwright/test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  handleContentCatalog,
  sendContentCatalogError,
} from '../../server/contentCatalogApi'

const workspaceId = '123e4567-e89b-42d3-a456-426614174000'
const itemId = '223e4567-e89b-42d3-a456-426614174000'
const projectId = 'workspace-project'
const sessionToken = 'content-catalog-session'
const anonKey = 'public-test-anon-key'

function requestFor(body: unknown, cookie = `sb_access_token=${encodeURIComponent(sessionToken)}`) {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage
  Object.assign(request, {
    headers: {
      cookie,
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      'content-type': 'application/json',
    },
  })
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

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId,
    workspace_id: workspaceId,
    project_id: projectId,
    asset_type: 'topic',
    local_asset_id: 'local-topic-1',
    display_name: 'Aster',
    status: 'active',
    current_version: 3,
    current_hash: 'sha256-current',
    origin_item_id: null,
    origin_project_id: null,
    origin_version: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-02T12:00:00.000Z',
    ...overrides,
  }
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId,
    version: 2,
    workspace_id: workspaceId,
    project_id: projectId,
    content_hash: 'sha256-version-2',
    payload: { bio: 'Aster', traits: ['curious'] },
    source_project_revision: 42,
    created_by: null,
    created_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

async function withConfig<T>(work: () => Promise<T>) {
  const before = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    nodeEnv: process.env.NODE_ENV,
  }
  process.env.SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_ANON_KEY = anonKey
  process.env.NODE_ENV = 'test'
  try {
    return await work()
  } finally {
    if (before.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = before.url
    if (before.key === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = before.key
    if (before.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before.nodeEnv
  }
}

async function withMockFetch<T>(
  mock: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    mock(new URL(String(input)), init)) as typeof fetch
  try {
    return await work()
  } finally {
    globalThis.fetch = original
  }
}

async function invoke(body: unknown, cookie?: string) {
  const recorded = responseRecorder()
  const error = await handleContentCatalog(requestFor(body, cookie), recorded.response)
    .then(() => null, value => value)
  if (error) sendContentCatalogError(recorded.response, error)
  return {
    statusCode: recorded.response.statusCode,
    headers: recorded.headers,
    body: JSON.parse(recorded.response.body),
  }
}

function identityFetch(role: string, resource: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return async (url: URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (url.pathname === '/auth/v1/user') {
      expect(headers.get('authorization')).toBe(`Bearer ${sessionToken}`)
      expect(headers.get('apikey')).toBe(anonKey)
      return Response.json({ id: 'user-1' })
    }
    if (url.pathname === '/rest/v1/workspace_memberships') {
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      expect(url.searchParams.get('user_id')).toBe('eq.user-1')
      return Response.json([{ workspace_id: workspaceId, role }])
    }
    if (url.pathname === '/rest/v1/workspace_role_permissions') {
      expect(url.searchParams.get('role')).toBe(`eq.${role}`)
      expect(url.searchParams.get('permission')).toBe('eq.read')
      return Response.json([{ permission: 'read' }])
    }
    return resource(url, init)
  }
}

test('list returns bounded active metadata and never selects payload or cloud project records', async () => {
  await withConfig(() => withMockFetch(identityFetch('viewer', url => {
    expect(url.pathname).toBe('/rest/v1/content_catalog_items')
    expect(url.searchParams.get('select')).not.toMatch(/payload|record/i)
    expect(url.searchParams.get('select')).toContain('display_name')
    expect(url.searchParams.get('select')).toContain('current_hash')
    expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
    expect(url.searchParams.get('project_id')).toBe(`eq.${projectId}`)
    expect(url.searchParams.get('asset_type')).toBe('eq.topic')
    expect(url.searchParams.get('display_name')).toBe('ilike."*Aster*"')
    expect(url.searchParams.get('status')).toBe('eq.active')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('offset')).toBe('10')
    return Response.json([itemRow({ payload: { shouldNeverReturn: true } })])
  }), async () => {
    const result = await invoke({
      action: 'list', workspaceId, projectId, assetType: 'topic',
      search: 'Aster', limit: 20, offset: 10,
    })
    expect(result.statusCode).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.body).toEqual({ items: [{
      itemId, workspaceId, projectId, assetType: 'topic',
      localAssetId: 'local-topic-1', displayName: 'Aster', status: 'active',
      currentVersion: 3, currentHash: 'sha256-current',
      originItemId: null, originProjectId: null, originVersion: null,
      createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-02T12:00:00.000Z',
    }] })
  }))
})

test('exact version is scoped to the verified workspace and item before payload is returned', async () => {
  const queries: URL[] = []
  await withConfig(() => withMockFetch(identityFetch('editor', url => {
    queries.push(url)
    if (url.pathname === '/rest/v1/content_catalog_items') {
      expect(url.searchParams.get('item_id')).toBe(`eq.${itemId}`)
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      expect(url.searchParams.get('select')).not.toMatch(/payload|record/i)
      return Response.json([itemRow()])
    }
    expect(url.pathname).toBe('/rest/v1/content_catalog_versions')
    expect(url.searchParams.get('item_id')).toBe(`eq.${itemId}`)
    expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
    expect(url.searchParams.get('version')).toBe('eq.2')
    expect(url.searchParams.get('select')).toContain('payload')
    expect(url.searchParams.get('select')).not.toMatch(/record/i)
    return Response.json([versionRow()])
  }), async () => {
    const result = await invoke({ action: 'version', workspaceId, itemId, version: 2 })
    expect(result.statusCode).toBe(200)
    expect(result.body.item.itemId).toBe(itemId)
    expect(result.body.version).toEqual({
      itemId, version: 2, workspaceId, projectId,
      contentHash: 'sha256-version-2',
      payload: { bio: 'Aster', traits: ['curious'] },
      sourceProjectRevision: 42, createdBy: null,
      createdAt: '2026-10-01T12:00:00.000Z',
    })
    expect(queries.map(query => query.pathname)).toEqual([
      '/rest/v1/content_catalog_items',
      '/rest/v1/content_catalog_versions',
    ])
  }))
})

test('cross-workspace membership and item/version scope do not disclose catalog rows', async () => {
  let catalogCalls = 0
  await withConfig(() => withMockFetch(async url => {
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'user-1' })
    if (url.pathname === '/rest/v1/workspace_memberships') return Response.json([])
    catalogCalls++
    throw new Error('Catalog query must not happen without verified membership')
  }, async () => {
    const result = await invoke({ action: 'list', workspaceId })
    expect(result.statusCode).toBe(403)
    expect(result.body.code).toBe('MEMBERSHIP_INACTIVE')
    expect(catalogCalls).toBe(0)
  }))

  await withConfig(() => withMockFetch(identityFetch('viewer', url => {
    if (url.pathname === '/rest/v1/content_catalog_items') {
      return Response.json([itemRow({ workspace_id: '323e4567-e89b-42d3-a456-426614174000' })])
    }
    throw new Error(`Unexpected query: ${url.pathname}`)
  }), async () => {
    const result = await invoke({ action: 'version', workspaceId, itemId, version: 1 })
    expect(result.statusCode).toBe(404)
    expect(result.body.code).toBe('ITEM_NOT_FOUND')
  }))
})

test('viewer reads are allowed but all direct mutations and unknown actions are rejected', async () => {
  let writes = 0
  await withConfig(() => withMockFetch(identityFetch('viewer', url => {
    if (url.pathname === '/rest/v1/content_catalog_items') return Response.json([itemRow()])
    writes++
    throw new Error('Unexpected non-read request')
  }), async () => {
    const list = await invoke({ action: 'list', workspaceId })
    expect(list.statusCode).toBe(200)
    const mutation = await invoke({ action: 'create', workspaceId, payload: {} })
    expect(mutation.statusCode).toBe(400)
    expect(mutation.body.code).toBe('INVALID_ACTION')
    const unknown = await invoke({ action: 'delete', workspaceId, itemId })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.body.code).toBe('INVALID_ACTION')
    expect(writes).toBe(0)
  }))
})

test('invalid asset types are rejected in requests and storage responses', async () => {
  let catalogCalls = 0
  await withConfig(() => withMockFetch(identityFetch('editor', url => {
    catalogCalls++
    return Response.json([itemRow({ asset_type: 'character' })])
  }), async () => {
    const invalidRequest = await invoke({ action: 'list', workspaceId, assetType: 'character' })
    expect(invalidRequest.statusCode).toBe(400)
    expect(invalidRequest.body.code).toBe('INVALID_ASSET_TYPE')
    expect(catalogCalls).toBe(0)

    const invalidRow = await invoke({ action: 'list', workspaceId })
    expect(invalidRow.statusCode).toBe(503)
    expect(invalidRow.body.code).toBe('STORAGE_RESPONSE_INVALID')
    expect(catalogCalls).toBe(1)
  }))
})

test('exact-version lookup rejects malformed item metadata before reading version content', async () => {
  let versionQueries = 0
  await withConfig(() => withMockFetch(identityFetch('viewer', url => {
    if (url.pathname === '/rest/v1/content_catalog_items')
      return Response.json([itemRow({ current_version: 0 })])
    versionQueries++
    return Response.json([versionRow()])
  }), async () => {
    const result = await invoke({ action: 'version', workspaceId, itemId, version: 2 })
    expect(result.statusCode).toBe(503)
    expect(result.body.code).toBe('STORAGE_RESPONSE_INVALID')
    expect(versionQueries).toBe(0)
  }))
})

test('list and exact-version metadata accept local asset IDs up to the 512-character schema limit', async () => {
  for (const length of [257, 512]) {
    const localAssetId = 'l'.repeat(length)
    await withConfig(() => withMockFetch(identityFetch('viewer', url => {
      if (url.pathname === '/rest/v1/content_catalog_items')
        return Response.json([itemRow({ local_asset_id: localAssetId })])
      if (url.pathname === '/rest/v1/content_catalog_versions') return Response.json([versionRow()])
      throw new Error(`Unexpected query: ${url.pathname}`)
    }), async () => {
      const list = await invoke({ action: 'list', workspaceId })
      expect(list.statusCode).toBe(200)
      expect(list.body.items[0].localAssetId).toBe(localAssetId)

      const exactVersion = await invoke({ action: 'version', workspaceId, itemId, version: 2 })
      expect(exactVersion.statusCode).toBe(200)
      expect(exactVersion.body.item.localAssetId).toBe(localAssetId)
    }))
  }

  await withConfig(() => withMockFetch(identityFetch('viewer', () => {
    throw new Error('A project ID over 256 characters must be rejected before storage')
  }), async () => {
    const result = await invoke({ action: 'list', workspaceId, projectId: 'p'.repeat(257) })
    expect(result.statusCode).toBe(400)
    expect(result.body.code).toBe('INVALID_ID')
  }))
})

test('invalid IDs, pagination, versions, search, and oversized version payloads are bounded', async () => {
  let fetches = 0
  await withConfig(() => withMockFetch(identityFetch('editor', url => {
    fetches++
    if (url.pathname === '/rest/v1/content_catalog_items') return Response.json([itemRow()])
    return Response.json([versionRow({ payload: { text: 'x'.repeat(512_001) } })])
  }), async () => {
    for (const input of [
      { action: 'list', workspaceId, limit: 101 },
      { action: 'list', workspaceId, offset: -1 },
      { action: 'list', workspaceId, search: 'x'.repeat(121) },
      { action: 'list', workspaceId, assetType: 'character' },
      { action: 'version', workspaceId, itemId: 'not-a-uuid', version: 1 },
      { action: 'version', workspaceId, itemId, version: 0 },
    ]) {
      const result = await invoke(input)
      expect(result.statusCode).toBe(400)
    }
    expect(fetches).toBe(0)
    const oversized = await invoke({ action: 'version', workspaceId, itemId, version: 2 })
    expect(oversized.statusCode).toBe(413)
    expect(oversized.body.code).toBe('PAYLOAD_TOO_LARGE')
  }))
})