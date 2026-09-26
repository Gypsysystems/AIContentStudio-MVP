// IndexedDB adapter. The app consumes the stable boundary in projectService.ts.

import {
  isEvidenceIndexFresh,
  remapEvidenceIndex,
  type EvidenceIndex,
} from './evidenceIndex'
import {
  isConceptAnalysisFresh,
  remapConceptAnalysis,
  type ConceptAnalysis,
} from './conceptAnalysis'
import type { SourceExtraction } from './sourceExtractor'
import {
  remapUnsupportedAnalysis,
  type UnsupportedAnalysis,
} from './unsupportedAnalysis'
import {
  isTocProposalFresh,
  type TocProposal,
} from './tocProposal'
import {
  remapAuthorTopicMetadata,
  type AuthorTopicMetadataMap,
} from './authorMetadata'
import {
  createEmptyReviewModel,
  remapReviewModelForDuplicate,
  type ReviewModel,
} from './reviewModel'
import {
  CURRENT_PROJECT_SCHEMA_VERSION, migrateProjectRecord, validateRestorableProjectRecord,
} from './projectMigrations'
import { getAccessContext } from './authSession'
import {
  authorizeProject, authorizeWorkspace, LOCAL_WORKSPACE_ID,
  type ProjectAccessContext, type ProjectOwnership,
} from './ownership'
import {
  normalizeProjectName, projectNameKey, suggestUniqueProjectName,
} from './projectNames'
import {
  checkpointIntegrityDigest, checkpointSha256, canonicalCheckpointJson, validateCheckpointReason,
  verifyCheckpointRead, type CheckpointVerification, type ProjectCheckpoint,
  type ProjectCheckpointRead, type ProjectCheckpointSummary,
} from './projectCheckpoint'

export { normalizeProjectName, projectNameKey, suggestUniqueProjectName } from './projectNames'

export const SCHEMA_VERSION = CURRENT_PROJECT_SCHEMA_VERSION
export { migrateProjectRecord, UnsupportedProjectSchemaError } from './projectMigrations'
const DB_NAME = 'docflow-db'
const DB_VERSION = 3
const STORE_PROJECTS = 'projects'
const STORE_FILES = 'files'
const STORE_CHECKPOINTS = 'projectCheckpoints'
const STORE_CHECKPOINT_FILES = 'projectCheckpointFiles'

// ── Types ──────────────────────────────────────────────────────────────────

export type StoredFile = {
  fileId: string
  projectId: string
  name: string
  type: string
  size: number
  uploadedAt: number
  blob: Blob
  /** Changes on every local persistence write; absent only on pre-token legacy rows. */
  writeToken?: string
}

export type ProjectSnapshot = {
  record: ProjectRecord
  files: StoredFile[]
}

export type RestoreProjectSnapshotOptions =
  | { mode: 'new'; newName: string; newProjectId?: string }
  | { mode: 'replace'; expectedRevision: number; expectedFileIds: string[] }

export type ProjectRecord = ProjectOwnership & {
  projectId: string
  schemaVersion: number
  recordRevision: number
  projectName: string
  documentType: string
  version: string
  createdAt: number
  modifiedAt: number
  isDemoMode: boolean

  // Theme / Branding
  themes: unknown[]
  projectMeta: unknown
  activeStyleProfileId: string
  themeVariables: Record<string, unknown[]>
  pageLayouts: unknown[]
  htmlMasterPages: unknown[]

  // Sources
  sourceFileIds: string[]
  sourcesRevision: number

  // Analysis
  analysisResult: unknown | null
  analysisRevision: number
  conceptAnalysis: unknown | null
  unsupportedAnalysis: unknown | null

  // TOC
  appToc: unknown[]
  tocProposal: unknown | null
  tocRevision: number
  tocGeneratedFromRev: number
  tocGeneratedFromEvidenceSourcesRevision: number
  tocGeneratedFromEvidenceExtractionRevision: string
  tocGeneratedFromConceptBuiltAt: number
  tocGeneratedFromContentType: string
  tocHumanModified: boolean
  masterAssignments: Record<string, string>

  // Source extractions
  sourceExtractions: Record<string, unknown>
  evidenceIndex: unknown | null

  // Content
  docBlocks: unknown[]
  topicContent: Record<string, unknown[]>
  authorTopicMetadata: AuthorTopicMetadataMap
  contentRevision: number

  // Review
  reviewModel: ReviewModel
  findingStatuses: Record<number, string>
  aiReviewDone: boolean
  reviewStage: 1 | 2
  reviewRevision: number

  // Studio / Publish
  snippets: unknown[]
  conditionGroups: unknown[]
  docComments: unknown[]
  publishConfig: unknown
}

export type ProjectSummary = ProjectOwnership & {
  projectId: string
  projectName: string
  documentType: string
  version: string
  createdAt: number
  modifiedAt: number
}

// ── DB open ────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'projectId' })
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const fs = db.createObjectStore(STORE_FILES, { keyPath: 'fileId' })
        fs.createIndex('projectId', 'projectId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        const checkpoints = db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'checkpointId' })
        checkpoints.createIndex('projectId', 'projectId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINT_FILES)) {
        db.createObjectStore(STORE_CHECKPOINT_FILES, { keyPath: ['checkpointId', 'fileId'] })
          .createIndex('checkpointId', 'checkpointId', { unique: false })
      }
    }
    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result
      resolve(_db!)
    }
    req.onerror = () => reject(req.error)
  })
}

function tx(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (stores: IDBObjectStore[]) => Promise<unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const storeList = Array.isArray(stores) ? stores : [stores]
    const t = db.transaction(storeList, mode)
    const storeObjects = storeList.map(s => t.objectStore(s))
    let operationError: unknown
    void fn(storeObjects).catch(error => {
      operationError = error
      try {
        t.abort()
      } catch {
        // The transaction may already have aborted because of a request error.
      }
    })
    t.oncomplete = () => operationError ? reject(operationError) : resolve()
    t.onerror = () => {
      // Wait for abort so an operation error can be surfaced without masking it.
    }
    t.onabort = () => reject(operationError ?? t.error ?? new Error('Transaction aborted'))
  })
}

function put<T>(store: IDBObjectStore, value: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = store.put(value)
    req.onsuccess = () => resolve(value)
    req.onerror = () => reject(req.error)
  })
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

async function assertUniqueProjectName(
  store: IDBObjectStore,
  workspaceId: string,
  name: string,
  excludingProjectId?: string,
): Promise<void> {
  const normalizedName = normalizeProjectName(name)
  if (!normalizedName)
    throw new Error('Project name cannot be empty.')

  const records = await getAll<ProjectRecord>(store)
  const existing = records
    .filter(record => {
      const legacy = record as Partial<ProjectRecord>
      return legacy.workspaceId === workspaceId
        || (legacy.workspaceId === undefined && legacy.ownerUserId === undefined
          && workspaceId === LOCAL_WORKSPACE_ID)
    })
    .map(raw => migrateProjectRecord(raw).record)
    .filter(record => record.workspaceId === workspaceId && record.projectId !== excludingProjectId)
  const key = projectNameKey(normalizedName)
  const conflict = existing.find(record => projectNameKey(record.projectName) === key)
  if (conflict) {
    const suggestedName = suggestUniqueProjectName(normalizedName, existing.map(record => record.projectName))
    throw new ProjectNameConflictError(normalizedName, suggestedName, conflict.projectId)
  }
}

function getByKey<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function deleteByKey(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function getAllByIndex<T>(store: IDBObjectStore, indexName: string, value: IDBValidKey): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const idx = store.index(indexName)
    const req = idx.getAll(value)
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function createProject(
  partial: Partial<ProjectRecord> & { projectId: string; projectName: string },
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectRecord> {
  authorizeWorkspace(context, 'create')
  if ((partial.workspaceId !== undefined && partial.workspaceId !== context.workspace.id) ||
    (partial.ownerUserId !== undefined && partial.ownerUserId !== context.user.id))
    throw new Error('Project ownership must match its creator and workspace.')
  const record = createProjectRecord(partial, context)
  const db = await openDB()
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    if (await getByKey<ProjectRecord>(s, record.projectId))
      throw new Error(`Project "${record.projectId}" already exists.`)
    await assertUniqueProjectName(s, record.workspaceId, record.projectName)
    await put(s, record)
  })
  return record
}

/** Build a new project's complete default record without writing local storage. */
export function createProjectRecord(
  partial: Partial<ProjectRecord> & { projectId: string; projectName: string },
  context: ProjectAccessContext = getAccessContext(),
): ProjectRecord {
  authorizeWorkspace(context, 'create')
  if ((partial.workspaceId !== undefined && partial.workspaceId !== context.workspace.id) ||
    (partial.ownerUserId !== undefined && partial.ownerUserId !== context.user.id))
    throw new Error('Project ownership must match its creator and workspace.')
  const now = Date.now()
  return {
    documentType: 'user-guide',
    version: '1.0',
    createdAt: now,
    modifiedAt: now,
    isDemoMode: false,
    themes: [],
    projectMeta: {},
    activeStyleProfileId: '',
    themeVariables: {},
    pageLayouts: [],
    htmlMasterPages: [],
    sourceFileIds: [],
    sourcesRevision: 0,
    analysisResult: null,
    analysisRevision: -1,
    conceptAnalysis: null,
    unsupportedAnalysis: null,
    appToc: [],
    tocProposal: null,
    tocRevision: 0,
    tocGeneratedFromRev: -1,
    tocGeneratedFromEvidenceSourcesRevision: -1,
    tocGeneratedFromEvidenceExtractionRevision: '',
    tocGeneratedFromConceptBuiltAt: -1,
    tocGeneratedFromContentType: '',
    tocHumanModified: false,
    masterAssignments: {},
    sourceExtractions: {},
    evidenceIndex: null,
    docBlocks: [],
    topicContent: {},
    authorTopicMetadata: {},
    contentRevision: 0,
    reviewModel: createEmptyReviewModel(partial.projectId),
    findingStatuses: {},
    aiReviewDone: false,
    reviewStage: 1,
    reviewRevision: -1,
    snippets: [],
    conditionGroups: [],
    docComments: [],
    publishConfig: { selectedFormats: [], activeVariant: '' },
    ...partial,
    ownerUserId: context.user.id,
    workspaceId: context.workspace.id,
    schemaVersion: SCHEMA_VERSION,
    recordRevision: 0,
  }
}

export async function saveProject(
  record: ProjectRecord, context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectRecord> {
  const db = await openDB()
  let saved: ProjectRecord | null = null
  // Legacy local save remains last-write-wins for existing UI flows. The
  // guarded operation below is the explicit cloud-ready conflict primitive.
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const previous = await getByKey<ProjectRecord>(s, record.projectId)
    if (!previous) throw new Error(`Project "${record.projectId}" does not exist.`)
    const current = migrateProjectRecord(previous).record
    authorizeProject(context, current, 'write')
    const incoming = migrateProjectRecord(record).record
    if (incoming.ownerUserId !== current.ownerUserId || incoming.workspaceId !== current.workspaceId)
      throw new Error('Project ownership cannot be changed by a content save.')
    if (!normalizeProjectName(incoming.projectName))
      throw new Error('Project name cannot be empty.')
    if (projectNameKey(incoming.projectName) !== projectNameKey(current.projectName))
      await assertUniqueProjectName(s, current.workspaceId, incoming.projectName, current.projectId)
    const revision = current.recordRevision
    saved = { ...migrateProjectRecord(record).record,
      ownerUserId: current.ownerUserId, workspaceId: current.workspaceId,
      schemaVersion: SCHEMA_VERSION, recordRevision: revision + 1, modifiedAt: Date.now() }
    await put(s, saved)
  })
  return saved!
}

export class ProjectConflictError extends Error {
  constructor(readonly projectId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Project "${projectId}" changed: expected revision ${expectedRevision}, found ${actualRevision}.`)
    this.name = 'ProjectConflictError'
  }
}

export class ProjectNameConflictError extends Error {
  constructor(
    readonly projectName: string,
    readonly suggestedName: string,
    readonly conflictingProjectId?: string,
  ) {
    super(`A project named "${normalizeProjectName(projectName)}" already exists in this workspace. Confirm a different name, such as "${suggestedName}".`)
    this.name = 'ProjectNameConflictError'
  }
}

export async function saveProjectIfCurrent(
  record: ProjectRecord, expectedRevision: number,
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectRecord> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Expected project revision must be a nonnegative integer.')
  const db = await openDB()
  let saved: ProjectRecord | null = null
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const previous = await getByKey<ProjectRecord>(s, record.projectId)
    if (!previous) throw new Error(`Project "${record.projectId}" does not exist.`)
    const current = migrateProjectRecord(previous).record
    authorizeProject(context, current, 'write')
    if (current.recordRevision !== expectedRevision)
      throw new ProjectConflictError(record.projectId, expectedRevision, current.recordRevision)
    const incoming = migrateProjectRecord(record).record
    if (incoming.ownerUserId !== current.ownerUserId || incoming.workspaceId !== current.workspaceId)
      throw new Error('Project ownership cannot be changed by a content save.')
    if (!normalizeProjectName(incoming.projectName))
      throw new Error('Project name cannot be empty.')
    if (projectNameKey(incoming.projectName) !== projectNameKey(current.projectName))
      await assertUniqueProjectName(s, current.workspaceId, incoming.projectName, current.projectId)
    saved = { ...incoming, ownerUserId: current.ownerUserId, workspaceId: current.workspaceId,
      schemaVersion: SCHEMA_VERSION,
      recordRevision: current.recordRevision + 1, modifiedAt: Date.now() }
    await put(s, saved)
  })
  return saved!
}

export async function loadProject(
  projectId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectRecord | null> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let result: ProjectRecord | undefined
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const stored = await getByKey<ProjectRecord>(s, projectId)
    if (!stored) return
    const migrated = migrateProjectRecord(stored)
    authorizeProject(context, migrated.record, 'read')
    result = migrated.record
    if (migrated.changed) await put(s, migrated.record)
  })
  return result ?? null
}

export async function loadProjectSnapshot(
  projectId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectSnapshot | null> {
  authorizeWorkspace(context, 'backup')
  const db = await openDB()
  let snapshot: ProjectSnapshot | null = null
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const raw = await getByKey<ProjectRecord>(ps, projectId)
    if (!raw) return
    const record = migrateProjectRecord(raw).record
    authorizeProject(context, record, 'backup')
    snapshot = {
      record,
      files: await getAllByIndex<StoredFile>(fs, 'projectId', projectId),
    }
  })
  return snapshot
}

export async function listProjects(
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectSummary[]> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let records: ProjectRecord[] = []
  await tx(db, STORE_PROJECTS, 'readonly', async ([s]) => {
    records = await getAll<ProjectRecord>(s)
  })
  return records
    .filter(raw => {
      // Filter raw ownership before schema migration so an incompatible record
      // from another workspace cannot break this workspace's listing.
      if (raw.workspaceId === context.workspace.id) return true
      return raw.workspaceId === undefined && raw.ownerUserId === undefined
        && context.workspace.id === LOCAL_WORKSPACE_ID
    })
    .map(raw => migrateProjectRecord(raw).record)
    .map(r => ({ projectId: r.projectId, ownerUserId: r.ownerUserId, workspaceId: r.workspaceId,
      projectName: r.projectName, documentType: r.documentType, version: r.version,
      createdAt: r.createdAt, modifiedAt: r.modifiedAt }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export async function deleteProject(
  projectId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<void> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  await tx(db, [STORE_PROJECTS, STORE_FILES, STORE_CHECKPOINTS, STORE_CHECKPOINT_FILES],
    'readwrite', async ([ps, fs, cs, cfs]) => {
    const raw = await getByKey<ProjectRecord>(ps, projectId)
    if (!raw) return
    authorizeProject(context, migrateProjectRecord(raw).record, 'delete')
    await deleteByKey(ps, projectId)
    const projectFiles = await getAllByIndex<StoredFile>(fs, 'projectId', projectId)
    for (const f of projectFiles) await deleteByKey(fs, f.fileId)
    // A deliberate whole-project deletion also removes its retained history.
    // File-level removal and replacement do not touch either history store.
    const checkpoints = await getAllByIndex<ProjectCheckpoint>(cs, 'projectId', projectId)
    for (const checkpoint of checkpoints) {
      const checkpointFiles = await getAllByIndex<StoredCheckpointFile>(cfs, 'checkpointId', checkpoint.checkpointId)
      for (const file of checkpointFiles)
        await deleteByKey(cfs, [checkpoint.checkpointId, file.fileId])
      await deleteByKey(cs, checkpoint.checkpointId)
    }
  })
}

function remapExtractionFileReferences(
  value: unknown,
  fileIdMap: Record<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => remapExtractionFileReferences(item, fileIdMap))
  }
  if (!value || typeof value !== 'object') return value

  const remapped: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === 'sourceId' || key === 'fileId')
      && typeof nestedValue === 'string'
      && fileIdMap[nestedValue]
    ) {
      remapped[key] = fileIdMap[nestedValue]
    } else {
      remapped[key] = remapExtractionFileReferences(nestedValue, fileIdMap)
    }
  }
  return remapped
}

export function createProjectCopySnapshot(
  snapshot: ProjectSnapshot,
  newId: string,
  newName: string,
  now: number,
  newFileIdMap: Record<string, string>,
  ownership: ProjectOwnership = snapshot.record,
): ProjectSnapshot {
  const source = snapshot.record
  const copy: ProjectRecord = { ...source, projectId: newId, projectName: newName,
    ownerUserId: ownership.ownerUserId, workspaceId: ownership.workspaceId,
    schemaVersion: SCHEMA_VERSION, recordRevision: 0, createdAt: now, modifiedAt: now }
  const newFiles: StoredFile[] = snapshot.files.map(sf => ({
    ...sf, fileId: newFileIdMap[sf.fileId], projectId: newId,
  }))
  copy.sourceFileIds = source.sourceFileIds.flatMap(id => {
    const copiedFileId = newFileIdMap[id]
    return copiedFileId ? [copiedFileId] : []
  })
  copy.sourceExtractions = Object.fromEntries(
    Object.entries(source.sourceExtractions ?? {}).flatMap(([fileId, extraction]) => {
      const copiedFileId = newFileIdMap[fileId]
      if (!copiedFileId) return []
      return [[
        copiedFileId,
        remapExtractionFileReferences(extraction, newFileIdMap),
      ]]
    }),
  )
  const sourceExtractions = source.sourceExtractions as Record<string, SourceExtraction>
  const sourceEvidenceIndex = source.evidenceIndex as EvidenceIndex | null
  copy.evidenceIndex = remapEvidenceIndex(
    sourceEvidenceIndex,
    newFileIdMap,
    copy.sourceExtractions as Record<string, SourceExtraction>,
    isEvidenceIndexFresh(sourceEvidenceIndex, sourceExtractions, source.sourcesRevision),
  )
  const sourceConceptAnalysis = source.conceptAnalysis as ConceptAnalysis | null
  copy.conceptAnalysis = remapConceptAnalysis(
    sourceConceptAnalysis,
    newFileIdMap,
    copy.evidenceIndex as EvidenceIndex | null,
    isConceptAnalysisFresh(sourceConceptAnalysis, sourceEvidenceIndex),
  )
  const sourceUnsupportedAnalysis = source.unsupportedAnalysis as UnsupportedAnalysis | null
  copy.unsupportedAnalysis = remapUnsupportedAnalysis(
    sourceUnsupportedAnalysis,
    newFileIdMap,
    copy.evidenceIndex as EvidenceIndex | null,
    !!sourceUnsupportedAnalysis
      && !!sourceEvidenceIndex
      && sourceUnsupportedAnalysis.evidenceSourcesRevision === sourceEvidenceIndex.sourcesRevision
      && sourceUnsupportedAnalysis.evidenceExtractionRevision === sourceEvidenceIndex.extractionRevision,
  )
  const copiedEvidenceIndex = copy.evidenceIndex as EvidenceIndex | null
  const copiedConceptAnalysis = copy.conceptAnalysis as ConceptAnalysis | null
  const sourceTocProposal = source.tocProposal as TocProposal | null
  const sourceProjectMeta = source.projectMeta && typeof source.projectMeta === 'object'
    ? source.projectMeta as Record<string, unknown>
    : {}
  const sourceContentType = typeof sourceProjectMeta.contentType === 'string'
    ? sourceProjectMeta.contentType
    : source.documentType
  const sourceProposalWasCurrent = isTocProposalFresh(
    sourceTocProposal,
    sourceEvidenceIndex,
    sourceConceptAnalysis,
    sourceContentType,
  )
  copy.tocProposal = sourceTocProposal && copiedEvidenceIndex && copiedConceptAnalysis
    ? {
        ...sourceTocProposal,
        ...(sourceProposalWasCurrent
          ? {
              evidenceSourcesRevision: copiedEvidenceIndex.sourcesRevision,
              evidenceExtractionRevision: copiedEvidenceIndex.extractionRevision,
              groundedAnalysisBuiltAt: copiedConceptAnalysis.builtAt,
            }
          : {}),
        items: sourceTocProposal.items.map(item => ({
          ...item,
          supportingEvidenceIds: [...item.supportingEvidenceIds],
          sourceSectionPaths: item.sourceSectionPaths?.map(path => [...path]),
        })),
      }
    : sourceTocProposal
  const committedTocWasCurrent = !!sourceEvidenceIndex
    && !!sourceConceptAnalysis
    && source.tocGeneratedFromEvidenceSourcesRevision === sourceEvidenceIndex.sourcesRevision
    && source.tocGeneratedFromEvidenceExtractionRevision === sourceEvidenceIndex.extractionRevision
    && source.tocGeneratedFromConceptBuiltAt === sourceConceptAnalysis.builtAt
    && source.tocGeneratedFromContentType === sourceContentType
  if (committedTocWasCurrent && copiedEvidenceIndex && copiedConceptAnalysis) {
    copy.tocGeneratedFromEvidenceSourcesRevision = copiedEvidenceIndex.sourcesRevision
    copy.tocGeneratedFromEvidenceExtractionRevision = copiedEvidenceIndex.extractionRevision
    copy.tocGeneratedFromConceptBuiltAt = copiedConceptAnalysis.builtAt
  }
  copy.authorTopicMetadata = remapAuthorTopicMetadata(
    source.authorTopicMetadata,
    newFileIdMap,
    sourceEvidenceIndex,
    copiedEvidenceIndex,
    sourceConceptAnalysis,
    copiedConceptAnalysis,
  )
  copy.reviewModel = remapReviewModelForDuplicate(
    source.reviewModel,
    source.projectId,
    newId,
    newFileIdMap,
  )
  return { record: copy, files: newFiles }
}

export function validateProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  if (!snapshot || !snapshot.record || typeof snapshot.record !== 'object')
    throw new Error('Project backup is missing its project record.')
  const record = migrateProjectRecord(snapshot.record).record
  validateRestorableProjectRecord(record)
  if (!record.projectId || typeof record.projectName !== 'string')
    throw new Error('Project backup is missing its project identity.')
  if (!Array.isArray(snapshot.files))
    throw new Error('Project backup is missing its file list.')

  const fileIds = new Set<string>()
  const files = snapshot.files.map(file => {
    if (!file || typeof file.fileId !== 'string' || !file.fileId)
      throw new Error('Project backup contains a file with an invalid ID.')
    if (fileIds.has(file.fileId))
      throw new Error(`Project backup contains duplicate file ID "${file.fileId}".`)
    fileIds.add(file.fileId)
    if (file.projectId !== record.projectId)
      throw new Error(`File "${file.fileId}" belongs to a different project.`)
    if (!file.blob || typeof file.blob.slice !== 'function'
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.blob.size !== file.size)
      throw new Error(`File "${file.fileId}" has missing or inconsistent binary data.`)
    return { ...file }
  })

  if (!Array.isArray(record.sourceFileIds))
    throw new Error('Project record has an invalid source file list.')
  const sourceFileIds = new Set<string>()
  for (const fileId of record.sourceFileIds) {
    if (typeof fileId !== 'string' || !fileId || sourceFileIds.has(fileId))
      throw new Error('Project record contains an invalid or duplicate source file reference.')
    sourceFileIds.add(fileId)
    if (!fileIds.has(fileId))
      throw new Error(`Required source file "${fileId}" is missing from the backup.`)
  }
  return { record, files }
}

function freshId(prefix: string): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}-${randomId}`
}

function withFreshFileWriteToken(file: StoredFile): StoredFile {
  return { ...file, writeToken: freshId('file-write') }
}

export async function restoreProjectSnapshot(
  input: ProjectSnapshot,
  options: RestoreProjectSnapshotOptions,
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectRecord> {
  const snapshot = validateProjectSnapshot(input)
  // As-new imports are portable; the destination actor deliberately becomes
  // owner. Replacement must authorize the existing project, not the archive.
  authorizeWorkspace(context, options.mode === 'new' ? 'restore-new' : 'read')
  const db = await openDB()

  if (options.mode === 'new') {
    const now = Date.now()
    const newId = options.newProjectId ?? freshId('project')
    const newFileIdMap: Record<string, string> = Object.create(null) as Record<string, string>
    for (const file of snapshot.files) newFileIdMap[file.fileId] = freshId('file')
    const restored = createProjectCopySnapshot(
      snapshot,
      newId,
      options.newName,
      now,
      newFileIdMap,
      { ownerUserId: context.user.id, workspaceId: context.workspace.id },
    )
    await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
      if (await getByKey<ProjectRecord>(ps, restored.record.projectId))
        throw new Error(`A project with generated ID "${restored.record.projectId}" already exists.`)
      await assertUniqueProjectName(ps, restored.record.workspaceId, restored.record.projectName)
      for (const file of restored.files) {
        if (await getByKey<StoredFile>(fs, file.fileId))
          throw new Error(`A file with generated ID "${file.fileId}" already exists.`)
      }
      await put(ps, restored.record)
      for (const file of restored.files) await put(fs, withFreshFileWriteToken(file))
    })
    return restored.record
  }

  if (options.mode !== 'replace')
    throw new Error('Unsupported project restore mode.')
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)
    throw new Error('Expected project revision must be a nonnegative integer.')
  if (!Array.isArray(options.expectedFileIds) ||
    options.expectedFileIds.some(id => typeof id !== 'string' || !id) ||
    new Set(options.expectedFileIds).size !== options.expectedFileIds.length)
    throw new Error('Replacement requires a valid snapshot of the destination files.')

  let restored: ProjectRecord | null = null
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    const previous = await getByKey<ProjectRecord>(ps, snapshot.record.projectId)
    if (!previous)
      throw new Error(`Project "${snapshot.record.projectId}" does not exist; replacement was not performed.`)
    const current = migrateProjectRecord(previous).record
    authorizeProject(context, current, 'replace')
    if (snapshot.record.workspaceId !== current.workspaceId)
      throw new Error('A backup from another workspace cannot replace this project; restore it as new.')
    if (current.recordRevision !== options.expectedRevision)
      throw new ProjectConflictError(snapshot.record.projectId, options.expectedRevision, current.recordRevision)
    if (!normalizeProjectName(snapshot.record.projectName))
      throw new Error('Project name cannot be empty.')
    if (projectNameKey(snapshot.record.projectName) !== projectNameKey(current.projectName))
      await assertUniqueProjectName(ps, current.workspaceId, snapshot.record.projectName, current.projectId)

    const existingFiles = await getAllByIndex<StoredFile>(fs, 'projectId', current.projectId)
    const existingFileIds = new Set(existingFiles.map(file => file.fileId))
    if (existingFiles.length !== options.expectedFileIds.length ||
      options.expectedFileIds.some(fileId => !existingFileIds.has(fileId)))
      throw new Error(`Project "${current.projectId}" files changed since restore confirmation; replacement was not performed.`)
    for (const file of snapshot.files) {
      const existing = await getByKey<StoredFile>(fs, file.fileId)
      if (existing && existing.projectId !== current.projectId)
        throw new Error(`File ID "${file.fileId}" is already owned by another project.`)
    }

    // Replacement keeps the destination's identity and original creation time;
    // all restored content, source/file IDs, and provenance remain from backup.
    restored = {
      ...snapshot.record,
      projectId: current.projectId,
      ownerUserId: current.ownerUserId,
      workspaceId: current.workspaceId,
      createdAt: current.createdAt,
      schemaVersion: SCHEMA_VERSION,
      recordRevision: current.recordRevision + 1,
      modifiedAt: Date.now(),
    }
    for (const fileId of existingFileIds) await deleteByKey(fs, fileId)
    await put(ps, restored)
    for (const file of snapshot.files)
      await put(fs, withFreshFileWriteToken({ ...file, projectId: current.projectId }))
  })
  return restored!
}

export async function duplicateProject(
  sourceId: string, newName: string,
  context: ProjectAccessContext = getAccessContext(),
  newProjectId?: string,
): Promise<ProjectRecord | null> {
  authorizeWorkspace(context, 'duplicate')
  const db = await openDB()
  const snapshot: { record: ProjectRecord | null; files: StoredFile[] } = { record: null, files: [] }
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const raw = await getByKey<ProjectRecord>(ps, sourceId)
    if (!raw) return
    const source = migrateProjectRecord(raw).record
    authorizeProject(context, source, 'duplicate')
    snapshot.record = source
    snapshot.files = await getAllByIndex<StoredFile>(fs, 'projectId', sourceId)
  })
  const source = snapshot.record
  if (!source) return null
  const sourceSnapshot: ProjectSnapshot = { record: source, files: snapshot.files }
  const now = Date.now()
  const newId = newProjectId ?? `project-${now}-${Math.random().toString(36).slice(2, 8)}`
  const newFileIdMap: Record<string, string> = Object.create(null) as Record<string, string>
  for (const file of snapshot.files) {
    newFileIdMap[file.fileId] = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  const copySnapshot = createProjectCopySnapshot(sourceSnapshot, newId, newName, now, newFileIdMap,
    { ownerUserId: context.user.id, workspaceId: context.workspace.id })
  const copy = copySnapshot.record
  const newFiles = copySnapshot.files
  const sourceFiles = snapshot.files
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    const currentRaw = await getByKey<ProjectRecord>(ps, sourceId)
    if (!currentRaw) throw new Error(`Source project "${sourceId}" was deleted during duplication.`)
    const current = migrateProjectRecord(currentRaw).record
    authorizeProject(context, current, 'duplicate')
    if (current.recordRevision !== source.recordRevision)
      throw new ProjectConflictError(sourceId, source.recordRevision, current.recordRevision)
    const currentFiles = await getAllByIndex<StoredFile>(fs, 'projectId', sourceId)
    if (currentFiles.map(file => file.fileId).sort().join('\0')
      !== sourceFiles.map(file => file.fileId).sort().join('\0'))
      throw new Error(`Source files changed during duplication of project "${sourceId}".`)
    if (await getByKey<ProjectRecord>(ps, copy.projectId))
      throw new Error(`Duplicate project ID "${copy.projectId}" already exists.`)
    await assertUniqueProjectName(ps, copy.workspaceId, copy.projectName)
    for (const file of newFiles) {
      if (await getByKey<StoredFile>(fs, file.fileId))
        throw new Error(`Duplicate file ID "${file.fileId}" already exists.`)
    }
    await put(ps, copy)
    for (const f of newFiles) await put(fs, withFreshFileWriteToken(f))
  })
  return copy
}

// ── File persistence ───────────────────────────────────────────────────────

export async function saveFile(
  projectId: string, file: File, context: ProjectAccessContext = getAccessContext(),
): Promise<StoredFile> {
  const db = await openDB()
  const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const stored: StoredFile = withFreshFileWriteToken({
    fileId, projectId, name: file.name, type: file.type, size: file.size,
    uploadedAt: Date.now(), blob: file,
  })
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    const project = await getByKey<ProjectRecord>(ps, projectId)
    if (!project) throw new Error(`Project "${projectId}" does not exist.`)
    authorizeProject(context, migrateProjectRecord(project).record, 'write')
    if (await getByKey<StoredFile>(fs, fileId))
      throw new Error(`File ID "${fileId}" already exists.`)
    await put(fs, stored)
  })
  return stored
}

export async function loadProjectFiles(
  projectId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<StoredFile[]> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let files: StoredFile[] = []
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const project = await getByKey<ProjectRecord>(ps, projectId)
    if (!project) return
    authorizeProject(context, migrateProjectRecord(project).record, 'read')
    files = await getAllByIndex<StoredFile>(fs, 'projectId', projectId)
  })
  return files
}

export async function loadFile(
  fileId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<StoredFile | null> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let result: StoredFile | undefined
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const file = await getByKey<StoredFile>(fs, fileId)
    if (!file) return
    const project = await getByKey<ProjectRecord>(ps, file.projectId)
    if (!project) throw new Error(`File "${fileId}" has no owning project.`)
    authorizeProject(context, migrateProjectRecord(project).record, 'read')
    result = file
  })
  return result ?? null
}

export async function removeFile(
  fileId: string, context: ProjectAccessContext = getAccessContext(),
): Promise<void> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    const file = await getByKey<StoredFile>(fs, fileId)
    if (!file) return
    const project = await getByKey<ProjectRecord>(ps, file.projectId)
    if (!project) throw new Error(`File "${fileId}" has no owning project.`)
    authorizeProject(context, migrateProjectRecord(project).record, 'write')
    await deleteByKey(fs, fileId)
  })
}

type StoredCheckpointFile = {
  checkpointId: string
  fileId: string
  projectId: string
  name: string
  type: string
  size: number
  uploadedAt: number
  blob: Blob
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function assertExpectedFileIds(ids: string[]): void {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)
    || new Set(ids).size !== ids.length)
    throw new Error('Checkpoint capture requires a valid snapshot of the project files.')
}

function validateCheckpointSourceSet(record: ProjectRecord, files: StoredFile[]): void {
  const byId = new Map<string, StoredFile>()
  for (const file of files) {
    if (!file || typeof file.fileId !== 'string' || !file.fileId
      || byId.has(file.fileId) || file.projectId !== record.projectId
      || typeof file.name !== 'string' || typeof file.type !== 'string'
      || !Number.isSafeInteger(file.size) || file.size < 0
      || !Number.isSafeInteger(file.uploadedAt) || !file.blob
      || file.blob.size !== file.size)
      throw new Error('Project checkpoint contains an invalid or inconsistent live file.')
    byId.set(file.fileId, file)
  }
  if (!Array.isArray(record.sourceFileIds)
    || new Set(record.sourceFileIds).size !== record.sourceFileIds.length
    || record.sourceFileIds.some(id => typeof id !== 'string' || !byId.has(id)))
    throw new Error('Project checkpoint cannot be captured because a source reference is missing.')
}

function freshCheckpointId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  return `checkpoint-${randomId}`
}

async function readAuthorizedCheckpoint(
  projectId: string,
  checkpointId: string,
  context: ProjectAccessContext,
  requireCompleteFiles = true,
): Promise<ProjectCheckpointRead | null> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let result: ProjectCheckpointRead | null = null
  await tx(db, [STORE_PROJECTS, STORE_CHECKPOINTS, STORE_CHECKPOINT_FILES], 'readonly',
    async ([ps, cs, fs]) => {
      const rawProject = await getByKey<ProjectRecord>(ps, projectId)
      if (!rawProject) return
      const project = migrateProjectRecord(rawProject).record
      authorizeProject(context, project, 'read')
      const checkpoint = await getByKey<ProjectCheckpoint>(cs, checkpointId)
      if (!checkpoint || checkpoint.projectId !== projectId) return
      if (checkpoint.workspaceId !== project.workspaceId)
        throw new Error('Checkpoint workspace does not match its project.')
      if (requireCompleteFiles && (checkpoint.record.projectId !== projectId
        || checkpoint.record.workspaceId !== project.workspaceId))
        throw new Error('Checkpoint record does not match its project scope.')
      const storedFiles = await getAllByIndex<StoredCheckpointFile>(fs, 'checkpointId', checkpointId)
      const scopedFiles = storedFiles.filter(file => file.projectId === projectId)
      if (requireCompleteFiles && (scopedFiles.length !== storedFiles.length
        || scopedFiles.length !== checkpoint.files.length
        || new Set(scopedFiles.map(file => file.fileId)).size !== scopedFiles.length))
        throw new Error('Checkpoint file store is incomplete or scoped to another project.')
      const filesById = new Map(scopedFiles.map(file => [file.fileId, file]))
      if (requireCompleteFiles && checkpoint.files.some(file => !filesById.has(file.fileId)))
        throw new Error('Checkpoint manifest does not match its immutable file store.')
      result = {
        checkpoint,
        files: scopedFiles.map(({ checkpointId: _checkpointId, ...file }) => file),
      }
    })
  return result
}

/** Append an immutable point-in-time copy guarded by the live revision and file set. */
export async function captureProjectCheckpoint(
  projectId: string,
  expectedRevision: number,
  expectedFileIds: string[],
  reason: string,
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectCheckpoint> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Expected project revision must be a nonnegative integer.')
  assertExpectedFileIds(expectedFileIds)
  const note = validateCheckpointReason(reason)
  authorizeWorkspace(context, 'write')
  const db = await openDB()

  const prepared: {
    record?: ProjectRecord
    files: StoredFile[]
    parentCheckpointId: string | null
  } = { files: [], parentCheckpointId: null }
  await tx(db, [STORE_PROJECTS, STORE_FILES, STORE_CHECKPOINTS], 'readonly', async ([ps, fs, cs]) => {
    const raw = await getByKey<ProjectRecord>(ps, projectId)
    if (!raw) throw new Error(`Project "${projectId}" does not exist.`)
    const record = migrateProjectRecord(raw).record
    authorizeProject(context, record, 'write')
    if (record.recordRevision !== expectedRevision)
      throw new ProjectConflictError(projectId, expectedRevision, record.recordRevision)
    const files = await getAllByIndex<StoredFile>(fs, 'projectId', projectId)
    if (sortedIds(files.map(file => file.fileId)).join('\0')
      !== sortedIds(expectedFileIds).join('\0'))
      throw new Error(`Project files changed before checkpoint capture for "${projectId}".`)
    validateCheckpointSourceSet(record, files)
    const history = await getAllByIndex<ProjectCheckpoint>(cs, 'projectId', projectId)
    const parent = history
      .filter(item => item.workspaceId === record.workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt || b.checkpointId.localeCompare(a.checkpointId))[0]
    prepared.record = record
    prepared.files = files
    prepared.parentCheckpointId = parent?.checkpointId ?? null
  })
  if (!prepared.record) throw new Error(`Project "${projectId}" does not exist.`)

  const record = prepared.record
  const orderedFiles = [...prepared.files].sort((a, b) => a.fileId.localeCompare(b.fileId))
  const checkpointId = freshCheckpointId()
  // Hashing must finish before opening the committing transaction: WebCrypto can
  // otherwise let IndexedDB auto-commit while the transaction is suspended.
  const manifests = await Promise.all(orderedFiles.map(async file => ({
    fileId: file.fileId,
    name: file.name,
    type: file.type,
    size: file.size,
    uploadedAt: file.uploadedAt,
    sha256: await checkpointSha256(file.blob),
    storageRef: `${checkpointId}/${file.fileId}`,
  })))
  const createdAt = Date.now()
  const baseCheckpoint: Omit<ProjectCheckpoint, 'integrityDigest'> = {
    checkpointId,
    workspaceId: record.workspaceId,
    projectId,
    parentCheckpointId: prepared.parentCheckpointId,
    reason: note,
    actorUserId: context.user.id,
    createdAt,
    originatingRecordRevision: record.recordRevision,
    recordSchemaVersion: record.schemaVersion,
    recordDigest: await checkpointSha256(canonicalCheckpointJson(record)),
    record: structuredClone(record),
    files: manifests,
  }
  const integrityDigest = await checkpointIntegrityDigest(baseCheckpoint)
  const checkpoint: ProjectCheckpoint = { ...baseCheckpoint, integrityDigest }

  await tx(db, [STORE_PROJECTS, STORE_FILES, STORE_CHECKPOINTS, STORE_CHECKPOINT_FILES],
    'readwrite', async ([ps, liveFilesStore, checkpointStore, checkpointFilesStore]) => {
      const raw = await getByKey<ProjectRecord>(ps, projectId)
      if (!raw) throw new Error(`Project "${projectId}" was deleted during checkpoint capture.`)
      const current = migrateProjectRecord(raw).record
      authorizeProject(context, current, 'write')
      if (current.recordRevision !== expectedRevision)
        throw new ProjectConflictError(projectId, expectedRevision, current.recordRevision)
      const liveFiles = await getAllByIndex<StoredFile>(liveFilesStore, 'projectId', projectId)
      const liveIds = sortedIds(liveFiles.map(file => file.fileId))
      if (liveIds.join('\0') !== sortedIds(expectedFileIds).join('\0')
        || liveIds.join('\0') !== orderedFiles.map(file => file.fileId).join('\0'))
        throw new Error(`Project files changed during checkpoint capture for "${projectId}".`)
      validateCheckpointSourceSet(current, liveFiles)
      const preparedById = new Map(orderedFiles.map(file => [file.fileId, file]))
      if (liveFiles.some(file => {
        const prepared = preparedById.get(file.fileId)
        return !prepared || file.projectId !== prepared.projectId || file.name !== prepared.name
          || file.type !== prepared.type || file.size !== prepared.size
          || file.uploadedAt !== prepared.uploadedAt || file.blob.size !== prepared.blob.size
          || file.writeToken !== prepared.writeToken
      }))
        throw new Error(`Project file metadata changed during checkpoint capture for "${projectId}".`)
      if (await getByKey<ProjectCheckpoint>(checkpointStore, checkpointId))
        throw new Error(`Checkpoint ID "${checkpointId}" already exists.`)
      const history = await getAllByIndex<ProjectCheckpoint>(checkpointStore, 'projectId', projectId)
      const parent = history
        .filter(item => item.workspaceId === current.workspaceId)
        .sort((a, b) => b.createdAt - a.createdAt || b.checkpointId.localeCompare(a.checkpointId))[0]
      if ((parent?.checkpointId ?? null) !== prepared.parentCheckpointId)
        throw new Error(`Checkpoint history changed during capture for project "${projectId}".`)
      for (const file of orderedFiles) {
        if (await getByKey<StoredCheckpointFile>(checkpointFilesStore, [checkpointId, file.fileId]))
          throw new Error(`Checkpoint file collision for "${file.fileId}".`)
      }
      await put(checkpointStore, checkpoint)
      // Copy precisely the blobs that were hashed before the transaction. The
      // per-write token proves those bytes are still the live version.
      for (const file of orderedFiles) {
        await put(checkpointFilesStore, {
          checkpointId,
          fileId: file.fileId,
          projectId,
          name: file.name,
          type: file.type,
          size: file.size,
          uploadedAt: file.uploadedAt,
          blob: file.blob.slice(0, file.blob.size, file.blob.type),
        } satisfies StoredCheckpointFile)
      }
    })
  return checkpoint
}

export async function listProjectCheckpoints(
  projectId: string,
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectCheckpointSummary[]> {
  authorizeWorkspace(context, 'read')
  const db = await openDB()
  let checkpoints: ProjectCheckpoint[] = []
  await tx(db, [STORE_PROJECTS, STORE_CHECKPOINTS], 'readonly', async ([ps, cs]) => {
    const raw = await getByKey<ProjectRecord>(ps, projectId)
    if (!raw) return
    const project = migrateProjectRecord(raw).record
    authorizeProject(context, project, 'read')
    checkpoints = await getAllByIndex<ProjectCheckpoint>(cs, 'projectId', projectId)
    if (checkpoints.some(checkpoint => checkpoint.projectId !== projectId
      || checkpoint.workspaceId !== project.workspaceId))
      throw new Error('Checkpoint history contains an invalid project scope.')
  })
  return checkpoints
    .sort((a, b) => b.createdAt - a.createdAt || b.checkpointId.localeCompare(a.checkpointId))
    .map(({ record: _record, ...summary }) => summary)
}

export async function getProjectCheckpoint(
  projectId: string,
  checkpointId: string,
  context: ProjectAccessContext = getAccessContext(),
): Promise<ProjectCheckpointRead | null> {
  return readAuthorizedCheckpoint(projectId, checkpointId, context)
}

export async function verifyProjectCheckpoint(
  projectId: string,
  checkpointId: string,
  context: ProjectAccessContext = getAccessContext(),
): Promise<CheckpointVerification> {
  const read = await readAuthorizedCheckpoint(projectId, checkpointId, context, false)
  if (!read) return { valid: false, issues: ['Checkpoint does not exist in this project.'] }
  return verifyCheckpointRead(read)
}

// ── Active project tracking (localStorage — tiny, fast) ───────────────────

const ACTIVE_KEY = 'docflow-active-project'
function activeKey(context: ProjectAccessContext): string {
  authorizeWorkspace(context, 'read')
  return context.workspace.id === LOCAL_WORKSPACE_ID
    ? ACTIVE_KEY : `${ACTIVE_KEY}:${context.workspace.id}`
}
export const getActiveProjectId = (
  context: ProjectAccessContext = getAccessContext(),
): string | null => localStorage.getItem(activeKey(context))
export const setActiveProjectId = (
  id: string | null, context: ProjectAccessContext = getAccessContext(),
): void => {
  const key = activeKey(context)
  if (id) localStorage.setItem(key, id)
  else localStorage.removeItem(key)
}
