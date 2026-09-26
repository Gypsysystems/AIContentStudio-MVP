import { expect, test } from '@playwright/test'
import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CloudApiError, CloudProjectApi } from '../../server/cloudProjectApi'
import { canonicalCheckpointJson } from '../../src/projectCheckpoint'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
  nodeEnv: process.env.NODE_ENV,
}
const PROJECT_ID = 'checkpoint-cloud-project'
const FILE_ID = 'checkpoint-cloud-file'
const WORKSPACE_ID = 'workspace-checkpoints'
const FILE_BYTES = Buffer.from('private source payload')
const PROJECT_RECORD = {
  projectId: PROJECT_ID,
  ownerUserId: 'user-checkpoints',
  workspaceId: WORKSPACE_ID,
  recordRevision: 7,
  schemaVersion: 4,
  projectName: 'Cloud checkpoint contract',
  sourceFileIds: [FILE_ID],
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function apiRequest(): IncomingMessage {
  return { headers: { cookie: 'sb_access_token=checkpoint-session' } } as IncomingMessage
}

function configureProvider(
  role: string,
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return reply({ id: 'user-checkpoints' })
    if (url.pathname === '/rest/v1/workspace_memberships')
      return reply([{ workspace_id: WORKSPACE_ID, role }])
    if (url.pathname === '/rest/v1/cloud_schema_versions') {
      const component = url.searchParams.get('component')?.slice(3)
      return reply([{ component, version: component === 'project-checkpoints' ? 3 : 2 }])
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
    if (url.pathname === '/rest/v1/cloud_projects' && url.searchParams.get('limit') === '0')
      return reply([])
    if (url.pathname === '/rest/v1/cloud_project_files' && url.searchParams.get('limit') === '0')
      return reply([])
    if (url.pathname === '/rest/v1/cloud_project_checkpoints' && url.searchParams.get('limit') === '0')
      return reply([])
    if (url.pathname === '/rest/v1/cloud_project_deletions' && url.searchParams.get('limit') === '0')
      return reply([])
    if (url.pathname === '/storage/v1/bucket/project-files')
      return reply({ id: 'project-files', public: false })
    if (url.pathname === '/storage/v1/bucket/project-checkpoints')
      return reply({ id: 'project-checkpoints', public: false })
    return handler(url, init)
  }) as typeof fetch
  return () => { globalThis.fetch = ORIGINAL_FETCH }
}

function committedRow(checkpointId: string, record: Record<string, unknown>, manifest: unknown[]): Record<string, unknown> {
  const stage = {
    checkpoint_id: checkpointId,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    parent_checkpoint_id: null,
    reason: 'Before release',
    actor_user_id: 'user-checkpoints',
    created_at: '2026-09-26T10:00:00.000Z',
    originating_record_revision: 7,
    record_schema_version: 4,
    record_digest: 'a'.repeat(64),
    integrity_digest: 'b'.repeat(64),
    record,
    file_manifest: manifest,
  }
  return stage
}

test.describe('cloud project checkpoint protocol', () => {
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

  test('capture snapshots server-owned record and exact current files into a private append-only archive', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
    let returnedCheckpoint: Record<string, unknown> | null = null
    const restore = configureProvider('editor', async (url, init) => {
      const method = init?.method ?? 'GET'
      let body: Record<string, unknown> | undefined
      if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
      calls.push({ path: url.pathname, method, body })
      if (url.pathname === '/rest/v1/cloud_projects')
        return reply([{ record: PROJECT_RECORD }])
      if (url.pathname === '/rest/v1/cloud_project_files')
        return reply([{
          file_id: FILE_ID,
          project_id: PROJECT_ID,
          name: 'source.txt',
          type: 'text/plain',
          size: FILE_BYTES.length,
          uploaded_at: 1_700_000_000_000,
          storage_path: `project-files/${WORKSPACE_ID}/${PROJECT_ID}/${FILE_ID}`,
          state: 'ready',
        }])
      if (url.pathname === '/rest/v1/cloud_project_checkpoints') {
        if (method === 'POST') return reply([])
        return reply([])
      }
      if (url.pathname === '/storage/v1/object/project-files/workspace-checkpoints/checkpoint-cloud-project/checkpoint-cloud-file')
        return new Response(FILE_BYTES)
      if (url.pathname.startsWith('/rest/v1/cloud_project_checkpoint_file_stages')
        || url.pathname.startsWith('/rest/v1/cloud_project_checkpoint_stages')) return reply([])
      if (url.pathname.startsWith('/storage/v1/object/project-checkpoints/')) {
        if (method === 'POST') return reply({})
        if (method === 'GET') return new Response(FILE_BYTES)
      }
      if (url.pathname === '/rest/v1/rpc/finalize_cloud_project_checkpoint') {
        const manifest = body?.p_file_manifest
        if (!Array.isArray(manifest)) throw new Error('Expected exact final checkpoint manifest')
        const stage = calls.find(call => call.path === '/rest/v1/cloud_project_checkpoint_stages')?.body
        const checkpointId = String(stage?.checkpoint_id)
        returnedCheckpoint = committedRow(checkpointId, PROJECT_RECORD, manifest)
        return reply(returnedCheckpoint)
      }
      throw new Error(`Unexpected checkpoint API call: ${url.pathname} ${method}`)
    })
    try {
      const api = await CloudProjectApi.fromRequest(apiRequest())
      const result = await api.execute({
        action: 'capture-checkpoint',
        projectId: PROJECT_ID,
        expectedRevision: 7,
        expectedFileIds: [FILE_ID],
        reason: ' Before release ',
      })
      expect(result.checkpoint).toMatchObject({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        parentCheckpointId: null,
        reason: 'Before release',
        actorUserId: 'user-checkpoints',
        originatingRecordRevision: 7,
        recordSchemaVersion: 4,
        record: PROJECT_RECORD,
        files: [{
          fileId: FILE_ID,
          name: 'source.txt',
          type: 'text/plain',
          size: FILE_BYTES.length,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          storageRef: expect.stringMatching(/^project-checkpoints\/workspace-checkpoints\/checkpoint-cloud-project\//),
        }],
      })
      expect(returnedCheckpoint).not.toBeNull()
      expect(calls.find(call => call.path === '/rest/v1/cloud_project_checkpoint_stages')?.body)
        .toMatchObject({
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          actor_user_id: 'user-checkpoints',
          expected_revision: 7,
          expected_file_ids: [FILE_ID],
          record: PROJECT_RECORD,
          reason: 'Before release',
        })
      expect(calls.find(call => call.path === '/rest/v1/rpc/finalize_cloud_project_checkpoint')?.body)
        .toMatchObject({ p_expected_revision: 7, p_expected_file_ids: [FILE_ID], p_parent_checkpoint_id: null })
      expect(calls.some(call => call.path.startsWith('/storage/v1/object/project-checkpoints/') && call.method === 'POST'))
        .toBe(true)
      expect(calls.some(call => call.path.startsWith('/storage/v1/object/project-checkpoints/') && call.method === 'GET'))
        .toBe(true)
    } finally {
      restore()
    }
  })

  test('revision and file-set conflicts and workspace roles are rejected before a stage is created', async () => {
    for (const scenario of [
      { role: 'editor', revision: 6, fileIds: [FILE_ID], code: 'PROJECT_CONFLICT' },
      { role: 'editor', revision: 7, fileIds: [], code: 'FILE_SET_CONFLICT' },
      { role: 'viewer', revision: 7, fileIds: [FILE_ID], code: 'FORBIDDEN' },
    ]) {
      let stageWrites = 0
      const restore = configureProvider(scenario.role, (url, init) => {
        if (url.pathname === '/rest/v1/cloud_projects') return reply([{ record: PROJECT_RECORD }])
        if (url.pathname === '/rest/v1/cloud_project_files')
          return reply([{
            file_id: FILE_ID, project_id: PROJECT_ID, name: 'source.txt', type: 'text/plain',
            size: FILE_BYTES.length, uploaded_at: 1, storage_path: 'project-files/ws/p/f', state: 'ready',
          }])
        if (url.pathname === '/rest/v1/cloud_project_checkpoints') return reply([])
        if (url.pathname === '/rest/v1/cloud_project_checkpoint_stages' && init?.method === 'POST') {
          stageWrites += 1
          return reply([])
        }
        throw new Error(`Unexpected request: ${url.pathname}`)
      })
      try {
        const api = await CloudProjectApi.fromRequest(apiRequest())
        await expect(api.execute({
          action: 'capture-checkpoint',
          projectId: PROJECT_ID,
          expectedRevision: scenario.revision,
          expectedFileIds: scenario.fileIds,
          reason: 'Contract guard',
        })).rejects.toMatchObject({ code: scenario.code })
        expect(stageWrites).toBe(0)
      } finally {
        restore()
      }
    }
  })

  test('checkpoint list omits the full record while get returns its scoped immutable manifest', async () => {
    const queries: URL[] = []
    const row = {
      checkpoint_id: 'checkpoint-list-id',
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      parent_checkpoint_id: null,
      reason: 'Before release',
      actor_user_id: 'user-checkpoints',
      created_at: '2026-09-26T10:00:00.000Z',
      originating_record_revision: 7,
      record_schema_version: 4,
      record_digest: 'a'.repeat(64),
      integrity_digest: 'b'.repeat(64),
      record: PROJECT_RECORD,
      file_manifest: [{
        fileId: FILE_ID,
        name: 'source.txt',
        type: 'text/plain',
        size: FILE_BYTES.length,
        uploadedAt: 1_700_000_000_000,
        sha256: 'c'.repeat(64),
        storageRef: `project-checkpoints/${WORKSPACE_ID}/${PROJECT_ID}/checkpoint-list-id/${FILE_ID}`,
      }],
    }
    const restore = configureProvider('viewer', url => {
      if (url.pathname === '/rest/v1/cloud_projects') return reply([{ record: PROJECT_RECORD }])
      if (url.pathname === '/rest/v1/cloud_project_checkpoints') {
        queries.push(url)
        return reply([row])
      }
      throw new Error(`Unexpected checkpoint read request: ${url.pathname}`)
    })
    try {
      const api = await CloudProjectApi.fromRequest(apiRequest())
      const listed = await api.execute({ action: 'list-checkpoints', projectId: PROJECT_ID })
      expect(listed.checkpoints).toHaveLength(1)
      expect(listed.checkpoints[0]).toMatchObject({
        checkpointId: 'checkpoint-list-id',
        reason: 'Before release',
        files: row.file_manifest,
      })
      expect(listed.checkpoints[0]).not.toHaveProperty('record')
      const read = await api.execute({
        action: 'get-checkpoint', projectId: PROJECT_ID, checkpointId: 'checkpoint-list-id',
      })
      expect(read.checkpoint).toMatchObject({
        checkpointId: 'checkpoint-list-id',
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        record: PROJECT_RECORD,
        files: row.file_manifest,
      })
      expect(queries.length).toBeGreaterThanOrEqual(2)
      for (const query of queries) {
        expect(query.searchParams.get('workspace_id')).toBe(`eq.${WORKSPACE_ID}`)
        expect(query.searchParams.get('project_id')).toBe(`eq.${PROJECT_ID}`)
      }
    } finally {
      restore()
    }
  })

  test('cloud checkpoint verification hashes an older supported record without migrating its immutable bytes', async () => {
    const checkpointId = 'checkpoint-older-schema'
    const oldRecord = { ...PROJECT_RECORD, schemaVersion: 3 }
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const makeCheckpoint = (record: Record<string, unknown>) => {
      const checkpoint = {
        checkpointId,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        parentCheckpointId: null,
        reason: 'Older schema baseline',
        actorUserId: 'user-checkpoints',
        createdAt: Date.parse('2026-09-26T10:00:00.000Z'),
        originatingRecordRevision: 7,
        recordSchemaVersion: 3,
        recordDigest: digest(canonicalCheckpointJson(record)),
        integrityDigest: '',
        record,
        files: [{
          fileId: FILE_ID,
          name: 'source.txt',
          type: 'text/plain',
          size: FILE_BYTES.length,
          uploadedAt: 1_700_000_000_000,
          sha256: digest(FILE_BYTES.toString()),
          storageRef: `project-checkpoints/${WORKSPACE_ID}/${PROJECT_ID}/${checkpointId}/${FILE_ID}`,
        }],
      }
      const { integrityDigest: _integrityDigest, ...content } = checkpoint
      checkpoint.integrityDigest = digest(canonicalCheckpointJson(content))
      return checkpoint
    }
    const checkpoint = makeCheckpoint(oldRecord)
    const restore = globalThis.fetch
    const mockCheckpointFetch = (current: ReturnType<typeof makeCheckpoint>) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/cloud-projects') {
          const request = JSON.parse(String(init?.body)) as { action?: string }
          expect(request.action).toBe('get-checkpoint')
          return reply({ checkpoint: current })
        }
        if (url === `/api/cloud-files?checkpointId=${checkpointId}&fileId=${FILE_ID}`)
          return new Response(FILE_BYTES)
        throw new Error(`Unexpected cloud checkpoint verification request: ${url}`)
      }) as typeof fetch
    globalThis.fetch = mockCheckpointFetch(checkpoint)
    try {
      const { cloudProjectRepository } = await import('../../src/cloudProjectRepository')
      const verified = await cloudProjectRepository.verifyProjectCheckpoint(PROJECT_ID, checkpointId)
      expect(verified).toMatchObject({ valid: true, issues: [], usable: false })
      expect(verified.usabilityIssues).toEqual([
        expect.stringMatching(/schema version 3 is not supported for restore/i),
      ])

      const rawTamperedRecord = { ...oldRecord, projectName: 'Altered raw legacy record' }
      const tamperedCheckpoint = makeCheckpoint(rawTamperedRecord)
      tamperedCheckpoint.recordDigest = checkpoint.recordDigest
      const { integrityDigest: _oldIntegrity, ...tamperedContent } = tamperedCheckpoint
      tamperedCheckpoint.integrityDigest = digest(canonicalCheckpointJson(tamperedContent))
      globalThis.fetch = mockCheckpointFetch(tamperedCheckpoint)
      const tampered = await cloudProjectRepository.verifyProjectCheckpoint(PROJECT_ID, checkpointId)
      expect(tampered.valid).toBe(false)
      expect(tampered.issues.join(' ')).toMatch(/record digest/i)
      expect(tampered.usabilityIssues).toEqual([
        expect.stringMatching(/schema version 3 is not supported for restore/i),
      ])
    } finally {
      globalThis.fetch = restore
    }
  })

  test('failed archive upload or finalization cleans only staged objects and abandons staged metadata', async () => {
    for (const failure of ['upload', 'finalize'] as const) {
      const calls: Array<{ path: string; method: string }> = []
      const stagedPaths: string[] = []
      const restore = configureProvider('editor', async (url, init) => {
        const method = init?.method ?? 'GET'
        calls.push({ path: url.pathname, method })
        if (url.pathname === '/rest/v1/cloud_projects') return reply([{ record: PROJECT_RECORD }])
        if (url.pathname === '/rest/v1/cloud_project_files')
          return reply([{
            file_id: FILE_ID, project_id: PROJECT_ID, name: 'source.txt', type: 'text/plain',
            size: FILE_BYTES.length, uploaded_at: 5, storage_path: 'project-files/ws/p/f', state: 'ready',
          }])
        if (url.pathname === '/rest/v1/cloud_project_checkpoints') return reply([])
        if (url.pathname === '/rest/v1/cloud_project_checkpoint_file_stages') {
          if (method === 'POST') {
            const fileStage = JSON.parse(String(init?.body)) as { storage_path: string }
            stagedPaths.push(fileStage.storage_path)
            return reply([])
          }
          return reply(stagedPaths.map(storage_path => ({ storage_path })))
        }
        if (url.pathname.startsWith('/rest/v1/cloud_project_checkpoint_stages')) return reply([])
        if (url.pathname === '/storage/v1/object/project-files/ws/p/f') return new Response(FILE_BYTES)
        if (url.pathname.startsWith('/storage/v1/object/project-checkpoints/')) {
          if (failure === 'upload' && method === 'POST') return reply({ message: 'upload denied' }, 403)
          if (method === 'POST' || method === 'DELETE') return reply({})
          if (method === 'GET') return new Response(FILE_BYTES)
        }
        if (url.pathname === '/rest/v1/rpc/finalize_cloud_project_checkpoint')
          return reply({ message: 'finalize failed' }, 503)
        if (url.pathname === '/rest/v1/cloud_project_checkpoints' && url.searchParams.has('checkpoint_id'))
          return reply([])
        if (url.pathname === '/rest/v1/rpc/abandon_cloud_project_checkpoint') return reply(true)
        throw new Error(`Unexpected cleanup request: ${url.pathname} ${method}`)
      })
      try {
        const api = await CloudProjectApi.fromRequest(apiRequest())
        await expect(api.execute({
          action: 'capture-checkpoint',
          projectId: PROJECT_ID,
          expectedRevision: 7,
          expectedFileIds: [FILE_ID],
          reason: 'Before release',
        })).rejects.toBeInstanceOf(CloudApiError)
        const archiveDeletes = calls.filter(call =>
          call.path.startsWith('/storage/v1/object/project-checkpoints/') && call.method === 'DELETE')
        expect(archiveDeletes).toHaveLength(1)
        expect(calls.some(call => call.path.startsWith('/storage/v1/object/project-files/') && call.method === 'DELETE'))
          .toBe(false)
        expect(calls.findIndex(call => call.path.startsWith('/storage/v1/object/project-checkpoints/') && call.method === 'DELETE'))
          .toBeLessThan(calls.findIndex(call => call.path === '/rest/v1/rpc/abandon_cloud_project_checkpoint'))
      } finally {
        restore()
      }
    }
  })

  test('deleting a cloud project removes archive and live objects before finalizing metadata deletion', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
    const deletionId = '11111111-2222-4333-8444-555555555555'
    const checkpointId = 'checkpoint-retained-before-delete'
    const archivePath = `project-checkpoints/${WORKSPACE_ID}/${PROJECT_ID}/${checkpointId}/${FILE_ID}`
    const livePath = `project-files/${WORKSPACE_ID}/${PROJECT_ID}/${FILE_ID}`
    const remainingObjects = new Set([archivePath, livePath])
    const restore = configureProvider('owner', (url, init) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined
      calls.push({ path: url.pathname, method, body })
      if (url.pathname === '/rest/v1/cloud_project_restore_stages') return reply([])
      if (url.pathname === '/rest/v1/cloud_project_deletions')
        return reply([{ project_id: PROJECT_ID }])
      if (url.pathname === '/rest/v1/cloud_project_deletion_objects')
        return reply([{ object_ref: archivePath }, { object_ref: livePath }])
      if (url.pathname.startsWith('/storage/v1/object/')) {
        const objectPath = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''))
          .replace(/^project-checkpoints\//, 'project-checkpoints/')
          .replace(/^project-files\//, 'project-files/')
        if (method === 'DELETE') remainingObjects.delete(objectPath)
        return reply({})
      }
      if (url.pathname === '/rest/v1/rpc/begin_cloud_project_deletion') return reply(deletionId)
      if (url.pathname === '/rest/v1/rpc/finish_cloud_project_deletion') return reply(true)
      throw new Error(`Unexpected project deletion request: ${url.pathname} ${method}`)
    })
    try {
      const api = await CloudProjectApi.fromRequest(apiRequest())
      await expect(api.execute({ action: 'delete', projectId: PROJECT_ID }))
        .resolves.toEqual({ projects: [] })
      const archiveDeleteIndex = calls.findIndex(call =>
        call.path === `/storage/v1/object/${archivePath}` && call.method === 'DELETE')
      const liveDeleteIndex = calls.findIndex(call =>
        call.path === `/storage/v1/object/${livePath}` && call.method === 'DELETE')
      const beginCall = calls.find(call => call.path === '/rest/v1/rpc/begin_cloud_project_deletion')
      const finishCall = calls.find(call => call.path === '/rest/v1/rpc/finish_cloud_project_deletion')
      const finishIndex = calls.findIndex(call => call.path === '/rest/v1/rpc/finish_cloud_project_deletion')
      expect(archiveDeleteIndex).toBeGreaterThan(-1)
      expect(liveDeleteIndex).toBeGreaterThan(-1)
      expect(beginCall?.body).toEqual({ p_project_id: PROJECT_ID, p_workspace_id: WORKSPACE_ID })
      expect(finishCall?.body).toEqual({ p_deletion_id: deletionId })
      expect(finishIndex).toBeGreaterThan(archiveDeleteIndex)
      expect(finishIndex).toBeGreaterThan(liveDeleteIndex)
      expect(remainingObjects).toEqual(new Set())
    } finally {
      restore()
    }
  })

  test('checkpoint migration enforces workspace RLS, immutable records, guarded atomic finalization, and private Storage', () => {
    const sql = readFileSync('supabase/migrations/20260926000200_project_checkpoints.sql', 'utf8')
    for (const table of [
      'cloud_project_checkpoint_stages',
      'cloud_project_checkpoint_file_stages',
      'cloud_project_checkpoints',
      'cloud_project_checkpoint_files',
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    }
    expect(sql).toContain("public.workspace_can(workspace_id, 'read')")
    expect(sql).toContain("public.workspace_can(workspace_id, 'write')")
    expect(sql).toContain("grant select on public.cloud_project_checkpoints, public.cloud_project_checkpoint_files to authenticated")
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all).*cloud_project_checkpoints\s+to\s+authenticated/i)
    expect(sql).toContain("project_id text not null")
    expect(sql).toContain("on delete restrict")
    expect(sql).toMatch(/where\s+workspace_id\s*=\s*staged\.workspace_id\s+and\s+project_id\s*=\s*staged\.project_id\s+and\s+state\s*=\s*'ready'/i)
    expect(sql).toMatch(/create policy cloud_checkpoint_stages_select[\s\S]*?actor_user_id = \(select auth\.uid\(\)\)[\s\S]*?public\.workspace_can\(workspace_id, 'write'\)/i)
    expect(sql).toMatch(/create policy cloud_checkpoint_file_stages_select[\s\S]*?stage\.actor_user_id = \(select auth\.uid\(\)\)[\s\S]*?public\.workspace_can\(stage\.workspace_id, 'replace'\)/i)
    const checkpointReadPolicies = [...sql.matchAll(/create policy project_checkpoints_read_authorized on storage\.objects[\s\S]*?;\s*/gi)]
    const checkpointReadPolicy = checkpointReadPolicies.at(-1)?.[0] ?? ''
    expect(checkpointReadPolicy).toMatch(/cloud_project_deletion_objects[\s\S]*?join public\.cloud_project_deletions deletion/i)
    expect(checkpointReadPolicy).toMatch(/entry\.object_ref = 'project-checkpoints\/' \|\| storage\.objects\.name/i)
    expect(checkpointReadPolicy).toMatch(/public\.workspace_can\(deletion\.workspace_id, 'delete'\)/i)
    const checkpointDeleteTrigger = sql.match(/create\s+trigger\s+([\w]+)\s+before\s+delete\s+on\s+storage\.objects[\s\S]*?execute\s+function\s+public\.([\w]+)\(\);/i)
    expect(checkpointDeleteTrigger).not.toBeNull()
    const checkpointDeleteGuard = checkpointDeleteTrigger
      ? sql.match(new RegExp(`create or replace function public\\.${checkpointDeleteTrigger[2]}\\(\\)[\\s\\S]*?\\$function\\$;`, 'i'))?.[0] ?? ''
      : ''
    expect(checkpointDeleteGuard).toMatch(/old\.bucket_id\s*(?:<>|!=)\s*'project-checkpoints'/i)
    expect(checkpointDeleteGuard).toMatch(/cloud_project_checkpoint_file_stages/i)
    expect(checkpointDeleteGuard).toMatch(/cloud_project_checkpoint_files/i)
    expect(checkpointDeleteGuard).toMatch(/perform pg_advisory_xact_lock\(hashtext\(target_checkpoint::text\)\)/i)
    expect(checkpointDeleteGuard).toMatch(/select status into project_status from public\.cloud_projects[\s\S]*?for update/i)
    expect(checkpointDeleteGuard).toMatch(/into staged_exists/i)
    expect(checkpointDeleteGuard).toMatch(/into committed_exists/i)
    expect(checkpointDeleteGuard).toMatch(/into tombstone_exists/i)
    expect(checkpointDeleteGuard).toMatch(/if tombstone_exists and not staged_exists and not committed_exists[\s\S]*?project_status = 'deleting' then[\s\S]*?return old/i)
    expect(checkpointDeleteGuard).toMatch(/raise exception 'Checkpoint object is committed or no longer safely deletable'/i)
    expect(sql).toContain("project_row.record_revision <> p_expected_revision")
    expect(sql).toContain("actual_ready_ids is distinct from")
    expect(sql).toContain("Checkpoint staged file set is incomplete")
    expect(sql).toContain("Checkpoint parent changed during capture")
    expect(sql).toContain("security definer")
    expect(sql).toContain("bucket_id = 'project-checkpoints'")
    expect(sql).toContain("values ('project-checkpoints', 'project-checkpoints', false, 104857600)")
    expect(sql).toContain("Checkpoint archive objects remain; remove them before cleanup")
    expect(sql).toContain("values ('project-checkpoints', 3)")
  })
})