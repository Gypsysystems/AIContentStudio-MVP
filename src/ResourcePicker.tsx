import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import './ResourcePicker.css'

export type ResourcePickerItem = {
  itemId: string
  projectId: string
  assetType: 'topic' | 'snippet' | 'variable' | 'condition'
  displayName: string
  currentVersion: number
  updatedAt: string
}

export type ResourcePickerSourceProject = {
  projectId: string
  projectName: string
}

export type ResourcePickerPreview = {
  item: ResourcePickerItem
  version: { version: number; payload: Record<string, unknown> }
}

export type ResourcePickerProps = {
  projects: ResourcePickerSourceProject[]
  canCopy: boolean
  loadItems: (filters: {
    projectId?: string
    assetType?: ResourcePickerItem['assetType']
    search?: string
    limit: number
    offset: number
  }) => Promise<ResourcePickerItem[]>
  loadPreview: (item: ResourcePickerItem) => Promise<ResourcePickerPreview>
  onCopy: (item: ResourcePickerItem, version: number) => Promise<void>
  onClose: () => void
}

const PAGE_SIZE = 50
const TYPES: Array<ResourcePickerItem['assetType']> = ['topic', 'snippet', 'variable', 'condition']

function messageFrom(error: unknown): string {
  if (error && typeof error === 'object') {
    const detail = error as { message?: unknown; error?: unknown; dependencySummary?: unknown; dependencies?: unknown }
    const summary = safeText(detail.dependencySummary, 500)
    const dependencies = Array.isArray(detail.dependencies)
      ? detail.dependencies.map(value => safeText(value, 120)).filter((value): value is string => value !== null).join(', ')
      : null
    const base = safeText(error instanceof Error ? error.message : detail.message ?? detail.error, 1000)
    if (base && summary) return `${base} Dependency summary: ${summary}`
    if (base && dependencies) return `${base} Dependencies: ${dependencies}`
    if (base) return base
  }
  return 'The request could not be completed. Try again.'
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function safeText(value: unknown, max = 1200): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null
  const text = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function summarizeBlockValue(value: unknown, max = 220, depth = 0): string {
  if (depth > 4) return ''
  const direct = safeText(value, max)
  if (direct !== null) return direct
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(entry => summarizeBlockValue(entry, max, depth + 1)).filter(Boolean).join(' · ')
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const textKeys = ['text', 'content', 'value', 'title', 'label', 'children', 'items', 'cells', 'rows']
  return textKeys
    .filter(key => key in record)
    .map(key => summarizeBlockValue(record[key], max, depth + 1))
    .filter(Boolean)
    .join(' · ')
    .slice(0, max)
}

function summarizeTopicBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const maxBlocks = 6
  const maxTotal = 1100
  let total = 0
  const lines = value.slice(0, maxBlocks).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const block = entry as Record<string, unknown>
    const kind = safeText(block.type ?? block.kind ?? block.blockType, 32)?.toLowerCase() ?? 'content'
    const tableData = block.tableData && typeof block.tableData === 'object' && !Array.isArray(block.tableData)
      ? block.tableData as Record<string, unknown>
      : null
    const tableRows = tableData?.rows ?? block.rows
    const listItems = block.listItems ?? block.items
    const isTable = kind.includes('table') || !!tableData
    const isList = kind.includes('list') || Array.isArray(block.listItems)
    let content = summarizeBlockValue(
      isTable ? tableRows ?? block.content ?? block.text
        : isList ? listItems ?? block.content ?? block.text
          : block.text ?? block.content ?? block.title ?? block.label ?? block.body,
      260,
    )
    if (!content) {
      if (isTable) {
        const rows = Array.isArray(tableRows) ? tableRows.length : 0
        content = rows ? `Table · ${rows} row${rows === 1 ? '' : 's'}` : ''
      } else if (isList) {
        const count = Array.isArray(listItems) ? listItems.length : 0
        content = count ? `List · ${count} item${count === 1 ? '' : 's'}` : ''
      }
    }
    if (!content || total >= maxTotal) return []
    const remaining = maxTotal - total
    const clipped = content.length > remaining ? `${content.slice(0, remaining)}…` : content
    total += clipped.length
    const label = isTable ? 'Table' : isList ? 'List' : `Block ${index + 1}`
    return [`${label}: ${clipped}`]
  })
  const remainingBlocks = Math.max(0, value.length - maxBlocks)
  if (remainingBlocks && total < maxTotal) lines.push(`+ ${remainingBlocks} more block${remainingBlocks === 1 ? '' : 's'}`)
  return lines.join('\n')
}

function previewFields(type: ResourcePickerItem['assetType'], payload: Record<string, unknown>) {
  const preferred: Record<ResourcePickerItem['assetType'], string[]> = {
    topic: ['title', 'name', 'summary', 'description', 'blocks'],
    snippet: ['name', 'content', 'text', 'description'],
    variable: ['name', 'value', 'type', 'description'],
    condition: ['name', 'label', 'group', 'tags', 'expression', 'description', 'rules'],
  }
  const seen = new Set<string>()
  const fields: Array<{ label: string; value: string }> = []
  for (const key of preferred[type]) {
    if (!(key in payload) || seen.has(key)) continue
    seen.add(key)
    if (type === 'topic' && key === 'blocks') {
      const summary = summarizeTopicBlocks(payload.blocks)
      if (summary) fields.push({ label: 'blocks', value: summary })
      if (fields.length === 4) break
      continue
    }
    const value = safeText(payload[key])
    if (type === 'condition' && key === 'tags' && Array.isArray(payload.tags)) {
      const tags = payload.tags
        .slice(0, 8)
        .map(tag => safeText(tag, 80))
        .filter((tag): tag is string => tag !== null)
      const remainder = payload.tags.length - tags.length
      if (remainder > 0) tags.push(`+ ${remainder} more`)
      if (tags.length) fields.push({ label: 'tags', value: tags.join(' · ') })
    } else if (value !== null) fields.push({ label: key, value })
    else if (Array.isArray(payload[key]) || (payload[key] && typeof payload[key] === 'object')) {
      try {
        const compact = JSON.stringify(payload[key])
        if (compact) fields.push({ label: key, value: compact.length > 1200 ? `${compact.slice(0, 1200)}…` : compact })
      } catch { /* Unserializable content is omitted from the preview. */ }
    }
      if (fields.length === 4) break
  }
  return fields
}

export function ResourcePicker({
  projects,
  canCopy,
  loadItems,
  loadPreview,
  onCopy,
  onClose,
}: ResourcePickerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const searchId = useId()
  const projectFilterId = useId()
  const typeFilterId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const initialFocusRef = useRef<HTMLElement | null>(null)
  const requestId = useRef(0)
  const previewRequestId = useRef(0)
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [assetType, setAssetType] = useState('')
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<ResourcePickerItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<ResourcePickerItem | null>(null)
  const [preview, setPreview] = useState<ResourcePickerPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)

  const projectNames = useMemo(
    () => new Map(projects.map(project => [project.projectId, project.projectName])),
    [projects],
  )

  useEffect(() => {
    initialFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      initialFocusRef.current?.focus()
    }
  }, [])

  const fetchItems = useCallback(async () => {
    const currentRequest = ++requestId.current
    previewRequestId.current += 1
    setListLoading(true)
    setListError('')
    setItems([])
    setSelected(null)
    setPreview(null)
    setPreviewError('')
    setCopyError('')
    setCopySuccess(false)
    try {
      const result = await loadItems({
        ...(projectId ? { projectId } : {}),
        ...(assetType ? { assetType: assetType as ResourcePickerItem['assetType'] } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (currentRequest === requestId.current) setItems(result)
    } catch (error) {
      if (currentRequest === requestId.current) setListError(messageFrom(error))
    } finally {
      if (currentRequest === requestId.current) setListLoading(false)
    }
  }, [assetType, loadItems, page, projectId, search])

  useEffect(() => {
    void fetchItems()
    return () => { requestId.current += 1 }
  }, [fetchItems])

  const chooseItem = async (item: ResourcePickerItem) => {
    setSelected(item)
    setPreview(null)
    setPreviewError('')
    setCopyError('')
    setCopySuccess(false)
    setPreviewLoading(true)
    const currentRequest = ++previewRequestId.current
    try {
      const result = await loadPreview(item)
      if (currentRequest !== previewRequestId.current) return
      if (result.item.itemId !== item.itemId || result.version.version !== item.currentVersion) {
        throw new Error('The current version changed. Refresh the list and select this item again.')
      }
      setPreview(result)
    } catch (error) {
      if (currentRequest === previewRequestId.current) setPreviewError(messageFrom(error))
    } finally {
      if (currentRequest === previewRequestId.current) setPreviewLoading(false)
    }
  }

  const close = useCallback(() => {
    if (!copyLoading) onClose()
  }, [copyLoading, onClose])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!copyLoading) close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getAttribute('aria-hidden') !== 'true')
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  const copySelected = async () => {
    if (!selected || !preview || !canCopy || copyLoading || preview.version.version !== selected.currentVersion) return
    setCopyLoading(true)
    setCopyError('')
    setCopySuccess(false)
    try {
      await onCopy(selected, preview.version.version)
      setCopySuccess(true)
    } catch (error) {
      setCopyError(messageFrom(error))
    } finally {
      setCopyLoading(false)
    }
  }

  const fields = selected && preview ? previewFields(selected.assetType, preview.version.payload) : []
  const rangeStart = items.length ? page * PAGE_SIZE + 1 : 0
  const rangeEnd = page * PAGE_SIZE + items.length

  return (
    <div className="rp-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !copyLoading) close() }}>
      <section
        ref={dialogRef}
        className="rp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="rp-header">
          <div className="rp-heading">
            <span className="rp-mark" aria-hidden="true">↗</span>
            <div>
              <p className="rp-eyebrow">CONTENT STUDIO <span>·</span> CROSS-PROJECT</p>
              <h2 id={titleId}>Reuse content</h2>
              <p id={descriptionId}>Browse active projects and bring a current version into this project.</p>
            </div>
          </div>
          <button type="button" className="rp-close" aria-label="Close resource picker" disabled={copyLoading} onClick={close}>×</button>
        </header>

        <div className="rp-filters">
          <label className="rp-search" htmlFor={searchId}>
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              placeholder="Search reusable content"
              value={search}
              onChange={event => { setSearch(event.target.value); setPage(0) }}
            />
            {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); setPage(0); searchRef.current?.focus() }}>×</button>}
          </label>
          <label className="rp-filter">
            <span className="rp-filter-label">PROJECT</span>
            <select id={projectFilterId} aria-label="Filter by source project" value={projectId} onChange={event => { setProjectId(event.target.value); setPage(0) }}>
              <option value="">All active projects</option>
              {projects.map(project => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
            </select>
          </label>
          <label className="rp-filter rp-type-filter">
            <span className="rp-filter-label">TYPE</span>
            <select id={typeFilterId} aria-label="Filter by content type" value={assetType} onChange={event => { setAssetType(event.target.value); setPage(0) }}>
              <option value="">All types</option>
              {TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        </div>

        <main className="rp-main">
          <section className="rp-results" aria-label="Reusable content results" aria-busy={listLoading}>
            <div className="rp-list-head">
              <span>CONTENT</span><span>TYPE</span><span>SOURCE PROJECT</span><span>VERSION</span><span>MODIFIED</span>
            </div>
            {listLoading ? (
              <div className="rp-loading" role="status" aria-label="Loading reusable content">
                {[0, 1, 2, 3, 4].map(index => <div className="rp-skeleton" key={index}><i /><i /><i /></div>)}
              </div>
            ) : listError ? (
              <div className="rp-state rp-state-error" role="alert">
                <span className="rp-state-symbol" aria-hidden="true">!</span>
                <strong>Couldn’t load content</strong><p>{listError}</p>
                <button type="button" className="rp-secondary-button" onClick={() => void fetchItems()}>Try again</button>
              </div>
            ) : items.length === 0 ? (
              <div className="rp-state">
                <span className="rp-state-symbol rp-empty-symbol" aria-hidden="true">⌕</span>
                <strong>No reusable content found</strong>
                <p>Try another search or filter. Only active projects are shown.</p>
              </div>
            ) : (
              <div className="rp-item-list" role="listbox" aria-label="Choose content to preview">
                {items.map(item => {
                  const isSelected = selected?.itemId === item.itemId
                  return (
                    <button
                      key={item.itemId}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`rp-item ${isSelected ? 'rp-item-selected' : ''}`}
                      onClick={() => void chooseItem(item)}
                    >
                      <span className="rp-item-name"><span className={`rp-type-mark rp-type-${item.assetType}`} aria-hidden="true">{item.assetType === 'topic' ? '¶' : item.assetType === 'snippet' ? '▤' : item.assetType === 'variable' ? '{·}' : '◇'}</span><strong title={item.displayName}>{item.displayName}</strong></span>
                      <span className="rp-item-type">{item.assetType}</span>
                      <span className="rp-item-project" title={projectNames.get(item.projectId) ?? item.projectId}>{projectNames.get(item.projectId) ?? 'Project unavailable'}</span>
                      <span className="rp-item-version">v{item.currentVersion}</span>
                      <time className="rp-item-date" dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                    </button>
                  )
                })}
              </div>
            )}
            <footer className="rp-pagination">
              <span>{listLoading ? 'Loading…' : items.length ? `${rangeStart}–${rangeEnd} items` : '0 items'}</span>
              <div>
                <button type="button" className="rp-page-button" disabled={page === 0 || listLoading} onClick={() => setPage(current => Math.max(0, current - 1))}>← Previous</button>
                <span className="rp-page-number">Page {page + 1}</span>
                <button type="button" className="rp-page-button" disabled={items.length < PAGE_SIZE || listLoading} onClick={() => setPage(current => current + 1)}>Next →</button>
              </div>
            </footer>
          </section>

          <aside className="rp-preview" aria-label="Selected content preview" aria-live="polite" aria-busy={previewLoading}>
            <div className="rp-preview-heading">
              <div><p className="rp-eyebrow">READ-ONLY PREVIEW</p><h3>{selected?.displayName ?? 'Select an item'}</h3></div>
              {selected && <span className="rp-version-pill">v{selected.currentVersion}</span>}
            </div>
            {!selected ? (
              <div className="rp-preview-empty"><span aria-hidden="true">↖</span><p>Choose an item to inspect its current version before copying.</p></div>
            ) : previewLoading ? (
              <div className="rp-preview-skeleton" role="status">Loading selected version…<i /><i /><i /></div>
            ) : previewError ? (
              <div className="rp-preview-error" role="alert"><strong>Preview unavailable</strong><p>{previewError}</p><button type="button" className="rp-secondary-button" onClick={() => void chooseItem(selected)}>Retry preview</button></div>
            ) : preview ? (
              <>
                <div className="rp-preview-meta"><span>{selected.assetType}</span><span>From {projectNames.get(selected.projectId) ?? selected.projectId}</span></div>
                <div className="rp-preview-content">
                  {fields.length ? fields.map(field => (
                    <div className="rp-preview-field" key={field.label}>
                      <span>{field.label}</span>
                      <p>{field.value}</p>
                    </div>
                  )) : <p className="rp-no-preview">No concise preview fields are available for this item.</p>}
                </div>
                <p className="rp-current-note">Previewing exact current version <strong>v{preview.version.version}</strong></p>
              </>
            ) : null}
          </aside>
        </main>

        <footer className="rp-footer">
          <div className="rp-copy-feedback" aria-live="polite">
            {!canCopy && <span className="rp-viewer-note">View-only access · copying is unavailable</span>}
            {copyError && <span className="rp-copy-error" role="alert">{copyError}</span>}
            {copySuccess && <span className="rp-copy-success" role="status">Copied into this project.</span>}
          </div>
          <div className="rp-footer-actions">
            <button type="button" className="rp-cancel-button" disabled={copyLoading} onClick={close}>Close</button>
            <button
              type="button"
              className="rp-copy-button"
              disabled={!canCopy || !selected || !preview || previewLoading || copyLoading || !!previewError}
              onClick={() => void copySelected()}
            >{copyLoading ? 'Copying…' : 'Copy to this project'}<span aria-hidden="true">→</span></button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default ResourcePicker