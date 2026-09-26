import React from 'react'
import type { ProjectHomeDestination, ProjectHomeIssue, ProjectHomeStage, ProjectHomeStatus, ProjectHomeSummary } from './projectHomeModel'

const stages: Array<{ id: ProjectHomeStage; name: string; destination: 'sources' | 'analysis' | 'studio' | 'quality' | 'publish'; detail: string; demoDetail: string }> = [
  { id: 'sources', name: 'Sources', destination: 'sources', detail: 'Files & evidence', demoDetail: 'Demo source files' },
  { id: 'analysis', name: 'Analysis', destination: 'analysis', detail: 'Grounded structure', demoDetail: 'Demo analysis progress' },
  { id: 'studio', name: 'Author', destination: 'studio', detail: 'Topic content', demoDetail: 'Demo topic content' },
  { id: 'quality', name: 'Review', destination: 'quality', detail: 'Current findings', demoDetail: 'Demo walkthrough' },
  { id: 'publish', name: 'Publish', destination: 'publish', detail: 'Output preparation', demoDetail: 'Demo output setup' },
]
const statusTone: Record<ProjectHomeStatus, string> = {
  'Not started': 'ph-status-idle',
  'In progress': 'ph-status-progress',
  'Needs attention': 'ph-status-attention',
  Ready: 'ph-status-ready',
  Complete: 'ph-status-complete',
  'Demo complete': 'ph-status-demo',
}
const destinationLabel: Record<ProjectHomeDestination, string> = {
  sources: 'Sources',
  analysis: 'Analysis',
  structure: 'Structure',
  studio: 'Author',
  quality: 'Review',
  publish: 'Publish',
  branding: 'Brand & Output',
}

export type ProjectHomeScreenProps = {
  projectName: string
  contentType: string
  summary: ProjectHomeSummary
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onRetrySave: () => void
  onNavigate: (screen: ProjectHomeDestination | 'create') => void
  onIssue: (issue: ProjectHomeIssue) => void
}

export function ProjectHomeScreen({ projectName, contentType, summary, saveStatus, onRetrySave, onNavigate, onIssue }: ProjectHomeScreenProps) {
  const saveLabel = saveStatus === 'saving' ? 'Saving changes' : saveStatus === 'error' ? 'Save failed' : saveStatus === 'saved' ? 'All changes saved' : 'No pending changes'
  const saveClass = saveStatus === 'saving' ? 'ph-save-saving' : saveStatus === 'error' ? 'ph-save-error' : 'ph-save-ok'
  const recentRun = summary.recentRun
  return (
    <section className="project-home fade-in" data-testid="project-home" aria-labelledby="project-home-title">
      <div className="ph-heading-row">
        <div className="ph-heading">
          <div className="ph-eyebrow"><span className="ph-eyebrow-mark" /> PROJECT OVERVIEW {summary.demoMode && <span className="ph-demo-badge">DEMO MODE</span>}</div>
          <h1 id="project-home-title">{projectName || 'Untitled project'}</h1>
          <div className="ph-identity">
            <span>{contentType || 'Content project'}</span>
            <span className="ph-identity-divider" />
            <span>{summary.topicCount} {summary.topicCount === 1 ? 'topic' : 'topics'}</span>
            <span className="ph-identity-divider" />
            <span>{summary.demoMode
              ? `${summary.demoSourceCount} demo ${summary.demoSourceCount === 1 ? 'file' : 'files'}`
              : `${summary.usableSourceCount} usable ${summary.usableSourceCount === 1 ? 'source' : 'sources'}`}</span>
          </div>
        </div>
        <div className={`ph-save-state ${saveClass}`} data-testid="project-home-save-state" role={saveStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span className="ph-save-dot" />
          <span>{saveLabel}</span>
          {saveStatus === 'error' && <button type="button" onClick={onRetrySave}>Retry</button>}
        </div>
      </div>

      {summary.demoMode && (
        <div className="ph-demo-note" role="status">
          Saved demo walkthrough progress only — this does not indicate source-verified evidence or a real Review.
        </div>
      )}

      <div className="ph-workspace-grid">
        <div className="ph-main-column">
          <section className="ph-next-card" aria-labelledby="ph-next-title">
            <div className="ph-next-content">
              <div className="ph-next-kicker">NEXT UP</div>
              <h2 id="ph-next-title">{summary.continueLabel}</h2>
              <p>{summary.continueStage === 'sources'
                ? summary.demoMode
                  ? 'Continue the saved demo workflow; evidence readiness is not evaluated here.'
                  : summary.usableSourceCount
                    ? 'Source extraction is available. Rebuild the Evidence Index before moving into analysis.'
                    : 'Attach source material and make sure extraction is ready.'
                : summary.continueStage === 'analysis'
                  ? summary.demoMode ? 'Continue the demo analysis and structure walkthrough.' : 'Bring the grounded analysis and committed structure up to date.'
                  : summary.continueStage === 'studio'
                    ? summary.demoMode ? 'Continue with the saved demo topic content.' : 'Work through the next topic that needs content or grounding.'
                    : summary.continueStage === 'quality'
                      ? summary.demoMode ? 'Continue the demo Review walkthrough; no grounded run is implied.' : 'Check the current Review inputs and required findings.'
                      : summary.demoMode ? 'Explore the demo output setup.' : 'Your current content has a completed Review. Set up the deliverables.'}</p>
            </div>
            <button type="button" className="ph-continue-button" data-testid="project-home-continue" onClick={() => onNavigate(summary.continueDestination)}>
              Continue working <span aria-hidden="true">→</span>
            </button>
          </section>

          <section className="ph-stages" aria-labelledby="ph-stages-title">
            <div className="ph-section-heading">
              <div>
                <p className="ph-section-index">01 / WORKFLOW</p>
                <h2 id="ph-stages-title">{summary.demoMode ? 'Demo progression' : 'Project stages'}</h2>
              </div>
              <span className="ph-section-note">{summary.demoMode ? 'Saved demo steps · not evidence verified' : 'Open any stage to work directly'}</span>
            </div>
            <ol className="ph-stage-list">
              {stages.map((stage, index) => {
                const status = summary.stages[stage.id]
                return (
                  <li key={stage.id}>
                    <button type="button" className="ph-stage-button" data-testid={`project-home-stage-${stage.id}`} onClick={() => onNavigate(stage.destination)}>
                      <span className={`ph-stage-index ${statusTone[status]}`}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="ph-stage-copy">
                        <span className="ph-stage-name">{stage.name}</span>
                        <span className="ph-stage-detail">{summary.demoMode ? stage.demoDetail : stage.detail}</span>
                      </span>
                      <span className={`ph-status ${statusTone[status]}`}>{status}</span>
                      <span className="ph-stage-arrow" aria-hidden="true">↗</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>

          {recentRun && (
            <section className="ph-recent" data-testid="project-home-recent-work" aria-labelledby="ph-recent-title">
              <div className="ph-section-heading ph-recent-heading">
                <div><p className="ph-section-index">02 / ACTIVITY</p><h2 id="ph-recent-title">Recent work</h2></div>
                <span className="ph-section-note">Persisted project activity</span>
              </div>
              <button type="button" className="ph-recent-row" onClick={() => onNavigate('quality')}>
                <span className="ph-recent-marker" />
                <span className="ph-recent-copy"><strong>Review run completed</strong><small>{recentRun.findingIds.length} findings recorded</small></span>
                <time dateTime={new Date(recentRun.completedAt!).toISOString()}>{new Date(recentRun.completedAt!).toLocaleString()}</time>
                <span aria-hidden="true">↗</span>
              </button>
            </section>
          )}
        </div>

        <aside className="ph-attention" aria-labelledby="ph-attention-title">
          <div className="ph-section-heading ph-attention-heading">
            <div><p className="ph-section-index">03 / PROJECT HEALTH</p><h2 id="ph-attention-title">Needs attention</h2></div>
            <span className={`ph-issue-count ${summary.issues.length ? 'has-issues' : ''}`}>{String(summary.issues.length).padStart(2, '0')}</span>
          </div>
          {summary.issues.length ? (
            <ul className="ph-issue-list">
              {summary.issues.map((issue: ProjectHomeIssue) => (
                <li key={issue.id}>
                  <button type="button" className="ph-issue-button" data-testid="project-home-issue" onClick={() => onIssue(issue)}>
                    <span className={`ph-issue-marker ${issue.severity}`} />
                    <span className="ph-issue-copy"><strong>{issue.title}</strong><small>{issue.detail}</small><span className="ph-issue-route">Open {destinationLabel[issue.destination ?? issue.stage]} <span aria-hidden="true">→</span></span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ph-clear-state">
              <span className="ph-clear-symbol">✓</span>
              <strong>{summary.demoMode ? 'No live checks in demo' : 'No open issues'}</strong>
              <p>{summary.demoMode
                ? 'This walkthrough uses saved demo data; source evidence and Review are not validated.'
                : 'The current project inputs are in good shape.'}</p>
            </div>
          )}
          <div className="ph-aside-footer">
            <span>PROJECT TOOLS</span>
            <button type="button" onClick={() => onNavigate('create')}>Project Settings <span aria-hidden="true">↗</span></button>
            <button type="button" onClick={() => onNavigate('branding')}>Brand &amp; Output <span aria-hidden="true">↗</span></button>
          </div>
        </aside>
      </div>
    </section>
  )
}