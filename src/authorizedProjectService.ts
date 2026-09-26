import {
  indexedDbProjectRepository as local,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectSnapshot,
  type RestoreProjectSnapshotOptions,
} from './projectService'
import {
  LOCAL_USER_ID, LOCAL_WORKSPACE_ID, type ProjectAccessContext,
} from './ownership'
import {
  readProjectBackupSnapshot,
  serializeProjectBackup,
  type RestoreOptions,
} from './projectBackup'
import { cloudProjectRepository } from './cloudProjectRepository'

type Action = 'list' | 'create' | 'read' | 'write' | 'delete' | 'delete-complete'
  | 'duplicate' | 'backup' | 'restore-new' | 'replace' | 'import-local'
type AccessReply = {
  projectId?: string
  projectIds?: string[]
  ownerUserId?: string
  workspaceId?: string
}

export class ProjectAccessApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ProjectAccessApiError'
  }
}

/**
 * No identity, role, or workspace claim crosses this API. In development the
 * server supplies its own fixed local identity; production has no provider
 * yet and must fail closed rather than trust the browser's local session.
 */
async function access(action: Action, fields: { projectId?: string; projectIds?: string[] } = {}): Promise<AccessReply> {
  let response: Response
  try {
    response = await fetch('/api/project-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ action, ...fields }),
    })
  } catch {
    throw new ProjectAccessApiError(0, 'API_UNAVAILABLE', 'Project access server is unavailable; local changes were not applied.')
  }
  let body: { error?: string; code?: string } & AccessReply
  try {
    body = await response.json()
  } catch {
    throw new ProjectAccessApiError(response.status, 'API_UNAVAILABLE', 'Project access server did not return a valid response.')
  }
  if (!response.ok) {
    throw new ProjectAccessApiError(response.status, body.code ?? 'ACCESS_DENIED',
      body.error ?? 'Project access was denied.')
  }
  return body
}

function noClientClaims(context?: ProjectAccessContext): void {
  if (context !== undefined)
    throw new Error('The server-authorized adapter does not accept browser identity or role claims.')
}

function requireServerId(reply: AccessReply): string {
  if (!reply.projectId || typeof reply.projectId !== 'string')
    throw new Error('Project access server did not allocate a project ID.')
  return reply.projectId
}

function requireLocalOwnership(reply: AccessReply): void {
  if (reply.ownerUserId !== LOCAL_USER_ID || reply.workspaceId !== LOCAL_WORKSPACE_ID)
    throw new Error('The local IndexedDB adapter cannot store a server-owned workspace project.')
}

// DEV-ONLY compatibility for projects created before the server metadata
// boundary. The browser can assert a local record's existence here, but cannot
// prove its origin. Production never uses this enrollment path.
async function enrollLegacyLocalProject(projectId: string): Promise<boolean> {
  if (!import.meta.env.DEV) return false
  const record = await local.loadProject(projectId)
  if (!record || record.ownerUserId !== LOCAL_USER_ID || record.workspaceId !== LOCAL_WORKSPACE_ID)
    return false
  await access('import-local', { projectIds: [projectId] })
  return true
}

async function guard(action: Action, projectId: string): Promise<AccessReply> {
  try {
    return await access(action, { projectId })
  } catch (error) {
    if (error instanceof ProjectAccessApiError && error.status === 404
      && await enrollLegacyLocalProject(projectId))
      return access(action, { projectId })
    throw error
  }
}

async function releaseUnwrittenProject(projectId: string): Promise<void> {
  // Metadata insertion precedes the IndexedDB transaction. Cleanup is
  // best-effort: an orphan grants no access to another project's contents.
  try { await access('delete-complete', { projectId }) } catch { /* retain orphan metadata */ }
}

/** App-facing adapter; the old IndexedDB repository remains a local primitive. */
const authorizedLocalProjectRepository: ProjectRepository = {
  async createProject(partial, context) {
    noClientClaims(context)
    const reply = await access('create', { projectId: partial.projectId })
    requireLocalOwnership(reply)
    try {
      return await local.createProject(partial)
    } catch (error) {
      await releaseUnwrittenProject(partial.projectId)
      throw error
    }
  },
  async saveProject(record, context) {
    noClientClaims(context)
    await guard('write', record.projectId)
    return local.saveProject(record)
  },
  async saveProjectIfCurrent(record, expectedRevision, context) {
    noClientClaims(context)
    await guard('write', record.projectId)
    return local.saveProjectIfCurrent(record, expectedRevision)
  },
  async loadProject(projectId, context) {
    noClientClaims(context)
    try {
      await guard('read', projectId)
    } catch (error) {
      if (error instanceof ProjectAccessApiError && error.status === 404) return null
      throw error
    }
    return local.loadProject(projectId)
  },
  async loadProjectSnapshot(projectId, context) {
    noClientClaims(context)
    try {
      await guard('backup', projectId)
    } catch (error) {
      if (error instanceof ProjectAccessApiError && error.status === 404) return null
      throw error
    }
    return local.loadProjectSnapshot(projectId)
  },
  async listProjects(context) {
    noClientClaims(context)
    let allowed = await access('list')
    const stored = await local.listProjects()
    if (import.meta.env.DEV) {
      const known = new Set(allowed.projectIds ?? [])
      for (const record of stored) {
        if (!known.has(record.projectId)
          && record.ownerUserId === LOCAL_USER_ID && record.workspaceId === LOCAL_WORKSPACE_ID) {
          await access('import-local', { projectIds: [record.projectId] })
          known.add(record.projectId)
        }
      }
      allowed = await access('list')
    }
    const visible = new Set(allowed.projectIds ?? [])
    return stored.filter(record => visible.has(record.projectId))
  },
  async deleteProject(projectId, context) {
    noClientClaims(context)
    await guard('delete', projectId)
    await local.deleteProject(projectId)
    await access('delete-complete', { projectId })
  },
  async duplicateProject(sourceId, newName, context) {
    noClientClaims(context)
    const allocation = await guard('duplicate', sourceId)
    const newId = requireServerId(allocation)
    requireLocalOwnership(allocation)
    try {
      return await local.duplicateProject(sourceId, newName, undefined, newId)
    } catch (error) {
      await releaseUnwrittenProject(newId)
      throw error
    }
  },
  async restoreProjectSnapshot(snapshot: ProjectSnapshot, options: RestoreProjectSnapshotOptions, context) {
    noClientClaims(context)
    if (options.mode === 'replace') {
      await guard('replace', snapshot.record.projectId)
      return local.restoreProjectSnapshot(snapshot, options)
    }
    const allocation = await access('restore-new')
    const newId = requireServerId(allocation)
    requireLocalOwnership(allocation)
    try {
      return await local.restoreProjectSnapshot(snapshot, { mode: 'new', newName: options.newName, newProjectId: newId })
    } catch (error) {
      await releaseUnwrittenProject(newId)
      throw error
    }
  },
  async saveFile(projectId, file, context) {
    noClientClaims(context)
    await guard('write', projectId)
    return local.saveFile(projectId, file)
  },
  async loadProjectFiles(projectId, context) {
    noClientClaims(context)
    await guard('read', projectId)
    return local.loadProjectFiles(projectId)
  },
  async loadFile(fileId, context) {
    noClientClaims(context)
    // There is no server-owned file index until project content moves to a
    // server. Never read a file before a trusted server gate in production.
    if (!import.meta.env.DEV)
      throw new Error('Browser file lookup is unavailable in production.')
    const file = await local.loadFile(fileId)
    if (!file) return null
    await guard('read', file.projectId)
    return file
  },
  async removeFile(fileId, context) {
    noClientClaims(context)
    if (!import.meta.env.DEV)
      throw new Error('Browser file lookup is unavailable in production.')
    const file = await local.loadFile(fileId)
    if (!file) return
    await guard('write', file.projectId)
    return local.removeFile(fileId)
  },
  async captureProjectCheckpoint(projectId, expectedRevision, expectedFileIds, reason, context) {
    noClientClaims(context)
    await guard('write', projectId)
    return local.captureProjectCheckpoint(projectId, expectedRevision, expectedFileIds, reason)
  },
  async listProjectCheckpoints(projectId, context) {
    noClientClaims(context)
    await guard('read', projectId)
    return local.listProjectCheckpoints(projectId)
  },
  async getProjectCheckpoint(projectId, checkpointId, context) {
    noClientClaims(context)
    try {
      await guard('read', projectId)
    } catch (error) {
      if (error instanceof ProjectAccessApiError && error.status === 404) return null
      throw error
    }
    return local.getProjectCheckpoint(projectId, checkpointId)
  },
  async verifyProjectCheckpoint(projectId, checkpointId, context) {
    noClientClaims(context)
    try {
      await guard('read', projectId)
    } catch (error) {
      if (error instanceof ProjectAccessApiError && error.status === 404)
        return { valid: false, issues: ['Checkpoint does not exist in this project.'] }
      throw error
    }
    return local.verifyProjectCheckpoint(projectId, checkpointId)
  },
  getActiveProjectId: local.getActiveProjectId,
  setActiveProjectId: local.setActiveProjectId,
}

let cloudMode = false

/** AuthGate selects the storage adapter before App mounts; no async dispatch race. */
export function setCloudProjectMode(enabled: boolean): void {
  cloudMode = enabled
}
export function isCloudProjectMode(): boolean {
  return cloudMode
}

const selected = () => cloudMode ? cloudProjectRepository : authorizedLocalProjectRepository

export const authorizedProjectRepository: ProjectRepository = {
  createProject: (...args) => selected().createProject(...args),
  saveProject: (...args) => selected().saveProject(...args),
  saveProjectIfCurrent: (...args) => selected().saveProjectIfCurrent(...args),
  loadProjectSnapshot: (...args) => selected().loadProjectSnapshot(...args),
  restoreProjectSnapshot: (...args) => selected().restoreProjectSnapshot(...args),
  loadProject: (...args) => selected().loadProject(...args),
  listProjects: (...args) => selected().listProjects(...args),
  deleteProject: (...args) => selected().deleteProject(...args),
  duplicateProject: (...args) => selected().duplicateProject(...args),
  saveFile: (...args) => selected().saveFile(...args),
  loadProjectFiles: (...args) => selected().loadProjectFiles(...args),
  loadFile: (...args) => selected().loadFile(...args),
  removeFile: (...args) => selected().removeFile(...args),
  captureProjectCheckpoint: (...args) => selected().captureProjectCheckpoint(...args),
  listProjectCheckpoints: (...args) => selected().listProjectCheckpoints(...args),
  getProjectCheckpoint: (...args) => selected().getProjectCheckpoint(...args),
  verifyProjectCheckpoint: (...args) => selected().verifyProjectCheckpoint(...args),
  getActiveProjectId: (...args) => selected().getActiveProjectId(...args),
  setActiveProjectId: (...args) => selected().setActiveProjectId(...args),
}

export async function createAuthorizedProjectBackup(projectId: string): Promise<Blob> {
  const snapshot = await authorizedProjectRepository.loadProjectSnapshot(projectId)
  if (!snapshot) throw new Error(`Project "${projectId}" does not exist.`)
  return serializeProjectBackup(snapshot)
}

export async function restoreAuthorizedProjectBackup(
  archive: Blob, options: RestoreOptions,
): Promise<ProjectRecord> {
  const snapshot = await readProjectBackupSnapshot(archive)
  return authorizedProjectRepository.restoreProjectSnapshot(snapshot, options)
}