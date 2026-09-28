export type ContentCatalogAssetType = 'topic' | 'snippet' | 'variable' | 'condition'

export type ContentCatalogItem = {
  itemId: string
  projectId: string
  assetType: ContentCatalogAssetType
  displayName: string
  currentVersion: number
  updatedAt: string
}

export type ContentCatalogVersion = {
  version: number
  payload: Record<string, unknown>
}

export type ContentCatalogProjectCopy = {
  projectId: string
  recordRevision: number
  assetType: ContentCatalogAssetType
  asset: {
    id: string
    name?: string
    title?: string
    topicId?: string
    alreadyAvailable?: boolean
  }
}

export type ContentCatalogListFilters = {
  projectId?: string
  excludeProjectId?: string
  assetType?: ContentCatalogAssetType
  search?: string
  limit: number
  offset: number
}

export type ContentCatalogCopyOptions = {
  workspaceId: string
  sourceItemId: string
  sourceVersion: number
  destinationProjectId: string
  expectedRevision: number
  insertion?: { afterTopicId: string }
}

const SUPPORTED_TYPES = new Set<ContentCatalogAssetType>(['topic', 'snippet', 'variable', 'condition'])
const MAX_PAGE_SIZE = 100
const MAX_OFFSET = 100_000

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredText(value: unknown, label: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value || value.length > maximum || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error(`Content catalog returned invalid ${label}.`)
  return value
}

function supportedType(value: unknown): ContentCatalogAssetType {
  if (typeof value !== 'string' || !SUPPORTED_TYPES.has(value as ContentCatalogAssetType))
    throw new Error('Content catalog returned an unsupported asset type.')
  return value as ContentCatalogAssetType
}

async function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('/api/content-catalog', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Content catalog is unavailable; no local fallback was used.')
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error('Content catalog returned an invalid response.')
  }
  if (!isObject(result)) throw new Error('Content catalog returned an invalid response.')
  if (!response.ok)
    throw new Error(String(result.error ?? result.message ?? 'Content catalog request failed.'))
  return result
}

function validateListFilters(filters: ContentCatalogListFilters): void {
  if (!Number.isSafeInteger(filters.limit) || filters.limit < 1 || filters.limit > MAX_PAGE_SIZE)
    throw new Error(`Content catalog page size must be between 1 and ${MAX_PAGE_SIZE}.`)
  if (!Number.isSafeInteger(filters.offset) || filters.offset < 0 || filters.offset > MAX_OFFSET)
    throw new Error(`Content catalog offset must be between 0 and ${MAX_OFFSET}.`)
  if (filters.projectId !== undefined)
    requiredText(filters.projectId, 'project ID', 256)
  if (filters.excludeProjectId !== undefined) {
    requiredText(filters.excludeProjectId, 'excluded project ID', 256)
    if (filters.projectId === filters.excludeProjectId)
      throw new Error('Content catalog source project cannot be the excluded destination project.')
  }
  if (filters.assetType !== undefined) supportedType(filters.assetType)
  if (filters.search !== undefined
    && (filters.search.trim() !== filters.search || filters.search.length > 120
      || /[\u0000-\u001f\u007f]/.test(filters.search)))
    throw new Error('Content catalog search must be at most 120 printable characters.')
}

export async function listContentCatalogItems(
  workspaceId: string,
  filters: ContentCatalogListFilters,
): Promise<ContentCatalogItem[]> {
  requiredText(workspaceId, 'workspace ID', 256)
  validateListFilters(filters)
  const result = await request({ action: 'list', workspaceId, ...filters })
  if (!Array.isArray(result.items)) throw new Error('Content catalog returned an invalid item list.')
  return result.items.flatMap((value): ContentCatalogItem[] => {
    if (!isObject(value)) throw new Error('Content catalog returned invalid item metadata.')
    const assetType = supportedType(value.assetType)
    if (typeof value.currentVersion !== 'number' || !Number.isSafeInteger(value.currentVersion)
      || value.currentVersion < 1)
      throw new Error('Content catalog returned invalid item metadata.')
    requiredText(value.updatedAt, 'item update timestamp', 100)
    return [{
      itemId: requiredText(value.itemId, 'item ID', 256),
      projectId: requiredText(value.projectId, 'project ID', 256),
      assetType,
      displayName: requiredText(value.displayName, 'item name'),
      currentVersion: value.currentVersion,
      updatedAt: value.updatedAt as string,
    }]
  })
}

export async function loadContentCatalogVersion(
  workspaceId: string,
  item: Pick<ContentCatalogItem, 'itemId' | 'currentVersion'>,
  version = item.currentVersion,
): Promise<{ item: ContentCatalogItem; version: ContentCatalogVersion }> {
  requiredText(workspaceId, 'workspace ID', 256)
  requiredText(item.itemId, 'item ID', 256)
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Content catalog version must be a positive integer.')
  const result = await request({ action: 'version', workspaceId, itemId: item.itemId, version })
  if (!isObject(result.item) || !isObject(result.version)
    || result.version.version !== version || !isObject(result.version.payload))
    throw new Error('Content catalog returned an invalid version preview.')
  const rawItem = result.item
  if (rawItem.itemId !== item.itemId
    || !Number.isSafeInteger(rawItem.currentVersion) || typeof rawItem.currentVersion !== 'number')
    throw new Error('Content catalog returned mismatched item metadata.')
  const normalizedItem: ContentCatalogItem = {
    itemId: requiredText(rawItem.itemId, 'item ID', 256),
    projectId: requiredText(rawItem.projectId, 'project ID', 256),
    assetType: supportedType(rawItem.assetType),
    displayName: requiredText(rawItem.displayName, 'item name'),
    currentVersion: rawItem.currentVersion,
    updatedAt: requiredText(rawItem.updatedAt, 'item update timestamp', 100),
  }
  return {
    item: normalizedItem,
    version: { version, payload: result.version.payload },
  }
}

export async function copyContentCatalogItem(
  options: ContentCatalogCopyOptions,
): Promise<ContentCatalogProjectCopy> {
  requiredText(options.workspaceId, 'workspace ID', 256)
  requiredText(options.sourceItemId, 'item ID', 256)
  requiredText(options.destinationProjectId, 'destination project ID', 256)
  if (!Number.isSafeInteger(options.sourceVersion) || options.sourceVersion < 1)
    throw new Error('Content catalog source version must be a positive integer.')
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)
    throw new Error('Destination project revision must be a nonnegative integer.')
  if (options.insertion) requiredText(options.insertion.afterTopicId, 'insertion topic ID', 256)

  // Keep the wire contract explicit: source payload is never sent to this endpoint.
  const body = {
    action: 'copy',
    workspaceId: options.workspaceId,
    sourceItemId: options.sourceItemId,
    sourceVersion: options.sourceVersion,
    destinationProjectId: options.destinationProjectId,
    expectedRevision: options.expectedRevision,
    ...(options.insertion ? { insertion: { afterTopicId: options.insertion.afterTopicId } } : {}),
  }
  const result = await request(body)
  if (!isObject(result.asset) || !Number.isSafeInteger(result.recordRevision)
    || typeof result.recordRevision !== 'number' || result.recordRevision < 0)
    throw new Error('Content catalog returned an invalid copy confirmation.')
  const asset: ContentCatalogProjectCopy['asset'] = {
    id: requiredText(result.asset.id, 'copied asset ID', 512),
    ...(typeof result.asset.name === 'string' ? { name: requiredText(result.asset.name, 'copied asset name') } : {}),
    ...(typeof result.asset.title === 'string' ? { title: requiredText(result.asset.title, 'copied asset title') } : {}),
    ...(typeof result.asset.topicId === 'string' ? { topicId: requiredText(result.asset.topicId, 'copied topic ID', 256) } : {}),
    ...(typeof result.asset.alreadyAvailable === 'boolean' ? { alreadyAvailable: result.asset.alreadyAvailable } : {}),
  }
  return {
    projectId: requiredText(result.projectId, 'copy project ID', 256),
    recordRevision: result.recordRevision as number,
    assetType: supportedType(result.assetType),
    asset,
  }
}