import JSZip from 'jszip'
import { migrateProjectRecord, validateRestorableProjectRecord } from './projectMigrations'
import { projectRepository, type ProjectRecord, type ProjectSnapshot, type StoredFile } from './projectService'
import type { ProjectAccessContext } from './ownership'

export const BACKUP_FORMAT_VERSION = 1
const FORMAT = 'docflow-project-backup'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MIB = 1024 * 1024
const MAX_BACKUP_BYTES = 512 * MIB
const MAX_RECORD_BYTES = 64 * MIB
const MAX_FILE_BYTES = 256 * MIB
const MAX_MANIFEST_BYTES = 8 * MIB
const MAX_FILES = 1000

type BackupEntry = { path: string; byteLength: number; sha256: string }
type FileEntry = BackupEntry & {
  fileId: string
  name: string
  type: string
  size: number
  uploadedAt: number
}

type BackupManifest = {
  format: typeof FORMAT
  backupVersion: number
  projectId: string
  projectName: string
  projectSchemaVersion: number
  recordRevision: number
  createdAt: number
  modifiedAt: number
  exportedAt: number
  record: BackupEntry
  files: FileEntry[]
}

export type BackupSummary = Pick<BackupManifest,
  'projectId' | 'projectName' | 'projectSchemaVersion' | 'recordRevision' | 'createdAt' | 'modifiedAt' | 'exportedAt'
> & { fileCount: number; backupVersion: number }

export type RestoreOptions = { mode: 'new' } | {
  mode: 'replace'; expectedRevision: number; expectedFileIds: string[]
}

function invalid(message: string): never {
  throw new Error(`Invalid project backup: ${message}`)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalid manifest structure.')
  return value as Record<string, unknown>
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function entry(value: unknown): BackupEntry {
  const item = object(value)
  if (typeof item.path !== 'string' || !item.path || !nonnegativeInteger(item.byteLength)
    || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256))
    invalid('invalid entry metadata.')
  return item as BackupEntry
}

function parseManifest(value: unknown): BackupManifest {
  const raw = object(value)
  if (raw.format !== FORMAT) invalid('unknown format.')
  if (raw.backupVersion !== BACKUP_FORMAT_VERSION)
    invalid(`unsupported backup version ${String(raw.backupVersion)}.`)
  if (typeof raw.projectId !== 'string' || !raw.projectId ||
    typeof raw.projectName !== 'string' ||
    !nonnegativeInteger(raw.projectSchemaVersion) || !nonnegativeInteger(raw.recordRevision) ||
    !nonnegativeInteger(raw.createdAt) || !nonnegativeInteger(raw.modifiedAt) ||
    !nonnegativeInteger(raw.exportedAt) || !Array.isArray(raw.files) || raw.files.length > MAX_FILES)
    invalid('invalid project metadata.')
  const record = entry(raw.record)
  if (record.path !== 'project.json' || record.byteLength > MAX_RECORD_BYTES)
    invalid('unexpected or oversized project record.')
  const files = raw.files.map((value, index) => {
    const details = object(value)
    const basic = entry(value)
    if (basic.path !== `files/${index}.bin` || typeof details.fileId !== 'string' || !details.fileId ||
      typeof details.name !== 'string' || typeof details.type !== 'string' ||
      !nonnegativeInteger(details.size) || !nonnegativeInteger(details.uploadedAt) ||
      details.size !== basic.byteLength || basic.byteLength > MAX_FILE_BYTES)
      invalid('invalid source file metadata.')
    return {
      ...basic,
      fileId: details.fileId, name: details.name, type: details.type,
      size: details.size, uploadedAt: details.uploadedAt,
    }
  })
  if (new Set(files.map(file => file.fileId)).size !== files.length)
    invalid('duplicate source file IDs.')
  return { ...raw, record, files } as BackupManifest
}

async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function checkedEntry(zip: JSZip, metadata: BackupEntry): Promise<Uint8Array> {
  const part = zip.file(metadata.path)
  if (!part) invalid(`missing ${metadata.path}.`)
  const bytes = await part.async('uint8array')
  if (bytes.length !== metadata.byteLength || await digest(bytes) !== metadata.sha256)
    invalid(`checksum or size mismatch for ${metadata.path}.`)
  return bytes
}

function ensureSourcesPresent(record: ProjectRecord, files: StoredFile[]): void {
  if (!Array.isArray(record.sourceFileIds) || record.sourceFileIds.some(id => typeof id !== 'string'))
    invalid('invalid source file references.')
  const fileIds = new Set(files.map(file => file.fileId))
  if (record.sourceFileIds.some(id => !fileIds.has(id)))
    invalid('a referenced source blob is missing.')
}

/** Serialize a consistent project/file snapshot. Inline media data URLs stay in project.json. */
export async function serializeProjectBackup(snapshot: ProjectSnapshot, exportedAt = Date.now()): Promise<Blob> {
  const { record, files } = snapshot
  if (files.length > MAX_FILES || files.some(file => file.size > MAX_FILE_BYTES))
    invalid('too many or oversized source files for a local backup.')
  ensureSourcesPresent(record, files)
  if (files.some(file => file.projectId !== record.projectId || file.blob.size !== file.size))
    invalid('source file metadata does not match its blob or project.')
  if (new Set(files.map(file => file.fileId)).size !== files.length)
    invalid('duplicate source file IDs.')
  const zip = new JSZip()
  const recordBytes = encoder.encode(JSON.stringify(record))
  if (recordBytes.length > MAX_RECORD_BYTES) invalid('project record exceeds the local backup limit.')
  zip.file('project.json', recordBytes)
  const manifest: BackupManifest = {
    format: FORMAT,
    backupVersion: BACKUP_FORMAT_VERSION,
    projectId: record.projectId,
    projectName: record.projectName,
    projectSchemaVersion: record.schemaVersion ?? 1,
    recordRevision: record.recordRevision ?? 0,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
    exportedAt,
    record: { path: 'project.json', byteLength: recordBytes.length, sha256: await digest(recordBytes) },
    files: [],
  }
  for (const [index, file] of [...files].sort((a, b) => a.fileId.localeCompare(b.fileId)).entries()) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer())
    const path = `files/${index}.bin`
    zip.file(path, bytes, { createFolders: false })
    manifest.files.push({
      path, byteLength: bytes.length, sha256: await digest(bytes),
      fileId: file.fileId, name: file.name, type: file.type, size: file.size, uploadedAt: file.uploadedAt,
    })
  }
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  if (manifestBytes.length > MAX_MANIFEST_BYTES ||
    recordBytes.length + manifest.files.reduce((sum, file) => sum + file.size, 0) > MAX_BACKUP_BYTES)
    invalid('backup exceeds the local size limit.')
  zip.file('manifest.json', manifestBytes)
  zip.file('manifest.sha256', await digest(manifestBytes))
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  if (archive.size > MAX_BACKUP_BYTES) invalid('compressed backup exceeds the local size limit.')
  return archive
}

export async function createProjectBackup(projectId: string, context?: ProjectAccessContext): Promise<Blob> {
  const snapshot = await projectRepository.loadProjectSnapshot(projectId, context)
  if (!snapshot) throw new Error(`Project "${projectId}" does not exist.`)
  return serializeProjectBackup(snapshot)
}

async function decodeBackup(archive: Blob): Promise<{ manifest: BackupManifest; snapshot: ProjectSnapshot }> {
  if (archive.size > MAX_BACKUP_BYTES) invalid('compressed backup exceeds the local size limit.')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await archive.arrayBuffer())
  } catch {
    invalid('file is not a readable ZIP archive.')
  }
  // Check ZIP central-directory sizes before expanding any entry. JSZip's
  // async('uint8array') otherwise allocates the entire uncompressed payload.
  const entries = Object.values(zip.files).filter(file => !file.dir)
  if (entries.length > MAX_FILES + 3) invalid('too many archive entries.')
  let expandedBytes = 0
  for (const file of entries) {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    const limit = file.name === 'manifest.json' ? MAX_MANIFEST_BYTES
      : file.name === 'manifest.sha256' ? 64
        : file.name === 'project.json' ? MAX_RECORD_BYTES : MAX_FILE_BYTES
    if (!nonnegativeInteger(size) || size > limit)
      invalid(`oversized or invalid ZIP entry ${file.name}.`)
    expandedBytes += size
    if (expandedBytes > MAX_BACKUP_BYTES) invalid('expanded backup exceeds the local size limit.')
  }
  const manifestFile = zip.file('manifest.json')
  const checksumFile = zip.file('manifest.sha256')
  if (!manifestFile || !checksumFile) invalid('manifest or manifest checksum is missing.')
  const manifestBytes = await manifestFile.async('uint8array')
  const expectedChecksum = await checksumFile.async('string')
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum) || await digest(manifestBytes) !== expectedChecksum)
    invalid('manifest checksum mismatch.')
  let manifest: BackupManifest
  try {
    manifest = parseManifest(JSON.parse(decoder.decode(manifestBytes)))
  } catch (error) {
    if ((error as Error).message.startsWith('Invalid project backup:')) throw error
    invalid('manifest is not valid JSON.')
  }
  const expectedPaths = new Set(['manifest.json', 'manifest.sha256', 'project.json', ...manifest.files.map(file => file.path)])
  const actualPaths = Object.values(zip.files).filter(file => !file.dir).map(file => file.name)
  if (actualPaths.length !== expectedPaths.size || actualPaths.some(path => !expectedPaths.has(path)))
    invalid('archive has missing or unexpected entries.')
  const recordBytes = await checkedEntry(zip, manifest.record)
  let rawRecord: Record<string, unknown>
  try {
    rawRecord = object(JSON.parse(decoder.decode(recordBytes)))
  } catch {
    invalid('project record is not valid JSON.')
  }
  if (rawRecord.projectId !== manifest.projectId || rawRecord.projectName !== manifest.projectName ||
    (rawRecord.schemaVersion ?? 1) !== manifest.projectSchemaVersion ||
    (rawRecord.recordRevision ?? 0) !== manifest.recordRevision ||
    rawRecord.createdAt !== manifest.createdAt || rawRecord.modifiedAt !== manifest.modifiedAt)
    invalid('project record and manifest metadata disagree.')
  const files: StoredFile[] = []
  for (const file of manifest.files) {
    const bytes = await checkedEntry(zip, file)
    files.push({
      fileId: file.fileId, projectId: manifest.projectId,
      name: file.name, type: file.type, size: file.size, uploadedAt: file.uploadedAt,
      blob: new Blob([bytes as BlobPart], { type: file.type }),
    })
  }
  // Migration is deterministic and never writes to IndexedDB during validation.
  const record = migrateProjectRecord(rawRecord).record
  validateRestorableProjectRecord(record)
  ensureSourcesPresent(record, files)
  return { manifest, snapshot: { record, files } }
}

/** Fully validates the archive (including every blob) without modifying local data. */
export async function inspectProjectBackup(archive: Blob): Promise<BackupSummary> {
  const { manifest } = await decodeBackup(archive)
  return {
    projectId: manifest.projectId, projectName: manifest.projectName,
    projectSchemaVersion: manifest.projectSchemaVersion, recordRevision: manifest.recordRevision,
    createdAt: manifest.createdAt, modifiedAt: manifest.modifiedAt,
    exportedAt: manifest.exportedAt, backupVersion: manifest.backupVersion,
    fileCount: manifest.files.length,
  }
}

/** Revalidates before the repository's single atomic create/replace transaction. */
export async function restoreProjectBackup(
  archive: Blob, options: RestoreOptions, context?: ProjectAccessContext,
): Promise<ProjectRecord> {
  const { snapshot } = await decodeBackup(archive)
  return projectRepository.restoreProjectSnapshot(snapshot, options, context)
}