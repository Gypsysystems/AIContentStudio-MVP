import type { CheckpointFileManifest, ProjectCheckpoint } from './projectCheckpoint'
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectMigrations'

export type TopicChange = {
  kind: 'added' | 'removed' | 'renamed'
  topicId: string
  before?: string
  after?: string
}

export type FileChange = {
  kind: 'added' | 'removed' | 'hash changed'
  fileId: string
  beforeName?: string
  afterName?: string
  beforeHash?: string
  afterHash?: string
}

type ChangeSection<T> = { status: 'ready'; changes: T[] } | { status: 'unknown'; reason: string }

export type CheckpointChangeSummary =
  | { status: 'baseline' }
  | { status: 'unknown'; reason: string }
  | { status: 'ready'; topics: ChangeSection<TopicChange>; files: ChangeSection<FileChange> }

export function unknownCheckpointChanges(reason: string): CheckpointChangeSummary {
  return { status: 'unknown', reason }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function savedTopics(checkpoint: ProjectCheckpoint): Map<string, string> | null {
  const record = checkpoint.record as unknown as Record<string, unknown>
  if (record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION || !Array.isArray(record.appToc)) return null
  const result = new Map<string, string>()
  for (const raw of record.appToc) {
    if (!isObject(raw) || typeof raw.topicId !== 'string' || !raw.topicId.trim()
      || typeof raw.title !== 'string' || !raw.title.trim()) return null
    const id = raw.topicId.trim()
    if (result.has(id)) return null
    result.set(id, raw.title)
  }
  return result
}

function savedFiles(checkpoint: ProjectCheckpoint): Map<string, CheckpointFileManifest> | null {
  if (!Array.isArray(checkpoint.files)) return null
  const result = new Map<string, CheckpointFileManifest>()
  for (const file of checkpoint.files) {
    if (!isObject(file) || typeof file.fileId !== 'string' || !file.fileId.trim()
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
      || result.has(file.fileId)) return null
    result.set(file.fileId, file)
  }
  return result
}

/** Display-only, direct-parent changes. Inputs must first pass metadata-only digest validation. */
export function buildCheckpointChangeSummary(child: ProjectCheckpoint, parent: ProjectCheckpoint | null): CheckpointChangeSummary {
  if (child.parentCheckpointId === null) return { status: 'baseline' }
  if (typeof child.parentCheckpointId !== 'string' || !child.parentCheckpointId.trim())
    return unknownCheckpointChanges('The saved direct-parent link is missing or malformed; changes cannot be determined.')
  if (child.parentCheckpointId === child.checkpointId)
    return unknownCheckpointChanges('The checkpoint links to itself as its parent; changes cannot be determined.')
  if (!parent) return unknownCheckpointChanges('The direct parent checkpoint record is unavailable; changes cannot be determined.')
  if (parent.checkpointId !== child.parentCheckpointId
    || parent.projectId !== child.projectId || parent.workspaceId !== child.workspaceId)
    return unknownCheckpointChanges('The saved parent link or project scope does not match; changes cannot be determined.')
  if (child.record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION
    || parent.record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION)
    return unknownCheckpointChanges('One or both saved project schemas are unsupported; changes cannot be determined.')

  const beforeTopics = savedTopics(parent)
  const afterTopics = savedTopics(child)
  let topics: ChangeSection<TopicChange>
  if (!beforeTopics || !afterTopics) {
    topics = { status: 'unknown', reason: 'One or both saved outlines have missing, duplicate, or ambiguous stable topic IDs or titles.' }
  } else {
    const changes: TopicChange[] = []
    for (const [id, title] of afterTopics) {
      const previous = beforeTopics.get(id)
      if (previous === undefined) changes.push({ kind: 'added', topicId: id, after: title })
      else if (previous !== title) changes.push({ kind: 'renamed', topicId: id, before: previous, after: title })
    }
    for (const [id, title] of beforeTopics) {
      if (!afterTopics.has(id)) changes.push({ kind: 'removed', topicId: id, before: title })
    }
    topics = { status: 'ready', changes }
  }

  const beforeFiles = savedFiles(parent)
  const afterFiles = savedFiles(child)
  let files: ChangeSection<FileChange>
  if (!beforeFiles || !afterFiles) {
    files = { status: 'unknown', reason: 'One or both saved file manifests have missing, duplicate, or unsupported IDs or hashes.' }
  } else {
    const changes: FileChange[] = []
    for (const [id, file] of afterFiles) {
      const previous = beforeFiles.get(id)
      const afterName = typeof file.name === 'string' ? file.name : undefined
      if (!previous) changes.push({ kind: 'added', fileId: id, afterName, afterHash: file.sha256 })
      else if (previous.sha256 !== file.sha256) changes.push({
        kind: 'hash changed', fileId: id,
        beforeName: typeof previous.name === 'string' ? previous.name : undefined,
        afterName, beforeHash: previous.sha256, afterHash: file.sha256,
      })
    }
    for (const [id, file] of beforeFiles) {
      if (!afterFiles.has(id)) changes.push({
        kind: 'removed', fileId: id,
        beforeName: typeof file.name === 'string' ? file.name : undefined,
        beforeHash: file.sha256,
      })
    }
    files = { status: 'ready', changes }
  }
  return { status: 'ready', topics, files }
}