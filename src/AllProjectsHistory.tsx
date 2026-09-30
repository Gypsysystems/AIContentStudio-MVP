import React, { useEffect, useMemo, useState } from 'react'
import type { ProjectSummary } from './projectService'
import type { ProjectCheckpointSummary } from './projectCheckpoint'
import { authorizedProjectRepository } from './authorizedProjectService'

type ProjectHistoryResult =
  | { status: 'loaded'; checkpoints: ProjectCheckpointSummary[] }
  | { status: 'error'; message: string }

export type AllProjectsHistoryProps = {
  projects: ProjectSummary[]
  onSelectProject: (id: string) => void
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

function errorMessage(): string {
  return 'Could not load history. Please try again later.'
}

function readableActor(actorId: string): string | null {
  const actor = actorId.trim()
  if (!actor || /^(?:user|auth|account)[_:-]/i.test(actor)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(actor)
    || /^[0-9a-f]{24,}$/i.test(actor)
    || /^[A-Za-z0-9_-]{24,}$/.test(actor)) return null
  return actor
}

function ActorIdDetails({ actorId }: { actorId: string }) {
  const [open, setOpen] = useState(false)
  return <details className="mt-1 text-[10px] text-[#777786]" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6865A8]">Additional metadata</summary>
    {open && <p className="mt-1 break-all">Actor ID: {actorId}</p>}
  </details>
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function AllProjectsHistory({ projects, onSelectProject }: AllProjectsHistoryProps) {
  const [results, setResults] = useState<Record<string, ProjectHistoryResult>>({})
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    let cancelled = false
    if (projects.length === 0) {
      setResults({})
      setLoading(false)
      return () => { cancelled = true }
    }

    setLoading(true)
    setResults({})
    Promise.all(projects.map(async (project) => {
      try {
        const checkpoints = await authorizedProjectRepository.listProjectCheckpoints(project.projectId)
        return [project.projectId, { status: 'loaded', checkpoints } as const] as const
      } catch {
        return [project.projectId, { status: 'error', message: errorMessage() } as const] as const
      }
    })).then((entries) => {
      if (cancelled) return
      setResults(Object.fromEntries(entries))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [projects])

  const sortedCheckpoints = useMemo(() => Object.fromEntries(Object.entries(results).map(([projectId, result]) => [
    projectId,
    result.status === 'loaded'
      ? [...result.checkpoints].sort((a, b) => b.createdAt - a.createdAt)
      : [],
  ])), [results])

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return projects.flatMap((project) => {
      const result = results[project.projectId]
      const checkpoints = result?.status === 'loaded' ? sortedCheckpoints[project.projectId] || [] : []
      if (activity === 'with-checkpoints' && result?.status === 'loaded' && checkpoints.length === 0) return []
      if (activity === 'without-checkpoints' && result?.status === 'loaded' && checkpoints.length > 0) return []
      const nameMatches = !query || project.projectName.toLocaleLowerCase().includes(query)
      const matched = checkpoints.filter(checkpoint => {
        const textMatches = nameMatches || !query
          || checkpoint.reason.toLocaleLowerCase().includes(query)
          || checkpoint.actorUserId.toLocaleLowerCase().includes(query)
          || checkpoint.checkpointId.toLocaleLowerCase().includes(query)
        const key = dateKey(checkpoint.createdAt)
        return textMatches && (!dateFrom || key >= dateFrom) && (!dateTo || key <= dateTo)
      })
      if ((dateFrom || dateTo) && matched.length === 0) return []
      if (query && !nameMatches && matched.length === 0) return []
      const visibleCheckpoints = (query && !nameMatches) || dateFrom || dateTo ? matched : checkpoints
      return [{ project, result, checkpoints: visibleCheckpoints }]
    })
  }, [projects, results, sortedCheckpoints, search, activity, dateFrom, dateTo])

  return (
    <main aria-labelledby="all-projects-history-title" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 id="all-projects-history-title" className="text-2xl font-semibold text-[#292936]">All projects history</h1>
        <p className="mt-2 text-sm text-[#686879]">Saved checkpoints across your projects.</p>
      </header>

      {loading && <p role="status" className="mb-4 text-sm text-[#686879]">Loading project histories…</p>}

      {projects.length === 0 ? (
        <p className="rounded-lg border border-[#E3E0DA] bg-white p-5 text-sm text-[#686879]">No projects to show.</p>
      ) : (
        <>
          <section aria-label="Filter project history" className="mb-5 rounded-lg border border-[#E3E0DA] bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label htmlFor="all-history-search" className="mb-1 block text-xs font-medium text-[#353543]">Search projects and activity</label>
                <input id="all-history-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Project name, checkpoint note, or actor" className="min-h-10 w-full rounded-md border border-[#D8D5CF] px-3 text-sm text-[#22222F] outline-none focus-visible:ring-2 focus-visible:ring-[#6865A8]" />
              </div>
              <div>
                <label htmlFor="all-history-activity" className="mb-1 block text-xs font-medium text-[#353543]">Activity</label>
                <select id="all-history-activity" value={activity} onChange={event => setActivity(event.target.value)} className="min-h-10 w-full rounded-md border border-[#D8D5CF] bg-white px-3 text-sm focus-visible:ring-2 focus-visible:ring-[#6865A8]">
                  <option value="all">All projects</option><option value="with-checkpoints">With checkpoints</option><option value="without-checkpoints">No checkpoints</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor="all-history-from" className="mb-1 block text-xs font-medium text-[#353543]">From</label><input id="all-history-from" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="min-h-10 w-full min-w-0 rounded-md border border-[#D8D5CF] px-2 text-sm focus-visible:ring-2 focus-visible:ring-[#6865A8]" /></div>
                <div><label htmlFor="all-history-to" className="mb-1 block text-xs font-medium text-[#353543]">To</label><input id="all-history-to" type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="min-h-10 w-full min-w-0 rounded-md border border-[#D8D5CF] px-2 text-sm focus-visible:ring-2 focus-visible:ring-[#6865A8]" /></div>
              </div>
            </div>
          </section>
        <ul className="space-y-4" aria-label="Project histories" aria-live="polite">
          {filteredProjects.map(({ project, result, checkpoints }) => {
            const recent = result?.status === 'loaded' ? checkpoints : []
            return (
              <li key={project.projectId} className="rounded-lg border border-[#E3E0DA] bg-white p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold text-[#292936]">{project.projectName}</h2>
                    {result?.status === 'loaded' && (
                      <p className="mt-1 text-sm text-[#686879]">
                        {result.checkpoints.length} {result.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectProject(project.projectId)}
                    aria-label={`Open history for ${project.projectName}`}
                    className="shrink-0 rounded-md border border-[#D7D5E7] px-4 py-2 text-sm font-medium text-[#48467D] hover:bg-[#F6F5FB] focus:outline-none focus:ring-2 focus:ring-[#6865A8] focus:ring-offset-2"
                  >
                    Open history
                  </button>
                </div>

                {result?.status === 'error' && (
                  <p role="alert" className="mt-4 text-sm text-[#A33333]">
                    Could not load history: {result.message}
                  </p>
                )}
                {result?.status === 'loaded' && (
                    recent.length > 0 ? (
                    <ul className="mt-4 divide-y divide-[#EEECE8]" aria-label={`Checkpoints for ${project.projectName}`}>
                      {recent.map((checkpoint) => (
                        <li key={checkpoint.checkpointId} className="py-3 first:pt-0 last:pb-0">
                          <p className="break-words text-sm font-medium text-[#353543]">{checkpoint.reason || 'Checkpoint saved'}</p>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#777786]">
                            <time dateTime={Number.isNaN(new Date(checkpoint.createdAt).getTime()) ? undefined : new Date(checkpoint.createdAt).toISOString()}>{formatDate(checkpoint.createdAt)}</time>
                            {readableActor(checkpoint.actorUserId) && <span>By {readableActor(checkpoint.actorUserId)}</span>}
                            <span>Schema v{checkpoint.recordSchemaVersion}</span>
                          </p>
                          {!readableActor(checkpoint.actorUserId) && checkpoint.actorUserId && <ActorIdDetails actorId={checkpoint.actorUserId} />}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-[#777786]">No checkpoints yet.</p>
                  )
                )}
              </li>
            )
          })}
        </ul>
        {filteredProjects.length === 0 && <p className="rounded-lg border border-[#E3E0DA] bg-white p-5 text-sm text-[#686879]" role="status">No project history matches these filters.</p>}
        </>
      )}
    </main>
  )
}

export default AllProjectsHistory