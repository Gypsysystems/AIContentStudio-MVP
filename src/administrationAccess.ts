import {
  PROJECT_PERMISSIONS,
  authorizeProject,
  authorizeWorkspace,
  type MembershipRole,
  type ProjectAccessContext,
  type ProjectOwnership,
  type ProjectPermission,
} from './ownership'

export type AdministrationAccess = {
  role: MembershipRole | null
  workspace: Record<ProjectPermission, boolean>
  project: { read: boolean; write: boolean } | null
}

function allowed(check: () => void): boolean {
  try {
    check()
    return true
  } catch {
    return false
  }
}

/** Display-only projection of the existing client policy. Repository/server checks remain authoritative. */
export function getAdministrationAccess(
  context: ProjectAccessContext,
  ownership: ProjectOwnership | null = null,
): AdministrationAccess {
  const workspace = Object.fromEntries(PROJECT_PERMISSIONS.map(permission =>
    [permission, allowed(() => authorizeWorkspace(context, permission))],
  )) as Record<ProjectPermission, boolean>
  return {
    role: workspace.read ? context.membership.role : null,
    workspace,
    project: ownership ? {
      read: allowed(() => authorizeProject(context, ownership, 'read')),
      write: allowed(() => authorizeProject(context, ownership, 'write')),
    } : null,
  }
}