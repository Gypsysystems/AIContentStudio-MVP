import type { ProjectCheckpoint } from './projectCheckpoint'
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectMigrations'

export type SavedOutlineItem = {
  position: number
  topicId: string | null
  legacyNumericId: number | null
  title: string | null
  level: number | null
}

export type CheckpointDetail = {
  projectName: string | null
  outline: SavedOutlineItem[] | null
  outlineCount: number
  sourceFileIds: string[] | null
  limitations: string[]
}

const objectValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A display-only projection. Never migrate or substitute live project fields. */
export function buildCheckpointDetail(checkpoint: ProjectCheckpoint): CheckpointDetail {
  const record = checkpoint.record as unknown as Record<string, unknown>
  const limitations: string[] = []
  const projectName = typeof record.projectName === 'string' && record.projectName.trim()
    ? record.projectName : null
  if (!projectName) limitations.push('Saved project name is unavailable.')

  let outline: SavedOutlineItem[] | null = null
  let outlineCount = 0
  if (record.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    limitations.push('Saved outline uses an unsupported project schema; its topics were not inferred.')
  } else if (!Array.isArray(record.appToc)) {
    limitations.push('Saved outline has an unsupported shape; its topics were not inferred.')
  } else {
    outlineCount = record.appToc.length
    outline = []
    const seen = new Set<string>()
    const seenNumeric = new Set<number>()
    for (const [index, raw] of record.appToc.entries()) {
      if (!objectValue(raw)) {
        limitations.push(`Saved outline item ${index + 1} has an unsupported shape and was not shown.`)
        continue
      }
      const stable = typeof raw.topicId === 'string' && raw.topicId.trim()
        ? raw.topicId.trim() : null
      const legacyNumericId = typeof raw.id === 'number' && Number.isSafeInteger(raw.id)
        ? raw.id : null
      const topicId = stable
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : null
      const level = typeof raw.level === 'number' && Number.isInteger(raw.level) && raw.level >= 1
        ? raw.level : null
      if (!topicId) limitations.push(`Saved outline item ${index + 1} has no stable topic ID${legacyNumericId !== null ? '; only its saved legacy numeric ID is shown' : ''}.`)
      else if (seen.has(topicId)) limitations.push(`Saved outline has duplicate topic ID "${topicId}".`)
      if (topicId) seen.add(topicId)
      if (legacyNumericId !== null && seenNumeric.has(legacyNumericId))
        limitations.push(`Saved outline has duplicate legacy numeric ID "${legacyNumericId}".`)
      if (legacyNumericId !== null) seenNumeric.add(legacyNumericId)
      if (!title) limitations.push(`Saved outline item ${index + 1} has no title.`)
      if (level === null) limitations.push(`Saved outline item ${index + 1} has no supported level.`)
      outline.push({ position: index + 1, topicId, legacyNumericId, title, level })
    }
  }

  const sourceFileIds = Array.isArray(record.sourceFileIds)
    && record.sourceFileIds.every(id => typeof id === 'string')
    ? [...record.sourceFileIds] : null
  if (!sourceFileIds) limitations.push('Saved source references have an unsupported shape.')
  else {
    const manifestIds = new Set(checkpoint.files.map(file => file.fileId))
    if (sourceFileIds.some(id => !manifestIds.has(id)))
      limitations.push('Some saved source references are absent from this checkpoint manifest.')
  }
  return { projectName, outline, outlineCount, sourceFileIds, limitations }
}