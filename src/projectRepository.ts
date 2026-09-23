// ProjectRepository — IndexedDB-backed persistence for DocFlow projects
// All project state flows through here; individual screens never write directly.

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

export const SCHEMA_VERSION = 2
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

export type ProjectRecord = {
  projectId: string
  schemaVersion: number
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
  tocRevision: number
  tocGeneratedFromRev: number
  tocHumanModified: boolean
  masterAssignments: Record<string, string>

  // Source extractions
  sourceExtractions: Record<string, unknown>
  evidenceIndex: unknown | null

  // Content
  docBlocks: unknown[]
  topicContent: Record<string, unknown[]>
  contentRevision: number

  // Review
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
    fn(storeObjects).catch(reject)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(new Error('Transaction aborted'))
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
    schemaVersion: SCHEMA_VERSION,
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
    tocRevision: 0,
    tocGeneratedFromRev: -1,
    tocHumanModified: false,
    masterAssignments: {},
    sourceExtractions: {},
    evidenceIndex: null,
    docBlocks: [],
    topicContent: {},
    contentRevision: 0,
    findingStatuses: {},
    aiReviewDone: false,
    reviewStage: 1,
    reviewRevision: -1,
    snippets: [],
    conditionGroups: [],
    docComments: [],
    publishConfig: { selectedFormats: [], activeVariant: '' },
    ...partial,
  }
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => { await put(s, record) })
  return record
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  const db = await openDB()
  const updated = { ...record, modifiedAt: Date.now() }
  await tx(db, STORE_PROJECTS, 'readwrite', async ([s]) => { await put(s, updated) })
}

export async function loadProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openDB()
  let result: ProjectRecord | undefined
  await tx(db, STORE_PROJECTS, 'readonly', async ([s]) => {
    result = await getByKey<ProjectRecord>(s, projectId)
  })
  return result ?? null
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDB()
  let records: ProjectRecord[] = []
  await tx(db, STORE_PROJECTS, 'readonly', async ([s]) => {
    records = await getAll<ProjectRecord>(s)
  })
  return records
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

export async function duplicateProject(sourceId: string, newName: string): Promise<ProjectRecord | null> {
  const source = await loadProject(sourceId)
  if (!source) return null
  const db = await openDB()
  const now = Date.now()
  const newId = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const copy: ProjectRecord = { ...source, projectId: newId, projectName: newName, createdAt: now, modifiedAt: now }
  // Deep-copy file blobs for new project
  let sourceFiles: StoredFile[] = []
  await tx(db, STORE_FILES, 'readonly', async ([fs]) => {
    sourceFiles = await getAllByIndex<StoredFile>(fs, 'projectId', sourceId)
  })
  const newFileIdMap: Record<string, string> = {}
  const newFiles: StoredFile[] = sourceFiles.map(sf => {
    const newFileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    newFileIdMap[sf.fileId] = newFileId
    return { ...sf, fileId: newFileId, projectId: newId }
  })
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
  await tx(db, [STORE_PROJECTS, STORE_FILES], 'readwrite', async ([ps, fs]) => {
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
