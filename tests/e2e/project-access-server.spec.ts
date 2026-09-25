import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JsonFileProjectOwnershipDirectory } from '../../server/localDevProjectAccess'
import { isSameOriginRequest } from '../../server/projectAccessPlugin'
import type { IncomingMessage } from 'node:http'
import {
  authorizeWorkspace,
  PROJECT_PERMISSIONS,
  type MembershipRole,
  type ProjectPermission,
  type ProjectOwnership,
} from '../../src/ownership'
import {
  createProjectAccessService,
  type MembershipLookupResult,
  type ProjectOwnershipDirectory,
  type VerifiedSession,
} from '../../server/projectAccess'

const NOW = 1_700_000_000_000
const WORKSPACE = 'workspace-a'
const ACTOR = 'actor-a'
const TOKEN = 'opaque-server-session-token'

type FakeRequest = IncomingMessage & { headers: IncomingMessage['headers'] }

class MemoryDirectory implements ProjectOwnershipDirectory {
  readonly entries = new Map<string, ProjectOwnership>()

  async get(projectId: string) {
    const ownership = this.entries.get(projectId)
    return ownership ? { ...ownership } : null
  }

  async listByWorkspace(workspaceId: string) {
    return [...this.entries]
      .filter(([, ownership]) => ownership.workspaceId === workspaceId)
      .map(([projectId]) => projectId)
      .sort()
  }

  async insert(projectId: string, ownership: ProjectOwnership) {
    if (this.entries.has(projectId)) return false
    this.entries.set(projectId, { ...ownership })
    return true
  }

  async insertMany(entries: ReadonlyArray<{ projectId: string; ownership: ProjectOwnership }>) {
    if (entries.some(({ projectId }) => this.entries.has(projectId))) return false
    for (const { projectId, ownership } of entries) {
      this.entries.set(projectId, { ...ownership })
    }
    return true
  }

  async remove(projectId: string) {
    this.entries.delete(projectId)
  }
}

function createFixture(options: {
  userId?: string
  workspaceId?: string
  role?: MembershipRole
  expiresAt?: number
  credential?: string
  generatedIds?: string[]
} = {}) {
  const userId = options.userId ?? ACTOR
  const workspaceId = options.workspaceId ?? WORKSPACE
  const credential = options.credential ?? TOKEN
  const sessions = new Map<string, VerifiedSession>([
    [credential, {
      userId,
      activeWorkspaceId: workspaceId,
      expiresAt: options.expiresAt ?? NOW + 60_000,
    }],
  ])
  const memberships = new Map<string, MembershipLookupResult>([
    [`${userId}:${workspaceId}`, { status: 'active', role: options.role ?? 'owner' }],
  ])
  const directory = new MemoryDirectory()
  let generatedIndex = 0
  const service = createProjectAccessService({
    sessionVerifier: {
      async verify(request) {
        const authorization = request.headers.authorization
        const suppliedCredential = typeof authorization === 'string'
          ? authorization.replace(/^Bearer /, '')
          : ''
        return sessions.get(suppliedCredential) ?? null
      },
    },
    membershipLookup: {
      async lookup(lookupUserId, lookupWorkspaceId) {
        return memberships.get(`${lookupUserId}:${lookupWorkspaceId}`) ?? { status: 'missing' }
      },
    },
    projectDirectory: directory,
    now: () => NOW,
    generateProjectId: () => options.generatedIds?.[generatedIndex++] ?? `server-project-${generatedIndex++}`,
  })
  const requestFor = (key = credential): FakeRequest => ({
    headers: { authorization: `Bearer ${key}` },
  } as FakeRequest)
  return { service, directory, sessions, memberships, requestFor, userId, workspaceId }
}

const permissionActions: Record<ProjectPermission, { action: string; projectId?: string }> = {
  create: { action: 'create', projectId: 'new-created-project' },
  read: { action: 'read', projectId: 'seed-project' },
  write: { action: 'write', projectId: 'seed-project' },
  delete: { action: 'delete', projectId: 'seed-project' },
  duplicate: { action: 'duplicate', projectId: 'seed-project' },
  backup: { action: 'backup', projectId: 'seed-project' },
  'restore-new': { action: 'restore-new' },
  replace: { action: 'replace', projectId: 'seed-project' },
}

test('server permissions stay consistent with src/ownership role policy', async () => {
  const roleMatrix: Record<MembershipRole, ProjectPermission[]> = {
    owner: [...PROJECT_PERMISSIONS],
    admin: [...PROJECT_PERMISSIONS],
    editor: ['create', 'read', 'write', 'duplicate', 'backup', 'restore-new'],
    viewer: ['read', 'backup'],
  }

  for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
    for (const permission of PROJECT_PERMISSIONS) {
      const fixture = createFixture({ role, generatedIds: [`generated-${role}-${permission}`] })
      await fixture.directory.insert('seed-project', {
        ownerUserId: 'original-owner',
        workspaceId: WORKSPACE,
      })
      const context = {
        user: { id: fixture.userId },
        workspace: { id: fixture.workspaceId },
        membership: { userId: fixture.userId, workspaceId: fixture.workspaceId, role },
      }
      let ownershipAllows = true
      try {
        authorizeWorkspace(context, permission)
      } catch {
        ownershipAllows = false
      }
      expect(ownershipAllows, `${role} policy for ${permission}`).toBe(roleMatrix[role].includes(permission))

      const action = permissionActions[permission]
      let serverAllows = true
      try {
        await fixture.service.execute({
          action: action.action,
          ...(action.projectId ? { projectId: action.projectId } : {}),
        }, fixture.requestFor())
      } catch (error) {
        serverAllows = false
        expect(error).toBeInstanceOf(Error)
        if (!ownershipAllows) expect(error).toHaveProperty('name', 'ProjectAuthorizationError')
      }
      expect(serverAllows, `server ${role} permission for ${permission}`).toBe(ownershipAllows)
    }
  }
})

test('sessions require server-owned credentials and fresh active membership', async () => {
  const expired = createFixture({ expiresAt: NOW })
  await expect(expired.service.execute({ action: 'list' }, expired.requestFor()))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
  await expect(expired.service.execute({ action: 'list' }, expired.requestFor('unknown-token')))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

  for (const status of ['revoked', 'missing'] as const) {
    const fixture = createFixture()
    fixture.memberships.set(`${ACTOR}:${WORKSPACE}`, { status })
    await expect(fixture.service.execute({ action: 'list' }, fixture.requestFor()))
      .rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_INACTIVE' })
  }

  const changedRole = createFixture({ role: 'owner' })
  changedRole.memberships.set(`${ACTOR}:${WORKSPACE}`, { status: 'active', role: 'viewer' })
  await expect(changedRole.service.execute({ action: 'delete', projectId: 'fresh-role-project' }, changedRole.requestFor()))
    .rejects.toMatchObject({ status: 404 })
  await changedRole.directory.insert('fresh-role-project', { ownerUserId: ACTOR, workspaceId: WORKSPACE })
  await expect(changedRole.service.execute(
    { action: 'delete', projectId: 'fresh-role-project' },
    changedRole.requestFor(),
  )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
})

test('cross-workspace projects, unknown IDs, and forged claims are denied', async () => {
  const fixture = createFixture()
  await fixture.directory.insert('foreign-project', {
    ownerUserId: ACTOR,
    workspaceId: 'workspace-b',
  })
  await expect(fixture.service.execute(
    { action: 'read', projectId: 'foreign-project' },
    fixture.requestFor(),
  )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
  await expect(fixture.service.execute(
    { action: 'read', projectId: 'unknown-project' },
    fixture.requestFor(),
  )).rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' })

  for (const forgedClaims of [
    { role: 'owner' },
    { workspaceId: WORKSPACE },
    { userId: ACTOR },
    { role: 'owner', workspaceId: WORKSPACE, userId: ACTOR },
  ]) {
    await expect(fixture.service.execute({
      action: 'read',
      projectId: 'foreign-project',
      ...forgedClaims,
    }, fixture.requestFor())).rejects.toMatchObject({ status: 400, code: 'UNEXPECTED_FIELD' })
  }

  const viewer = createFixture({ role: 'viewer' })
  await expect(viewer.service.execute({
    action: 'delete',
    projectId: 'viewer-escalation',
    role: 'owner',
  }, viewer.requestFor())).rejects.toMatchObject({ status: 400 })
  await viewer.directory.insert('viewer-escalation', { ownerUserId: ACTOR, workspaceId: WORKSPACE })
  await expect(viewer.service.execute(
    { action: 'delete', projectId: 'viewer-escalation' },
    viewer.requestFor(),
  )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
})

test('duplicate and restore-new allocate ownership on the server; replace checks destination access', async () => {
  const fixture = createFixture({
    role: 'editor',
    generatedIds: ['server-duplicate-id', 'server-restore-id'],
  })
  await fixture.directory.insert('duplicate-source', {
    ownerUserId: 'source-owner',
    workspaceId: WORKSPACE,
  })
  const duplicate = await fixture.service.execute(
    { action: 'duplicate', projectId: 'duplicate-source' },
    fixture.requestFor(),
  )
  expect(duplicate).toEqual({
    projectId: 'server-duplicate-id',
    ownerUserId: ACTOR,
    workspaceId: WORKSPACE,
  })
  expect(await fixture.directory.get('server-duplicate-id')).toEqual({
    ownerUserId: ACTOR,
    workspaceId: WORKSPACE,
  })

  const restored = await fixture.service.execute({ action: 'restore-new' }, fixture.requestFor())
  expect(restored).toEqual({
    projectId: 'server-restore-id',
    ownerUserId: ACTOR,
    workspaceId: WORKSPACE,
  })
  expect(await fixture.directory.get('server-restore-id')).toEqual({
    ownerUserId: ACTOR,
    workspaceId: WORKSPACE,
  })

  const collision = createFixture({ generatedIds: ['server-collision'] })
  await collision.directory.insert('duplicate-source', { ownerUserId: ACTOR, workspaceId: WORKSPACE })
  await collision.directory.insert('server-collision', {
    ownerUserId: 'existing-owner',
    workspaceId: WORKSPACE,
  })
  await expect(collision.service.execute(
    { action: 'duplicate', projectId: 'duplicate-source' },
    collision.requestFor(),
  )).rejects.toMatchObject({ status: 409, code: 'PROJECT_EXISTS' })
  expect(await collision.directory.get('server-collision')).toEqual({
    ownerUserId: 'existing-owner',
    workspaceId: WORKSPACE,
  })

  await fixture.directory.insert('replace-destination', {
    ownerUserId: 'destination-owner',
    workspaceId: WORKSPACE,
  })
  const editorReplacement = fixture.service.execute(
    { action: 'replace', projectId: 'replace-destination' },
    fixture.requestFor(),
  )
  await expect(editorReplacement).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
  const admin = createFixture({ role: 'admin' })
  await admin.directory.insert('replace-destination', {
    ownerUserId: 'destination-owner',
    workspaceId: WORKSPACE,
  })
  expect(await admin.service.execute(
    { action: 'replace', projectId: 'replace-destination' },
    admin.requestFor(),
  )).toMatchObject({ projectId: 'replace-destination', workspaceId: WORKSPACE })
})

test('delete-complete removes the ownership record after authorization', async () => {
  const fixture = createFixture()
  await fixture.directory.insert('complete-delete-project', {
    ownerUserId: ACTOR,
    workspaceId: WORKSPACE,
  })
  expect(await fixture.service.execute(
    { action: 'delete-complete', projectId: 'complete-delete-project' },
    fixture.requestFor(),
  )).toMatchObject({ projectId: 'complete-delete-project' })
  expect(await fixture.directory.get('complete-delete-project')).toBeNull()
})

test('HTTP project-access accepts no identity claims and returns metadata only', async ({ request, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required for the local API integration')
  const origin = new URL(baseURL).origin
  const call = (data: object) => request.post('/api/project-access', {
    headers: { Origin: origin },
    data,
  })

  const forged = await call({
    action: 'create',
    projectId: `http-forged-${Date.now()}`,
    role: 'owner',
    workspaceId: 'attacker-workspace',
    userId: 'attacker-user',
    blob: 'must never be stored or returned',
  })
  expect(forged.status()).toBe(400)
  expect(await forged.json()).toMatchObject({ code: 'UNEXPECTED_FIELD' })

  const projectId = `http-contract-${Date.now()}`
  const created = await call({ action: 'create', projectId })
  expect(created.status()).toBe(200)
  expect(await created.json()).toEqual({
    projectId,
    ownerUserId: 'local-user',
    workspaceId: 'local-workspace',
  })

  const read = await call({ action: 'read', projectId })
  expect(read.status()).toBe(200)
  const response = await read.json()
  expect(response).toEqual({
    projectId,
    ownerUserId: 'local-user',
    workspaceId: 'local-workspace',
  })
  expect(JSON.stringify(response)).not.toContain('blob')
  expect(JSON.stringify(response)).not.toContain('must never be stored')

  const removed = await call({ action: 'delete-complete', projectId })
  expect(removed.status()).toBe(200)
})

test('local metadata writers do not lose concurrent ownership records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'docflow-auth-test-'))
  try {
    const file = path.join(directory, 'ownership.json')
    const writers = Array.from({ length: 3 }, () => new JsonFileProjectOwnershipDirectory(file))
    await Promise.all(Array.from({ length: 18 }, (_, index) =>
      writers[index % writers.length].insert(`concurrent-${index}`, {
        ownerUserId: 'local-user', workspaceId: 'local-workspace',
      })))
    const ids = await writers[0].listByWorkspace('local-workspace')
    expect(ids).toHaveLength(18)
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')))).toHaveLength(18)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('origin validation does not trust forged forwarded authority', () => {
  const request = {
    headers: {
      host: '127.0.0.1:4173',
      origin: 'https://forged.example',
      'x-forwarded-host': 'forged.example',
      'x-forwarded-proto': 'https',
    },
    socket: { encrypted: false },
  } as unknown as IncomingMessage
  expect(isSameOriginRequest(request)).toBe(false)
})