import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ConnectionError, decryptCredential, encryptCredential, encryptionKey, executeConnections,
  handleAiConnections, readEncryptedFromDatabase, sendConnectionError, type ConnectionDependencies,
} from '../../server/aiConnectionsApi'

const workspaceId = 'workspace-one'
const providerId = 'neutral-provider'
const key = randomBytes(32)
const timestamp = '2026-09-26T12:00:00.000Z'

function fixture() {
  const rows = new Map<string, { workspaceId: string; providerId: string; revision: number; state: string;
    proof: string | null; testedAt: string | null; updatedAt: string; updatedBy: string;
    ciphertext: string; nonce: string; tag: string }>()
  const calls: Record<string, unknown>[] = []
  const safe = (row: NonNullable<ReturnType<typeof rows.get>>) => {
    const { ciphertext: _ciphertext, nonce: _nonce, tag: _tag, ...metadata } = row
    return metadata
  }
  let outcome: 'verified' | 'failed' | 'unavailable' = 'verified'
  const dependencies: ConnectionDependencies = {
    async command(args) {
      calls.push(args)
      const action = args.p_action
      if (action === 'list') return { connections: [...rows.values()].filter(row => row.workspaceId === args.p_workspace_id).map(safe) }
      const id = `${args.p_workspace_id}:${args.p_provider_id}`
      const existing = rows.get(id)
      if (action === 'create' && existing || action !== 'create' && (!existing || existing.revision !== args.p_expected_revision))
        throw new ConnectionError(409, 'REVISION_CONFLICT', 'stale')
      if (action === 'delete') { rows.delete(id); return { deleted: true, providerId: args.p_provider_id, revision: existing!.revision } }
      if (action === 'create' || action === 'replace') {
        const row = {
          workspaceId: String(args.p_workspace_id), providerId: String(args.p_provider_id),
          revision: action === 'create' ? 1 : existing!.revision + 1,
          state: 'untested', proof: null, testedAt: null, updatedAt: timestamp, updatedBy: 'owner',
          ciphertext: String(args.p_ciphertext), nonce: String(args.p_nonce), tag: String(args.p_tag),
        }
        rows.set(id, row)
        return { connection: safe(row) }
      }
      if (action === 'test') {
        const row = { ...existing!, state: String(args.p_state), proof: String(args.p_proof),
          testedAt: String(args.p_tested_at), updatedAt: timestamp }
        rows.set(id, row)
        return { connection: safe(row) }
      }
      throw new Error('unexpected action')
    },
    async readEncrypted(workspace, provider) {
      const row = rows.get(`${workspace}:${provider}`)
      return row ? { workspaceId: row.workspaceId, providerId: row.providerId, revision: row.revision,
        ciphertext: Buffer.from(row.ciphertext, 'base64'), nonce: Buffer.from(row.nonce, 'base64'),
        tag: Buffer.from(row.tag, 'base64'), keyVersion: 'v1' } : null
    },
    async verify(_provider, credential) {
      expect(credential).toBe('test-only-fixture-key')
      return outcome
    },
  }
  return { rows, calls, dependencies, setOutcome: (value: typeof outcome) => { outcome = value } }
}

test('authenticated encryption binds workspace, provider and revision; missing key fails closed', () => {
  expect(() => encryptionKey('')).toThrowError(ConnectionError)
  expect(() => encryptionKey('not-base64')).toThrowError(ConnectionError)
  const value = encryptCredential(key, workspaceId, providerId, 1, 'test-only-fixture-key')
  expect(value.ciphertext).not.toContain('test-only-fixture-key')
  const row = { workspaceId, providerId, revision: 1, ciphertext: Buffer.from(value.ciphertext, 'base64'),
    nonce: Buffer.from(value.nonce, 'base64'), tag: Buffer.from(value.tag, 'base64'), keyVersion: 'v1' }
  expect(decryptCredential(key, row)).toBe('test-only-fixture-key')
  expect(() => decryptCredential(key, { ...row, workspaceId: 'another-workspace' })).toThrowError(ConnectionError)
  expect(() => decryptCredential(key, { ...row, revision: 2 })).toThrowError(ConnectionError)
})

test('restricted database reader rejects TLS downgrade URL options before connecting', async () => {
  const original = process.env.AI_CONNECTION_DATABASE_URL
  try {
    for (const suffix of ['?sslmode=disable', '?sslmode=no-verify', '?sslmode=require', '#fragment']) {
      process.env.AI_CONNECTION_DATABASE_URL =
        `postgresql://ai_connection_reader:fixture-password@localhost:5432/test${suffix}`
      await expect(readEncryptedFromDatabase(workspaceId, providerId))
        .rejects.toMatchObject({ code: 'READER_UNAVAILABLE' })
    }
  } finally {
    if (original === undefined) delete process.env.AI_CONNECTION_DATABASE_URL
    else process.env.AI_CONNECTION_DATABASE_URL = original
  }
})

test('create, verified/failed/unavailable test, replace and delete return metadata only', async () => {
  const store = fixture()
  const rawCommand = store.dependencies.command
  store.dependencies.command = async args => {
    const result = await rawCommand(args)
    if (args.p_action === 'test' && result && typeof result === 'object' && 'connection' in result) {
      const connection = (result as { connection: Record<string, unknown> }).connection
      // PostgreSQL timestamptz loses JS's literal ".000Z" formatting on a real round trip.
      const databaseTimestamp = String(connection.testedAt).replace('.000Z', '+00:00')
      connection.testedAt = databaseTimestamp
      store.rows.get(`${workspaceId}:${providerId}`)!.testedAt = databaseTimestamp
    }
    return result
  }
  const run = (input: unknown) => executeConnections(input, workspaceId, 'owner', key, store.dependencies)
  const created = await run({ action: 'create', providerId, credential: 'test-only-fixture-key' })
  expect(created).toMatchObject({ connection: { providerId, revision: 1, state: 'untested' } })
  expect(JSON.stringify(created)).not.toMatch(/ciphertext|nonce|tag|proof|credential|test-only-fixture-key/)
  expect(await run({ action: 'list' })).toMatchObject({ connections: [{ state: 'untested' }] })
  const verified = await run({ action: 'test', providerId, expectedRevision: 1 })
  expect(verified).toMatchObject({ connection: { state: 'verified', revision: 1 } })
  store.setOutcome('failed')
  expect(await run({ action: 'test', providerId, expectedRevision: 1 })).toMatchObject({ connection: { state: 'failed' } })
  store.setOutcome('unavailable')
  expect(await run({ action: 'test', providerId, expectedRevision: 1 })).toMatchObject({ connection: { state: 'unavailable' } })
  expect(await run({ action: 'replace', providerId, expectedRevision: 1, credential: 'test-only-fixture-key' }))
    .toMatchObject({ connection: { revision: 2, state: 'untested', testedAt: null } })
  expect(await run({ action: 'delete', providerId, expectedRevision: 2 }))
    .toEqual({ deleted: true, providerId, revision: 2 })
  expect(await run({ action: 'list' })).toEqual({ connections: [] })
  expect(JSON.stringify(store.calls.filter(call => call.p_action === 'list'))).not.toContain('ciphertext')
})

test('read-only roles, stale versions, foreign rows and malformed confirmations fail closed', async () => {
  const store = fixture()
  await executeConnections({ action: 'create', providerId, credential: 'test-only-fixture-key' }, workspaceId, 'admin', key, store.dependencies)
  for (const role of ['editor', 'viewer']) {
    expect(await executeConnections({ action: 'list' }, workspaceId, role, key, store.dependencies))
      .toMatchObject({ connections: [{ providerId }] })
    for (const action of ['test', 'delete', 'replace']) {
      await expect(executeConnections(action === 'replace'
        ? { action, providerId, expectedRevision: 1, credential: 'fixture' }
        : { action, providerId, expectedRevision: 1 },
        workspaceId, role, key, store.dependencies)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  }
  await expect(executeConnections({ action: 'replace', providerId, expectedRevision: 2, credential: 'fixture' },
    workspaceId, 'owner', key, store.dependencies)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  await expect(executeConnections({ action: 'test', providerId, expectedRevision: 1 },
    'other-workspace', 'owner', key, store.dependencies)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const invalid: ConnectionDependencies = { ...store.dependencies, command: async () => ({ connection: { providerId, ciphertext: 'leak' } }) }
  await expect(executeConnections({ action: 'create', providerId: 'second', credential: 'fixture' },
    workspaceId, 'owner', key, invalid)).rejects.toMatchObject({ code: 'STORAGE_RESPONSE_INVALID' })
  const forged: ConnectionDependencies = { ...store.dependencies, command: async () => ({ connections: [{
    workspaceId, providerId, revision: 1, state: 'verified', proof: 'a'.repeat(64), testedAt: timestamp,
    updatedAt: timestamp, updatedBy: 'owner',
  }] }) }
  await expect(executeConnections({ action: 'list' }, workspaceId, 'viewer', key, forged))
    .rejects.toMatchObject({ code: 'STORAGE_RESPONSE_INVALID' })
})

test('server requires its encryption key and forwards only redacted confirmations', async () => {
  const saved = { key: process.env.AI_CONNECTION_ENCRYPTION_KEY, url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY }
  const originalFetch = globalThis.fetch
  process.env.SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_ANON_KEY = 'public-test-anon-key'
  const request = (input: unknown): IncomingMessage => {
    const stream = Readable.from([JSON.stringify(input)]) as unknown as IncomingMessage
    Object.assign(stream, { headers: { cookie: 'sb_access_token=fixture-session' } })
    return stream
  }
  const invoke = async (input: unknown) => {
    const response = {
      statusCode: 200, headersSent: false, body: '',
      setHeader() {},
      end(body: string) { this.body = body; this.headersSent = true },
    } as unknown as ServerResponse & { body: string }
    await handleAiConnections(request(input), response).catch(error => sendConnectionError(response, error))
    return { status: response.statusCode, body: response.body }
  }
  try {
    delete process.env.AI_CONNECTION_ENCRYPTION_KEY
    const unavailable = await invoke({ action: 'list' })
    expect(unavailable.status).toBe(503)
    expect(JSON.parse(unavailable.body)).toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' })
    process.env.AI_CONNECTION_ENCRYPTION_KEY = key.toString('base64')
    const requests: { path: string; authorization: string | null; payload: unknown }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const payload = init?.body ? JSON.parse(String(init.body)) as unknown : null
      requests.push({ path, authorization: new Headers(init?.headers).get('authorization'), payload })
      if (path === '/auth/v1/user') return Response.json({ id: 'user-one' })
      if (path === '/rest/v1/workspace_memberships') return Response.json([{ workspace_id: workspaceId, role: 'owner' }])
      if (path === '/rest/v1/rpc/ai_connection_command') {
        if ((payload as Record<string, unknown>).p_action === 'create') {
          return Response.json({ connection: { workspaceId, providerId, revision: 1, state: 'untested',
            proof: null, testedAt: null, updatedAt: timestamp, updatedBy: 'user-one' } })
        }
        return Response.json({ connections: [] })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const created = await invoke({ action: 'create', workspaceId, providerId, credential: 'test-only-fixture-key' })
    expect(created.status).toBe(200)
    expect(created.body).not.toMatch(/ciphertext|nonce|tag|proof|test-only-fixture-key/)
    expect(requests.every(call => call.authorization === 'Bearer fixture-session')).toBe(true)
    expect(requests.find(call => call.path.includes('/rpc/'))?.payload).toMatchObject({
      p_workspace_id: workspaceId, p_provider_id: providerId,
    })
    expect(JSON.stringify(requests.find(call => call.path.includes('/rpc/'))?.payload))
      .not.toContain('test-only-fixture-key')
    const unexpected = await invoke({ action: 'list', workspaceId, credential: 'accidental-secret' })
    expect(unexpected.status).toBe(400)
    const revoked = await invoke({ action: 'list', workspaceId })
    expect(revoked.status).toBe(200)
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/auth/v1/user')) return Response.json({ id: 'user-one' })
      return Response.json([], { status: 200 })
    }) as typeof fetch
    expect((await invoke({ action: 'create', workspaceId, providerId, credential: 'fixture' })).status).toBe(403)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of [
      ['AI_CONNECTION_ENCRYPTION_KEY', saved.key],
      ['SUPABASE_URL', saved.url],
      ['SUPABASE_ANON_KEY', saved.anon],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('revocation never redirects a workspace A request to a surviving workspace B membership', async () => {
  const saved = { key: process.env.AI_CONNECTION_ENCRYPTION_KEY, url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY }
  const originalFetch = globalThis.fetch
  process.env.AI_CONNECTION_ENCRYPTION_KEY = key.toString('base64')
  process.env.SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_ANON_KEY = 'public-test-anon-key'
  let rpcCalls = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'user-one' })
    if (url.pathname === '/rest/v1/workspace_memberships') {
      // A was revoked; B remains active. The server must ask for A, not silently pick B.
      expect(url.searchParams.get('workspace_id')).toBe(`eq.${workspaceId}`)
      return Response.json([])
    }
    rpcCalls++
    return Response.json({ deleted: true, providerId, revision: 1 })
  }) as typeof fetch
  const request = Readable.from([JSON.stringify({ action: 'delete', workspaceId,
    providerId, expectedRevision: 1 })]) as unknown as IncomingMessage
  Object.assign(request, { headers: { cookie: 'sb_access_token=fixture-session' } })
  const response = {
    statusCode: 200, headersSent: false, body: '',
    setHeader() {},
    end(body: string) { this.body = body; this.headersSent = true },
  } as unknown as ServerResponse & { body: string }
  try {
    await handleAiConnections(request, response).catch(error => sendConnectionError(response, error))
    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'FORBIDDEN' })
    expect(rpcCalls).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of [
      ['AI_CONNECTION_ENCRYPTION_KEY', saved.key],
      ['SUPABASE_URL', saved.url],
      ['SUPABASE_ANON_KEY', saved.anon],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})