import React, { useCallback, useEffect, useState } from 'react'
import type { CheckpointVerification, ProjectCheckpointSummary } from './projectCheckpoint'

type VerificationState =
  | { status: 'verifying' }
  | { status: 'verified'; result: CheckpointVerification }
  | { status: 'error'; message: string }

export type ProjectHistoryPanelProps = {
  projectId: string
  onBack: () => void
  onCreateCheckpoint: (reason: string) => Promise<ProjectCheckpointSummary>
  listCheckpoints: (projectId: string) => Promise<ProjectCheckpointSummary[]>
  verifyCheckpoint: (projectId: string, checkpointId: string) => Promise<CheckpointVerification>
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

export function ProjectHistoryPanel({
  projectId, onBack, onCreateCheckpoint, listCheckpoints, verifyCheckpoint,
}: ProjectHistoryPanelProps) {
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpointSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [verification, setVerification] = useState<Record<string, VerificationState>>({})
  const listCheckpointsRef = React.useRef(listCheckpoints)
  listCheckpointsRef.current = listCheckpoints

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setCheckpoints(await listCheckpointsRef.current(projectId))
    } catch (error) {
      setLoadError(`Could not load project history: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

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
    setVerification(current => ({ ...current, [checkpointId]: { status: 'verifying' } }))
    try {
      const result = await verifyCheckpoint(projectId, checkpointId)
      setVerification(current => ({ ...current, [checkpointId]: { status: 'verified', result } }))
    } catch (error) {
      setVerification(current => ({ ...current, [checkpointId]: { status: 'error', message: (error as Error).message } }))
    }
  }

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
            <input
              id="history-checkpoint-reason"
              value={reason}
              maxLength={200}
              onChange={event => setReason(event.target.value)}
              placeholder="For example, approved content before release"
              className="min-h-10 min-w-0 flex-1 rounded-md border border-[#D8D5CF] bg-white px-3 text-[12px] text-[#22222F] outline-none placeholder:text-[#9694A0] focus:border-[#7775D6] focus:ring-2 focus:ring-[#7775D6]/20"
            />
            <button
              type="button"
              disabled={creating || !reason.trim()}
              onClick={() => void createCheckpoint()}
              className="min-h-10 rounded-md bg-[#5554B8] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#45449E] disabled:cursor-not-allowed disabled:bg-[#AAA9C8]"
            >
              {creating ? 'Saving checkpoint…' : 'Create checkpoint'}
            </button>
          </div>
          {creating && <p className="mt-2 text-[11px] text-[#686879]" role="status">Settling project saves and capturing the latest persisted state…</p>}
          {createError && <p className="mt-3 text-[12px] text-[#B42318]" role="alert">{createError}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-[#E3E0DA] bg-white shadow-sm" aria-labelledby="history-list-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECE9E4] px-5 py-4 sm:px-6">
          <div>
            <h2 id="history-list-title" className="text-[15px] font-semibold text-[#22222F]">Checkpoints</h2>
            <p className="mt-0.5 text-[11px] text-[#777786]">Integrity is checked against the saved record and checkpoint files.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[11px] font-medium text-[#41414F] hover:bg-[#F8F7F5] disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {loadError && <p className="m-5 rounded-md bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B42318]" role="alert">{loadError}</p>}
        {loading ? (
          <p className="px-6 py-10 text-center text-[12px] text-[#777786]" role="status">Loading checkpoints…</p>
        ) : !loadError && checkpoints.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[13px] font-medium text-[#353543]">No checkpoints yet</p>
            <p className="mt-1 text-[11px] text-[#777786]">Create a checkpoint to preserve a named, verifiable project state.</p>
          </div>
        ) : (
          <ol className="divide-y divide-[#ECE9E4]">
            {checkpoints.map(checkpoint => {
              const checked = verification[checkpoint.checkpointId]
              const result = checked?.status === 'verified' ? checked.result : null
              return (
                <li key={checkpoint.checkpointId} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-semibold text-[#292936]">{checkpoint.reason}</p>
                      <time className="mt-1 block text-[11px] text-[#777786]">{formatDate(checkpoint.createdAt)}</time>
                    </div>
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
                  {result && !result.valid && result.issues.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-[#A52A2A]" aria-label="Integrity issues">
                      {result.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
                    </ul>
                  )}
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={checked?.status === 'verifying'}
                      onClick={() => void verify(checkpoint.checkpointId)}
                      className="rounded-md border border-[#D8D5CF] px-3 py-1.5 text-[10px] font-semibold text-[#41414F] hover:bg-[#F8F7F5] disabled:opacity-50"
                    >
                      {checked?.status === 'verifying' ? 'Verifying…' : result ? 'Verify again' : 'Verify integrity'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      </div>
    </section>
  )
}