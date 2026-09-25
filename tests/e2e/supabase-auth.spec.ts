import { expect, test } from '@playwright/test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  LocalDevMembershipLookup,
  LocalDevSessionVerifier,
} from '../../server/localDevProjectAccess'
import { projectAccessPlugin } from '../../server/projectAccessPlugin'
import {
  createProjectAccessService,
  type MembershipLookupResult,
  type ProjectOwnershipDirectory,
  type VerifiedSession,
  type WorkspaceMembershipLookup,
} from '../../server/projectAccess'
import type { MembershipRole, ProjectOwnership } from '../../src/ownership'

const NOW = 1_700_000_000_000
const USER_ID = 'user-batch5'
const WORKSPACE_ID = 'workspace-batch5'
const SESSION_TOKEN = 'valid-session-token'

type TestRequest = IncomingMessage & { headers: IncomingMessage['headers'] }

class MemoryOwnershipDirectory implements ProjectOwnershipDirectory {
  private readonly projects = new Map<string, ProjectOwnership>()

  async get(projectId: string) {
    const ownership = this.projects.get(projectId)
    return ownership ? { ...ownership } : null
  }

  async listByWorkspace(workspaceId: string) {
    return [...this.projects]
      .filter(([, ownership]) => ownership.workspaceId === workspaceId)
      .map(([projectId]) => projectId)
  }

  async insert(projectId: string, ownership: ProjectOwnership) {
    if (this.projects.has(projectId)) return false
    this.projects.set(projectId, { ...ownership })
    return true
  }

  async insertMany(entries: ReadonlyArray<{ projectId: string; ownership: ProjectOwnership }>) {
    if (entries.some(({ projectId }) => this.projects.has(projectId))) return false
    for (const { projectId, ownership } of entries) this.projects.set(projectId, { ...ownership })
    return true
  }

  async remove(projectId: string) {
    this.projects.delete(projectId)
  }
}

function createAuthFixture(options: {
  session?: VerifiedSession | null
  role?: MembershipRole
  membership?: MembershipLookupResult
  membershipLookup?: WorkspaceMembershipLookup
} = {}) {
  const directory = new MemoryOwnershipDirectory()
  const session = options.session === undefined
    ? { userId: USER_ID, activeWorkspaceId: WORKSPACE_ID, expiresAt: NOW + 60_000 }
    : options.session
  const service = createProjectAccessService({
    sessionVerifier: {
      async verify(request) {
        return request.headers.authorization === `Bearer ${SESSION_TOKEN}` ? session : null
      },
    },
    membershipLookup: options.membershipLookup ?? {
      async lookup() {
        return options.membership ?? { status: 'active', role: options.role ?? 'owner' }
      },
    },
    projectDirectory: directory,
    now: () => NOW,
  })
  const request = (token = SESSION_TOKEN) => ({
    headers: { authorization: `Bearer ${token}` },
  } as TestRequest)
  return { service, directory, request }
}

test('a valid server-verified session is resolved with fresh active membership', async () => {
  const lookups: Array<[string, string]> = []
  const fixture = createAuthFixture({
    membershipLookup: {
      async lookup(userId, workspaceId) {
        lookups.push([userId, workspaceId])
        return { status: 'active', role: 'owner' }
      },
    },
  })

  const response = await fixture.service.execute({ action: 'create', projectId: 'owned-project' }, fixture.request())
  expect(response).toEqual({
    projectId: 'owned-project',
    ownerUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
  })
  expect(lookups).toEqual([[USER_ID, WORKSPACE_ID]])
})

test('expired and invalid sessions are rejected as unauthenticated', async () => {
  const expired = createAuthFixture({
    session: { userId: USER_ID, activeWorkspaceId: WORKSPACE_ID, expiresAt: NOW },
  })
  await expect(expired.service.execute({ action: 'list' }, expired.request()))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

  const invalid = createAuthFixture()
  await expect(invalid.service.execute({ action: 'list' }, invalid.request('unknown-token')))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
})

test('revoked workspace membership blocks an otherwise valid session', async () => {
  const fixture = createAuthFixture({ membership: { status: 'revoked' } })
  await expect(fixture.service.execute({ action: 'list' }, fixture.request()))
    .rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_INACTIVE' })
})

test('cross-workspace ownership and insufficient current roles are denied', async () => {
  const crossWorkspace = createAuthFixture()
  await crossWorkspace.directory.insert('foreign-project', {
    ownerUserId: USER_ID,
    workspaceId: 'another-workspace',
  })
  await expect(crossWorkspace.service.execute(
    { action: 'read', projectId: 'foreign-project' },
    crossWorkspace.request(),
  )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })

  const editor = createAuthFixture({ role: 'editor' })
  await editor.directory.insert('editor-delete-project', {
    ownerUserId: 'another-user',
    workspaceId: WORKSPACE_ID,
  })
  await expect(editor.service.execute(
    { action: 'delete', projectId: 'editor-delete-project' },
    editor.request(),
  )).rejects.toMatchObject({ name: 'ProjectAuthorizationError' })
})

test('preview without an authentication provider fails closed', async () => {
  let middleware: ((request: IncomingMessage, response: ServerResponse, next: () => void) => void) | undefined
  const server = {
    middlewares: {
      use(handler: typeof middleware) {
        middleware = handler
      },
    },
  }
  const plugin = projectAccessPlugin()
  const configurePreviewServer = plugin.configurePreviewServer
  if (typeof configurePreviewServer === 'function') configurePreviewServer(server as never)
  else configurePreviewServer?.handler(server as never)
  expect(middleware).toBeDefined()

  let statusCode = 0
  let responseBody = ''
  const response = {
    setHeader() {},
    end(body: string) {
      responseBody = body
    },
    get headersSent() {
      return Boolean(responseBody)
    },
    statusCode,
  } as unknown as ServerResponse
  const request = { url: '/api/project-access', method: 'POST' } as IncomingMessage

  middleware!(request, response, () => {
    throw new Error('The auth endpoint should handle this request')
  })
  statusCode = response.statusCode
  expect(statusCode).toBe(503)
  expect(JSON.parse(responseBody)).toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' })
})

test('development adapter uses its fixed local identity and gates local imports', async () => {
  const verifier = new LocalDevSessionVerifier()
  const membershipLookup = new LocalDevMembershipLookup()
  const request = {
    headers: {
      authorization: 'Bearer forged-browser-identity',
      cookie: 'userId=attacker; role=owner',
    },
  } as TestRequest
  const localSession = await verifier.verify(request)
  expect(localSession).toMatchObject({
    userId: 'local-user',
    activeWorkspaceId: 'local-workspace',
  })
  expect(await membershipLookup.lookup(localSession.userId, localSession.activeWorkspaceId))
    .toEqual({ status: 'active', role: 'owner' })

  const directory = new MemoryOwnershipDirectory()
  const gated = createProjectAccessService({
    sessionVerifier: verifier,
    membershipLookup,
    projectDirectory: directory,
    now: () => NOW,
    localImportEnabled: false,
  })
  await expect(gated.execute(
    { action: 'import-local', projectIds: ['legacy-project'] },
    request,
  )).rejects.toMatchObject({ status: 403, code: 'LOCAL_IMPORT_DISABLED' })

  const enabled = createProjectAccessService({
    sessionVerifier: verifier,
    membershipLookup,
    projectDirectory: directory,
    now: () => NOW,
    localImportEnabled: true,
    localUserId: 'local-user',
    localWorkspaceId: 'local-workspace',
  })
  expect(await enabled.execute(
    { action: 'import-local', projectIds: ['legacy-project'] },
    request,
  )).toEqual({ projectIds: ['legacy-project'] })
})