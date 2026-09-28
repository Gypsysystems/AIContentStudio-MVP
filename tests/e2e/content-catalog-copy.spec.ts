import { expect, test } from '@playwright/test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleContentCatalog, sendContentCatalogError } from '../../server/contentCatalogApi'

const workspaceId = '123e4567-e89b-42d3-a456-426614174000'
const itemId = '223e4567-e89b-42d3-a456-426614174000'
const sessionToken = 'copy-test-session'
const anonKey = 'public-test-anon-key'
const destinationId = 'destination-project'
const sourceProjectId = 'source-project'

function sourceItem(type = 'topic', overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId, workspace_id: workspaceId, project_id: sourceProjectId,
    asset_type: type, local_asset_id: 'source-local-id', display_name: 'Copied item',
    status: 'active', current_version: 4, current_hash: 'sha256-current',
    origin_item_id: null, origin_project_id: null, origin_version: null,
    created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-02T12:00:00.000Z',
    ...overrides,
  }
}

function version(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId, version: 2, workspace_id: workspaceId, project_id: sourceProjectId,
    content_hash: 'sha256-version-2', payload, source_project_revision: 42,
    created_by: null, created_at: '2026-10-01T12:00:00.000Z', ...overrides,
  }
}

function projectRecord(overrides: Record<string, unknown> = {}) {
  return {
    projectId: destinationId, workspaceId, ownerUserId: 'user-1', recordRevision: 7,
    projectName: 'Destination', modifiedAt: 10, marker: { preserve: true },
    projectMeta: { themeId: 'theme-default' }, themeVariables: { 'theme-default': [] },
    appToc: [{ id: 8, topicId: 'existing-topic', title: 'Existing', level: 1, words: 0 }],
    topicContent: { 'existing-topic': [{ id: 'existing-block', type: 'para', content: 'keep me' }] },
    tocRevision: 3, contentRevision: 5, tocHumanModified: false,
    snippets: [], conditionGroups: [], ...overrides,
  }
}

function requestFor(body: unknown) {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage
  Object.assign(request, { headers: {
    cookie: `sb_access_token=${encodeURIComponent(sessionToken)}`,
    host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173',
    'content-type': 'application/json',
  } })
  return request
}

function responseRecorder() {
  const headers = new Map<string, string>()
  const target = {
    statusCode: 200, body: '',
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end(body?: string) { target.body = body ?? '' },
  }
  return { headers, response: target as unknown as ServerResponse & { body: string } }
}

async function withConfig<T>(work: () => Promise<T>) {
  const before = [process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, process.env.NODE_ENV]
  process.env.SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_ANON_KEY = anonKey
  process.env.NODE_ENV = 'test'
  try { return await work() } finally {
    if (before[0] === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = before[0]
    if (before[1] === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = before[1]
    if (before[2] === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before[2]
  }
}

async function withMockFetch<T>(
  mock: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    mock(new URL(String(input)), init)) as typeof fetch
  try { return await work() } finally { globalThis.fetch = original }
}

async function invoke(body: unknown) {
  const recorder = responseRecorder()
  const error = await handleContentCatalog(requestFor(body), recorder.response).then(() => null, value => value)
  if (error) sendContentCatalogError(recorder.response, error)
  return {
    status: recorder.response.statusCode,
    headers: recorder.headers,
    body: JSON.parse(recorder.response.body),
  }
}

type MockOptions = {
  role?: string
  item?: Record<string, unknown>
  version?: Record<string, unknown>
  record?: Record<string, unknown>
  destinationOverrides?: Record<string, unknown>
  casRows?: unknown[]
}

function apiMock(options: MockOptions = {}, observe: (url: URL, init?: RequestInit) => void = () => {}) {
  const role = options.role ?? 'editor'
  const record = options.record ?? projectRecord()
  const item = options.item ?? sourceItem()
  const sourceVersion = options.version ?? version({
    title: 'Copied topic', level: 2, order: 0, parentId: null,
    blocks: [{ id: 'source-block', type: 'para', content: 'A useful paragraph', evidenceIds: ['source-evidence'] }],
  })
  return async (url: URL, init?: RequestInit): Promise<Response> => {
    observe(url, init)
    const headers = new Headers(init?.headers)
    if (url.pathname === '/auth/v1/user') {
      expect(headers.get('authorization')).toBe(`Bearer ${sessionToken}`)
      expect(headers.get('apikey')).toBe(anonKey)
      return Response.json({ id: 'user-1' })
    }
    if (url.pathname === '/rest/v1/workspace_memberships')
      return Response.json([{ workspace_id: workspaceId, role }])
    if (url.pathname === '/rest/v1/workspace_role_permissions') {
      const permission = url.searchParams.get('permission')
      return Response.json(permission === 'eq.read' || role !== 'viewer' && permission === 'eq.write'
        ? [{ permission: permission?.slice(3) }]
        : [])
    }
    if (url.pathname === '/rest/v1/content_catalog_items') {
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      expect(url.searchParams.get('select')).not.toMatch(/payload|record/i)
      return Response.json([item])
    }
    if (url.pathname === '/rest/v1/content_catalog_versions') {
      expect(url.searchParams.get('version')).toBe('eq.2')
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      return Response.json([sourceVersion])
    }
    if (url.pathname === '/rest/v1/cloud_projects' && init?.method === 'PATCH') {
      expect(url.searchParams.get('project_id')).toBe(`eq.${destinationId}`)
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      expect(url.searchParams.get('status')).toBe('eq.active')
      expect(url.searchParams.get('record_revision')).toBe('eq.7')
      return Response.json(options.casRows ?? [{ project_id: destinationId, record_revision: 8 }])
    }
    if (url.pathname === '/rest/v1/cloud_projects') {
      expect(url.searchParams.get('project_id')).toBe(`eq.${destinationId}`)
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      expect(url.searchParams.get('status')).toBe('eq.active')
      return Response.json([{
        project_id: destinationId, workspace_id: workspaceId, owner_user_id: 'user-1',
        record_revision: 7, status: 'active', record,
        ...(options.destinationOverrides ?? {}),
      }])
    }
    throw new Error(`Unexpected provider access: ${url.pathname}`)
  }
}

function copyRequest(overrides: Record<string, unknown> = {}) {
  return {
    action: 'copy', workspaceId, sourceItemId: itemId, sourceVersion: 2,
    destinationProjectId: destinationId, expectedRevision: 7, ...overrides,
  }
}

test('copies exact topic content, allocates stable IDs, preserves unrelated record, and returns no project record', async () => {
  const calls: string[] = []
  await withConfig(() => withMockFetch(apiMock({}, url => calls.push(url.pathname)), async () => {
    const result = await invoke(copyRequest({ insertion: { afterTopicId: 'existing-topic' } }))
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      projectId: destinationId, recordRevision: 8, assetType: 'topic',
      asset: expect.objectContaining({ title: 'Copied topic', topicId: expect.any(String), id: expect.any(String) }),
    })
    expect(JSON.stringify(result.body)).not.toContain('marker')
    expect(calls).not.toContain('/rest/v1/cloud_project_files')
    expect(calls.some(path => /ai|source_file/i.test(path))).toBe(false)
    expect(calls.filter(path => path === '/rest/v1/cloud_projects')).toHaveLength(2)
  }))
})

test('list excludes the destination project and rejects contradictory project filters', async () => {
  let projectFilters: string[] = []
  const seenFilters: string[][] = []
  let providerCalls = 0
  await withConfig(() => withMockFetch(apiMock({}, url => {
    if (url.pathname === '/rest/v1/content_catalog_items') {
      providerCalls++
      projectFilters = url.searchParams.getAll('project_id')
      seenFilters.push(projectFilters)
    }
  }), async () => {
    const result = await invoke({ action: 'list', workspaceId, excludeProjectId: destinationId })
    expect(result.status).toBe(200)
    expect(projectFilters).toEqual([`neq.${destinationId}`])

    const narrowed = await invoke({
      action: 'list', workspaceId, projectId: sourceProjectId, excludeProjectId: destinationId,
    })
    expect(narrowed.status).toBe(200)
    expect(projectFilters).toEqual([`eq.${sourceProjectId}`, `neq.${destinationId}`])

    const contradictory = await invoke({
      action: 'list', workspaceId, projectId: destinationId, excludeProjectId: destinationId,
    })
    expect(contradictory.status).toBe(400)
    expect(contradictory.body.code).toBe('PROJECT_FILTER_CONFLICT')
    expect(providerCalls).toBe(2)
    expect(seenFilters[0]).toEqual([`neq.${destinationId}`])
  }))
})

test('CAS writes new content lineage without source evidence and preserves record fields', async () => {
  let patched: Record<string, unknown> | undefined
  await withConfig(() => withMockFetch(apiMock({}, (url, init) => {
    if (url.pathname === '/rest/v1/cloud_projects' && init?.method === 'PATCH')
      patched = JSON.parse(String(init.body)).record
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(200)
    const record = patched as Record<string, any>
    const copiedTopic = record.appToc[1]
    expect(copiedTopic.id).toBe(9)
    expect(copiedTopic.level).toBe(1)
    expect(copiedTopic.parentId).toBeUndefined()
    expect(record.appToc[0].topicId).toBe('existing-topic')
    expect(record.topicContent['existing-topic'][0].id).toBe('existing-block')
    const copiedBlock = record.topicContent[copiedTopic.topicId][0]
    expect(copiedBlock.id).not.toBe('source-block')
    expect(copiedBlock.evidenceIds).toBeUndefined()
    expect(record.contentOrigins.topic[copiedTopic.topicId]).toEqual({
      originItemId: itemId, originProjectId: sourceProjectId, originVersion: 2,
    })
    expect(record.marker).toEqual({ preserve: true })
    expect(record.recordRevision).toBe(8)
    expect(record.modifiedAt).toEqual(expect.any(Number))
    expect(record.analysisResult).toBeUndefined()
    expect(result.body).not.toHaveProperty('record')
  }))
})

test('requires owner/admin/editor write access before reading source or destination', async () => {
  let catalogReads = 0
  await withConfig(() => withMockFetch(apiMock({ role: 'viewer' }, url => {
    if (url.pathname.startsWith('/rest/v1/content_catalog')) catalogReads++
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('FORBIDDEN')
    expect(catalogReads).toBe(0)
  }))
})

test('rejects browser content, extra fields, malformed identifiers, and oversized requests before provider access', async () => {
  let calls = 0
  await withConfig(() => withMockFetch(async () => {
    calls++
    throw new Error('Validation must precede provider calls')
  }, async () => {
    for (const body of [
      copyRequest({ payload: { browserSupplied: true } }),
      copyRequest({ content: { browserSupplied: true } }),
      copyRequest({ sourceItemId: 'not-a-uuid' }),
      copyRequest({ destinationProjectId: 'bad/id' }),
      copyRequest({ insertion: { afterTopicId: 'valid', foreign: 1 } }),
    ]) {
      const result = await invoke(body)
      expect(result.status).toBe(400)
    }
    const oversized = await invoke(copyRequest({ extra: 'x'.repeat(17_000) }))
    expect(oversized.status).toBe(413)
    expect(calls).toBe(0)
  }))
})

test('reads only the requested immutable version and rejects inactive or cross-workspace source metadata', async () => {
  let versionReads = 0
  await withConfig(() => withMockFetch(apiMock({ item: sourceItem('topic', { status: 'retired' }) }, url => {
    if (url.pathname === '/rest/v1/content_catalog_versions') versionReads++
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(404)
    expect(versionReads).toBe(0)
  }))
  await withConfig(() => withMockFetch(apiMock({ item: sourceItem('topic', {
    workspace_id: '323e4567-e89b-42d3-a456-426614174000',
  }) }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(404)
  }))
})

test('blocks unresolved variables, media, and unsupported project-local references without patching', async () => {
  const payloads = [
    { title: 'Needs variable', level: 1, order: 0, parentId: null,
      blocks: [{ id: 'b1', type: 'para', content: 'Hello {{Missing}}' }] },
    { title: 'Needs media', level: 1, order: 0, parentId: null,
      blocks: [{ id: 'b1', type: 'media', content: 'image' }] },
    { title: 'Unknown reference', level: 1, order: 0, parentId: null,
      blocks: [{ id: 'b1', type: 'para', content: '[[topic:other-topic]]' }] },
  ]
  for (const payload of payloads) {
    let patches = 0
    await withConfig(() => withMockFetch(apiMock({ version: version(payload) }, (url, init) => {
      if (init?.method === 'PATCH') patches++
    }), async () => {
      const result = await invoke(copyRequest())
      expect(result.status).toBe(409)
      expect(result.body.code).toBe('DEPENDENCY_BLOCKED')
      expect(result.body.error).toMatch(/unresolved project dependencies/i)
      expect(patches).toBe(0)
    }))
  }
})

test('blocks embedded and linked media while allowing ordinary hyperlinks', async () => {
  const mediaTexts = [
    '![diagram](https://cdn.example.test/diagram.png)',
    '<img src="/assets/diagram.svg" alt="diagram">',
    '<video><source src="https://cdn.example.test/clip.mp4"></video>',
    '<audio src="/audio/voice.ogg"></audio>',
    'https://cdn.example.test/files/track.wav?download=1',
  ]
  for (const content of mediaTexts) {
    await withConfig(() => withMockFetch(apiMock({ version: version({
      title: 'Media-linked', level: 1, order: 0, parentId: null,
      blocks: [{ id: 'media-ref', type: 'para', content }],
    }) }), async () => {
      const result = await invoke(copyRequest())
      expect(result.status).toBe(409)
      expect(result.body.code).toBe('DEPENDENCY_BLOCKED')
      expect(result.body.error).toMatch(/media/i)
    }))
  }

  await withConfig(() => withMockFetch(apiMock({ version: version({
    title: 'Link', level: 1, order: 0, parentId: null,
    blocks: [{ id: 'link', type: 'para', content: '[Read more](https://example.test/guide)' }],
  }) }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(200)
  }))

  await withConfig(() => withMockFetch(apiMock({
    item: sourceItem('snippet', { local_asset_id: 'linked-snippet' }),
    version: version({ id: 'linked-snippet', name: 'Linked', content: '![photo](photo.jpg)' }),
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('DEPENDENCY_BLOCKED')
  }))
})

test('snippet variable tokens require a matching destination active-theme variable', async () => {
  const record = projectRecord({
    themeVariables: { 'theme-default': [{ id: 'brand-variable', name: 'Brand', value: 'blue' }] },
  })
  let patched: Record<string, any> | undefined
  await withConfig(() => withMockFetch(apiMock({
    item: sourceItem('snippet', { local_asset_id: 'snippet-brand' }),
    version: version({ id: 'snippet-brand', name: 'Brand snippet', content: 'Use {{Brand}}' }),
    record,
  }, (url, init) => {
    if (url.pathname === '/rest/v1/cloud_projects' && init?.method === 'PATCH')
      patched = JSON.parse(String(init.body)).record
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(200)
    expect(patched!.snippets.at(-1).content).toBe('Use {{Brand}}')
  }))

  let patches = 0
  await withConfig(() => withMockFetch(apiMock({
    item: sourceItem('snippet', { local_asset_id: 'snippet-missing' }),
    version: version({ id: 'snippet-missing', name: 'Missing variable', content: 'Use {{Missing}}' }),
  }, (_url, init) => { if (init?.method === 'PATCH') patches++ }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('DEPENDENCY_BLOCKED')
    expect(result.body.error).toContain('variable "Missing"')
    expect(patches).toBe(0)
  }))
})

test('rejects unknown project-local list-item fields', async () => {
  const payload = {
    title: 'Unsafe list item', level: 1, order: 0, parentId: null,
    blocks: [{
      id: 'list-block', type: 'list', content: '',
      listItems: [{
        id: 'list-item', text: 'Meaningful text', level: 1, type: 'bullet',
        sourceProjectId,
      }],
    }],
  }
  await withConfig(() => withMockFetch(apiMock({ version: version(payload) }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('INVALID_ASSET_CONTENT')
  }))
})

test('resolves destination variables and conditions while remapping self-contained bookmark references', async () => {
  const record = projectRecord({
    themeVariables: { 'theme-default': [{ id: 'destination-brand', name: 'Brand', value: 'blue' }] },
    conditionGroups: [{ id: 'destination-condition', group: 'Audience', tags: ['admin'] }],
  })
  const payload = {
    title: 'Portable', level: 2, order: 0, parentId: null,
    blocks: [
      { id: 'first', type: 'para', content: 'Hello {{Brand}} [[block:second]]', conditions: ['admin'] },
      { id: 'second', type: 'bookmark', content: 'Section bookmark' },
    ],
  }
  let patched: Record<string, any> | undefined
  await withConfig(() => withMockFetch(apiMock({ record, version: version(payload) }, (url, init) => {
    if (url.pathname === '/rest/v1/cloud_projects' && init?.method === 'PATCH')
      patched = JSON.parse(String(init.body)).record
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(200)
    const topic = patched!.appToc[1]
    const blocks = patched!.topicContent[topic.topicId]
    expect(blocks[0].content).toBe(`Hello {{Brand}} [[block:${blocks[1].id}]]`)
    expect(blocks[0].conditions).toEqual(['admin'])
    expect(blocks[1].id).not.toBe('second')
  }))
})

test('returns conflict when guarded update matches zero rows and never rebases', async () => {
  let readsAfterPatch = 0
  await withConfig(() => withMockFetch(apiMock({ casRows: [] }, (url, init) => {
    if (url.pathname === '/rest/v1/cloud_projects' && !init?.method) readsAfterPatch++
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('PROJECT_CONFLICT')
    expect(readsAfterPatch).toBe(1)
  }))
})

test('validates destination identity and revision, and rejects same-project copies', async () => {
  await withConfig(() => withMockFetch(apiMock({
    destinationOverrides: { record_revision: 9, record: projectRecord({ recordRevision: 9 }) },
  }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('PROJECT_CONFLICT')
  }))
  await withConfig(() => withMockFetch(apiMock({ destinationOverrides: { workspace_id: '323e4567-e89b-42d3-a456-426614174000' } }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(404)
  }))
  await withConfig(() => withMockFetch(apiMock({ item: sourceItem('topic', { project_id: destinationId }) }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('SAME_PROJECT_COPY')
  }))
})

test('bounds stored source payloads and enforces snippet and condition name conflicts', async () => {
  await withConfig(() => withMockFetch(apiMock({ version: version({
    id: 'snippet-1', name: 'Huge', content: 'x'.repeat(512_001),
  }), item: sourceItem('snippet', { local_asset_id: 'snippet-1' }) }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(413)
    expect(result.body.code).toBe('PAYLOAD_TOO_LARGE')
  }))

  for (const [type, payload, record] of [
    ['snippet', { id: 's1', name: 'Guide', content: 'Text' }, projectRecord({ snippets: [{ id: 'old', name: 'Guide', content: 'Old' }] })],
    ['condition', { id: 'c1', group: 'Audience', tags: ['admin'] }, projectRecord({ conditionGroups: [{ id: 'old', group: 'Audience', tags: [] }] })],
  ] as const) {
    await withConfig(() => withMockFetch(apiMock({ item: sourceItem(type, { local_asset_id: type === 'snippet' ? 's1' : 'c1' }), version: version(payload), record }), async () => {
      const result = await invoke(copyRequest())
      expect(result.status).toBe(409)
      expect(result.body.code).toBe('ASSET_NAME_CONFLICT')
    }))
  }
})

test('identical variable already in destination is returned without duplicate write', async () => {
  const record = projectRecord({
    themeVariables: { 'theme-default': [{ id: 'existing-variable', name: 'Brand', value: 'blue', description: '' }] },
  })
  let patches = 0
  await withConfig(() => withMockFetch(apiMock({
    item: sourceItem('variable', { local_asset_id: 'source-var' }),
    version: version({ id: 'source-var', name: 'Brand', value: 'blue', description: '' }),
    record,
  }, (_url, init) => { if (init?.method === 'PATCH') patches++ }), async () => {
    const result = await invoke(copyRequest())
    expect(result.status).toBe(200)
    expect(result.body.asset).toEqual({ id: 'existing-variable', name: 'Brand', alreadyAvailable: true })
    expect(result.body.recordRevision).toBe(7)
    expect(patches).toBe(0)
  }))
})