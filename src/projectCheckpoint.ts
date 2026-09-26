import type { ProjectRecord, StoredFile } from './projectRepository'
import { CURRENT_PROJECT_SCHEMA_VERSION, validateRestorableProjectRecord } from './projectMigrations'

export type CheckpointFileManifest = {
  fileId: string
  name: string
  type: string
  size: number
  uploadedAt: number
  sha256: string
  storageRef: string
}

export type ProjectCheckpoint = {
  checkpointId: string
  workspaceId: string
  projectId: string
  parentCheckpointId: string | null
  reason: string
  actorUserId: string
  createdAt: number
  originatingRecordRevision: number
  recordSchemaVersion: number
  recordDigest: string
  integrityDigest: string
  record: ProjectRecord
  files: CheckpointFileManifest[]
}

export type ProjectCheckpointSummary = Omit<ProjectCheckpoint, 'record'>
export type ProjectCheckpointRead = { checkpoint: ProjectCheckpoint; files: StoredFile[] }
export type CheckpointVerification = {
  valid: boolean
  issues: string[]
  usable?: boolean
  usabilityIssues?: string[]
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort()
      .filter(key => object[key] !== undefined)
      .map(key => [key, sortedJson(object[key])]))
  }
  return value
}

export function canonicalCheckpointJson(value: unknown): string {
  return JSON.stringify(sortedJson(value))
}

export async function checkpointSha256(bytes: ArrayBuffer | Blob | string): Promise<string> {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes)
    : bytes instanceof Blob ? await bytes.arrayBuffer() : bytes
  const hash = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function validateCheckpointReason(reason: string): string {
  const note = reason.trim()
  if (!note || note.length > 200) throw new Error('Enter a checkpoint reason (up to 200 characters).')
  return note
}

export async function checkpointIntegrityDigest(
  checkpoint: Omit<ProjectCheckpoint, 'integrityDigest'>,
): Promise<string> {
  return checkpointSha256(canonicalCheckpointJson(checkpoint))
}

export async function verifyCheckpointRead(read: ProjectCheckpointRead): Promise<CheckpointVerification> {
  const { checkpoint, files } = read
  const issues: string[] = []
  const usabilityIssues: string[] = []
  const record = checkpoint.record as unknown as Record<string, unknown>
  if (checkpoint.projectId !== record.projectId
    || checkpoint.workspaceId !== record.workspaceId
    || checkpoint.originatingRecordRevision !== record.recordRevision
    || checkpoint.recordSchemaVersion !== record.schemaVersion)
    issues.push('Checkpoint identity does not match its record.')
  if (await checkpointSha256(canonicalCheckpointJson(record)) !== checkpoint.recordDigest)
    issues.push('Project record digest does not match.')
  const { integrityDigest, ...content } = checkpoint
  if (await checkpointIntegrityDigest(content) !== integrityDigest)
    issues.push('Checkpoint integrity digest does not match.')
  const manifest = [...checkpoint.files].sort((a, b) => a.fileId.localeCompare(b.fileId))
  if (new Set(manifest.map(file => file.fileId)).size !== manifest.length
    || canonicalCheckpointJson(manifest) !== canonicalCheckpointJson(checkpoint.files))
    issues.push('File manifest has duplicate or unsorted IDs.')
  const byId = new Map(files.map(file => [file.fileId, file]))
  if (files.length !== manifest.length || byId.size !== files.length)
    issues.push('Checkpoint file set is incomplete.')
  for (const item of manifest) {
    const file = byId.get(item.fileId)
    if (!file) { issues.push(`Missing checkpoint file: ${item.fileId}`); continue }
    if (file.projectId !== checkpoint.projectId || file.name !== item.name
      || file.type !== item.type || file.size !== item.size
      || file.uploadedAt !== item.uploadedAt || file.blob.size !== item.size
      || await checkpointSha256(file.blob) !== item.sha256)
      issues.push(`Checkpoint file failed integrity verification: ${item.fileId}`)
  }
  if (record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    usabilityIssues.push(`Project schema version ${String(record.schemaVersion)} is not supported for restore by this app.`)
  } else {
    try {
      validateRestorableProjectRecord(checkpoint.record)
    } catch (error) {
      usabilityIssues.push(error instanceof Error
        ? `Project record cannot be restored: ${error.message}`
        : 'Project record cannot be restored.')
    }
  }
  if (Array.isArray(record.sourceFileIds)
    && record.sourceFileIds.some(id => typeof id !== 'string' || !byId.has(id)))
    usabilityIssues.push('A source referenced by the project record is missing.')
  return {
    valid: issues.length === 0,
    issues,
    usable: usabilityIssues.length === 0,
    usabilityIssues,
  }
}