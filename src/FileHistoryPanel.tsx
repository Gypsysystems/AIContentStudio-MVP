import { useEffect, useRef, useState } from 'react'
import type { ProjectCheckpoint, ProjectCheckpointSummary } from './projectCheckpoint'
import { listedFileIds, loadProjectFileHistory, type FileHistoryEntry } from './fileHistory'

type Props = {
  projectId: string
  checkpoints: ProjectCheckpointSummary[]
  listLoading: boolean
  listError: string
  getCheckpointRecord: (projectId: string, checkpointId: string) => Promise<ProjectCheckpoint | null>
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

export function FileHistoryPanel({ projectId, checkpoints, listLoading, listError, getCheckpointRecord }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [loaded, setLoaded] = useState<{
    projectId: string; fileId: string; list: ProjectCheckpointSummary[]; entries: FileHistoryEntry[]
  } | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const getRecordRef = useRef(getCheckpointRecord)
  getRecordRef.current = getCheckpointRecord
  const fileIds = listedFileIds(projectId, checkpoints)
  const activeId = fileIds.includes(selectedId) ? selectedId : ''
  const entries = !listLoading && !listError && loaded?.projectId === projectId && loaded.fileId === activeId
    && loaded.list === checkpoints ? loaded.entries : null

  useEffect(() => {
    if (!activeId || listLoading || listError) {
      setLoaded(null)
      setReading(false)
      setError('')
      return
    }
    let active = true
    setLoaded(null)
    setReading(true)
    setError('')
    void loadProjectFileHistory(projectId, activeId, checkpoints, (id, checkpointId) =>
      getRecordRef.current(id, checkpointId))
      .then(result => {
        if (active) setLoaded({ projectId, fileId: activeId, list: checkpoints, entries: result })
      })
      .catch(cause => {
        if (active) setError(`Could not load file history: ${(cause as Error).message}`)
      })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [projectId, activeId, checkpoints, listLoading, listError])

  return <section className="mb-7 rounded-xl border border-[#E3E0DA] bg-white shadow-sm" aria-labelledby="file-history-title" data-testid="file-history">
    <div className="border-b border-[#ECE9E4] px-5 py-4 sm:px-6">
      <h2 id="file-history-title" className="text-[15px] font-semibold text-[#22222F]">File history</h2>
      <p className="mt-0.5 text-[11px] text-[#777786]">Read-only file presence and saved hashes from committed checkpoints. No current files or archived bytes are read.</p>
    </div>
    <div className="px-5 py-4 sm:px-6">
      {!listLoading && !listError && <div>
        <label htmlFor="history-file-selector" className="mb-1.5 block text-[11px] font-medium text-[#353543]">Saved file ID</label>
        <select id="history-file-selector" value={activeId} disabled={fileIds.length === 0}
          onChange={event => setSelectedId(event.target.value)}
          className="min-h-10 w-full rounded-md border border-[#D8D5CF] bg-white px-3 text-[12px] text-[#22222F] outline-none focus:border-[#7775D6] focus:ring-2 focus:ring-[#7775D6]/20 disabled:opacity-60 sm:max-w-lg">
          <option value="">Select a saved file ID</option>
          {fileIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        {fileIds.length === 0 && <p className="mt-2 text-[11px] text-[#777786]">
          No stable file IDs are listed in these checkpoint manifests. Legacy or unreadable file entries cannot be selected.
        </p>}
      </div>}
      {activeId && <div className="mt-4" aria-live="polite">
        <p className="text-[11px] leading-5 text-[#686879]">
          Known presence and hashes come only from validated saved records and manifests. Unknown rows may show unvalidated checkpoint-list metadata.
          Presence and SHA-256 do not verify archived file bytes.
          A missing checkpoint or broken ancestry is unknown; no changes are inferred across gaps. Use Verify integrity in Checkpoints for a separate full file check.
        </p>
        {reading && <p className="mt-3 text-[11px] text-[#686879]" role="status">Reading authorized checkpoint metadata…</p>}
        {error && <p className="mt-3 text-[11px] text-[#B42318]" role="alert">{error}</p>}
        {entries && <ol className="mt-4 space-y-2" data-testid="file-history-timeline">{entries.map((entry, index) => <li
          key={`${entry.checkpointId}-${index}`} className="rounded-md border border-[#E7E4DF] bg-[#FAF9F7] p-3 text-[11px]" data-testid="file-history-entry">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-semibold text-[#292936]">{entry.reason || 'Checkpoint without a note'}</p>
            <span className={`font-semibold ${entry.status === 'unknown' ? 'text-[#8A5A13]' : 'text-[#444351]'}`}>
              {entry.status === 'present' ? 'Present' : entry.status === 'absent' ? 'Absent' : 'Unknown'}
            </span>
          </div>
          <p className="mt-1 break-all text-[10px] text-[#686879]">Checkpoint {entry.checkpointId} · {formatDate(entry.createdAt)} · Actor {entry.actorUserId || 'Unknown'} · Revision {entry.originatingRecordRevision}</p>
          {entry.status === 'present' && <div className="mt-2 text-[10px] text-[#444351]">
            {entry.name && <p>Saved name: {entry.name}</p>}
            <p className="break-all">Saved SHA-256: {entry.sha256}</p>
          </div>}
          {entry.status === 'absent' && <p className="mt-2 text-[10px] text-[#686879]">Not in this saved file manifest.</p>}
          {entry.issue && <p className="mt-2 text-[10px] text-[#8A5A13]">Presence unknown: {entry.issue}</p>}
          {entry.ancestryIssue && <p className="mt-2 text-[10px] text-[#8A5A13]">Ancestry unknown: {entry.ancestryIssue}</p>}
        </li>)}</ol>}
      </div>}
    </div>
  </section>
}