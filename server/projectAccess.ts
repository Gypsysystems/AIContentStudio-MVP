import {
  authorizeProject,
  authorizeWorkspace,
  type MembershipRole,
  type ProjectAccessContext,
  type ProjectPermission,
  type ProjectOwnership,
} from '../src/ownership'
import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface VerifiedSession {
  userId: string
  activeWorkspaceId: string
  /** Unix epoch milliseconds. */
  expiresAt: number
}

export interface VerifiedSessionVerifier {
  verify(request: IncomingMessage): Promise<VerifiedSession | null>
}

export type MembershipLookupResult =
  | { status: 'active'; role: MembershipRole }
  | { status: 'revoked' | 'missing' }

export interface WorkspaceMembershipLookup {
  lookup(userId: string, workspaceId: string, request?: IncomingMessage): Promise<MembershipLookupResult>
}

export interface ProjectOwnershipDirectory {
  get(projectId: string): Promise<ProjectOwnership | null>
  listByWorkspace(workspaceId: string): Promise<string[]>
  insert(projectId: string, ownership: ProjectOwnership): Promise<boolean>
  /** Inserts all entries atomically, returning false if any ID already exists. */
  insertMany(entries: ReadonlyArray<{ projectId: string; ownership: ProjectOwnership }>): Promise<boolean>
  remove(projectId: string): Promise<void>
}

export type ProjectAccessAction =
  | 'list'
  | 'create'
  | 'read'
  | 'write'
  | 'delete'
  | 'delete-complete'
  | 'duplicate'
  | 'backup'
  | 'restore-new'
  | 'replace'
  | 'import-local'

export interface ProjectAccessRequest {
  action: ProjectAccessAction
  projectId?: string
  projectIds?: string[]
}

export interface ProjectAccessResponse {
  projectId?: string
  projectIds?: string[]
  ownerUserId?: string
  workspaceId?: string
}

export interface ProjectAccessServiceDependencies {
  sessionVerifier: VerifiedSessionVerifier
  membershipLookup: WorkspaceMembershipLookup
  projectDirectory: ProjectOwnershipDirectory
  generateProjectId?: () => string
  now?: () => number
  localImportEnabled?: boolean
  localUserId?: string
  localWorkspaceId?: string
}

export class ProjectAccessServiceError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ProjectAccessServiceError'
    this.status = status
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const ACTIONS = new Set<ProjectAccessAction>([
  'list', 'create', 'read', 'write', 'delete', 'delete-complete',
  'duplicate', 'backup', 'restore-new', 'replace', 'import-local',
])
const MAX_PROJECT_ID_LENGTH = 256
const MAX_IMPORT_IDS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateProjectId(value: unknown, field = 'projectId'): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PROJECT_ID_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectAccessServiceError(400, 'INVALID_PROJECT_ID', `${field} must be a valid non-empty project ID`)
  }
  return value
}

/** Validate the exact JSON envelope; browser-supplied identity claims are never accepted. */
export function validateProjectAccessRequest(value: unknown): ProjectAccessRequest {
  if (!isRecord(value) || typeof value.action !== 'string' || !ACTIONS.has(value.action as ProjectAccessAction)) {
    throw new ProjectAccessServiceError(400, 'INVALID_REQUEST', 'A supported action is required')
  }

  const action = value.action as ProjectAccessAction
  const permittedKeys = action === 'import-local'
    ? new Set(['action', 'projectIds'])
    : ['create', 'read', 'write', 'delete', 'delete-complete', 'duplicate', 'backup', 'replace']
      .includes(action)
      ? new Set(['action', 'projectId'])
      : new Set(['action'])
  if (Object.keys(value).some((key) => !permittedKeys.has(key))) {
    throw new ProjectAccessServiceError(400, 'UNEXPECTED_FIELD', 'Unexpected request fields are not allowed')
  }

  if (action === 'import-local') {
    if (!Array.isArray(value.projectIds)
      || value.projectIds.length === 0
      || value.projectIds.length > MAX_IMPORT_IDS) {
      throw new ProjectAccessServiceError(400, 'INVALID_PROJECT_IDS', `projectIds must contain 1-${MAX_IMPORT_IDS} IDs`)
    }
    const projectIds = value.projectIds.map((id, index) => validateProjectId(id, `projectIds[${index}]`))
    if (new Set(projectIds).size !== projectIds.length) {
      throw new ProjectAccessServiceError(400, 'DUPLICATE_PROJECT_IDS', 'projectIds must not contain duplicates')
    }
    return { action, projectIds }
  }

  if (permittedKeys.has('projectId')) {
    return { action, projectId: validateProjectId(value.projectId) }
  }
  return { action }
}

/**
 * Authorization and metadata service. It has no browser identity inputs: each
 * operation resolves a verifier session and a fresh membership before acting.
 */
export class ProjectAccessService {
  private readonly dependencies: ProjectAccessServiceDependencies

  constructor(dependencies: ProjectAccessServiceDependencies) {
    this.dependencies = dependencies
  }

  async execute(value: unknown, request: IncomingMessage): Promise<ProjectAccessResponse> {
    const input = validateProjectAccessRequest(value)
    const { context, session } = await this.resolveContext(request)
    switch (input.action) {
      case 'list':
        return this.list(context)
      case 'create':
        return this.create(context, input.projectId!)
      case 'read':
        return this.read(context, input.projectId!)
      case 'write':
        return this.write(context, input.projectId!)
      case 'delete':
        return this.delete(context, input.projectId!)
      case 'delete-complete':
        return this.deleteComplete(context, input.projectId!)
      case 'duplicate':
        return this.duplicate(context, input.projectId!)
      case 'backup':
        return this.backup(context, input.projectId!)
      case 'restore-new':
        return this.restoreNew(context)
      case 'replace':
        return this.replace(context, input.projectId!)
      case 'import-local':
        return this.importLocal(context, session, input.projectIds!)
    }
  }

  async list(context?: ProjectAccessContext, request?: IncomingMessage): Promise<ProjectAccessResponse> {
    const resolved = context ?? (await this.resolveContext(this.requireRequest(request))).context
    authorizeWorkspace(resolved, 'read')
    return { projectIds: await this.dependencies.projectDirectory.listByWorkspace(resolved.workspace.id) }
  }

  async create(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    authorizeWorkspace(context, 'create')
    return this.insertNewProject(context, validateProjectId(projectId))
  }

  async read(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    return this.authorizedProject(context, projectId, 'read')
  }

  async write(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    return this.authorizedProject(context, projectId, 'write')
  }

  async delete(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    // The client can remove project contents first; metadata is retained until delete-complete.
    return this.authorizedProject(context, projectId, 'delete')
  }

  async deleteComplete(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    const result = await this.authorizedProject(context, projectId, 'delete')
    await this.dependencies.projectDirectory.remove(result.projectId!)
    return result
  }

  async duplicate(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    await this.authorizedProject(context, projectId, 'duplicate')
    return this.insertNewProject(context, this.generateUniqueId)
  }

  async backup(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    return this.authorizedProject(context, projectId, 'backup')
  }

  async restoreNew(context: ProjectAccessContext): Promise<ProjectAccessResponse> {
    authorizeWorkspace(context, 'restore-new')
    return this.insertNewProject(context, this.generateUniqueId)
  }

  async replace(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    // projectId is the destination being replaced; archives are deliberately not authorized here.
    return this.authorizedProject(context, projectId, 'replace')
  }

  async importLocal(
    context: ProjectAccessContext,
    session: VerifiedSession,
    projectIds: readonly string[],
  ): Promise<ProjectAccessResponse> {
    const localUserId = this.dependencies.localUserId ?? 'local-user'
    const localWorkspaceId = this.dependencies.localWorkspaceId ?? 'local-workspace'
    if (!this.dependencies.localImportEnabled
      || session.userId !== localUserId
      || session.activeWorkspaceId !== localWorkspaceId) {
      throw new ProjectAccessServiceError(403, 'LOCAL_IMPORT_DISABLED', 'Local project import is available only in local development')
    }
    authorizeWorkspace(context, 'create')
    const ownership = { ownerUserId: localUserId, workspaceId: localWorkspaceId }
    const entries = projectIds.map((id) => ({ projectId: validateProjectId(id), ownership }))
    if (!await this.dependencies.projectDirectory.insertMany(entries)) {
      throw new ProjectAccessServiceError(409, 'PROJECT_EXISTS', 'One or more project IDs already have ownership metadata')
    }
    return { projectIds: entries.map(({ projectId }) => projectId) }
  }

  private async authorizedProject(
    context: ProjectAccessContext,
    projectId: string,
    permission: ProjectPermission,
  ): Promise<ProjectAccessResponse> {
    const id = validateProjectId(projectId)
    const ownership = await this.dependencies.projectDirectory.get(id)
    if (!ownership) throw new ProjectAccessServiceError(404, 'PROJECT_NOT_FOUND', 'Project ownership metadata was not found')
    authorizeProject(context, ownership, permission)
    return {
      projectId: id,
      ownerUserId: ownership.ownerUserId,
      workspaceId: ownership.workspaceId,
    }
  }

  private async insertNewProject(context: ProjectAccessContext, projectId: string): Promise<ProjectAccessResponse> {
    const ownership = {
      ownerUserId: context.user.id,
      workspaceId: context.workspace.id,
    }
    if (!await this.dependencies.projectDirectory.insert(projectId, ownership)) {
      throw new ProjectAccessServiceError(409, 'PROJECT_EXISTS', 'Project ownership metadata already exists')
    }
    return { projectId, ...ownership }
  }

  private get generateUniqueId(): string {
    const generated = (this.dependencies.generateProjectId ?? (() => `project-${randomUUID()}`))()
    return validateProjectId(generated, 'generated projectId')
  }

  private async resolveContext(request: IncomingMessage): Promise<{ context: ProjectAccessContext; session: VerifiedSession }> {
    let session: VerifiedSession | null
    try {
      session = await this.dependencies.sessionVerifier.verify(request)
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) throw error
      throw new ProjectAccessServiceError(503, 'SESSION_VERIFIER_UNAVAILABLE', 'Session verification is unavailable')
    }
    const now = (this.dependencies.now ?? Date.now)()
    if (!isRecord(session)
      || typeof session.userId !== 'string' || !session.userId
      || typeof session.activeWorkspaceId !== 'string' || !session.activeWorkspaceId
      || !Number.isFinite(session.expiresAt)
      || session.expiresAt <= now) {
      throw new ProjectAccessServiceError(401, 'UNAUTHENTICATED', 'A valid, unexpired session is required')
    }

    let membership: MembershipLookupResult
    try {
      // Always load current membership; session role or stale membership is never used.
      membership = await this.dependencies.membershipLookup.lookup(
        session.userId,
        session.activeWorkspaceId,
        request,
      )
    } catch {
      throw new ProjectAccessServiceError(503, 'MEMBERSHIP_LOOKUP_UNAVAILABLE', 'Workspace membership lookup is unavailable')
    }
    if (membership.status !== 'active') {
      throw new ProjectAccessServiceError(403, 'MEMBERSHIP_INACTIVE', 'An active workspace membership is required')
    }
    return {
      session,
      context: {
        user: { id: session.userId },
        workspace: { id: session.activeWorkspaceId },
        membership: {
          userId: session.userId,
          workspaceId: session.activeWorkspaceId,
          role: membership.role,
        },
      },
    }
  }

  private requireRequest(request?: IncomingMessage): IncomingMessage {
    if (!request) throw new Error('An HTTP request is required to resolve the server session')
    return request
  }
}

export function createProjectAccessService(dependencies: ProjectAccessServiceDependencies): ProjectAccessService {
  return new ProjectAccessService(dependencies)
}