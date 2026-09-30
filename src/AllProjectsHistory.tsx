import React, { useEffect, useState } from 'react'
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load this project’s history.'
}

export function AllProjectsHistory({ projects, onSelectProject }: AllProjectsHistoryProps) {
  const [results, setResults] = useState<Record<string, ProjectHistoryResult>>({})
  const [loading, setLoading] = useState(false)

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
      } catch (error) {
        return [project.projectId, { status: 'error', message: errorMessage(error) } as const] as const
      }
    })).then((entries) => {
      if (cancelled) return
      setResults(Object.fromEntries(entries))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [projects])

  return (
    <main aria-labelledby="all-projects-history-title" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 id="all-projects-history-title" className="text-2xl font-semibold text-[#292936]">All projects history</h1>
        <p className="mt-2 text-sm text-[#686879]">Recent saved checkpoints across your projects.</p>
      </header>

      {loading && <p role="status" className="mb-4 text-sm text-[#686879]">Loading project histories…</p>}

      {projects.length === 0 ? (
        <p className="rounded-lg border border-[#E3E0DA] bg-white p-5 text-sm text-[#686879]">No projects to show.</p>
      ) : (
        <ul className="space-y-4" aria-label="Project histories">
          {projects.map((project) => {
            const result = results[project.projectId]
            const recent = result?.status === 'loaded'
              ? [...result.checkpoints].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
              : []
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
                    <ul className="mt-4 divide-y divide-[#EEECE8]" aria-label={`Recent checkpoints for ${project.projectName}`}>
                      {recent.map((checkpoint) => (
                        <li key={checkpoint.checkpointId} className="py-3 first:pt-0 last:pb-0">
                          <p className="break-words text-sm font-medium text-[#353543]">{checkpoint.reason}</p>
                          <time dateTime={Number.isNaN(new Date(checkpoint.createdAt).getTime()) ? undefined : new Date(checkpoint.createdAt).toISOString()} className="mt-1 block text-xs text-[#777786]">
                            {formatDate(checkpoint.createdAt)}
                          </time>
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
      )}
    </main>
  )
}

export default AllProjectsHistory