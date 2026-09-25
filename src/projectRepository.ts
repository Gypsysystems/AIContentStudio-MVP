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

export const SCHEMA_VERSION = CURRENT_PROJECT_SCHEMA_VERSION
export { migrateProjectRecord, UnsupportedProjectSchemaError } from './projectMigrations'
const DB_NAME = 'docflow-db'
const DB_VERSION = 2
const STORE_PROJECTS = 'projects'
const STORE_FILES = 'files'

// ── Types ──────────────────────────────────────────────────────────────────

export type StoredFile = {
  fileId: string
  projectId: string
  name: string
  type: string
  size: number
  uploadedAt: number
  blob: Blob
}

export type ProjectSnapshot = {
  record: ProjectRecord
  files: StoredFile[]
}

export type RestoreProjectSnapshotOptions =
  | { mode: 'new' }
  | { mode: 'replace'; expectedRevision: number; expectedFileIds: string[] }

export type ProjectRecord = {
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

export type ProjectSummary = {
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

export async function createProject(partial: Partial<ProjectRecord> & { projectId: string; projectName: string }): Promise<ProjectRecord> {
  const db = await openDB()
  const now = Date.now()
  const record: ProjectRecord = {
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
    schemaVersion: SCHEMA_VERSION,
    recordRevision: 0,
  }
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => { await put(s, record) })
  return record
}

export async function saveProject(record: ProjectRecord): Promise<ProjectRecord> {
  const db = await openDB()
  let saved: ProjectRecord | null = null
  // Legacy local save remains last-write-wins for existing UI flows. The
  // guarded operation below is the explicit cloud-ready conflict primitive.
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const previous = await getByKey<ProjectRecord>(s, record.projectId)
    const revision = previous ? migrateProjectRecord(previous).record.recordRevision : 0
    saved = { ...migrateProjectRecord(record).record,
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

export async function saveProjectIfCurrent(record: ProjectRecord, expectedRevision: number): Promise<ProjectRecord> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Expected project revision must be a nonnegative integer.')
  const db = await openDB()
  let saved: ProjectRecord | null = null
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const previous = await getByKey<ProjectRecord>(s, record.projectId)
    if (!previous) throw new Error(`Project "${record.projectId}" does not exist.`)
    const current = migrateProjectRecord(previous).record
    if (current.recordRevision !== expectedRevision)
      throw new ProjectConflictError(record.projectId, expectedRevision, current.recordRevision)
    saved = { ...migrateProjectRecord(record).record, schemaVersion: SCHEMA_VERSION,
      recordRevision: current.recordRevision + 1, modifiedAt: Date.now() }
    await put(s, saved)
  })
  return saved!
}

export async function loadProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openDB()
  let result: ProjectRecord | undefined
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => {
    const stored = await getByKey<ProjectRecord>(s, projectId)
    if (!stored) return
    const migrated = migrateProjectRecord(stored)
    result = migrated.record
    if (migrated.changed) await put(s, migrated.record)
  })
  return result ?? null
}

export async function loadProjectSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  const db = await openDB()
  let snapshot: ProjectSnapshot | null = null
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const raw = await getByKey<ProjectRecord>(ps, projectId)
    if (!raw) return
    snapshot = {
      record: migrateProjectRecord(raw).record,
      files: await getAllByIndex<StoredFile>(fs, 'projectId', projectId),
    }
  })
  return snapshot
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDB()
  let records: ProjectRecord[] = []
  await tx(db, STORE_PROJECTS, 'readonly', async ([s]) => {
    records = await getAll<ProjectRecord>(s)
  })
  return records
    .map(raw => migrateProjectRecord(raw).record)
    .map(r => ({ projectId: r.projectId, projectName: r.projectName, documentType: r.documentType, version: r.version, createdAt: r.createdAt, modifiedAt: r.modifiedAt }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDB()
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    await deleteByKey(ps, projectId)
    const projectFiles = await getAllByIndex<StoredFile>(fs, 'projectId', projectId)
    for (const f of projectFiles) await deleteByKey(fs, f.fileId)
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

function createProjectCopySnapshot(
  snapshot: ProjectSnapshot,
  newId: string,
  newName: string,
  now: number,
  newFileIdMap: Record<string, string>,
): ProjectSnapshot {
  const source = snapshot.record
  const copy: ProjectRecord = { ...source, projectId: newId, projectName: newName,
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

function validateProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
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

export async function restoreProjectSnapshot(
  input: ProjectSnapshot,
  options: RestoreProjectSnapshotOptions,
): Promise<ProjectRecord> {
  const snapshot = validateProjectSnapshot(input)
  const db = await openDB()

  if (options.mode === 'new') {
    const now = Date.now()
    const newId = freshId('project')
    const newFileIdMap: Record<string, string> = Object.create(null) as Record<string, string>
    for (const file of snapshot.files) newFileIdMap[file.fileId] = freshId('file')
    const restored = createProjectCopySnapshot(
      snapshot,
      newId,
      `${snapshot.record.projectName} (Restored)`,
      now,
      newFileIdMap,
    )
    await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
      if (await getByKey<ProjectRecord>(ps, restored.record.projectId))
        throw new Error(`A project with generated ID "${restored.record.projectId}" already exists.`)
      for (const file of restored.files) {
        if (await getByKey<StoredFile>(fs, file.fileId))
          throw new Error(`A file with generated ID "${file.fileId}" already exists.`)
      }
      await put(ps, restored.record)
      for (const file of restored.files) await put(fs, file)
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
    if (current.recordRevision !== options.expectedRevision)
      throw new ProjectConflictError(snapshot.record.projectId, options.expectedRevision, current.recordRevision)

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
      createdAt: current.createdAt,
      schemaVersion: SCHEMA_VERSION,
      recordRevision: current.recordRevision + 1,
      modifiedAt: Date.now(),
    }
    for (const fileId of existingFileIds) await deleteByKey(fs, fileId)
    await put(ps, restored)
    for (const file of snapshot.files) await put(fs, { ...file, projectId: current.projectId })
  })
  return restored!
}

export async function duplicateProject(sourceId: string, newName: string): Promise<ProjectRecord | null> {
  const db = await openDB()
  const snapshot: { record: ProjectRecord | null; files: StoredFile[] } = { record: null, files: [] }
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readonly', async ([ps, fs]) => {
    const raw = await getByKey<ProjectRecord>(ps, sourceId)
    if (!raw) return
    snapshot.record = migrateProjectRecord(raw).record
    snapshot.files = await getAllByIndex<StoredFile>(fs, 'projectId', sourceId)
  })
  const source = snapshot.record
  if (!source) return null
  const sourceSnapshot: ProjectSnapshot = { record: source, files: snapshot.files }
  const now = Date.now()
  const newId = `project-${now}-${Math.random().toString(36).slice(2, 8)}`
  const newFileIdMap: Record<string, string> = Object.create(null) as Record<string, string>
  for (const file of snapshot.files) {
    newFileIdMap[file.fileId] = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  const copySnapshot = createProjectCopySnapshot(sourceSnapshot, newId, newName, now, newFileIdMap)
  const copy = copySnapshot.record
  const newFiles = copySnapshot.files
  const sourceFiles = snapshot.files
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
    const currentRaw = await getByKey<ProjectRecord>(ps, sourceId)
    if (!currentRaw) throw new Error(`Source project "${sourceId}" was deleted during duplication.`)
    const current = migrateProjectRecord(currentRaw).record
    if (current.recordRevision !== source.recordRevision)
      throw new ProjectConflictError(sourceId, source.recordRevision, current.recordRevision)
    const currentFiles = await getAllByIndex<StoredFile>(fs, 'projectId', sourceId)
    if (currentFiles.map(file => file.fileId).sort().join('\0')
      !== sourceFiles.map(file => file.fileId).sort().join('\0'))
      throw new Error(`Source files changed during duplication of project "${sourceId}".`)
    await put(ps, copy)
    for (const f of newFiles) await put(fs, f)
  })
  return copy
}

// ── File persistence ───────────────────────────────────────────────────────

export async function saveFile(projectId: string, file: File): Promise<StoredFile> {
  const db = await openDB()
  const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const stored: StoredFile = { fileId, projectId, name: file.name, type: file.type, size: file.size, uploadedAt: Date.now(), blob: file }
  await tx(db, STORE_FILES, 'readwrite', async ([s]) => { await put(s, stored) })
  return stored
}

export async function loadProjectFiles(projectId: string): Promise<StoredFile[]> {
  const db = await openDB()
  let files: StoredFile[] = []
  await tx(db, STORE_FILES, 'readonly', async ([s]) => {
    files = await getAllByIndex<StoredFile>(s, 'projectId', projectId)
  })
  return files
}

export async function loadFile(fileId: string): Promise<StoredFile | null> {
  const db = await openDB()
  let result: StoredFile | undefined
  await tx(db, STORE_FILES, 'readonly', async ([s]) => {
    result = await getByKey<StoredFile>(s, fileId)
  })
  return result ?? null
}

export async function removeFile(fileId: string): Promise<void> {
  const db = await openDB()
  await tx(db, STORE_FILES, 'readwrite', ([s]) =>
    new Promise<void>((resolve, reject) => {
      const req = s.delete(fileId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  )
}

// ── Active project tracking (localStorage — tiny, fast) ───────────────────

const ACTIVE_KEY = 'docflow-active-project'
export const getActiveProjectId = (): string | null => localStorage.getItem(ACTIVE_KEY)
export const setActiveProjectId = (id: string | null): void => {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}
