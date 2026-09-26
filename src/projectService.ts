import * as indexedDb from './projectRepository'

// The UI depends only on this contract. Every project/file operation accepts
// an optional access context; the local adapter supplies the dev session when
// omitted. A future server-backed adapter must resolve a trusted identity and
// enforce these scope, authorization, guarded-write, and file-remapping rules.
export interface ProjectRepository {
  createProject: typeof indexedDb.createProject
  saveProject: typeof indexedDb.saveProject
  saveProjectIfCurrent: typeof indexedDb.saveProjectIfCurrent
  loadProjectSnapshot: typeof indexedDb.loadProjectSnapshot
  restoreProjectSnapshot: typeof indexedDb.restoreProjectSnapshot
  loadProject: typeof indexedDb.loadProject
  listProjects: typeof indexedDb.listProjects
  deleteProject: typeof indexedDb.deleteProject
  duplicateProject: typeof indexedDb.duplicateProject
  saveFile: typeof indexedDb.saveFile
  loadProjectFiles: typeof indexedDb.loadProjectFiles
  loadFile: typeof indexedDb.loadFile
  removeFile: typeof indexedDb.removeFile
  captureProjectCheckpoint: typeof indexedDb.captureProjectCheckpoint
  listProjectCheckpoints: typeof indexedDb.listProjectCheckpoints
  getProjectCheckpoint: typeof indexedDb.getProjectCheckpoint
  verifyProjectCheckpoint: typeof indexedDb.verifyProjectCheckpoint
  getActiveProjectId: typeof indexedDb.getActiveProjectId
  setActiveProjectId: typeof indexedDb.setActiveProjectId
}

export const indexedDbProjectRepository: ProjectRepository = {
  createProject: indexedDb.createProject,
  saveProject: indexedDb.saveProject,
  saveProjectIfCurrent: indexedDb.saveProjectIfCurrent,
  loadProjectSnapshot: indexedDb.loadProjectSnapshot,
  restoreProjectSnapshot: indexedDb.restoreProjectSnapshot,
  loadProject: indexedDb.loadProject,
  listProjects: indexedDb.listProjects,
  deleteProject: indexedDb.deleteProject,
  duplicateProject: indexedDb.duplicateProject,
  saveFile: indexedDb.saveFile,
  loadProjectFiles: indexedDb.loadProjectFiles,
  loadFile: indexedDb.loadFile,
  removeFile: indexedDb.removeFile,
  captureProjectCheckpoint: indexedDb.captureProjectCheckpoint,
  listProjectCheckpoints: indexedDb.listProjectCheckpoints,
  getProjectCheckpoint: indexedDb.getProjectCheckpoint,
  verifyProjectCheckpoint: indexedDb.verifyProjectCheckpoint,
  getActiveProjectId: indexedDb.getActiveProjectId,
  setActiveProjectId: indexedDb.setActiveProjectId,
}

export const projectRepository: ProjectRepository = indexedDbProjectRepository
export { SCHEMA_VERSION, ProjectConflictError } from './projectRepository'
export { ProjectAuthorizationError } from './ownership'
export type { ProjectAccessContext, ProjectOwnership } from './ownership'
export type {
  ProjectRecord,
  ProjectSnapshot,
  ProjectSummary,
  RestoreProjectSnapshotOptions,
  StoredFile,
} from './projectRepository'
export type {
  CheckpointVerification,
  ProjectCheckpoint,
  ProjectCheckpointRead,
  ProjectCheckpointSummary,
} from './projectCheckpoint'