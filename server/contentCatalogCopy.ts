import { randomUUID } from 'node:crypto'

export type CopyJson = Record<string, unknown>

export class ContentCopyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ContentCopyError'
  }
}

export type CopySourceItem = {
  item_id: string
  workspace_id: string
  project_id: string
  asset_type: string
  local_asset_id: string
  display_name: string
  status: string
  current_version: number
}

function isObject(value: unknown): value is CopyJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failStructure(message: string): never {
  throw new ContentCopyError(422, 'INVALID_ASSET_CONTENT', message)
}

function dependencyBlocked(dependencies: string[]): never {
  const unique = [...new Set(dependencies)]
  throw new ContentCopyError(409, 'DEPENDENCY_BLOCKED',
    `Copy is blocked by unresolved project dependencies: ${unique.join(', ')}`)
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 512 || value.trim() !== value
    || /[\u0000-\u001f\u007f/\\]/.test(value))
    failStructure(`${label} has an invalid stable ID`)
  return value
}

function asObject(value: unknown, label: string): CopyJson {
  if (!isObject(value)) failStructure(`${label} must be an object`)
  return value
}

function encodedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    failStructure('Asset content is not valid JSON')
  }
}

function remapReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    const exact = ids.get(value) ?? value
    return exact.replace(/\[\[(block|bookmark):([^\]]+)\]\]/gi, (token, kind: string, targetId: string) =>
      ids.has(targetId) ? `[[${kind}:${ids.get(targetId)}]]` : token)
  }
  if (Array.isArray(value)) return value.map(part => remapReferences(part, ids))
  if (!isObject(value)) return value
  const result: CopyJson = {}
  for (const [key, part] of Object.entries(value))
    result[ids.get(key) ?? key] = remapReferences(part, ids)
  return result
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output))
  else if (isObject(value)) Object.values(value).forEach(item => collectStrings(item, output))
}

const MEDIA_URL_PATTERN =
  /\.(?:apng|avif|bmp|gif|heic|heif|jpe?g|jxl|png|svg|webp|tiff?|ico|mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|3gp|3g2|ts|m2ts|vob|wmv|flv|f4v|mp3|m4a|wav|oga|ogg|opus|flac|aac|aiff?|alac|ape|mid|midi|wma)(?:[?#][^\s"'<>)]*)?(?=$|[\s"'<>),.;:!?])/i

function hasMediaReference(value: string): boolean {
  return /data:(?:image|video|audio)\//i.test(value)
    || /!\[[^\]]*\]\s*(?:\([^)]*\)|\[[^\]]*\])/i.test(value)
    || /<(?:img|video|audio|source)\b/i.test(value)
    || /(?:^|\/)media\/[A-Za-z0-9_-]+(?:\/|$|[?#])/i.test(value)
    || MEDIA_URL_PATTERN.test(value)
}

function validateTopicBlocks(value: unknown): CopyJson[] {
  if (!Array.isArray(value) || value.length > 500) failStructure('Topic blocks must be an array of at most 500 blocks')
  const ids = new Set<string>()
  const allowedTypes = new Set([
    'h1', 'h2', 'h3', 'h4', 'para', 'caption', 'callout', 'table', 'procedure',
    'code', 'divider', 'quote', 'media', 'variable', 'bookmark', 'list',
  ])
  const allowedFields = new Set([
    'id', 'type', 'content', 'calloutVariant', 'evidenceIds', 'tableData',
    'procedureSteps', 'mediaType', 'caption', 'conditions', 'listItems',
  ])
  const blocks = value.map((entry, index) => {
    const block = asObject(entry, `Block ${index + 1}`)
    if (Object.keys(block).some(key => !allowedFields.has(key)))
      dependencyBlocked(['unknown block reference or project-local block property'])
    const id = stableId(block.id, `Block ${index + 1}`)
    if (ids.has(id)) failStructure('Topic contains duplicate block IDs')
    ids.add(id)
    if (typeof block.type !== 'string' || !allowedTypes.has(block.type) || typeof block.content !== 'string')
      failStructure(`Block "${id}" has an unsupported structure`)
    if (block.type === 'media' || block.mediaType !== undefined)
      dependencyBlocked([`media in block ${id}`])
    if (block.tableData !== undefined) {
      const table = asObject(block.tableData, `Block "${id}" tableData`)
      if (Object.keys(table).some(key => !['rows', 'hasHeader'].includes(key))
        || !Array.isArray(table.rows) || table.rows.length > 1000
        || table.rows.some(row => !Array.isArray(row) || row.length > 100
          || row.some(cell => typeof cell !== 'string'))
        || typeof table.hasHeader !== 'boolean')
        failStructure(`Block "${id}" has invalid table data`)
    }
    for (const field of ['procedureSteps', 'conditions', 'evidenceIds'] as const) {
      if (block[field] !== undefined && (!Array.isArray(block[field])
        || (block[field] as unknown[]).some(item => typeof item !== 'string')))
        failStructure(`Block "${id}" has invalid ${field}`)
    }
    if (block.listItems !== undefined) {
      if (!Array.isArray(block.listItems) || block.listItems.some(item => !isObject(item)
        || Object.keys(item).some(key => !['id', 'text', 'level', 'type', 'startFresh'].includes(key))
        || typeof item.text !== 'string' || !Number.isSafeInteger(item.level)
        || (item.type !== 'bullet' && item.type !== 'ordered')
        || (item.startFresh !== undefined && typeof item.startFresh !== 'boolean')))
        failStructure(`Block "${id}" has invalid list items`)
      for (const item of block.listItems as CopyJson[]) {
        const itemId = stableId(item.id, `List item in block "${id}"`)
        if (ids.has(itemId)) failStructure('Topic contains duplicate block or list item IDs')
        ids.add(itemId)
      }
    }
    return block
  })
  // Evidence IDs are source-project metadata, not portable content.
  return blocks.map(block => {
    const { evidenceIds: _evidenceIds, ...content } = block
    return content
  })
}

function activeThemeId(record: CopyJson): string {
  const meta = isObject(record.projectMeta) ? record.projectMeta : {}
  return typeof meta.themeId === 'string' ? meta.themeId : ''
}

function variablesInActiveTheme(record: CopyJson): CopyJson[] {
  const theme = activeThemeId(record)
  if (!theme) return []
  const variables = isObject(record.themeVariables) ? record.themeVariables[theme] : undefined
  if (variables === undefined) return []
  if (!Array.isArray(variables)) failStructure('Destination active theme variables are invalid')
  return variables.map((value, index) => asObject(value, `Destination variable ${index + 1}`))
}

function conditions(record: CopyJson): CopyJson[] {
  if (record.conditionGroups === undefined) return []
  if (!Array.isArray(record.conditionGroups)) failStructure('Destination conditions are invalid')
  return record.conditionGroups.map((value, index) => asObject(value, `Destination condition ${index + 1}`))
}

function contentOrigins(record: CopyJson): CopyJson {
  if (record.contentOrigins === undefined || record.contentOrigins === null) return {}
  if (!isObject(record.contentOrigins)) failStructure('Destination content lineage metadata is invalid')
  return record.contentOrigins
}

function replaceVariableTokens(
  text: string,
  destinationVars: CopyJson[],
  dependencies: string[],
): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, rawName: string) => {
    const name = rawName.trim()
    const target = destinationVars.find(variable => variable.name === name)
    if (!target) {
      dependencies.push(`variable "${name}"`)
      return token
    }
    return `{{${String(target.name)}}}`
  })
}

function resolveVariableTokens(
  value: unknown,
  destinationVars: CopyJson[],
  dependencies: string[],
): unknown {
  if (typeof value === 'string')
    return replaceVariableTokens(value, destinationVars, dependencies)
  if (Array.isArray(value))
    return value.map(part => resolveVariableTokens(part, destinationVars, dependencies))
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, part]) => [
    key, resolveVariableTokens(part, destinationVars, dependencies),
  ]))
}

function validateSnippetPayload(payload: unknown): CopyJson {
  const source = asObject(payload, 'Snippet payload')
  if (Object.keys(source).some(key => !['id', 'name', 'content'].includes(key))
    || typeof source.id !== 'string' || typeof source.name !== 'string'
    || typeof source.content !== 'string' || !source.name.trim()
    || source.name.trim() !== source.name || source.name.length > 500 || source.content.length > 60_000)
    failStructure('Snippet payload has an invalid structure')
  return { id: stableId(source.id, 'Snippet'), name: source.name, content: source.content }
}

function applyTopic(
  record: CopyJson,
  payload: unknown,
  item: CopySourceItem,
  insertion?: { afterTopicId: string },
): { asset: CopyJson; record: CopyJson } {
  const source = asObject(payload, 'Topic payload')
  if (Object.keys(source).some(key => !['title', 'level', 'order', 'parentId', 'blocks'].includes(key))
    || typeof source.title !== 'string' || !source.title.trim()
    || !Number.isSafeInteger(source.level) || (source.level as number) < 1 || (source.level as number) > 4
    || !Number.isSafeInteger(source.order) || (source.order as number) < 0
    || !(source.parentId === null || source.parentId === undefined || typeof source.parentId === 'string')) {
    failStructure('Topic payload has an invalid structure')
  }
  const toc = record.appToc
  if (!Array.isArray(toc) || toc.length > 10_000) failStructure('Destination table of contents is invalid')
  if (!isObject(record.topicContent)) failStructure('Destination topic content is invalid')
  const stableIdValue = `topic-${randomUUID()}`
  const numericIds = toc.map(topic => isObject(topic) && Number.isSafeInteger(topic.id) ? topic.id as number : 0)
  const nextNumericId = Math.max(0, ...numericIds) + 1
  if (!Number.isSafeInteger(nextNumericId)) failStructure('Could not allocate a topic ID')

  let level = 1
  let parentId: number | undefined
  let parentTopicId: string | undefined
  let insertIndex = toc.length
  if (insertion) {
    const selected = toc.find(candidate => isObject(candidate)
      && (candidate.topicId === insertion.afterTopicId
        || (candidate.topicId === undefined && `legacy-${String(candidate.id)}` === insertion.afterTopicId)))
    if (!isObject(selected)) throw new ContentCopyError(404, 'TOPIC_NOT_FOUND', 'Insertion topic was not found in the destination')
    level = Number.isSafeInteger(selected.level) ? selected.level as number : 1
    parentId = Number.isSafeInteger(selected.parentId) ? selected.parentId as number : undefined
    parentTopicId = typeof selected.parentTopicId === 'string' ? selected.parentTopicId : undefined
    const selectedIndex = toc.indexOf(selected)
    insertIndex = selectedIndex + 1
    while (insertIndex < toc.length && isObject(toc[insertIndex])
      && Number.isSafeInteger(toc[insertIndex].level) && (toc[insertIndex].level as number) > level) insertIndex++
  }
  const blocks = validateTopicBlocks(source.blocks)
  const newBlockIds = new Map<string, string>()
  for (const block of blocks) {
    newBlockIds.set(block.id as string, `block-${randomUUID()}`)
    if (Array.isArray(block.listItems)) {
      for (const item of block.listItems)
        if (isObject(item) && typeof item.id === 'string')
          newBlockIds.set(item.id, `list-item-${randomUUID()}`)
    }
  }
  const remappedBlocks = remapReferences(blocks, newBlockIds) as CopyJson[]

  const destinationVars = variablesInActiveTheme(record)
  // Topic snapshots carry no variable definitions; existing destination variables
  // are resolved by exact name, while unknown tokens remain blocking dependencies.
  const dependencyNames: string[] = []
  const conditionList = conditions(record)
  const resolvedBlocks = resolveVariableTokens(remappedBlocks, destinationVars, dependencyNames) as CopyJson[]
  const internalBlockIds = new Set([...newBlockIds.keys(), ...newBlockIds.values()])
  for (const block of resolvedBlocks) {
    const refs = Array.isArray(block.conditions) ? block.conditions as string[] : []
    for (const ref of refs) {
      const resolved = conditionList.some(condition => condition.id === ref
        || condition.group === ref || (Array.isArray(condition.tags) && condition.tags.includes(ref)))
      if (!resolved) dependencyNames.push(`condition "${ref}"`)
    }
    const textValues: string[] = []
    collectStrings(block, textValues)
    for (const text of textValues) {
      if (hasMediaReference(text))
        dependencyNames.push('media')
      const internalRefs = [...text.matchAll(/\[\[(?:block|bookmark):([^\]]+)\]\]/gi)]
      for (const match of internalRefs) {
        if (!internalBlockIds.has(match[1])) dependencyNames.push(`internal block reference "${match[1]}"`)
      }
      if (/\[\[(?:topic|project|asset):[^\]]+\]\]/i.test(text))
        dependencyNames.push('unknown project-local reference')
    }
  }
  if (dependencyNames.length) dependencyBlocked(dependencyNames)

  const topic: CopyJson = {
    id: nextNumericId,
    topicId: stableIdValue,
    title: source.title,
    level,
    words: 0,
    order: insertIndex,
    ...(parentId === undefined ? {} : { parentId }),
    ...(parentTopicId === undefined ? {} : { parentTopicId }),
  }
  const nextToc = [...toc]
  nextToc.splice(insertIndex, 0, topic)
  const oldContent = record.topicContent as CopyJson
  const updatedContent = { ...oldContent, [stableIdValue]: resolvedBlocks }
  const origins = contentOrigins(record)
  const topicOrigins = isObject(origins.topic) ? origins.topic : {}
  const nextRecord = {
    ...record,
    appToc: nextToc,
    topicContent: updatedContent,
    tocHumanModified: true,
    tocRevision: (Number.isSafeInteger(record.tocRevision) ? record.tocRevision as number : 0) + 1,
    contentRevision: (Number.isSafeInteger(record.contentRevision) ? record.contentRevision as number : 0) + 1,
    contentOrigins: {
      ...origins,
      topic: {
        ...topicOrigins,
        [stableIdValue]: { originItemId: item.item_id, originProjectId: item.project_id, originVersion: item.current_version },
      },
    },
  }
  return { record: nextRecord, asset: { id: stableIdValue, title: source.title, topicId: stableIdValue } }
}

function applyNonTopic(
  record: CopyJson,
  payload: unknown,
  item: CopySourceItem,
): { asset: CopyJson; record: CopyJson } {
  const id = randomUUID()
  const origins = contentOrigins(record)
  if (item.asset_type === 'snippet') {
    const snippet = validateSnippetPayload(payload)
    if (snippet.id !== item.local_asset_id)
      failStructure('Snippet payload ID does not match its catalog item')
    const dependencies: string[] = []
    const vars = variablesInActiveTheme(record)
    const content = resolveVariableTokens(snippet.content, vars, dependencies) as string
    if (dependencies.length) dependencyBlocked(dependencies)
    if (hasMediaReference(content)
      || /\[\[(?:topic|project|asset|block|bookmark):[^\]]+\]\]/i.test(content))
      dependencyBlocked(['snippet contains a media or unresolved project-local reference'])
    if (!Array.isArray(record.snippets)) failStructure('Destination snippets are invalid')
    const existing = record.snippets.map((value, index) => asObject(value, `Destination snippet ${index + 1}`))
    if (existing.some(value => value.name === snippet.name))
      throw new ContentCopyError(409, 'ASSET_NAME_CONFLICT', `A snippet named "${snippet.name}" already exists`)
    const newSnippet = { ...snippet, id, content }
    const snippetOrigins = isObject(origins.snippet) ? origins.snippet : {}
    return {
      record: {
        ...record, snippets: [...existing, newSnippet],
        contentOrigins: { ...origins, snippet: { ...snippetOrigins, [id]: {
          originItemId: item.item_id, originProjectId: item.project_id, originVersion: item.current_version,
        } } },
      },
      asset: { id, name: newSnippet.name },
    }
  }
  if (item.asset_type === 'variable') {
    const source = asObject(payload, 'Variable payload')
    if (Object.keys(source).some(key => !['id', 'name', 'value', 'description'].includes(key))
      || typeof source.id !== 'string' || typeof source.name !== 'string'
      || !source.name.trim() || source.name.trim() !== source.name || source.name.length > 500
      || typeof source.value !== 'string' || typeof source.description !== 'string'
      || source.description.length > 60_000)
      failStructure('Variable payload has an invalid structure')
    if (stableId(source.id, 'Variable') !== item.local_asset_id)
      failStructure('Variable payload ID does not match its catalog item')
    const themeId = activeThemeId(record)
    if (!themeId) dependencyBlocked(['destination active theme'])
    const vars = variablesInActiveTheme(record)
    const sameName = vars.find(variable => variable.name === source.name)
    if (sameName) {
      if (sameName.value === source.value && (sameName.description ?? '') === (source.description ?? ''))
        return { record, asset: { id: sameName.id, name: source.name, alreadyAvailable: true } }
      throw new ContentCopyError(409, 'ASSET_NAME_CONFLICT', `A variable named "${source.name}" already exists with different content`)
    }
    const variable = { id, name: source.name, value: source.value, description: source.description ?? '' }
    const allVariables = isObject(record.themeVariables) ? record.themeVariables : {}
    const variableOrigins = isObject(origins.variable) ? origins.variable : {}
    return {
      record: {
        ...record,
        themeVariables: { ...allVariables, [themeId]: [...vars, variable] },
        contentOrigins: { ...origins, variable: { ...variableOrigins, [id]: {
          originItemId: item.item_id, originProjectId: item.project_id, originVersion: item.current_version,
        } } },
      },
      asset: { id, name: variable.name },
    }
  }
  if (item.asset_type === 'condition') {
    const source = asObject(payload, 'Condition payload')
    if (Object.keys(source).some(key => !['id', 'group', 'tags'].includes(key))
      || typeof source.id !== 'string' || typeof source.group !== 'string' || !source.group.trim()
      || source.group.trim() !== source.group || source.group.length > 500 || !Array.isArray(source.tags)
      || source.tags.some(tag => typeof tag !== 'string'))
      failStructure('Condition payload has an invalid structure')
    if (stableId(source.id, 'Condition') !== item.local_asset_id)
      failStructure('Condition payload ID does not match its catalog item')
    if (!Array.isArray(record.conditionGroups)) failStructure('Destination conditions are invalid')
    const current = record.conditionGroups.map((value, index) => asObject(value, `Destination condition ${index + 1}`))
    if (current.some(condition => condition.group === source.group))
      throw new ContentCopyError(409, 'ASSET_NAME_CONFLICT', `A condition group named "${source.group}" already exists`)
    const condition = { id, group: source.group, tags: [...source.tags] }
    const conditionOrigins = isObject(origins.condition) ? origins.condition : {}
    return {
      record: {
        ...record, conditionGroups: [...current, condition],
        contentOrigins: { ...origins, condition: { ...conditionOrigins, [id]: {
          originItemId: item.item_id, originProjectId: item.project_id, originVersion: item.current_version,
        } } },
      },
      asset: { id, name: condition.group },
    }
  }
  dependencyBlocked([`${item.asset_type} assets cannot be copied into a project record`])
}

export function copyCatalogAsset(
  record: CopyJson,
  payload: unknown,
  item: CopySourceItem,
  insertion?: { afterTopicId: string },
): { record: CopyJson; asset: CopyJson } {
  if (encodedSize(payload) > 512_000)
    throw new ContentCopyError(413, 'PAYLOAD_TOO_LARGE', 'Content catalog version payload exceeds the 512 KB limit')
  if (!isObject(payload)) failStructure('Asset payload must be a JSON object')
  if (item.asset_type === 'topic') return applyTopic(record, payload, item, insertion)
  return applyNonTopic(record, payload, item)
}