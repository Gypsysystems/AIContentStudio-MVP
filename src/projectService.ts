import * as indexedDb from './projectRepository'

// The UI depends only on this contract. A future remote repository must
// implement the same semantics, including guarded writes and file remapping.
export interface ProjectRepository {
  createProject: typeof indexedDb.createProject
  saveProject: typeof indexedDb.saveProject
  saveProjectIfCurrent: typeof indexedDb.saveProjectIfCurrent
  loadProject: typeof indexedDb.loadProject
  listProjects: typeof indexedDb.listProjects
  deleteProject: typeof indexedDb.deleteProject
  duplicateProject: typeof indexedDb.duplicateProject
  saveFile: typeof indexedDb.saveFile
  loadProjectFiles: typeof indexedDb.loadProjectFiles
  loadFile: typeof indexedDb.loadFile
  removeFile: typeof indexedDb.removeFile
  getActiveProjectId: typeof indexedDb.getActiveProjectId
  setActiveProjectId: typeof indexedDb.setActiveProjectId
}

export const indexedDbProjectRepository: ProjectRepository = {
  createProject: indexedDb.createProject,
  saveProject: indexedDb.saveProject,
  saveProjectIfCurrent: indexedDb.saveProjectIfCurrent,
  loadProject: indexedDb.loadProject,
  listProjects: indexedDb.listProjects,
  deleteProject: indexedDb.deleteProject,
  duplicateProject: indexedDb.duplicateProject,
  saveFile: indexedDb.saveFile,
  loadProjectFiles: indexedDb.loadProjectFiles,
  loadFile: indexedDb.loadFile,
  removeFile: indexedDb.removeFile,
  getActiveProjectId: indexedDb.getActiveProjectId,
  setActiveProjectId: indexedDb.setActiveProjectId,
}

export const projectRepository: ProjectRepository = indexedDbProjectRepository
export { SCHEMA_VERSION, ProjectConflictError } from './projectRepository'
export type { ProjectRecord, ProjectSummary, StoredFile } from './projectRepository'