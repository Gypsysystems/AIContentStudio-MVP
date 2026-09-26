import React, { useCallback, useEffect, useState } from 'react'
import type { AuthorTopicMetadata } from './authorMetadata'
import {
  type CheckpointVerification, type ProjectCheckpoint, type ProjectCheckpointSummary,
} from './projectCheckpoint'
import { buildCheckpointDetail } from './checkpointDetail'
import { readValidatedCheckpointRecord } from './checkpointRecordRead'
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectMigrations'
import { buildTopicHistory, type TopicHistoryTopic } from './topicHistory'

type VerificationState =
  | { status: 'verifying'; projectId: string; integrityDigest: string }
  | { status: 'verified'; projectId: string; integrityDigest: string; result: CheckpointVerification }
  | { status: 'error'; projectId: string; integrityDigest: string; message: string }

type TopicRecordLoad = { checkpointId: string; message: string }

export type ProjectHistoryPanelProps = {
  projectId: string
  currentToc: unknown[]
  onBack: () => void
  onCreateCheckpoint: (reason: string) => Promise<ProjectCheckpointSummary>
  listCheckpoints: (projectId: string) => Promise<ProjectCheckpointSummary[]>
  getCheckpointRecord: (projectId: string, checkpointId: string) => Promise<ProjectCheckpoint | null>
  verifyCheckpoint: (projectId: string, checkpointId: string) => Promise<CheckpointVerification>
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function TopicBlock({ value, index }: { value: unknown; index: number }) {
  if (!isObject(value)) {
    return <p className="whitespace-pre-wrap text-[12px] text-[#555461]">{String(value ?? `Unsupported saved block ${index + 1}`)}</p>
  }
  const type = text(value.type)
  const content = text(value.content)
  const common = 'whitespace-pre-wrap break-words text-[12px] leading-5 text-[#353543]'
  const headingClass = `${common} font-semibold text-[#22222F]`

  if (type === 'divider') return <hr className="border-[#E3E0DA]" />
  if (type === 'h1' || type === 'h2' || type === 'h3' || type === 'h4') {
    const Tag = type
    return <Tag className={headingClass}>{content}</Tag>
  }
  if (type === 'code') return <pre className="overflow-x-auto rounded-md bg-[#F5F4F2] p-3 text-[11px] text-[#353543]"><code>{content}</code></pre>
  if (type === 'quote') return <blockquote className={`border-l-2 border-[#AAA8D8] pl-3 italic ${common}`}>{content}</blockquote>
  if (type === 'caption') return <p className={`${common} text-[11px] italic text-[#686879]`}>{content}</p>
  if (type === 'callout') {
    return <aside className="rounded-md border border-[#E3E0DA] bg-[#F8F7F5] p-3">
      {typeof value.calloutVariant === 'string' && <p className="mb-1 text-[10px] font-semibold uppercase text-[#686879]">{value.calloutVariant}</p>}
      <p className={common}>{content}</p>
    </aside>
  }
  if (type === 'table') {
    const data = isObject(value.tableData) ? value.tableData : null
    const rows = Array.isArray(data?.rows) ? data.rows : []
    return rows.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[11px]">
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>
        {Array.isArray(row) && row.map((cell, cellIndex) => {
          const Cell = rowIndex === 0 && data?.hasHeader === true ? 'th' : 'td'
          return <Cell key={cellIndex} className="border border-[#E3E0DA] px-2 py-1.5 font-normal">{text(cell)}</Cell>
        })}
      </tr>)}</tbody>
    </table></div> : <p className={`${common} text-[#777786]`}>Saved table has no rows.</p>
  }
  if (type === 'procedure') {
    const steps = Array.isArray(value.procedureSteps) ? value.procedureSteps : []
    return <div>{content && <p className={common}>{content}</p>}<ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-[#353543]">
      {steps.map((step, stepIndex) => <li key={stepIndex} className="whitespace-pre-wrap">{text(step)}</li>)}
    </ol></div>
  }
  if (type === 'list') {
    const items = Array.isArray(value.listItems) ? value.listItems : []
    return <div>{content && <p className={common}>{content}</p>}<ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-[#353543]">
      {items.map((item, itemIndex) => <li key={itemIndex} className="whitespace-pre-wrap">{isObject(item) ? text(item.text) : text(item)}</li>)}
    </ul></div>
  }
  if (type === 'media') return <div className="rounded-md border border-[#E3E0DA] bg-[#F8F7F5] p-3 text-[11px] text-[#555461]">
    <p className="font-medium">Saved media reference (not loaded)</p>
    {text(value.mediaType) && <p className="mt-1">Type: {text(value.mediaType)}</p>}
    {content && <p className="mt-1 break-all">{content}</p>}
    {text(value.caption) && <p className="mt-1 italic">{text(value.caption)}</p>}
  </div>
  if (type === 'variable') return <p className={common}>Saved variable: {content || 'No value recorded'}</p>
  if (type === 'bookmark') return <p className={common}>Saved bookmark: {content || 'No label recorded'}</p>
  return <div className="rounded-md border border-[#E3E0DA] p-3">
    <p className="mb-1 text-[10px] font-semibold uppercase text-[#777786]">{type || 'Unknown block type'}</p>
    <p className={common}>{content || 'This saved block has no plain-text content.'}</p>
  </div>
}

function MetadataDetails({ metadata }: { metadata: AuthorTopicMetadata | null }) {
  if (!metadata) return <p className="mt-3 text-[11px] text-[#777786]">No topic author metadata was recorded at this checkpoint.</p>
  const provenance = metadata.provenance
  const savedIds = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value.join(', ') || 'None recorded' : 'Unavailable in this saved record'
  const savedPaths = Array.isArray(metadata.sourcePaths)
    && metadata.sourcePaths.every(path => Array.isArray(path) && path.every(segment => typeof segment === 'string'))
    ? metadata.sourcePaths.map(path => path.join(' / ')).join('; ') || 'None recorded'
    : 'Unavailable in this saved record'
  const values: Array<[string, string]> = [
    ['Generation status', metadata.generationStatus],
    ['Content origin', metadata.contentOrigin],
    ['Generated at', metadata.generatedAt === null ? 'Not recorded' : formatDate(metadata.generatedAt)],
    ['Approved', metadata.approved ? 'Yes' : 'No'],
    ['Manually edited', metadata.manualEdited ? 'Yes' : 'No'],
    ['Sources revision', provenance.sourcesRevision === null ? 'Not recorded' : String(provenance.sourcesRevision)],
    ['Evidence extraction revision', provenance.evidenceExtractionRevision || 'Not recorded'],
    ['Evidence index built', provenance.evidenceIndexBuiltAt === null ? 'Not recorded' : formatDate(provenance.evidenceIndexBuiltAt)],
    ['Analysis revision', provenance.analysisRevision === null ? 'Not recorded' : String(provenance.analysisRevision)],
    ['TOC revision', provenance.tocRevision === null ? 'Not recorded' : String(provenance.tocRevision)],
    ['Content type', provenance.contentType || 'Not recorded'],
    ['Language', provenance.language || 'Not recorded'],
    ['Style profile', provenance.styleProfileId || 'Not recorded'],
    ['Saved source file IDs', savedIds(metadata.sourceFileIds)],
    ['Saved evidence IDs', savedIds(metadata.evidenceIds)],
    ['Saved source paths', savedPaths],
  ]
  return <><p className="mt-3 text-[10px] text-[#777786]">References are shown as saved at this checkpoint; current files and evidence are not used to resolve them.</p><dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-[10px] sm:grid-cols-2">
    {values.map(([label, value]) => <div key={label}><dt className="text-[#858391]">{label}</dt><dd className="mt-0.5 break-words text-[#444351]">{value}</dd></div>)}
  </dl></>
}

function TopicHistoryView({ topic }: { topic: TopicHistoryTopic }) {
  return <div className="mt-4 border-t border-[#ECE9E4] pt-4">
    <h3 className="text-[14px] font-semibold text-[#292936]">{topic.currentTitle || 'Deleted topic'}</h3>
    {topic.limitations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[#8A5A13]">
      {topic.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}
    </ul>}
    {topic.versions.length === 0 ? <p className="mt-3 text-[12px] text-[#777786]">{topic.limitations.length
      ? 'No supported saved versions of this topic could be shown. See the limitations above.'
      : topic.currentTitle
        ? 'This topic is in the current outline, but has no checkpointed versions yet.'
        : 'No saved versions of this topic are available.'}</p> : (
      <ol className="mt-3 space-y-3">
        {topic.versions.map(version => <li key={version.checkpointId} className="rounded-lg border border-[#E3E0DA] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-[#292936]">{version.title || 'Untitled saved topic'}{version.changed === true ? ' · Changed' : version.changed === false ? ' · Unchanged' : ''}</p>
              <p className="mt-1 text-[11px] text-[#686879]">{version.reason} · {formatDate(version.createdAt)}</p>
            </div>
            <span className="text-[10px] text-[#777786]">Checkpoint {version.checkpointId}</span>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-[10px] sm:grid-cols-3">
            <div><dt className="text-[#858391]">Actor</dt><dd className="mt-0.5 break-all text-[#444351]">{version.actorUserId || 'Unknown'}</dd></div>
            <div><dt className="text-[#858391]">Originating record revision</dt><dd className="mt-0.5 text-[#444351]">Revision {version.originatingRecordRevision}</dd></div>
            <div><dt className="text-[#858391]">Checkpoint provenance</dt><dd className="mt-0.5 text-[#444351]">Committed record</dd></div>
          </dl>
          {version.limitations.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-[#8A5A13]">
            {version.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}
          </ul>}
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#5554B8]">Saved topic content and metadata</summary>
            {version.blocks.length === 0 ? <p className="mt-3 text-[11px] text-[#777786]">No saved content blocks in this version.</p> : (
              <div className="mt-3 space-y-3">{version.blocks.map((block, index) => <TopicBlock key={isObject(block) && typeof block.id === 'string' ? block.id : index} value={block} index={index} />)}</div>
            )}
            <MetadataDetails metadata={version.metadata} />
          </details>
        </li>)}
      </ol>
    )}
  </div>
}

function CheckpointDetailView({ checkpoint, fullVerification }: {
  checkpoint: ProjectCheckpoint
  fullVerification: CheckpointVerification | null
}) {
  const detail = buildCheckpointDetail(checkpoint)
  return <section id="checkpoint-detail" data-testid="checkpoint-detail" className="mt-4 rounded-lg border border-[#E3E0DA] bg-[#FAF9F7] p-4 sm:p-5" aria-labelledby="checkpoint-detail-title">
    <h3 id="checkpoint-detail-title" className="text-[14px] font-semibold text-[#292936]">Saved checkpoint detail</h3>
    <p className="mt-1 text-[11px] leading-5 text-[#686879]">
      Saved record and manifest metadata validated. Archived file bytes were not downloaded or verified by this view.
      {fullVerification?.valid ? ' A separate full integrity verification passed.' : ' Use Verify integrity for the separate full record-and-file check.'}
    </p>
    <dl className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
      {([
        ['Saved project name', detail.projectName || 'Unavailable'],
        ['Checkpoint ID', checkpoint.checkpointId],
        ['Note', checkpoint.reason],
        ['Saved at', formatDate(checkpoint.createdAt)],
        ['Actor', checkpoint.actorUserId || 'Unknown'],
        ['Originating record revision', `Revision ${checkpoint.originatingRecordRevision}`],
        ['Saved record schema', String(checkpoint.recordSchemaVersion)],
        ['Parent checkpoint', checkpoint.parentCheckpointId || 'None (first checkpoint)'],
        ['Saved file count', String(checkpoint.files.length)],
        ['Saved record digest', checkpoint.recordDigest],
        ['Saved checkpoint digest', checkpoint.integrityDigest],
      ] as Array<[string, string]>).map(([label, value]) => <div key={label}><dt className="text-[#858391]">{label}</dt><dd className="mt-0.5 break-words text-[#444351]">{value}</dd></div>)}
    </dl>
    {detail.limitations.length > 0 && <div className="mt-4 rounded-md bg-[#FFF7E8] p-3 text-[11px] text-[#8A5A13]" role="status">
      <p className="font-semibold">Saved record limitations</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{detail.limitations.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
    </div>}
    <div className="mt-5">
      <h4 className="text-[12px] font-semibold text-[#292936]">Saved project outline and topic list</h4>
      {detail.outline === null
        ? <p className="mt-2 text-[11px] text-[#8A5A13]">This saved outline cannot be shown safely. See the limitations above.</p>
        : detail.outlineCount === 0
          ? <p className="mt-2 text-[11px] text-[#686879]">The saved project outline has no topics.</p>
          : <><p className="mt-1 text-[11px] text-[#686879]">{detail.outline.length} of {detail.outlineCount} saved outline items shown, in saved order. Titles and IDs come only from this checkpoint.</p>
            <ol className="mt-3 space-y-1.5" data-testid="saved-outline">{detail.outline.map(item => <li key={item.position} className="rounded-md border border-[#E7E4DF] bg-white px-3 py-2" style={{ marginLeft: Math.min((item.level ?? 1) - 1, 4) * 12 }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[11px] font-medium text-[#353543]">{item.position}. {item.title || 'Untitled saved topic'}</span><span className="break-all text-[10px] text-[#777786]">{item.topicId ? `Topic ID ${item.topicId}` : item.legacyNumericId !== null ? `Legacy numeric ID ${item.legacyNumericId} (no stable ID)` : 'ID unavailable'} · {item.level === null ? 'Level unavailable' : `Level ${item.level}`}</span></div>
            </li>)}</ol></>}
    </div>
    <div className="mt-5">
      <h4 className="text-[12px] font-semibold text-[#292936]">Saved file manifest</h4>
      <p className="mt-1 text-[11px] text-[#686879]">These are saved file descriptions and hashes, not current files or verified archive bytes.</p>
      {checkpoint.files.length === 0 ? <p className="mt-2 text-[11px] text-[#686879]">No files were saved in this checkpoint.</p> : <ul className="mt-3 space-y-2" data-testid="saved-file-manifest">
        {checkpoint.files.map((file, index) => <li key={`${file.fileId}-${index}`} className="rounded-md border border-[#E7E4DF] bg-white p-3 text-[11px]">
          <p className="font-medium text-[#353543]">{typeof file.name === 'string' ? file.name : 'File name unavailable'}{detail.sourceFileIds?.includes(file.fileId) && <span className="ml-2 text-[10px] font-normal text-[#686879]">Saved source</span>}</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-[10px] text-[#686879] sm:grid-cols-2">
            <div><dt className="inline font-semibold">File ID: </dt><dd className="inline break-all">{file.fileId}</dd></div>
            <div><dt className="inline font-semibold">Type: </dt><dd className="inline">{typeof file.type === 'string' && file.type ? file.type : 'Not recorded'}</dd></div>
            <div><dt className="inline font-semibold">Saved size: </dt><dd className="inline">{Number.isSafeInteger(file.size) && file.size >= 0 ? `${file.size} bytes` : 'Unavailable'}</dd></div>
            <div><dt className="inline font-semibold">Uploaded: </dt><dd className="inline">{typeof file.uploadedAt === 'number' ? formatDate(file.uploadedAt) : 'Unavailable'}</dd></div>
            <div className="sm:col-span-2"><dt className="inline font-semibold">Saved SHA-256: </dt><dd className="inline break-all">{typeof file.sha256 === 'string' ? file.sha256 : 'Unavailable'}</dd></div>
          </dl>
        </li>)}
      </ul>}
    </div>
  </section>
}

export function ProjectHistoryPanel({
  projectId, currentToc, onBack, onCreateCheckpoint, listCheckpoints, getCheckpointRecord, verifyCheckpoint,
}: ProjectHistoryPanelProps) {
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpointSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [verification, setVerification] = useState<Record<string, VerificationState>>({})
  const verificationGeneration = React.useRef(0)
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null)
  const [detailCheckpoint, setDetailCheckpoint] = useState<ProjectCheckpoint | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRetry, setDetailRetry] = useState(0)
  const detailRequestId = React.useRef(0)
  const [topicOpen, setTopicOpen] = useState(false)
  const [topicLoading, setTopicLoading] = useState(false)
  const [topicLoaded, setTopicLoaded] = useState(false)
  const [topicError, setTopicError] = useState('')
  const [topicFailures, setTopicFailures] = useState<TopicRecordLoad[]>([])
  const [topics, setTopics] = useState<TopicHistoryTopic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const listRequestId = React.useRef(0)
  const listCheckpointsRef = React.useRef(listCheckpoints)
  listCheckpointsRef.current = listCheckpoints
  const getCheckpointRecordRef = React.useRef(getCheckpointRecord)
  getCheckpointRecordRef.current = getCheckpointRecord
  const topicRequestId = React.useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++listRequestId.current
    topicRequestId.current += 1
    detailRequestId.current += 1
    verificationGeneration.current += 1
    setLoading(true)
    setLoadError('')
    setVerification({})
    setDetailCheckpoint(null)
    setDetailLoading(false)
    setDetailError('')
    setTopicLoading(false)
    setTopicLoaded(false)
    setTopics([])
    setTopicFailures([])
    setTopicError('')
    try {
      const list = await listCheckpointsRef.current(projectId)
      if (requestId !== listRequestId.current) return
      setCheckpoints(list)
      setSelectedCheckpointId(current => current && list.some(item => item.checkpointId === current) ? current : null)
    } catch (error) {
      if (requestId === listRequestId.current)
        setLoadError(`Could not load project history: ${(error as Error).message}`)
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!selectedCheckpointId || loading || loadError) return
    const summary = checkpoints.find(item => item.checkpointId === selectedCheckpointId)
    if (!summary) return
    const requestId = ++detailRequestId.current
    setDetailLoading(true)
    setDetailCheckpoint(null)
    setDetailError('')
    void readValidatedCheckpointRecord(projectId, summary, getCheckpointRecordRef.current)
      .then(checkpoint => {
        if (requestId === detailRequestId.current) setDetailCheckpoint(checkpoint)
      })
      .catch(error => {
        if (requestId === detailRequestId.current)
          setDetailError(`Could not inspect saved checkpoint: ${(error as Error).message}`)
      })
      .finally(() => {
        if (requestId === detailRequestId.current) setDetailLoading(false)
      })
    return () => { detailRequestId.current += 1 }
  }, [selectedCheckpointId, checkpoints, loading, loadError, projectId, detailRetry])

  const loadTopicHistory = async () => {
    const requestId = ++topicRequestId.current
    setTopicLoading(true)
    setTopicError('')
    setTopicFailures([])
    try {
      const results = await Promise.all(checkpoints.map(async summary => {
        try {
          const checkpoint = await readValidatedCheckpointRecord(projectId, summary, getCheckpointRecordRef.current)
          return { checkpoint, failure: null }
        } catch (error) {
          return { checkpoint: null, failure: { checkpointId: summary.checkpointId, message: (error as Error).message || 'Could not read committed checkpoint record.' } }
        }
      }))
      if (requestId !== topicRequestId.current) return
      const records = results.flatMap(result => result.checkpoint ? [result.checkpoint] : [])
      const failures = results.flatMap(result => result.failure ? [result.failure] : [])
      const unsupported = records.flatMap(checkpoint => {
        const record = checkpoint.record
        if (record.schemaVersion === CURRENT_PROJECT_SCHEMA_VERSION
          && Array.isArray(record.appToc)
          && record.topicContent && typeof record.topicContent === 'object'
          && record.authorTopicMetadata && typeof record.authorTopicMetadata === 'object') return []
        return [{
          checkpointId: checkpoint.checkpointId,
          message: `Saved project schema or topic record shape is unsupported; no content was inferred from this checkpoint.`,
        }]
      })
      setTopicFailures([...failures, ...unsupported])
      const history = buildTopicHistory(records, currentToc, checkpoints)
      setTopics(history)
      setSelectedTopicId(current => current && history.some(topic => topic.topicId === current)
        ? current : (history[0]?.topicId || ''))
    } catch (error) {
      if (requestId === topicRequestId.current)
        setTopicError(`Could not build topic history: ${(error as Error).message}`)
    } finally {
      if (requestId === topicRequestId.current) {
        setTopicLoaded(true)
        setTopicLoading(false)
      }
    }
  }

  const openTopicHistory = () => {
    setTopicOpen(true)
  }

  useEffect(() => {
    if (topicOpen && !loading && !loadError && !topicLoading && !topicLoaded)
      void loadTopicHistory()
  }, [topicOpen, loading, loadError, topicLoading, topicLoaded, checkpoints, currentToc])

  const createCheckpoint = async () => {
    setCreateError('')
    setCreating(true)
    try {
      await onCreateCheckpoint(reason)
      setReason('')
      await refresh()
    } catch (error) {
      setCreateError(`Could not create checkpoint: ${(error as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  const verify = async (checkpointId: string) => {
    const summary = checkpoints.find(item => item.checkpointId === checkpointId)
    if (!summary) return
    const generation = verificationGeneration.current
    const identity = { projectId, integrityDigest: summary.integrityDigest }
    setVerification(current => ({ ...current, [checkpointId]: { status: 'verifying', ...identity } }))
    try {
      const result = await verifyCheckpoint(projectId, checkpointId)
      if (generation === verificationGeneration.current)
        setVerification(current => ({ ...current, [checkpointId]: { status: 'verified', result, ...identity } }))
    } catch (error) {
      if (generation === verificationGeneration.current)
        setVerification(current => ({ ...current, [checkpointId]: { status: 'error', message: (error as Error).message, ...identity } }))
    }
  }

  const selectedTopic = topics.find(topic => topic.topicId === selectedTopicId)

  return (
    <section className="min-h-0 w-full flex-1 overflow-y-auto px-4 py-7 sm:px-7 sm:py-10" data-testid="project-history" aria-labelledby="project-history-title">
      <div className="mx-auto max-w-5xl">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <button type="button" onClick={onBack} className="mb-3 rounded text-[12px] font-medium text-[#5958B8] hover:text-[#38378E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">
            <span aria-hidden="true">← </span>Back to project
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#777786]">Project record</p>
          <h1 id="project-history-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#171722]">History</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[#686879]">Review saved project checkpoints, their origin, and integrity status.</p>
        </div>
      </div>

      <section className="mb-7 rounded-xl border border-[#E3E0DA] bg-white p-5 shadow-sm sm:p-6" aria-labelledby="checkpoint-create-title">
        <div className="max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#777786]">Saved snapshot</p>
          <h2 id="checkpoint-create-title" className="mt-1 text-[17px] font-semibold text-[#22222F]">Create a checkpoint</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#686879]">A checkpoint records the currently persisted project and its files. Add a short note to identify why it was saved.</p>
          <label htmlFor="history-checkpoint-reason" className="mt-4 block text-[11px] font-medium text-[#353543]">Checkpoint note <span className="font-normal text-[#777786]">(required, up to 200 characters)</span></label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input id="history-checkpoint-reason" value={reason} maxLength={200} onChange={event => setReason(event.target.value)} placeholder="For example, approved content before release" className="min-h-10 min-w-0 flex-1 rounded-md border border-[#D8D5CF] bg-white px-3 text-[12px] text-[#22222F] outline-none placeholder:text-[#9694A0] focus:border-[#7775D6] focus:ring-2 focus:ring-[#7775D6]/20" />
            <button type="button" disabled={creating || !reason.trim()} onClick={() => void createCheckpoint()} className="min-h-10 rounded-md bg-[#5554B8] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#45449E] disabled:cursor-not-allowed disabled:bg-[#AAA9C8]">{creating ? 'Saving checkpoint…' : 'Create checkpoint'}</button>
          </div>
          {creating && <p className="mt-2 text-[11px] text-[#686879]" role="status">Settling project saves and capturing the latest persisted state…</p>}
          {createError && <p className="mt-3 text-[12px] text-[#B42318]" role="alert">{createError}</p>}
        </div>
      </section>

      <section className="mb-7 rounded-xl border border-[#E3E0DA] bg-white shadow-sm" aria-labelledby="topic-history-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECE9E4] px-5 py-4 sm:px-6">
          <div>
            <h2 id="topic-history-title" className="text-[15px] font-semibold text-[#22222F]">Topic history</h2>
            <p className="mt-0.5 text-[11px] text-[#777786]">Read-only versions derived from committed checkpoint records.</p>
          </div>
          <button type="button" onClick={() => topicOpen ? setTopicOpen(false) : openTopicHistory()} className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[11px] font-medium text-[#41414F] hover:bg-[#F8F7F5]">
            {topicOpen ? 'Close topic history' : 'Open topic history'}
          </button>
        </div>
        {topicOpen && <div className="px-5 py-4 sm:px-6">
          <p className="mb-3 rounded-md bg-[#F8F7F5] px-3 py-2 text-[11px] leading-5 text-[#686879]">
            Topic versions show checkpoint-record content and metadata only. Reading metadata does not verify archived file bytes. Use <strong>Verify integrity</strong> in Checkpoints for the full record-and-file integrity check.
          </p>
          {!loading && checkpoints.length === 0 && !loadError && <p className="mb-3 text-[11px] text-[#686879]">No checkpoints yet. Current topics have no saved history.</p>}
          {topicLoading ? <p className="py-5 text-center text-[12px] text-[#777786]" role="status">Loading committed checkpoint records…</p> : null}
          {topicError && <p className="mb-3 rounded-md bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B42318]" role="alert">{topicError}<button type="button" onClick={() => void loadTopicHistory()} className="ml-2 underline">Retry</button></p>}
          {!topicLoading && topicFailures.length > 0 && <div className="mb-3 rounded-md bg-[#FFF7E8] px-3 py-2 text-[11px] text-[#8A5A13]" role="status">
            <p className="font-semibold">Some checkpoint records could not be read; topic history may be incomplete.</p>
            <ul className="mt-1 list-disc pl-5">{topicFailures.map(failure => <li key={failure.checkpointId}>Checkpoint {failure.checkpointId}: {failure.message}</li>)}</ul>
            <button type="button" onClick={() => void loadTopicHistory()} className="mt-2 underline">Retry checkpoint record loading</button>
          </div>}
          {!topicLoading && !topicError && topics.length === 0 && topicFailures.length === 0 && <div className="py-5 text-center">
            <p className="text-[12px] text-[#777786]">No topic history is available. Topics without checkpoint provenance are not shown.</p>
            {checkpoints.length > 0 && <p className="mt-2 text-[11px] text-[#8A5A13]">Checkpoint records were read, but they contain no topic history supported by this view. No live project content was substituted.</p>}
          </div>}
          {!topicLoading && topics.length > 0 && <div>
            <label htmlFor="history-topic-selector" className="mb-1.5 block text-[11px] font-medium text-[#353543]">Topic</label>
            <select id="history-topic-selector" value={selectedTopicId} onChange={event => setSelectedTopicId(event.target.value)} className="min-h-10 w-full rounded-md border border-[#D8D5CF] bg-white px-3 text-[12px] text-[#22222F] outline-none focus:border-[#7775D6] focus:ring-2 focus:ring-[#7775D6]/20 sm:max-w-lg">
              {topics.map(topic => <option key={topic.topicId} value={topic.topicId}>{topic.currentTitle || 'Deleted topic'}{!topic.currentTitle ? ' (deleted)' : ''}</option>)}
            </select>
            {selectedTopic && <TopicHistoryView topic={selectedTopic} />}
          </div>}
        </div>}
      </section>

      <section className="rounded-xl border border-[#E3E0DA] bg-white shadow-sm" aria-labelledby="history-list-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECE9E4] px-5 py-4 sm:px-6">
          <div>
            <h2 id="history-list-title" className="text-[15px] font-semibold text-[#22222F]">Checkpoints</h2>
            <p className="mt-0.5 text-[11px] text-[#777786]">Integrity is checked against the saved record and checkpoint files.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[11px] font-medium text-[#41414F] hover:bg-[#F8F7F5] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {loadError && <p className="m-5 rounded-md bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B42318]" role="alert">{loadError}</p>}
        {loading ? <p className="px-6 py-10 text-center text-[12px] text-[#777786]" role="status">Loading checkpoints…</p> : !loadError && checkpoints.length === 0 ? (
          <div className="px-6 py-10 text-center"><p className="text-[13px] font-medium text-[#353543]">No checkpoints yet</p><p className="mt-1 text-[11px] text-[#777786]">Create a checkpoint to preserve a named, verifiable project state.</p></div>
        ) : <ol className="divide-y divide-[#ECE9E4]">
          {checkpoints.map(checkpoint => {
             const state = verification[checkpoint.checkpointId]
             const checked = state?.projectId === projectId && state.integrityDigest === checkpoint.integrityDigest ? state : undefined
            const result = checked?.status === 'verified' ? checked.result : null
            return <li key={checkpoint.checkpointId} className="px-5 py-4 sm:px-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0"><p className="break-words text-[13px] font-semibold text-[#292936]">{checkpoint.reason}</p><time className="mt-1 block text-[11px] text-[#777786]">{formatDate(checkpoint.createdAt)}</time></div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ${!checked || checked.status === 'verifying' || checked.status === 'error' ? 'bg-[#F1F0ED] text-[#666572]' : result?.valid ? 'bg-[#E8F4EB] text-[#347348]' : 'bg-[#FDECEC] text-[#A52A2A]'}`}>
                  {!checked ? 'Integrity not verified' : checked.status === 'verifying' ? 'Verifying…' : checked.status === 'error' ? 'Could not verify' : result?.valid ? 'Integrity verified' : 'Integrity issue'}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-[#858391]">Actor</dt><dd className="mt-0.5 break-all text-[#444351]">{checkpoint.actorUserId || 'Unknown'}</dd></div>
                <div><dt className="text-[#858391]">Originating revision</dt><dd className="mt-0.5 text-[#444351]">Revision {checkpoint.originatingRecordRevision}</dd></div>
                <div><dt className="text-[#858391]">Parent checkpoint</dt><dd className="mt-0.5 break-all text-[#444351]">{checkpoint.parentCheckpointId || 'None (first checkpoint)'}</dd></div>
                <div><dt className="text-[#858391]">Restore</dt><dd className="mt-0.5 text-[#444351]">Not yet available</dd></div>
              </dl>
              {checked?.status === 'error' && <p className="mt-3 text-[11px] text-[#A52A2A]" role="alert">Verification could not be completed: {checked.message}</p>}
              {result && !result.valid && result.issues.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-[#A52A2A]" aria-label="Integrity issues">{result.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}
               <div className="mt-3 flex flex-wrap gap-2">
                 <button type="button" aria-expanded={selectedCheckpointId === checkpoint.checkpointId} aria-controls="checkpoint-detail" onClick={() => setSelectedCheckpointId(current => current === checkpoint.checkpointId ? null : checkpoint.checkpointId)} className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[10px] font-semibold text-[#41414F] hover:bg-[#F8F7F5]">{selectedCheckpointId === checkpoint.checkpointId ? 'Close saved detail' : 'Inspect saved checkpoint'}</button>
                 <button type="button" disabled={checked?.status === 'verifying'} onClick={() => void verify(checkpoint.checkpointId)} className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[10px] font-semibold text-[#41414F] hover:bg-[#F8F7F5] disabled:opacity-50">{checked?.status === 'verifying' ? 'Verifying…' : result ? 'Verify again' : 'Verify integrity'}</button>
               </div>
               {selectedCheckpointId === checkpoint.checkpointId && !loading && !loadError && <>
                 {detailLoading && <p className="mt-4 text-[11px] text-[#686879]" role="status">Checking saved record and manifest metadata…</p>}
                 {detailError && <p className="mt-4 rounded-md bg-[#FEF2F2] p-3 text-[11px] text-[#B42318]" role="alert">{detailError} <button type="button" onClick={() => setDetailRetry(current => current + 1)} className="underline">Retry saved detail</button></p>}
                 {!detailLoading && detailCheckpoint?.checkpointId === checkpoint.checkpointId && detailCheckpoint.projectId === projectId && <CheckpointDetailView checkpoint={detailCheckpoint} fullVerification={result} />}
               </>}
            </li>
          })}
        </ol>}
      </section>
      </div>
    </section>
  )
}