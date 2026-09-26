import type { AuthorTopicMetadata } from './authorMetadata'
import type { ProjectCheckpoint, ProjectCheckpointSummary } from './projectCheckpoint'
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectMigrations'

export type TopicHistoryVersion = {
  checkpointId: string
  reason: string
  createdAt: number
  actorUserId: string
  originatingRecordRevision: number
  title: string
  blocks: unknown[]
  metadata: AuthorTopicMetadata | null
  changed: boolean | null
  limitations: string[]
}

export type TopicHistoryTopic = {
  topicId: string
  currentTitle: string | null
  versions: TopicHistoryVersion[]
  limitations: string[]
}

type TopicShape = { id?: unknown; topicId?: unknown; title?: unknown }
type SnapshotTopic = {
  title: string
  blocks: unknown[]
  metadata: AuthorTopicMetadata | null
  limitations: string[]
}

const objectValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T
  if (objectValue(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T
  }
  return value
}

function numericId(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return String(value)
}

function stableId(topic: TopicShape): string | null {
  if (typeof topic.topicId === 'string' && topic.topicId.trim()) return topic.topicId.trim()
  const numeric = numericId(topic.id)
  return numeric === null ? null : `legacy-${numeric}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (objectValue(value)) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function addLimitation(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message)
}

function recordSnapshot(checkpoint: ProjectCheckpoint): {
  topics: Map<string, SnapshotTopic>
  limitations: string[]
} {
  const topics = new Map<string, SnapshotTopic>()
  const limitations: string[] = []
  const record = checkpoint.record as unknown as Record<string, unknown>
  const rawToc = record?.appToc
  const rawContent = record?.topicContent
  const rawMetadata = record?.authorTopicMetadata

  if (record?.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    limitations.push(`Checkpoint ${checkpoint.checkpointId} uses an unsupported project schema.`)
    return { topics, limitations }
  }
  if (!Array.isArray(rawToc) || !objectValue(rawContent) || !objectValue(rawMetadata)) {
    limitations.push(`Checkpoint ${checkpoint.checkpointId} has an unsupported topic-history record shape.`)
    return { topics, limitations }
  }

  if (rawToc.some(item => !objectValue(item))) {
    limitations.push(`Checkpoint ${checkpoint.checkpointId} contains malformed TOC entries.`)
  }
  const toc = rawToc.filter(objectValue) as TopicShape[]
  const idCounts = new Map<string, number>()
  const stableCounts = new Map<string, number>()
  for (const item of toc) {
    const numeric = numericId(item.id)
    if (numeric !== null) idCounts.set(numeric, (idCounts.get(numeric) ?? 0) + 1)
    const id = stableId(item)
    if (id !== null) stableCounts.set(id, (stableCounts.get(id) ?? 0) + 1)
  }
  const ambiguousStableIds = new Set([...stableCounts].filter(([, count]) => count > 1).map(([id]) => id))

  const numericOwners = new Map<string, string>()
  for (const item of toc) {
    const numeric = numericId(item.id)
    const id = stableId(item)
    if (numeric !== null && id !== null && idCounts.get(numeric) === 1) numericOwners.set(numeric, id)
  }

  const ensure = (id: string, title = ''): SnapshotTopic => {
    let item = topics.get(id)
    if (!item) {
      item = { title, blocks: [], metadata: null, limitations: [] }
      topics.set(id, item)
    } else if (title) item.title = title
    return item
  }

  for (const item of toc) {
    const id = stableId(item)
    if (!id) {
      limitations.push(`Checkpoint ${checkpoint.checkpointId} contains a topic without a usable identity.`)
      continue
    }
    const entry = ensure(id, typeof item.title === 'string' ? item.title : '')
    if (ambiguousStableIds.has(id)) {
      addLimitation(entry.limitations, 'Duplicate topic IDs make this checkpoint identity ambiguous.')
    }
    const numeric = numericId(item.id)
    if (numeric !== null && idCounts.get(numeric)! > 1) {
      addLimitation(entry.limitations, `Duplicate numeric topic ID "${numeric}" makes legacy keys ambiguous.`)
    }
  }

  const resolveKey = (key: string, source: 'content' | 'metadata'): string | null => {
    if (/^(0|[1-9]\d*)$/.test(key)) {
      const hasLiteralStableOwner = toc.some(item =>
        typeof item.topicId === 'string' && item.topicId.trim() === key)
      const conflictingNumericOwner = hasLiteralStableOwner
        && toc.some(item => numericId(item.id) === key && stableId(item) !== key)
      if (conflictingNumericOwner) {
        const affected = [...new Set(toc.flatMap(item => {
          const id = stableId(item)
          return numericId(item.id) === key || (typeof item.topicId === 'string' && item.topicId.trim() === key)
            ? id ? [id] : []
            : []
        }))]
        for (const id of affected) {
          addLimitation(ensure(id).limitations, `Numeric ${source} key "${key}" is ambiguous: it collides with a stable topic ID and was not assigned.`)
        }
        return null
      }
    }
    // Exact stable-ID keys are authoritative, including numeric-looking stable IDs.
    const exactOwners = toc.filter(item => typeof item.topicId === 'string'
      && item.topicId.trim() === key)
    if (exactOwners.length === 1) return key
    if (exactOwners.length > 1) {
      addLimitation(ensure(key).limitations, `Duplicate topic IDs make persisted ${source} ambiguous.`)
      return null
    }

    if (/^(0|[1-9]\d*)$/.test(key)) {
      const owner = numericOwners.get(key)
      if (owner && idCounts.get(key) === 1) {
        // Numeric IDs are only a fallback when there is no competing stable ID.
        const stableCollision = toc.some(item =>
          typeof item.topicId === 'string' && item.topicId.trim() === key
          && numericId(item.id) !== key)
        if (!stableCollision) return owner
      }
      const affected = [...new Set(toc.flatMap(item => {
        const id = stableId(item)
        return numericId(item.id) === key || (typeof item.topicId === 'string' && item.topicId.trim() === key)
          ? id ? [id] : []
          : []
      }))]
      for (const id of affected) {
        addLimitation(ensure(id).limitations, `Numeric ${source} key "${key}" is ambiguous and was not assigned.`)
      }
      if (affected.length === 0) limitations.push(`Orphan numeric ${source} key "${key}" cannot be assigned unambiguously.`)
      return null
    }
    if (toc.some(item => stableId(item) === key)) return key
    limitations.push(`Orphan ${source} key "${key}" has no matching committed topic and was not assigned.`)
    return null
  }

  for (const [key, rawBlocks] of Object.entries(rawContent)) {
    const id = resolveKey(key, 'content')
    if (!id) continue
    const isNumericFallback = /^(0|[1-9]\d*)$/.test(key)
      && !toc.some(item => typeof item.topicId === 'string' && item.topicId.trim() === key)
      && numericOwners.get(key) === id
    if (isNumericFallback && Object.prototype.hasOwnProperty.call(rawContent, id)) continue
    if (!Array.isArray(rawBlocks)) {
      addLimitation(ensure(id).limitations, `Persisted content for "${key}" is not a block array.`)
      continue
    }
    if (ambiguousStableIds.has(id)) continue
    ensure(id).blocks = cloneValue(rawBlocks)
  }

  for (const [key, rawItem] of Object.entries(rawMetadata)) {
    const id = resolveKey(key, 'metadata')
    if (!id) continue
    const isNumericFallback = /^(0|[1-9]\d*)$/.test(key)
      && !toc.some(item => typeof item.topicId === 'string' && item.topicId.trim() === key)
      && numericOwners.get(key) === id
    if (isNumericFallback && Object.prototype.hasOwnProperty.call(rawMetadata, id)) continue
    if (!objectValue(rawItem)) {
      addLimitation(ensure(id).limitations, `Persisted metadata for "${key}" has an unsupported shape.`)
      continue
    }
    if (typeof rawItem.topicId !== 'string') {
      addLimitation(ensure(id).limitations, `Persisted metadata for "${key}" has no stable topic ID.`)
      continue
    }
    if (rawItem.topicId !== id) {
      addLimitation(ensure(id).limitations, `Persisted metadata for "${key}" has a mismatched topic ID.`)
      continue
    }
    const provenance = rawItem.provenance
    const stringOrEmpty = (value: unknown) => value === null || value === undefined || typeof value === 'string'
    const numberOrEmpty = (value: unknown) => value === null || value === undefined || typeof value === 'number'
    if (!objectValue(provenance)
      || typeof rawItem.generationStatus !== 'string'
      || typeof rawItem.contentOrigin !== 'string'
      || !stringOrEmpty(provenance.evidenceExtractionRevision)
      || !stringOrEmpty(provenance.contentType)
      || !stringOrEmpty(provenance.language)
      || !stringOrEmpty(provenance.styleProfileId)
      || !numberOrEmpty(provenance.sourcesRevision)
      || !numberOrEmpty(provenance.evidenceIndexBuiltAt)
      || !numberOrEmpty(provenance.analysisRevision)
      || !numberOrEmpty(provenance.tocRevision)
      || !numberOrEmpty(rawItem.generatedAt)
      || (rawItem.approved !== undefined && typeof rawItem.approved !== 'boolean')
      || (rawItem.manualEdited !== undefined && typeof rawItem.manualEdited !== 'boolean')) {
      addLimitation(ensure(id).limitations, `Persisted metadata for "${key}" is incomplete or malformed; it was not shown.`)
      continue
    }
    if (ambiguousStableIds.has(id)) continue
    ensure(id).metadata = cloneValue(rawItem) as unknown as AuthorTopicMetadata
  }

  for (const id of ambiguousStableIds) {
    const item = topics.get(id)
    if (item) {
      item.title = ''
      item.blocks = []
      item.metadata = null
    }
  }
  return { topics, limitations }
}

export function buildTopicHistory(
  checkpoints: ProjectCheckpoint[],
  currentToc: unknown[],
  expectedCheckpoints: ProjectCheckpointSummary[] = checkpoints,
): TopicHistoryTopic[] {
  const result = new Map<string, TopicHistoryTopic>()
  const currentCounts = new Map<string, number>()
  const currentNumericCounts = new Map<string, number>()
  const currentEntries: Array<{ id: string | null; title: string | null; numericId: string | null }> = []

  for (const raw of currentToc) {
    if (!objectValue(raw)) continue
    const topic = raw as TopicShape
    const id = stableId(topic)
    const title = typeof topic.title === 'string' ? topic.title : null
    const numeric = numericId(topic.id)
    currentEntries.push({ id, title, numericId: numeric })
    if (id) currentCounts.set(id, (currentCounts.get(id) ?? 0) + 1)
    if (numeric !== null) currentNumericCounts.set(numeric, (currentNumericCounts.get(numeric) ?? 0) + 1)
  }
  for (const [id, count] of currentCounts) {
    const entry = currentEntries.find(item => item.id === id)
    const numeric = entry?.numericId ?? null
    result.set(id, {
      topicId: id,
      currentTitle: count === 1 ? entry?.title ?? null : null,
      versions: [],
      limitations: [
        ...(count > 1 ? ['Duplicate current topic IDs make the current title ambiguous.'] : []),
        ...(numeric !== null && currentNumericCounts.get(numeric)! > 1
          ? [`Duplicate current numeric topic ID "${numeric}" makes legacy keys ambiguous.`]
          : []),
      ],
    })
  }

  const chronological = [...expectedCheckpoints].sort((a, b) =>
    a.createdAt - b.createdAt || a.checkpointId.localeCompare(b.checkpointId))
  const expectedById = new Map(chronological.map(item => [item.checkpointId, item]))
  const ordered: ProjectCheckpointSummary[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const append = (item: ProjectCheckpointSummary) => {
    if (visited.has(item.checkpointId) || visiting.has(item.checkpointId)) return
    visiting.add(item.checkpointId)
    if (item.parentCheckpointId) {
      const parent = expectedById.get(item.parentCheckpointId)
      if (parent) append(parent)
    }
    visiting.delete(item.checkpointId)
    visited.add(item.checkpointId)
    ordered.push(item)
  }
  for (const item of chronological) append(item)
  const byCheckpointId = new Map(checkpoints.map(checkpoint => [checkpoint.checkpointId, checkpoint]))
  let previousTopics: Map<string, SnapshotTopic> | null = new Map()
  const globalLimitations: string[] = []
  for (const expected of ordered) {
    const checkpoint = byCheckpointId.get(expected.checkpointId)
    if (!checkpoint) {
      addLimitation(globalLimitations, `Checkpoint ${expected.checkpointId} could not be read; comparisons across this gap are unknown.`)
      previousTopics = null
      continue
    }
    const snapshot = recordSnapshot(checkpoint)
    for (const limitation of snapshot.limitations) addLimitation(globalLimitations, limitation)
    for (const [topicId, stored] of snapshot.topics) {
      let topic = result.get(topicId)
      if (!topic) {
        topic = { topicId, currentTitle: null, versions: [], limitations: [] }
        result.set(topicId, topic)
      }
      for (const limitation of snapshot.limitations) addLimitation(topic.limitations, limitation)
      for (const limitation of stored.limitations) addLimitation(topic.limitations, limitation)
      const preceding = previousTopics?.get(topicId)
      topic.versions.push({
        checkpointId: checkpoint.checkpointId,
        reason: checkpoint.reason,
        createdAt: checkpoint.createdAt,
        actorUserId: checkpoint.actorUserId,
        originatingRecordRevision: checkpoint.originatingRecordRevision,
        title: stored.title,
        blocks: cloneValue(stored.blocks),
        metadata: stored.metadata ? cloneValue(stored.metadata) : null,
        changed: preceding && !preceding.limitations.length && !stored.limitations.length
          ? canonical(preceding.blocks) !== canonical(stored.blocks) : null,
        limitations: [...stored.limitations],
      })
    }
    previousTopics = snapshot.limitations.length ? null : snapshot.topics
  }

  for (const topic of result.values())
    for (const limitation of globalLimitations) addLimitation(topic.limitations, limitation)
  return [...result.values()]
}