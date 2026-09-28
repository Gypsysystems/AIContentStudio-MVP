import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  createContentExplorerFolder,
  deleteContentExplorerFolder,
  deriveContentExplorerTree,
  moveContentExplorerFolder,
  moveContentExplorerItem,
  renameContentExplorerFolder,
  type ContentExplorerAssets,
  type ContentExplorerMetadata,
} from './contentExplorerModel'
import { ResourcePicker, type ResourcePickerItem, type ResourcePickerPreview, type ResourcePickerSourceProject } from './ResourcePicker'

export type ContentExplorerPanelProps = {
  metadata: ContentExplorerMetadata
  assets: ContentExplorerAssets
  selectedTopicId?: string | null
  onOpenTopic: (topicId: string) => void
  onChange: (metadata: ContentExplorerMetadata) => void
  readOnly?: boolean
  canBrowseCatalog?: boolean
  canCopyCatalog?: boolean
  loadCatalogProjects?: () => Promise<ResourcePickerSourceProject[]>
  loadCatalogItems?: (filters: {
    projectId?: string
    assetType?: ResourcePickerItem['assetType']
    search?: string
    limit: number
    offset: number
  }) => Promise<ResourcePickerItem[]>
  loadCatalogPreview?: (item: ResourcePickerItem) => Promise<ResourcePickerPreview>
  onCatalogCopy?: (item: ResourcePickerItem, version: number, afterTopicId: string | null) => Promise<void>
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}

type AssetType = 'topic' | 'snippet' | 'variable' | 'condition' | 'reference' | 'media'
type ExplorerNode = {
  id: string
  name: string
  kind: 'root' | 'folder' | 'asset'
  assetType?: AssetType
  assetId?: string
  children: ExplorerNode[]
}

type DerivedNode = {
  id?: unknown
  folderId?: unknown
  assetId?: unknown
  name?: unknown
  title?: unknown
  label?: unknown
  kind?: unknown
  type?: unknown
  nodeType?: unknown
  assetType?: unknown
  children?: unknown
  items?: unknown
  roots?: unknown
}

const ROOTS: Array<{ id: string; name: string; icon: string }> = [
  { id: 'topics', name: 'Topics', icon: '¶' },
  { id: 'snippets', name: 'Snippets', icon: '▤' },
  { id: 'media', name: 'Media', icon: '▧' },
  { id: 'variables', name: 'Variables', icon: '{ }' },
  { id: 'conditions', name: 'Conditions', icon: '◇' },
  { id: 'references', name: 'References', icon: '↗' },
]

const MEDIA_CATEGORIES = [
  { id: 'media-images', name: 'Images', icon: '▧' },
  { id: 'media-videos', name: 'Videos', icon: '▷' },
  { id: 'media-gifs', name: 'GIFs', icon: '✧' },
  { id: 'media-audio', name: 'Audio', icon: '♫' },
]

const ASSET_TYPES: AssetType[] = ['topic', 'snippet', 'variable', 'condition', 'reference', 'media']
const ROOT_IDS = new Set([...ROOTS.map(root => root.id), ...MEDIA_CATEGORIES.map(category => category.id)])
const ROOT_ICON = new Map(ROOTS.map(root => [root.id, root.icon]))
const CATEGORY_ICON = new Map(MEDIA_CATEGORIES.map(category => [category.id, category.icon]))
const ITEM_ICONS: Record<AssetType, string> = {
  topic: '¶',
  snippet: '▤',
  variable: '{ }',
  condition: '◇',
  reference: '↗',
  media: '▧',
}

function nodeKind(node: DerivedNode): ExplorerNode['kind'] {
  const type = String(node.nodeType ?? node.kind ?? node.type ?? '').toLowerCase()
  if (type === 'asset' || ASSET_TYPES.includes(type as AssetType) || node.assetId !== undefined) return 'asset'
  const id = String(node.id ?? node.folderId ?? '')
  return ROOT_IDS.has(id) || type === 'root' || type === 'system-root' || type === 'category'
    ? 'root'
    : 'folder'
}

/**
 * Model tree nodes are intentionally consumed structurally here so the UI
 * does not own a second copy of the folder/placement derivation rules.
 */
function normalizeDerivedTree(raw: unknown): ExplorerNode[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as DerivedNode).roots ?? (raw as DerivedNode).children ?? (raw as DerivedNode).items)
      : null
  if (!Array.isArray(source)) return []

  const normalize = (value: unknown): ExplorerNode | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const node = value as DerivedNode
    const id = String(node.id ?? node.folderId ?? '')
    if (!id) return null
    const kind = nodeKind(node)
    const typeText = String(node.assetType ?? node.type ?? node.kind ?? '')
    const assetType = ASSET_TYPES.includes(typeText as AssetType) ? typeText as AssetType : undefined
    const children = Array.isArray(node.children)
      ? node.children
      : Array.isArray(node.items) ? node.items : []
    return {
      id,
      name: String(node.name ?? node.title ?? node.label ?? id),
      kind,
      ...(kind === 'asset' && assetType ? { assetType } : {}),
      ...(kind === 'asset' && node.assetId !== undefined ? { assetId: String(node.assetId) } : {}),
      children: children.map(normalize).filter((child): child is ExplorerNode => child !== null),
    }
  }
  return source.map(normalize).filter((node): node is ExplorerNode => node !== null)
}

function createFolderId(): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `folder-${suffix}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The folder change could not be applied.'
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <span aria-hidden="true" className="ce-chevron">{expanded ? '▾' : '▸'}</span>
}

export function ContentExplorerPanel({
  metadata,
  assets,
  selectedTopicId = null,
  onOpenTopic,
  onChange,
  readOnly = false,
  canBrowseCatalog = false,
  canCopyCatalog = false,
  loadCatalogProjects,
  loadCatalogItems,
  loadCatalogPreview,
  onCatalogCopy,
  collapsed,
  onCollapse,
}: ContentExplorerPanelProps) {
  const [localCollapsed, setLocalCollapsed] = useState(false)
  const isCollapsed = collapsed ?? localCollapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set([...ROOTS.map(root => root.id), ...MEDIA_CATEGORIES.map(category => category.id)]),
  )
  const [query, setQuery] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [folderForm, setFolderForm] = useState<{
    parentId: string
    renameId?: string
    name: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const [newFolderParent, setNewFolderParent] = useState('topics')
  const [pickerProjects, setPickerProjects] = useState<ResourcePickerSourceProject[] | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)

  const tree = useMemo(
    () => normalizeDerivedTree(deriveContentExplorerTree(metadata, assets)),
    [metadata, assets],
  )
  const searchableTree = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return tree
    const filter = (nodes: ExplorerNode[]): ExplorerNode[] => nodes.flatMap(node => {
      const children = filter(node.children)
      return node.name.toLowerCase().includes(term) || children.length > 0
        ? [{ ...node, children }]
        : []
    })
    return filter(tree)
  }, [tree, query])

  const setCollapsed = (next: boolean) => {
    if (collapsed === undefined) setLocalCollapsed(next)
    onCollapse?.(next)
  }

  const openResourcePicker = async () => {
    if (!canBrowseCatalog || !loadCatalogProjects || !loadCatalogItems || !loadCatalogPreview || !onCatalogCopy) return
    setPickerLoading(true)
    setNotice('')
    try {
      setPickerProjects(await loadCatalogProjects())
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setPickerLoading(false)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const commitFolder = () => {
    if (!folderForm || readOnly) return
    try {
      const next = folderForm.renameId
        ? renameContentExplorerFolder(metadata, folderForm.renameId, folderForm.name)
        : createContentExplorerFolder(metadata, folderForm.parentId, folderForm.name, createFolderId())
      onChange(next)
      setNotice('')
      setFolderForm(null)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const beginNewFolder = (parentId: string) => {
    if (readOnly) return
    setQuery('')
    setExpandedIds(current => new Set(current).add(parentId))
    setNotice('')
    setMenuNodeId(null)
    setFolderForm({ parentId, name: '' })
  }

  const beginRename = (folder: ExplorerNode) => {
    if (readOnly || folder.kind !== 'folder') return
    setMenuNodeId(null)
    setFolderForm({ parentId: '', renameId: folder.id, name: folder.name })
  }

  const deleteFolder = (folder: ExplorerNode) => {
    if (readOnly || folder.kind !== 'folder') return
    setMenuNodeId(null)
    if (!window.confirm(`Delete the empty folder “${folder.name}”?`)) return
    try {
      onChange(deleteContentExplorerFolder(metadata, folder.id))
      setNotice('')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const startDrag = (event: DragEvent, node: ExplorerNode) => {
    if (readOnly || (node.kind !== 'folder' && !(node.kind === 'asset' && (node.assetType === 'topic' || node.assetType === 'reference')))) {
      event.preventDefault()
      return
    }
    const drag = node.kind === 'folder'
      ? { kind: 'folder', id: node.id }
      : { kind: 'asset', assetType: node.assetType, assetId: node.assetId }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-author-content-explorer', JSON.stringify(drag))
  }

  const receiveDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault()
    if (readOnly) return
    const raw = event.dataTransfer.getData('application/x-author-content-explorer')
    if (!raw) return
    try {
      const drag = JSON.parse(raw) as { kind?: string; id?: string; assetType?: AssetType; assetId?: string }
      let next: ContentExplorerMetadata
      if (drag.kind === 'folder' && drag.id) {
        next = moveContentExplorerFolder(metadata, drag.id, targetId)
      } else if (drag.kind === 'asset' && drag.assetType && drag.assetId
        && (drag.assetType === 'topic' || drag.assetType === 'reference')) {
        next = moveContentExplorerItem(metadata, drag.assetType, drag.assetId, targetId)
      } else {
        return
      }
      onChange(next)
      setNotice('')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: ExplorerNode) => {
    if (event.key === 'ArrowRight' && node.children.length > 0 && !expandedIds.has(node.id)) {
      event.preventDefault()
      toggleExpanded(node.id)
    } else if (event.key === 'ArrowLeft' && node.children.length > 0 && expandedIds.has(node.id)) {
      event.preventDefault()
      toggleExpanded(node.id)
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (node.kind === 'asset' && node.assetType === 'topic' && node.assetId) {
        event.preventDefault()
        onOpenTopic(node.assetId)
      }
    }
  }

  const iconFor = (node: ExplorerNode) => ROOT_ICON.get(node.id)
    ?? CATEGORY_ICON.get(node.id)
    ?? (node.assetType ? ITEM_ICONS[node.assetType] : '▰')

  const renderNode = (node: ExplorerNode, depth: number): ReactNode => {
    const expanded = query.trim() ? true : expandedIds.has(node.id)
    const selected = node.kind === 'asset' && node.assetType === 'topic'
      ? node.assetId === selectedTopicId
      : selectedAsset === `${node.assetType ?? node.kind}:${node.assetId ?? node.id}`
    const isEditing = folderForm?.renameId === node.id
    const isFolder = node.kind === 'folder'
    const canDrag = !readOnly && (isFolder
      || (node.kind === 'asset' && (node.assetType === 'topic' || node.assetType === 'reference')))
    const canDrop = !readOnly && node.kind !== 'asset'
    const showChildren = expanded && node.children.length > 0
    const rootAdd = node.kind === 'root'
    return (
      <div
        key={`${node.kind}:${node.id}`}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.children.length > 0 ? expanded : undefined}
        aria-selected={selected}
        tabIndex={0}
        data-testid={node.kind === 'root' ? `content-explorer-root-${node.id}` : undefined}
        data-folder-id={isFolder ? node.id : undefined}
        draggable={canDrag}
        onDragStart={event => {
          event.stopPropagation()
          startDrag(event, node)
        }}
        onDragOver={event => { if (canDrop) event.preventDefault() }}
        onDrop={event => {
          if (canDrop) {
            event.stopPropagation()
            receiveDrop(event, node.id)
          }
        }}
        onKeyDown={event => handleRowKeyDown(event, node)}
        className={`ce-row ${selected ? 'ce-row-selected' : ''}`}
        style={{ paddingInlineStart: 8 + depth * 14 }}
      >
        <div className="ce-row-main">
          <button
            type="button"
            className="ce-disclosure"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-hidden={node.children.length === 0}
            tabIndex={node.children.length === 0 ? -1 : 0}
            onClick={event => { event.stopPropagation(); toggleExpanded(node.id) }}
          >
            {node.children.length > 0 ? <Chevron expanded={expanded} /> : <span className="ce-chevron-placeholder" />}
          </button>
          {isEditing ? (
            <div className="ce-name-button">
              <span className="ce-icon" aria-hidden="true">{iconFor(node)}</span>
              <input
                autoFocus
                aria-label={`Rename ${node.name}`}
                value={folderForm?.name ?? ''}
                disabled={readOnly}
                onChange={event => setFolderForm(current => current ? { ...current, name: event.target.value } : current)}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); commitFolder() }
                  if (event.key === 'Escape') { event.preventDefault(); setFolderForm(null) }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="ce-name-button"
              data-testid={node.kind === 'asset' ? `content-explorer-item-${node.assetType}-${node.assetId}` : undefined}
              aria-current={node.kind === 'asset' && node.assetType === 'topic' && selected ? 'page' : undefined}
              onClick={() => {
                if (node.kind !== 'asset') {
                  toggleExpanded(node.id)
                  return
                }
                setSelectedAsset(`${node.assetType ?? ''}:${node.assetId ?? node.id}`)
                if (node.assetType === 'topic' && node.assetId) onOpenTopic(node.assetId)
              }}
            >
              <span className="ce-icon" aria-hidden="true">{iconFor(node)}</span>
              <span className="ce-name">{node.name}</span>
              {node.kind === 'asset' && <span className="ce-type">{node.assetType}</span>}
            </button>
          )}
          {!readOnly && node.kind !== 'asset' && (
            <div className="ce-actions">
              {isEditing && <>
                <button type="button" aria-label="Save folder name" onClick={commitFolder}>✓</button>
                <button type="button" aria-label="Cancel folder rename" onClick={() => setFolderForm(null)}>×</button>
              </>}
              {!isEditing && <>
                {rootAdd && (
                  <button
                    type="button"
                    aria-label={`New folder in ${node.name}`}
                    title={`New folder in ${node.name}`}
                    onClick={event => { event.stopPropagation(); beginNewFolder(node.id) }}
                  >+</button>
                )}
                <button
                  type="button"
                  aria-label={`Actions for ${node.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuNodeId === node.id}
                onClick={event => {
                  event.stopPropagation()
                  menuTriggerRef.current = event.currentTarget
                  setMenuNodeId(current => current === node.id ? null : node.id)
                }}
                >⋯</button>
              </>}
            </div>
          )}
          {menuNodeId === node.id && !readOnly && node.kind !== 'asset' && (
            <div
              role="menu"
              aria-label={`Actions for ${node.name}`}
              className="ce-menu"
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMenuNodeId(null)
                  menuTriggerRef.current?.focus()
                }
              }}
            >
              <button type="button" role="menuitem" autoFocus onClick={() => beginNewFolder(node.id)}>New folder</button>
              {isFolder && <>
                <button type="button" role="menuitem" onClick={() => beginRename(node)}>Rename</button>
                <button type="button" role="menuitem" onClick={() => deleteFolder(node)}>Delete empty folder</button>
              </>}
            </div>
          )}
        </div>
        {folderForm && !folderForm.renameId && folderForm.parentId === node.id && (
          <div className="ce-folder-form" style={{ paddingInlineStart: 28 }}>
            <input
              autoFocus
              aria-label="New folder name"
              placeholder="Folder name"
              value={folderForm.name}
              onChange={event => setFolderForm(current => current ? { ...current, name: event.target.value } : current)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commitFolder() }
                if (event.key === 'Escape') { event.preventDefault(); setFolderForm(null) }
              }}
            />
            <button type="button" onClick={commitFolder}>Create</button>
            <button type="button" aria-label="Cancel new folder" onClick={() => setFolderForm(null)}>Cancel</button>
          </div>
        )}
        {showChildren && <div role="group">{node.children.map(child => renderNode(child, depth + 1))}</div>}
      </div>
    )
  }

  const availableParents = [
    ...ROOTS.map(root => ({ id: root.id, name: root.name })),
    ...MEDIA_CATEGORIES.map(category => ({ id: category.id, name: `Media / ${category.name}` })),
  ]

  if (isCollapsed) {
    return (
      <aside className="content-explorer content-explorer-collapsed" data-testid="content-explorer-panel" aria-label="Content Explorer">
        <button type="button" aria-label="Expand Content Explorer" title="Expand Content Explorer" onClick={() => setCollapsed(false)}>›</button>
      </aside>
    )
  }

  return (
    <aside className="content-explorer" data-testid="content-explorer-panel" aria-label="Content Explorer">
      <header className="ce-header">
        <div className="ce-heading">
          <div>
            <p className="ce-eyebrow">PROJECT CONTENT</p>
            <h2>Content Explorer</h2>
          </div>
          <button type="button" aria-label="Collapse Content Explorer" title="Collapse Content Explorer" onClick={() => setCollapsed(true)}>‹</button>
        </div>
        <div className="ce-tools">
          <label className="ce-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Filter content"
              placeholder="Filter by name"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            {query && <button type="button" aria-label="Clear filter" onClick={() => setQuery('')}>×</button>}
          </label>
          {!readOnly && <div className="ce-add-control">
            <label>
              <span className="sr-only">New folder location</span>
              <select aria-label="New folder location" value={newFolderParent} onChange={event => setNewFolderParent(event.target.value)}>
                {availableParents.map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
              </select>
            </label>
            <button type="button" data-testid="content-explorer-new-folder" onClick={() => beginNewFolder(newFolderParent)}>+ Add</button>
          </div>}
          {canBrowseCatalog && (
            <button
              type="button"
              className="ce-reuse-action"
              data-testid="content-explorer-reuse"
              onClick={() => void openResourcePicker()}
              disabled={pickerLoading}
            >{pickerLoading ? 'Loading projects…' : '+ Add existing'}</button>
          )}
        </div>
      </header>
      {notice && <div className="ce-notice" role="status">{notice}</div>}
      <div className="ce-tree-scroll">
        <div role="tree" aria-label="Project content">
          {searchableTree.length
            ? searchableTree.map(node => renderNode(node, 0))
            : <p className="ce-empty">{query.trim() ? 'No matching content.' : 'No project content is available.'}</p>}
        </div>
      </div>
      {pickerProjects && loadCatalogItems && loadCatalogPreview && onCatalogCopy && (
        <ResourcePicker
          projects={pickerProjects}
          canCopy={canCopyCatalog}
          loadItems={loadCatalogItems}
          loadPreview={loadCatalogPreview}
          onCopy={(item, version) => onCatalogCopy(item, version, selectedTopicId)}
          onClose={() => setPickerProjects(null)}
        />
      )}
      <style>{`
        .content-explorer {
          display:flex; flex:0 0 260px; flex-direction:column; min-width:0; width:260px;
          overflow:hidden; border-right:1px solid #e1e6df; background:#fbfcfa; color:#273229;
          font: 11px/1.4 Inter,system-ui,sans-serif;
        }
        .content-explorer * { box-sizing:border-box; }
        .content-explorer button,.content-explorer input,.content-explorer select { font:inherit; }
        .content-explorer-collapsed { flex-basis:34px; width:34px; align-items:center; padding-top:10px; }
        .content-explorer-collapsed > button { border:1px solid #dce2da; border-radius:5px; background:#fff; color:#596b5b; cursor:pointer; }
        .ce-header { flex-shrink:0; padding:12px 10px 9px; border-bottom:1px solid #e7e9e4; }
        .ce-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .ce-heading h2 { margin:0; font-size:12px; line-height:1.25; font-weight:650; color:#28362c; }
        .ce-eyebrow { margin:0 0 3px; color:#848c84; font-size:8px; font-weight:650; letter-spacing:.12em; }
        .ce-heading > button { width:23px; height:23px; border:0; border-radius:4px; background:transparent; color:#6f7e70; cursor:pointer; font-size:17px!important; }
        .ce-heading > button:hover,.ce-actions button:hover { background:#eaf0e9; }
        .ce-tools { display:flex; flex-direction:column; gap:7px; margin-top:11px; }
        .ce-search { display:flex; align-items:center; gap:6px; min-width:0; height:29px; border:1px solid #dfe4dc; border-radius:5px; background:#fff; padding:0 7px; color:#7c897d; }
        .ce-search input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:#28362c; font-size:10px!important; }
        .ce-search button { border:0; background:transparent; color:#67766a; cursor:pointer; }
        .ce-add-control { display:flex; align-items:center; gap:5px; }
        .ce-add-control label { flex:1; min-width:0; }
        .ce-add-control select { width:100%; height:27px; border:1px solid #e0e4dd; border-radius:4px; background:#fff; color:#616b61; padding:0 5px; font-size:9px!important; }
        .ce-add-control > button,.ce-folder-form button { min-height:27px; border:1px solid #54745a; border-radius:4px; background:#54745a; padding:0 8px; color:white; cursor:pointer; font-size:9px!important; font-weight:600; white-space:nowrap; }
        .ce-reuse-action { min-height:27px; border:1px solid #dce2da; border-radius:4px; background:#fff; padding:0 8px; color:#435846; cursor:pointer; font-size:9px!important; font-weight:600; text-align:left; }
        .ce-reuse-action:disabled { cursor:wait; opacity:.65; }
        .ce-tree-scroll { min-height:0; flex:1; overflow:auto; padding:7px 4px 14px 0; overscroll-behavior:contain; }
        .ce-row { position:relative; min-width:0; }
        .ce-row-main { position:relative; display:flex; min-width:0; min-height:29px; align-items:center; gap:2px; border-radius:4px; padding-right:4px; }
        .ce-row-main:hover { background:#f0f3ef; }
        .ce-row-selected > .ce-row-main { background:#e8efe8; }
        .ce-disclosure { display:flex; flex:0 0 16px; width:16px; height:24px; align-items:center; justify-content:center; border:0; background:transparent; color:#778378; cursor:pointer; }
        .ce-chevron-placeholder { width:7px; }
        .ce-name-button { display:flex; flex:1; min-width:0; height:27px; align-items:center; gap:7px; overflow:hidden; border:0; background:transparent; padding:0 2px; color:#354138; text-align:left; cursor:pointer; }
        .ce-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ce-icon { display:inline-flex; flex:0 0 17px; width:17px; align-items:center; justify-content:center; color:#667a68; font-size:11px; font-weight:650; }
        .ce-type { flex-shrink:0; color:#959c94; font-size:8px; text-transform:capitalize; }
        .ce-actions { display:flex; flex:0 0 auto; gap:1px; opacity:.68; }
        .ce-actions button { width:21px; height:22px; border:0; border-radius:3px; background:transparent; color:#66776a; cursor:pointer; }
        .ce-menu { position:absolute; z-index:5; top:24px; right:4px; display:flex; min-width:142px; flex-direction:column; border:1px solid #dce2da; border-radius:5px; background:white; padding:3px; box-shadow:0 4px 14px #24332824; }
        .ce-menu button { min-height:28px; border:0; border-radius:3px; background:transparent; padding:0 8px; color:#39483c; text-align:left; cursor:pointer; }
        .ce-menu button:hover { background:#eef2ed; }
        .ce-folder-form { display:flex; align-items:center; gap:4px; padding:3px 5px 5px 23px; }
        .ce-folder-form input { flex:1; min-width:0; height:26px; border:1px solid #8ba08e; border-radius:4px; padding:0 5px; }
        .ce-folder-form button { min-height:25px; padding:0 5px; }
        .ce-folder-form button:last-child { border-color:#dce2da; background:#fff; color:#566357; }
        .ce-notice { flex-shrink:0; border-bottom:1px solid #efd2c5; background:#fff8f4; padding:7px 10px; color:#8a4534; font-size:10px; }
        .ce-empty { margin:12px 10px; color:#818980; font-size:10px; }
        .content-explorer :is(button,input,select,[role="treeitem"]):focus-visible { outline:2px solid #54745a; outline-offset:1px; }
        .content-explorer [draggable="true"] { cursor:grab; }
        .content-explorer [draggable="true"]:active { cursor:grabbing; }
        @media(max-width:1100px) {
          .content-explorer { flex-basis:220px; width:220px; }
        }
      `}</style>
    </aside>
  )
}