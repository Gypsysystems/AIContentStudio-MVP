export type ContentExplorerAssetType =
  | 'topic'
  | 'snippet'
  | 'variable'
  | 'condition'
  | 'reference'
  | 'media'

export type ContentExplorerAssetReference = {
  id: string
  name: string
}

export type ContentExplorerAssets = {
  topics: ContentExplorerAssetReference[]
  snippets: ContentExplorerAssetReference[]
  variables: ContentExplorerAssetReference[]
  conditions: ContentExplorerAssetReference[]
  references?: ContentExplorerAssetReference[]
  media?: ContentExplorerAssetReference[]
}

export type ContentExplorerFolder = {
  id: string
  parentId: string
  name: string
  order: number
}

export type ContentExplorerPlacement = {
  assetType: ContentExplorerAssetType
  assetId: string
  folderId: string
  order: number
}

export type ContentExplorerMetadata = {
  version: 1
  folders: ContentExplorerFolder[]
  placements: ContentExplorerPlacement[]
}

export type ContentExplorerTreeNode = {
  id: string
  name: string
  kind: 'root' | 'category' | 'folder' | 'asset'
  assetType?: ContentExplorerAssetType
  assetId?: string
  children: ContentExplorerTreeNode[]
}

export const CONTENT_EXPLORER_ROOTS = [
  { id: 'topics', name: 'Topics' },
  { id: 'snippets', name: 'Snippets' },
  { id: 'media', name: 'Media' },
  { id: 'variables', name: 'Variables' },
  { id: 'conditions', name: 'Conditions' },
  { id: 'references', name: 'References' },
] as const

export const CONTENT_EXPLORER_MEDIA_CATEGORIES = [
  { id: 'media-images', name: 'Images' },
  { id: 'media-videos', name: 'Videos' },
  { id: 'media-gifs', name: 'GIFs' },
  { id: 'media-audio', name: 'Audio' },
] as const

export const CONTENT_EXPLORER_MAX_FOLDERS = 256
export const CONTENT_EXPLORER_MAX_PLACEMENTS = 5000
export const CONTENT_EXPLORER_MAX_DEPTH = 8
const MAX_FOLDER_NAME_LENGTH = 80
const MAX_ASSET_NAME_LENGTH = 256
const MAX_ID_LENGTH = 200

const ASSET_ROOT: Record<ContentExplorerAssetType, string> = {
  topic: 'topics',
  snippet: 'snippets',
  variable: 'variables',
  condition: 'conditions',
  reference: 'references',
  media: 'media',
}
const ASSET_FIELDS: Array<[ContentExplorerAssetType, keyof ContentExplorerAssets]> = [
  ['topic', 'topics'],
  ['snippet', 'snippets'],
  ['variable', 'variables'],
  ['condition', 'conditions'],
  ['reference', 'references'],
  ['media', 'media'],
]
const ROOT_IDS = new Set<string>(CONTENT_EXPLORER_ROOTS.map(root => root.id))
const MEDIA_CATEGORY_IDS = new Set<string>(
  CONTENT_EXPLORER_MEDIA_CATEGORIES.map(category => category.id),
)

function fail(message: string): never {
  throw new Error(`Content Explorer: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(value))
    fail(`${label} must be a non-empty stable ID.`)
  return value
}

function folderName(value: unknown): string {
  if (typeof value !== 'string') return fail('Folder name must be text.')
  const name = value.trim()
  if (!name || name.length > MAX_FOLDER_NAME_LENGTH ||
      name === '.' || name === '..' || /[\\/:\u0000-\u001f\u007f]/.test(name))
    fail(`Folder names must be 1–${MAX_FOLDER_NAME_LENGTH} safe characters.`)
  return name
}

function assetName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() ||
      value.length > MAX_ASSET_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(value))
    fail(`Asset names must be 1–${MAX_ASSET_NAME_LENGTH} printable characters.`)
  return value.trim()
}

function isAssetType(value: unknown): value is ContentExplorerAssetType {
  return typeof value === 'string' && ASSET_ROOT[value as ContentExplorerAssetType] !== undefined
}

function emptyMetadata(): ContentExplorerMetadata {
  return { version: 1, folders: [], placements: [] }
}

function readAssets(assets: ContentExplorerAssets): Map<ContentExplorerAssetType, Map<string, string>> {
  if (!isRecord(assets)) fail('Assets must be provided as stable references.')
  const result = new Map<ContentExplorerAssetType, Map<string, string>>()
  let total = 0
  for (const [assetType, field] of ASSET_FIELDS) {
    const raw = assets[field] ?? []
    if (!Array.isArray(raw)) fail(`${field} assets must be an array.`)
    const items = new Map<string, string>()
    for (const entry of raw) {
      if (!isRecord(entry)) fail(`${field} assets must contain references only.`)
      const id = validId(entry.id, `${field} asset ID`)
      if (items.has(id)) fail(`Duplicate ${field} asset ID "${id}".`)
      items.set(id, assetName(entry.name))
      total += 1
    }
    result.set(assetType, items)
  }
  if (total > CONTENT_EXPLORER_MAX_PLACEMENTS)
    fail(`Projects may contain at most ${CONTENT_EXPLORER_MAX_PLACEMENTS} content references.`)
  return result
}

function folderIndex(folders: ContentExplorerFolder[]): Map<string, ContentExplorerFolder> {
  return new Map(folders.map(folder => [folder.id, folder]))
}

function folderRoot(
  parentId: string,
  folders: Map<string, ContentExplorerFolder>,
): string | null {
  if (ROOT_IDS.has(parentId)) return parentId
  if (MEDIA_CATEGORY_IDS.has(parentId)) return 'media'
  let current = folders.get(parentId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) fail('Folder parent cycle detected.')
    seen.add(current.id)
    if (ROOT_IDS.has(current.parentId)) return current.parentId
    if (MEDIA_CATEGORY_IDS.has(current.parentId)) return 'media'
    current = folders.get(current.parentId)
  }
  return null
}

function folderDepth(
  folderId: string,
  folders: Map<string, ContentExplorerFolder>,
): number {
  let depth = 0
  let current = folders.get(folderId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) fail('Folder parent cycle detected.')
    seen.add(current.id)
    depth += 1
    current = folders.get(current.parentId)
  }
  return depth
}

function validDestinationRoot(
  parentId: string,
  folders: Map<string, ContentExplorerFolder>,
): string {
  const root = folderRoot(parentId, folders)
  if (!root) fail(`Unknown folder "${parentId}".`)
  if (!ROOT_IDS.has(parentId) && !MEDIA_CATEGORY_IDS.has(parentId) && !folders.has(parentId))
    fail(`Unknown folder "${parentId}".`)
  return root
}

function compareOrderAndId(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || a.id.localeCompare(b.id)
}

function nextOrder(metadata: ContentExplorerMetadata, folderId: string): number {
  const siblingFolders = metadata.folders
    .filter(folder => folder.parentId === folderId)
    .map(folder => folder.order)
  const siblingPlacements = metadata.placements
    .filter(placement => placement.folderId === folderId)
    .map(placement => placement.order)
  return Math.max(-1, ...siblingFolders, ...siblingPlacements) + 1
}

function canonicalize(metadata: ContentExplorerMetadata): ContentExplorerMetadata {
  const folderGroups = new Map<string, ContentExplorerFolder[]>()
  for (const folder of metadata.folders) {
    const group = folderGroups.get(folder.parentId) ?? []
    group.push(folder)
    folderGroups.set(folder.parentId, group)
  }
  const folders = [...folderGroups.values()]
    .flatMap(group => group.sort(compareOrderAndId).map((folder, order) => ({ ...folder, order })))

  const placementGroups = new Map<string, ContentExplorerPlacement[]>()
  for (const placement of metadata.placements) {
    const key = `${placement.assetType}\u0000${placement.folderId}`
    const group = placementGroups.get(key) ?? []
    group.push(placement)
    placementGroups.set(key, group)
  }
  const placements = [...placementGroups.values()]
    .flatMap(group => group.sort((a, b) =>
      a.order - b.order || a.assetId.localeCompare(b.assetId),
    ).map((placement, order) => ({ ...placement, order })))
  return { version: 1, folders, placements }
}

function validateStructure(raw: unknown): ContentExplorerMetadata {
  if (!isRecord(raw) || raw.version !== 1 ||
      Object.keys(raw).sort().join(',') !== 'folders,placements,version' ||
      !Array.isArray(raw.folders) || !Array.isArray(raw.placements))
    fail('Metadata must use version 1 with folder and placement arrays.')
  if (raw.folders.length > CONTENT_EXPLORER_MAX_FOLDERS)
    fail(`Projects may contain at most ${CONTENT_EXPLORER_MAX_FOLDERS} folders.`)
  if (raw.placements.length > CONTENT_EXPLORER_MAX_PLACEMENTS)
    fail(`Projects may contain at most ${CONTENT_EXPLORER_MAX_PLACEMENTS} placements.`)

  const folders: ContentExplorerFolder[] = raw.folders.map(value => {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'id,name,order,parentId')
      return fail('Folder metadata is malformed.')
    const id = validId(value.id, 'Folder ID')
    if (!/^folder-[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id))
      fail(`User folder ID "${id}" is not stable or safe.`)
    if (ROOT_IDS.has(id) || MEDIA_CATEGORY_IDS.has(id))
      fail(`System folder "${id}" cannot be stored as a user folder.`)
    const parentId = validId(value.parentId, 'Folder parent ID')
    const name = folderName(value.name)
    if (!Number.isSafeInteger(value.order) || (value.order as number) < 0)
      fail(`Folder "${id}" has an invalid sibling order.`)
    return { id, parentId, name, order: value.order as number }
  })
  const folderIds = new Set<string>()
  for (const folder of folders) {
    if (folderIds.has(folder.id)) fail(`Duplicate folder ID "${folder.id}".`)
    folderIds.add(folder.id)
  }
  const foldersById = folderIndex(folders)
  const siblingNames = new Set<string>()
  for (const folder of folders) {
    validDestinationRoot(folder.parentId, foldersById)
    let current = foldersById.get(folder.parentId)
    const ancestors = new Set<string>()
    while (current) {
      if (ancestors.has(current.id)) fail('Folder parent cycle detected.')
      ancestors.add(current.id)
      current = foldersById.get(current.parentId)
    }
    const depth = folderDepth(folder.id, foldersById)
    if (depth > CONTENT_EXPLORER_MAX_DEPTH)
      fail(`Folder nesting cannot exceed ${CONTENT_EXPLORER_MAX_DEPTH} levels.`)
    const siblingKey = `${folder.parentId}\u0000${folder.name.toLowerCase()}`
    if (siblingNames.has(siblingKey))
      fail(`Folder name "${folder.name}" already exists in this location.`)
    siblingNames.add(siblingKey)
  }

  const placements: ContentExplorerPlacement[] = raw.placements.map(value => {
    if (!isRecord(value) ||
        Object.keys(value).sort().join(',') !== 'assetId,assetType,folderId,order' ||
        !isAssetType(value.assetType))
      return fail('Asset placement metadata is malformed.')
    const assetId = validId(value.assetId, 'Asset ID')
    const folderId = validId(value.folderId, 'Placement folder ID')
    if (!Number.isSafeInteger(value.order) || (value.order as number) < 0)
      fail(`Asset "${assetId}" has an invalid sibling order.`)
    const root = validDestinationRoot(folderId, foldersById)
    if (root !== ASSET_ROOT[value.assetType])
      fail(`${value.assetType} assets must remain beneath their fixed root.`)
    return {
      assetType: value.assetType,
      assetId,
      folderId,
      order: value.order as number,
    }
  })
  const placementIds = new Set<string>()
  for (const placement of placements) {
    const key = `${placement.assetType}\u0000${placement.assetId}`
    if (placementIds.has(key)) fail(`Duplicate placement for ${placement.assetType} "${placement.assetId}".`)
    placementIds.add(key)
  }
  return canonicalize({ version: 1, folders, placements })
}

/**
 * Validate persisted metadata, prune references to removed assets, and add
 * deterministic root placements for newly committed project assets.
 */
export function hydrateContentExplorerMetadata(
  raw: unknown,
  assets: ContentExplorerAssets,
): ContentExplorerMetadata {
  const knownAssets = readAssets(assets)
  const metadata = raw === undefined || raw === null
    ? emptyMetadata()
    : validateStructure(raw)
  const folders = folderIndex(metadata.folders)
  const availablePlacements = metadata.placements.filter(placement =>
    knownAssets.get(placement.assetType)?.has(placement.assetId),
  )
  const seen = new Set(availablePlacements.map(
    placement => `${placement.assetType}\u0000${placement.assetId}`,
  ))
  for (const [assetType] of ASSET_FIELDS) {
    for (const assetId of knownAssets.get(assetType)!.keys()) {
      const key = `${assetType}\u0000${assetId}`
      if (!seen.has(key)) {
        availablePlacements.push({
          assetType,
          assetId,
          folderId: ASSET_ROOT[assetType],
          order: nextOrder(
            { ...metadata, placements: availablePlacements },
            ASSET_ROOT[assetType],
          ),
        })
        seen.add(key)
      }
    }
  }
  return canonicalize({ version: 1, folders: metadata.folders, placements: availablePlacements })
}

export function createContentExplorerFolder(
  metadata: ContentExplorerMetadata,
  parentId: string,
  name: string,
  id: string,
): ContentExplorerMetadata {
  const current = validateStructure(metadata)
  if (current.folders.length >= CONTENT_EXPLORER_MAX_FOLDERS)
    fail(`Projects may contain at most ${CONTENT_EXPLORER_MAX_FOLDERS} folders.`)
  const folderId = validId(id, 'Folder ID')
  if (!/^folder-[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(folderId))
    fail('New folder IDs must be caller-supplied stable IDs beginning with "folder-".')
  if (current.folders.some(folder => folder.id === folderId))
    fail(`Folder ID "${folderId}" already exists.`)
  const normalizedName = folderName(name)
  const folders = folderIndex(current.folders)
  validDestinationRoot(parentId, folders)
  if (current.folders.some(folder => folder.parentId === parentId &&
      folder.name.toLowerCase() === normalizedName.toLowerCase()))
    fail(`Folder name "${normalizedName}" already exists in this location.`)
  const depth = (folders.has(parentId) ? folderDepth(parentId, folders) : 0) + 1
  if (depth > CONTENT_EXPLORER_MAX_DEPTH)
    fail(`Folder nesting cannot exceed ${CONTENT_EXPLORER_MAX_DEPTH} levels.`)
  return canonicalize({
    ...current,
    folders: [...current.folders, {
      id: folderId,
      parentId,
      name: normalizedName,
      order: nextOrder(current, parentId),
    }],
  })
}

export function renameContentExplorerFolder(
  metadata: ContentExplorerMetadata,
  id: string,
  name: string,
): ContentExplorerMetadata {
  const current = validateStructure(metadata)
  const target = current.folders.find(folder => folder.id === id)
  if (!target) fail(`System or unknown folder "${id}" cannot be renamed.`)
  const normalizedName = folderName(name)
  if (current.folders.some(folder => folder.id !== id && folder.parentId === target.parentId &&
      folder.name.toLowerCase() === normalizedName.toLowerCase()))
    fail(`Folder name "${normalizedName}" already exists in this location.`)
  return canonicalize({
    ...current,
    folders: current.folders.map(folder =>
      folder.id === id ? { ...folder, name: normalizedName } : folder,
    ),
  })
}

export function moveContentExplorerFolder(
  metadata: ContentExplorerMetadata,
  id: string,
  parentId: string,
): ContentExplorerMetadata {
  const current = validateStructure(metadata)
  const target = current.folders.find(folder => folder.id === id)
  if (!target) fail(`System or unknown folder "${id}" cannot be moved.`)
  const folders = folderIndex(current.folders)
  validDestinationRoot(parentId, folders)
  if (parentId === id) fail('A folder cannot be moved inside itself.')
  let parent = folders.get(parentId)
  while (parent) {
    if (parent.id === id) fail('A folder cannot be moved inside its own descendant.')
    parent = folders.get(parent.parentId)
  }
  if (current.folders.some(folder => folder.id !== id && folder.parentId === parentId &&
      folder.name.toLowerCase() === target.name.toLowerCase()))
    fail(`Folder name "${target.name}" already exists in this location.`)

  const changedFolders = current.folders.map(folder =>
    folder.id === id ? { ...folder, parentId, order: nextOrder(current, parentId) } : folder,
  )
  const moved = changedFolders.find(folder => folder.id === id)!
  const updatedIndex = folderIndex(changedFolders)
  const subtreeDepth = (folderId: string): number => {
    const children = changedFolders.filter(folder => folder.parentId === folderId)
    return children.length
      ? 1 + Math.max(...children.map(child => subtreeDepth(child.id)))
      : 1
  }
  const parentDepth = updatedIndex.has(parentId) ? folderDepth(parentId, updatedIndex) : 0
  if (parentDepth + subtreeDepth(id) > CONTENT_EXPLORER_MAX_DEPTH)
    fail(`Folder nesting cannot exceed ${CONTENT_EXPLORER_MAX_DEPTH} levels.`)
  const oldRoot = folderRoot(target.parentId, folders)
  const nextRoot = folderRoot(moved.parentId, updatedIndex)
  if (nextRoot !== oldRoot) {
    for (const placement of current.placements) {
      if (placement.folderId === id || isDescendant(placement.folderId, id, updatedIndex)) {
        const placementRoot = ASSET_ROOT[placement.assetType]
        if (placementRoot !== nextRoot)
          fail(`${placement.assetType} content cannot be moved outside its fixed root.`)
      }
    }
  }
  return canonicalize({ ...current, folders: changedFolders })
}

function isDescendant(
  candidateId: string,
  ancestorId: string,
  folders: Map<string, ContentExplorerFolder>,
): boolean {
  let current = folders.get(candidateId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    if (current.parentId === ancestorId) return true
    current = folders.get(current.parentId)
  }
  return false
}

export function deleteContentExplorerFolder(
  metadata: ContentExplorerMetadata,
  id: string,
): ContentExplorerMetadata {
  const current = validateStructure(metadata)
  if (!current.folders.some(folder => folder.id === id))
    fail(`System or unknown folder "${id}" cannot be deleted.`)
  if (current.folders.some(folder => folder.parentId === id) ||
      current.placements.some(placement => placement.folderId === id))
    fail(`Folder "${id}" must be empty before it can be deleted.`)
  return { ...current, folders: current.folders.filter(folder => folder.id !== id) }
}

export function moveContentExplorerItem(
  metadata: ContentExplorerMetadata,
  assetType: ContentExplorerAssetType,
  assetId: string,
  folderId: string,
): ContentExplorerMetadata {
  if (!isAssetType(assetType)) fail('Unknown content type.')
  const current = validateStructure(metadata)
  const itemId = validId(assetId, 'Asset ID')
  const existing = current.placements.find(placement =>
    placement.assetType === assetType && placement.assetId === itemId,
  )
  if (!existing) fail(`No ${assetType} placement exists for "${itemId}".`)
  const root = validDestinationRoot(folderId, folderIndex(current.folders))
  if (root !== ASSET_ROOT[assetType])
    fail(`${assetType} content must remain beneath its fixed root.`)
  return canonicalize({
    ...current,
    placements: current.placements.map(placement =>
      placement === existing
        ? { ...placement, folderId, order: nextOrder(current, folderId) }
        : placement,
    ),
  })
}

export function deriveContentExplorerTree(
  metadata: ContentExplorerMetadata,
  assets: ContentExplorerAssets,
): ContentExplorerTreeNode[] {
  const hydrated = hydrateContentExplorerMetadata(metadata, assets)
  const assetNames = readAssets(assets)
  const folders = folderIndex(hydrated.folders)
  const nodes = new Map<string, ContentExplorerTreeNode>()
  for (const root of CONTENT_EXPLORER_ROOTS) {
    nodes.set(root.id, { ...root, kind: 'root', children: [] })
  }
  for (const category of CONTENT_EXPLORER_MEDIA_CATEGORIES) {
    nodes.set(category.id, { ...category, kind: 'category', children: [] })
    nodes.get('media')!.children.push(nodes.get(category.id)!)
  }
  for (const folder of hydrated.folders) {
    nodes.set(folder.id, {
      id: folder.id,
      name: folder.name,
      kind: 'folder',
      children: [],
    })
  }
  for (const folder of hydrated.folders) {
    nodes.get(folder.parentId)!.children.push(nodes.get(folder.id)!)
  }
  for (const placement of hydrated.placements) {
    const name = assetNames.get(placement.assetType)?.get(placement.assetId)
    if (name === undefined) continue
    nodes.get(placement.folderId)!.children.push({
      id: `${placement.assetType}:${placement.assetId}`,
      name,
      kind: 'asset',
      assetType: placement.assetType,
      assetId: placement.assetId,
      children: [],
    })
  }
  const orderById = new Map<string, number>()
  for (const folder of hydrated.folders) orderById.set(folder.id, folder.order)
  for (const placement of hydrated.placements)
    orderById.set(`${placement.assetType}:${placement.assetId}`, placement.order)
  const mediaCategoryOrder = new Map<string, number>(
    CONTENT_EXPLORER_MEDIA_CATEGORIES.map((category, index) => [category.id, index]),
  )
  const sortChildren = (node: ContentExplorerTreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind === 'category' || b.kind === 'category') {
        if (a.kind !== b.kind) return a.kind === 'category' ? -1 : 1
        return (mediaCategoryOrder.get(a.id) ?? 0) - (mediaCategoryOrder.get(b.id) ?? 0)
      }
      const order = (orderById.get(a.id) ?? -1) - (orderById.get(b.id) ?? -1)
      if (order) return order
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.id.localeCompare(b.id)
    })
    for (const child of node.children) sortChildren(child)
  }
  const roots = CONTENT_EXPLORER_ROOTS.map(root => nodes.get(root.id)!)
  roots.forEach(sortChildren)
  return roots
}