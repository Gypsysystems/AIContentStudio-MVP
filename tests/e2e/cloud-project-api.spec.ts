import { expect, test } from '@playwright/test'
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { CloudApiError, CloudProjectApi, handleCloudFiles } from '../../server/cloudProjectApi'
import { handleSupabaseAuthRequest } from '../../server/supabaseProjectAccess'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
  nodeEnv: process.env.NODE_ENV,
}

test.describe('workspace cloud project API', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_ANON_KEY = 'public-test-anon-key'
    process.env.NODE_ENV = 'test'
  })

  test.afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH
    if (ORIGINAL_ENV.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = ORIGINAL_ENV.url
    if (ORIGINAL_ENV.key === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = ORIGINAL_ENV.key
    if (ORIGINAL_ENV.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = ORIGINAL_ENV.nodeEnv
  })

  function request(): IncomingMessage {
    return { headers: { cookie: 'sb_access_token=user-jwt' } } as IncomingMessage
  }

  function reply(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  function provider(role: string, storageReady = true, projectPatch?: (url: URL, init?: RequestInit) => Response): () => void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/auth/v1/user') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt')
        return reply({ id: 'user-1' })
      }
      if (url.pathname === '/rest/v1/workspace_memberships') {
        return reply([{ workspace_id: 'workspace-1', role }])
      }
      if (url.pathname === '/rest/v1/cloud_schema_versions') {
        return storageReady ? reply([{ component: 'project-storage', version: 1 }]) : reply([], 404)
      }
      if (url.pathname === '/rest/v1/workspace_role_permissions') {
        const permissions: Record<string, string[]> = {
          owner: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
          admin: ['create', 'read', 'write', 'delete', 'duplicate', 'backup', 'restore-new', 'replace'],
          editor: ['create', 'read', 'write', 'duplicate', 'backup', 'restore-new'],
          viewer: ['read', 'backup'],
        }
        return reply((permissions[role] ?? []).map(permission => ({ permission })))
      }
      if (url.pathname === '/rest/v1/cloud_projects' && url.searchParams.get('limit') === '0') return reply([])
      if (url.pathname === '/rest/v1/cloud_project_files' && url.searchParams.get('limit') === '0') return reply([])
      if (url.pathname === '/storage/v1/bucket/project-files') {
        return storageReady ? reply({ id: 'project-files', public: false }) : reply({}, 404)
      }
      if (projectPatch) return projectPatch(url, init)
      throw new Error(`Unexpected provider call: ${url.pathname}`)
    }) as typeof fetch
    return () => { globalThis.fetch = ORIGINAL_FETCH }
  }

  test('readiness fails closed when the migration marker or private bucket is absent', async () => {
    const restore = provider('editor', false)
    try {
      const api = await CloudProjectApi.fromRequest(request())
      expect(await api.execute({ action: 'ready' })).toEqual({ ready: false })
      await expect(api.execute({ action: 'list' })).rejects.toMatchObject({
        status: 503,
        code: 'STORAGE_NOT_READY',
      })
    } finally {
      restore()
    }
  })

  test('readiness checks independent authenticated provider endpoints concurrently', async () => {
    const initialChecks = new Set<string>()
    const resourceChecks = new Set<string>()
    let releaseInitial!: () => void
    let releaseResources!: () => void
    const initialReady = new Promise<void>(resolve => { releaseInitial = resolve })
    const resourcesReady = new Promise<void>(resolve => { releaseResources = resolve })
    const restore = (() => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === '/auth/v1/user') return reply({ id: 'user-1' })
        if (url.pathname === '/rest/v1/workspace_memberships')
          return reply([{ workspace_id: 'workspace-1', role: 'editor' }])

        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt')
        if (url.pathname === '/rest/v1/cloud_schema_versions'
          || url.pathname === '/rest/v1/workspace_role_permissions') {
          initialChecks.add(url.pathname)
          if (initialChecks.size === 2) releaseInitial()
          await initialReady
          if (url.pathname === '/rest/v1/cloud_schema_versions')
            return reply([{ component: 'project-storage', version: 1 }])
          return reply(['create', 'read', 'write', 'duplicate', 'backup', 'restore-new']
            .map(permission => ({ permission })))
        }

        if (url.pathname === '/rest/v1/cloud_projects'
          || url.pathname === '/rest/v1/cloud_project_files'
          || url.pathname === '/storage/v1/bucket/project-files') {
          resourceChecks.add(url.pathname)
          if (resourceChecks.size === 3) releaseResources()
          await resourcesReady
          if (url.pathname === '/storage/v1/bucket/project-files')
            return reply({ id: 'project-files', public: false })
          return reply([])
        }
        throw new Error(`Unexpected provider call: ${url.pathname}`)
      }) as typeof fetch
      return () => { globalThis.fetch = ORIGINAL_FETCH }
    })()
    try {
      const api = await CloudProjectApi.fromRequest(request())
      expect(await api.execute({ action: 'ready' })).toEqual({ ready: true })
      expect([...initialChecks].sort()).toEqual([
        '/rest/v1/cloud_schema_versions',
        '/rest/v1/workspace_role_permissions',
      ])
      expect([...resourceChecks].sort()).toEqual([
        '/rest/v1/cloud_project_files',
        '/rest/v1/cloud_projects',
        '/storage/v1/bucket/project-files',
      ])
    } finally {
      restore()
    }
  })

  test('create preserves the full record but replaces client ownership with server identity', async () => {
    const original = {
      projectId: 'client-id',
      ownerUserId: 'attacker',
      workspaceId: 'foreign-workspace',
      recordRevision: 88,
      schemaVersion: 4,
      projectName: 'Workspace project',
      extensionPayload: { retained: true },
    }
    let inserted: Record<string, unknown> | null = null
    const restore = provider('editor', true, (url, init) => {
      if (url.pathname !== '/rest/v1/cloud_projects' || init?.method !== 'POST')
        throw new Error(`Unexpected provider call: ${url.pathname}`)
      inserted = JSON.parse(String(init.body)) as Record<string, unknown>
      return reply([{ record: inserted.record }])
    })
    try {
      const api = await CloudProjectApi.fromRequest(request())
      const result = await api.execute({ action: 'create', record: original })
      expect(result).toEqual({ record: {
        ...original,
        projectId: 'client-id',
        ownerUserId: 'user-1',
        workspaceId: 'workspace-1',
        recordRevision: 0,
      } })
      expect(inserted).toMatchObject({
        project_id: 'client-id',
        workspace_id: 'workspace-1',
        owner_user_id: 'user-1',
        record_revision: 0,
      })
    } finally {
      restore()
    }
  })

  test('viewer role cannot create even when the storage is ready', async () => {
    const restore = provider('viewer')
    try {
      const api = await CloudProjectApi.fromRequest(request())
      await expect(api.execute({ action: 'create', record: { projectName: 'Denied' } }))
        .rejects.toBeInstanceOf(CloudApiError)
      await expect(api.execute({ action: 'create', record: { projectName: 'Denied' } }))
        .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    } finally {
      restore()
    }
  })

  test('foreign-workspace project IDs resolve as not found and queries stay tenant-scoped', async () => {
    const projectQueries: URL[] = []
    const restore = provider('editor', true, url => {
      if (url.pathname !== '/rest/v1/cloud_projects')
        throw new Error(`Unexpected provider call: ${url.pathname}`)
      projectQueries.push(url)
      return reply([])
    })
    try {
      const api = await CloudProjectApi.fromRequest(request())
      await expect(api.execute({ action: 'read', projectId: 'foreign-project' }))
        .rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' })
      expect(projectQueries[0]?.searchParams.get('workspace_id')).toBe('eq.workspace-1')
    } finally {
      restore()
    }
  })

  test('save uses an atomic revision predicate and reports stale revisions as conflict', async () => {
    const patchCalls: Array<{ url: URL; body: Record<string, unknown> }> = []
    let projectReads = 0
    const restore = provider('editor', true, (url, init) => {
      if (url.pathname === '/rest/v1/cloud_projects' && init?.method === 'PATCH') {
        patchCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return reply([])
      }
      if (url.pathname === '/rest/v1/cloud_projects' && init?.method === undefined && url.searchParams.get('limit') === '1')
        return reply([{ record: { projectId: 'stable-id', ownerUserId: 'original-owner', recordRevision: ++projectReads === 1 ? 6 : 7 } }])
      throw new Error(`Unexpected provider call: ${url.pathname}`)
    })
    try {
      const api = await CloudProjectApi.fromRequest(request())
      await expect(api.execute({
        action: 'save',
        projectId: 'stable-id',
        expectedRevision: 6,
        record: { projectId: 'stable-id', projectName: 'losing write', custom: ['kept'] },
      })).rejects.toMatchObject({ status: 409, code: 'PROJECT_CONFLICT' })
      expect(patchCalls[0]?.url.searchParams.get('record_revision')).toBe('eq.6')
      expect(patchCalls[0]?.body).toMatchObject({
        record_revision: 7,
        record: {
          projectId: 'stable-id',
          ownerUserId: 'original-owner',
          workspaceId: 'workspace-1',
          recordRevision: 7,
          custom: ['kept'],
        },
      })
    } finally {
      restore()
    }
  })

  test('duplicate upload ID never compensates by deleting the preexisting object or metadata', async () => {
    const calls: Array<{ path: string; method: string }> = []
    const restore = provider('editor', true, (url, init) => {
      calls.push({ path: url.pathname, method: init?.method ?? 'GET' })
      if (url.pathname === '/rest/v1/cloud_projects')
        return reply([{ record: { projectId: 'p-1', ownerUserId: 'owner-1', recordRevision: 0 } }])
      if (url.pathname === '/rest/v1/cloud_project_files' && init?.method === 'POST')
        return reply({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409)
      throw new Error(`Unexpected provider call: ${url.pathname}`)
    })
    try {
      const payload = Buffer.from('replacement bytes')
      const input = Readable.from([payload]) as Readable & Partial<IncomingMessage>
      input.url = '/api/cloud-files?fileId=file-existing'
      input.method = 'POST'
      input.headers = {
        cookie: 'sb_access_token=user-jwt',
        'x-project-id': 'p-1',
        'x-file-name': 'duplicate.txt',
        'content-type': 'text/plain',
        'content-length': String(payload.length),
      }
      let responseBody = ''
      const response = {
        statusCode: 0,
        setHeader() {},
        end(body?: string) {
          responseBody = body ?? ''
        },
        get headersSent() { return responseBody.length > 0 },
      } as unknown as import('node:http').ServerResponse
      await handleCloudFiles(input as IncomingMessage, response)
      expect(response.statusCode).toBe(409)
      expect(JSON.parse(responseBody)).toMatchObject({ code: 'RESOURCE_CONFLICT' })
      expect(calls.some(call => call.method === 'DELETE')).toBe(false)
      expect(calls.some(call => call.path.startsWith('/storage/v1/object/project-files/') && call.method === 'POST')).toBe(false)
    } finally {
      restore()
    }
  })

  test('Supabase session exposes activeRole only from the fresh membership response', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/auth/v1/user') return reply({ id: 'user-1' })
      if (url.pathname === '/rest/v1/workspace_memberships')
        return reply([{ workspace_id: 'workspace-1', role: 'editor' }])
      if (url.pathname === '/rest/v1/workspaces')
        return reply([{ id: 'workspace-1', name: 'Workspace', orgs: { name: 'Organization' } }])
      throw new Error(`Unexpected auth provider call: ${url.pathname}`)
    }) as typeof fetch
    try {
      const input = Readable.from([Buffer.from('{}')]) as Readable & Partial<IncomingMessage>
      input.url = '/api/auth/session'
      input.method = 'POST'
      input.headers = {
        cookie: 'sb_access_token=user-jwt',
        host: '127.0.0.1',
        origin: 'http://127.0.0.1',
        'content-type': 'application/json',
        'content-length': '2',
      }
      let body = ''
      const response = {
        statusCode: 0,
        setHeader() {},
        end(value?: string) { body = value ?? '' },
      } as unknown as import('node:http').ServerResponse
      await handleSupabaseAuthRequest(input as IncomingMessage, response)
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(body)).toMatchObject({
        authenticated: true,
        activeWorkspaceId: 'workspace-1',
        activeRole: 'editor',
      })
    } finally {
      globalThis.fetch = ORIGINAL_FETCH
    }
  })

  test('restore SQL locks without stage UPDATE and restricts staging transitions', () => {
    const migration = readFileSync('supabase/migrations/20260925000300_cloud_project_storage.sql', 'utf8')
    expect(migration).toContain('pg_advisory_xact_lock(hashtext(p_stage_id::text))')
    expect(migration).not.toContain('public.storage.objects')
    expect(migration).not.toMatch(/where stage_id = p_stage_id and owner_user_id = \(select auth\.uid\(\)\)\s+for update/i)
    expect(migration).toContain('stage.stage_id = new.stage_id')
    expect(migration).toContain('stage.workspace_id = new.workspace_id')
    expect(migration).toContain('s.stage_id = cloud_project_files.stage_id')
    expect(migration).toContain('s.workspace_id = cloud_project_files.workspace_id')
    expect(migration).toMatch(/grant update \(record_revision, record, updated_at\) on public\.cloud_projects/i)
    expect(migration).toMatch(/create or replace function public\.finalize_cloud_project_restore[\s\S]*?security definer/i)
  })

  test('replacement retains old object metadata in retryable cleanup state', () => {
    const migration = readFileSync('supabase/migrations/20260925000300_cloud_project_storage.sql', 'utf8')
    expect(migration).toContain("set state = 'cleanup', cleanup_owner_user_id = (select auth.uid())")
    expect(migration).toContain('public.delete_cloud_project_file_metadata')
    expect(migration).toContain("object.name = substring(file_row.storage_path from 15)")
    expect(migration).toContain("(f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))")
    expect(migration).toContain("on public.cloud_project_files (file_id) where state in ('ready', 'uploading')")
    expect(migration).toContain("on public.cloud_project_files (stage_id, file_id) where state = 'staged'")
    expect(migration).not.toContain('file_id text primary key')
  })

  test('abandonment permits scoped Storage cleanup and guards project resource deletion', () => {
    const migration = readFileSync('supabase/migrations/20260925000300_cloud_project_storage.sql', 'utf8')
    expect(migration).toContain("(f.state = 'uploading' and public.workspace_can(f.workspace_id, 'write'))")
    expect(migration).toContain("(f.state = 'cleanup' and public.workspace_can(f.workspace_id, 'replace'))")
    expect(migration).toContain('public.begin_cloud_project_restore_abandon')
    expect(migration).toContain('public.finish_cloud_project_restore_abandon')
    expect(migration).toContain("set state = 'abandoning'")
    expect(migration).toContain("staged.owner_user_id = (select auth.uid())")
    expect(migration).toContain("public.workspace_can(staged.workspace_id, 'replace')")
    expect(migration).toContain('public.prevent_cloud_project_delete_with_resources')
    expect(migration).toContain('cloud_projects_require_resource_cleanup')
  })

  test('abandon-restore lets the stage owner and administrators retry Storage cleanup', async () => {
    for (const scenario of [
      { role: 'editor', owner: 'user-1' },
      { role: 'admin', owner: 'another-user' },
    ]) {
      const calls: Array<{ path: string; method: string }> = []
      const restore = provider(scenario.role, true, (url, init) => {
        calls.push({ path: url.pathname, method: init?.method ?? 'GET' })
        if (url.pathname === '/rest/v1/cloud_project_restore_stages')
          return reply([{
            stage_id: '123e4567-e89b-12d3-a456-426614174000',
            project_id: 'staged-project',
            mode: 'new',
            owner_user_id: scenario.owner,
          }])
        if (url.pathname === '/rest/v1/rpc/begin_cloud_project_restore_abandon'
          || url.pathname === '/rest/v1/rpc/finish_cloud_project_restore_abandon') return reply(true)
        if (url.pathname === '/rest/v1/cloud_project_files')
          return reply([{
            file_id: 'original-file-id',
            project_id: 'staged-project',
            name: 'asset.bin',
            type: 'application/octet-stream',
            size: 3,
            uploaded_at: 1,
            storage_path: 'project-files/workspace-1/_staging/123e4567-e89b-12d3-a456-426614174000/original-file-id',
            state: 'staged',
          }])
        if (url.pathname.startsWith('/storage/v1/object/')) return reply({})
        throw new Error(`Unexpected provider call: ${url.pathname}`)
      })
      try {
        const api = await CloudProjectApi.fromRequest(request())
        expect(await api.execute({
          action: 'abandon-restore',
          stageId: '123e4567-e89b-12d3-a456-426614174000',
        })).toEqual({ abandoned: true, projectId: 'staged-project' })
        const storageDeleteIndex = calls.findIndex(call => call.path === '/storage/v1/object/project-files/workspace-1/_staging/123e4567-e89b-12d3-a456-426614174000/original-file-id' && call.method === 'DELETE')
        const finishIndex = calls.findIndex(call => call.path === '/rest/v1/rpc/finish_cloud_project_restore_abandon')
        expect(storageDeleteIndex).toBeGreaterThan(-1)
        expect(finishIndex).toBeGreaterThan(storageDeleteIndex)
      } finally {
        restore()
      }
    }
  })
})