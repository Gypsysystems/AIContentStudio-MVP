/**
 * Core identity and workspace domain models.
 *
 * These client-side models are useful for local authorization checks only.
 * A future server must resolve identity and memberships from trusted
 * credentials/storage; it must not trust a ProjectAccessContext supplied by a
 * client.
 */
export interface User {
  id: string
  name?: string
  email?: string
}

export interface Organization {
  id: string
  name?: string
}

export interface Workspace {
  id: string
  organizationId?: string
  name?: string
}

export type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type WorkspaceRole = MembershipRole

export interface Membership {
  userId: string
  workspaceId: string
  role: MembershipRole
  organizationId?: string
}

export interface ProjectOwnership {
  ownerUserId: string
  workspaceId: string
}

export type ProjectPermission =
  | 'create'
  | 'read'
  | 'write'
  | 'delete'
  | 'duplicate'
  | 'backup'
  | 'restore-new'
  | 'replace'

export const PROJECT_PERMISSIONS: readonly ProjectPermission[] = [
  'create',
  'read',
  'write',
  'delete',
  'duplicate',
  'backup',
  'restore-new',
  'replace',
]

export interface ProjectAccessContext {
  user: User
  workspace: Workspace
  membership: Membership
}

export const LOCAL_USER_ID = 'local-user'
export const LOCAL_WORKSPACE_ID = 'local-workspace'

export const LOCAL_ACCESS_CONTEXT: ProjectAccessContext = {
  user: {
    id: LOCAL_USER_ID,
    name: 'Local user',
  },
  workspace: {
    id: LOCAL_WORKSPACE_ID,
    name: 'Local workspace',
  },
  membership: {
    userId: LOCAL_USER_ID,
    workspaceId: LOCAL_WORKSPACE_ID,
    role: 'owner',
  },
}

export class ProjectAuthorizationError extends Error {
  constructor(message = 'Project authorization failed') {
    super(message)
    this.name = 'ProjectAuthorizationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const ALL_PERMISSIONS: ReadonlySet<ProjectPermission> = new Set(PROJECT_PERMISSIONS)
const EDITOR_PERMISSIONS: ReadonlySet<ProjectPermission> = new Set([
  'create',
  'read',
  'write',
  'duplicate',
  'backup',
  'restore-new',
])
const VIEWER_PERMISSIONS: ReadonlySet<ProjectPermission> = new Set(['read', 'backup'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateContext(context: unknown): asserts context is ProjectAccessContext {
  if (!isRecord(context)
    || !isRecord(context.user)
    || !isRecord(context.workspace)
    || !isRecord(context.membership)) {
    throw new ProjectAuthorizationError('A valid user, workspace, and membership are required')
  }

  const { user, workspace, membership } = context
  if (!isNonEmptyString(user.id)
    || !isNonEmptyString(workspace.id)
    || !isNonEmptyString(membership.userId)
    || !isNonEmptyString(membership.workspaceId)
    || membership.userId !== user.id
    || membership.workspaceId !== workspace.id
    || !['owner', 'admin', 'editor', 'viewer'].includes(String(membership.role))) {
    throw new ProjectAuthorizationError('A matching workspace membership is required')
  }
}

function validatePermission(permission: unknown): asserts permission is ProjectPermission {
  if (typeof permission !== 'string' || !ALL_PERMISSIONS.has(permission as ProjectPermission)) {
    throw new ProjectAuthorizationError('Unknown project permission')
  }
}

/** Throws unless this context's matching workspace membership allows the action. */
export function authorizeWorkspace(
  context: ProjectAccessContext,
  permission: ProjectPermission,
): void {
  validateContext(context)
  validatePermission(permission)

  const role = context.membership.role
  if (role === 'owner' || role === 'admin') return
  if (role === 'editor' && EDITOR_PERMISSIONS.has(permission)) return
  if (role === 'viewer' && VIEWER_PERMISSIONS.has(permission)) return

  throw new ProjectAuthorizationError(`Workspace role "${role}" cannot ${permission}`)
}

/** Throws unless the context may act on this project within its workspace. */
export function authorizeProject(
  context: ProjectAccessContext,
  ownership: ProjectOwnership,
  permission: ProjectPermission,
): void {
  validateContext(context)
  validatePermission(permission)

  if (!isRecord(ownership)
    || !isNonEmptyString(ownership.ownerUserId)
    || !isNonEmptyString(ownership.workspaceId)) {
    throw new ProjectAuthorizationError('Valid project ownership is required')
  }
  if (ownership.workspaceId !== context.workspace.id) {
    throw new ProjectAuthorizationError('Projects cannot be accessed across workspaces')
  }

  // Owner identity records attribution. A downgraded membership must not
  // retain permissions from an older role or bypass current workspace policy.
  authorizeWorkspace(context, permission)
}