import {
  type ProjectCheckpoint, type ProjectCheckpointSummary,
} from './projectCheckpoint'
import { readValidatedCheckpointRecord } from './checkpointRecordRead'
import { CURRENT_PROJECT_SCHEMA_VERSION, validateRestorableProjectRecord } from './projectMigrations'

export type FileHistoryEntry = {
  checkpointId: string
  reason: string
  createdAt: number
  actorUserId: string
  originatingRecordRevision: number
  status: 'present' | 'absent' | 'unknown'
  sha256?: string
  name?: string
  issue?: string
  ancestryIssue?: string
}

export type FileHistoryRead = { checkpoint: ProjectCheckpoint; error?: never }
  | { checkpoint?: never; error: string }

/** File IDs are offered only from the authorized checkpoint list, never current project files. */
export function listedFileIds(projectId: string, summaries: ProjectCheckpointSummary[]): string[] {
  const ids = new Set<string>()
  for (const summary of summaries) {
    if (summary.projectId !== projectId) continue
    if (!Array.isArray(summary.files)) continue
    for (const file of summary.files) {
      if (file && typeof file.fileId === 'string' && file.fileId.trim()) ids.add(file.fileId)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function manifestFile(checkpoint: ProjectCheckpoint, fileId: string):
  | { status: 'present'; sha256: string; name?: string }
  | { status: 'absent' }
  | { status: 'unknown'; issue: string } {
  if (checkpoint.record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION)
    return { status: 'unknown', issue: 'Legacy or unsupported saved project schema; file presence cannot be determined.' }
  try {
    // Shape validation only. No migration, restore, or archive read is performed.
    validateRestorableProjectRecord(checkpoint.record)
  } catch {
    return { status: 'unknown', issue: 'Saved project record has an unsupported or unusable shape.' }
  }
  const sourceIds = checkpoint.record.sourceFileIds as unknown
  if (!Array.isArray(sourceIds) || sourceIds.some(id => typeof id !== 'string' || !id.trim())
    || new Set(sourceIds).size !== sourceIds.length)
    return { status: 'unknown', issue: 'Saved project source references have missing or ambiguous file IDs.' }
  if (!Array.isArray(checkpoint.files))
    return { status: 'unknown', issue: 'Saved file manifest is unavailable or unsupported.' }
  const seen = new Set<string>()
  let selected: { sha256: string; name?: string } | null = null
  for (const raw of checkpoint.files) {
    if (!isObject(raw) || typeof raw.fileId !== 'string' || !raw.fileId.trim()
      || seen.has(raw.fileId) || typeof raw.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(raw.sha256)
      || typeof raw.name !== 'string' || typeof raw.type !== 'string'
      || !Number.isSafeInteger(raw.size) || (raw.size as number) < 0
      || !Number.isSafeInteger(raw.uploadedAt) || (raw.uploadedAt as number) < 0
      || typeof raw.storageRef !== 'string' || !raw.storageRef.trim())
      return { status: 'unknown', issue: 'Saved manifest has missing, duplicate, or unsupported file metadata or hashes.' }
    seen.add(raw.fileId)
    if (raw.fileId === fileId) selected = {
      sha256: raw.sha256,
      name: typeof raw.name === 'string' ? raw.name : undefined,
    }
  }
  if (sourceIds.some(id => !seen.has(id)))
    return { status: 'unknown', issue: 'Saved project source references are absent from its file manifest.' }
  return selected ? { status: 'present', ...selected } : { status: 'absent' }
}

function ancestryIssue(
  index: number,
  summaries: ProjectCheckpointSummary[],
  states: Array<ReturnType<typeof manifestFile> | null>,
): string | undefined {
  const summary = summaries[index]
  const matches = summaries.filter(item => item.checkpointId === summary.checkpointId)
  if (matches.length !== 1) return 'Duplicate checkpoint IDs make ancestry ambiguous.'
  if (summary.parentCheckpointId === null) {
    if (summaries.filter(item => item.parentCheckpointId === null).length !== 1)
      return 'Multiple checkpoints claim no parent; the first checkpoint is ambiguous.'
    return undefined
  }
  if (typeof summary.parentCheckpointId !== 'string' || !summary.parentCheckpointId.trim())
    return 'Direct-parent link is missing or malformed.'
  const visited = new Set([summary.checkpointId])
  let current: ProjectCheckpointSummary = summary
  while (current.parentCheckpointId !== null) {
    const id = current.parentCheckpointId
    if (typeof id !== 'string' || !id.trim()) return 'An ancestor has a missing or malformed parent link.'
    if (visited.has(id)) return 'Checkpoint ancestry contains a cycle.'
    visited.add(id)
    const parentIndexes = summaries.flatMap((item, parentIndex) => item.checkpointId === id ? [parentIndex] : [])
    if (parentIndexes.length !== 1) return 'A direct ancestor is absent or ambiguous in the authorized checkpoint list.'
    const parentIndex = parentIndexes[0]
    const parent = summaries[parentIndex]
    if (parent.projectId !== summary.projectId || parent.workspaceId !== summary.workspaceId)
      return 'An ancestor belongs to a different project or workspace.'
    if (!states[parentIndex]) return 'An ancestor record could not be read or validated.'
    if (states[parentIndex].status === 'unknown')
      return 'An ancestor has an unsupported or ambiguous saved project record or file manifest.'
    current = parent
  }
  if (summaries.filter(item => item.parentCheckpointId === null).length !== 1)
    return 'The first checkpoint is ambiguous.'
  return undefined
}

/** Independent saved snapshots, in the authorized list's order. No adjacent-state inference. */
export function buildFileHistory(
  fileId: string,
  summaries: ProjectCheckpointSummary[],
  reads: FileHistoryRead[],
): FileHistoryEntry[] {
  const states = summaries.map((summary, index) => {
    const checkpoint = reads[index]?.checkpoint
    if (!checkpoint || checkpoint.checkpointId !== summary.checkpointId
      || checkpoint.projectId !== summary.projectId || checkpoint.workspaceId !== summary.workspaceId
      || checkpoint.integrityDigest !== summary.integrityDigest) return null
    return manifestFile(checkpoint, fileId)
  })
  return summaries.map((summary, index) => {
    const base = {
      checkpointId: summary.checkpointId, reason: summary.reason, createdAt: summary.createdAt,
      actorUserId: summary.actorUserId, originatingRecordRevision: summary.originatingRecordRevision,
    }
    const read = reads[index]
    if (!read?.checkpoint) return {
      ...base, status: 'unknown' as const,
      issue: read?.error || 'Committed checkpoint record is unavailable.',
    }
    const state = states[index]
    if (!state)
      return { ...base, status: 'unknown' as const, issue: 'Saved record does not match its authorized checkpoint summary.' }
    const ancestry = ancestryIssue(index, summaries, states)
    if (state.status === 'unknown') return { ...base, ...state, ancestryIssue: ancestry }
    if (ancestry) return {
      ...base, status: 'unknown' as const,
      issue: 'Checkpoint ancestry is unresolved; file history cannot be established.',
      ancestryIssue: ancestry,
    }
    return { ...base, ...state }
  })
}

/** Only the existing project-scoped metadata endpoint is called; archive bytes are never fetched. */
export async function loadProjectFileHistory(
  projectId: string,
  fileId: string,
  summaries: ProjectCheckpointSummary[],
  getCheckpointRecord: (projectId: string, checkpointId: string) => Promise<ProjectCheckpoint | null>,
): Promise<FileHistoryEntry[]> {
  if (summaries.some(summary => summary.projectId !== projectId)
    || new Set(summaries.map(summary => summary.workspaceId)).size > 1)
    throw new Error('Checkpoint list does not belong to one authorized project and workspace.')
  if (!fileId.trim() || !listedFileIds(projectId, summaries).includes(fileId))
    throw new Error('Select a file ID from the authorized checkpoint list.')
  const reads: FileHistoryRead[] = await Promise.all(summaries.map(async summary => {
    try {
      return { checkpoint: await readValidatedCheckpointRecord(projectId, summary, getCheckpointRecord) }
    } catch (error) {
      return { error: (error as Error).message || 'Committed checkpoint record could not be read.' }
    }
  }))
  return buildFileHistory(fileId, summaries, reads)
}