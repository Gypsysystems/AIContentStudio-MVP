import { useState } from 'react'
import { getAdministrationAccess } from './administrationAccess'
import MySettings from './MySettings'
import type { MembershipRole, ProjectAccessContext, ProjectOwnership } from './ownership'

type AdministrationScreenProps = {
  context: ProjectAccessContext
  mode: 'local-dev' | 'cloud'
  organizationName?: string
  workspaceName?: string
  project: {
    name: string
    documentType: string
    version: string
    ownership: ProjectOwnership
  } | null
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onBack: () => void
  onProjectSettings: () => void
  onDiscardProject: () => void
}

const permissionLabels = [
  { key: 'create', label: 'Create projects', note: 'Start new work in this workspace' },
  { key: 'read', label: 'Read projects', note: 'Open and view project content' },
  { key: 'write', label: 'Edit projects', note: 'Change project content and settings' },
  { key: 'delete', label: 'Delete projects', note: 'Remove projects from the workspace' },
  { key: 'duplicate', label: 'Duplicate projects', note: 'Make a copy of a project' },
  { key: 'backup', label: 'Back up projects', note: 'Create a project backup' },
  { key: 'restore-new', label: 'Restore as new', note: 'Restore a backup as a new project' },
  { key: 'replace', label: 'Replace projects', note: 'Replace an existing project from backup' },
] as const

const roleDetails: Record<MembershipRole, { title: string; description: string }> = {
  owner: { title: 'Owner', description: 'All currently supported project permissions in this workspace.' },
  admin: { title: 'Administrator', description: 'All currently supported project permissions in this workspace.' },
  editor: { title: 'Editor', description: 'Can create and edit projects, but cannot delete or replace them.' },
  viewer: { title: 'Viewer', description: 'Can read projects and make permitted backups.' },
}

function SectionHeading({ id, index, eyebrow, title, description }: {
  id: string
  index: string
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mb-5 flex gap-4">
      <span aria-hidden="true" className="mt-0.5 font-mono text-[11px] tracking-[0.14em] text-[#8F8EA0]">{index}</span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74738A]">{eyebrow}</p>
        <h2 id={id} className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[#20202C]">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#777685]">{description}</p>
      </div>
    </div>
  )
}

function AccessMark({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#EAF3EE] px-2 text-[10px] font-semibold text-[#3E765B]">
      Yes
    </span>
  ) : (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#F1F0EE] px-2 text-[10px] font-medium text-[#92909A]">
      No
    </span>
  )
}

export default function AdministrationScreen({
  context,
  mode,
  organizationName,
  workspaceName,
  project,
  saveStatus,
  onBack,
  onProjectSettings,
  onDiscardProject,
}: AdministrationScreenProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const access = getAdministrationAccess(context, project?.ownership)
  const role = access.role
  const canReadProject = access.project?.read === true
  const canWriteProject = access.project?.write === true
  const displayWorkspace = mode === 'cloud' ? workspaceName || 'Unavailable' : context.workspace.name || 'Local workspace'
  const displayOrganization = mode === 'cloud' ? organizationName || 'Unavailable' : 'Local development'

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#F7F6F3] text-[#20202C]" data-testid="administration-workspace">
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-5 sm:px-7 sm:pt-8 lg:px-10">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-[11px] text-[#858391]">
          <button type="button" onClick={onBack} className="rounded-sm transition-colors hover:text-[#4D4DC2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">
            Workspace
          </button>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-[#434250]">Administration</span>
        </nav>

        <header className="relative mb-8 overflow-hidden rounded-2xl border border-[#E1DFD9] bg-[#FCFBF9] px-5 py-6 sm:px-8 sm:py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full border border-[#E7E4DD] sm:right-10 sm:top-[-104px] sm:h-72 sm:w-72" />
          <div aria-hidden="true" className="pointer-events-none absolute right-[-2px] top-[-22px] h-40 w-40 rounded-full border border-[#ECE9E2] sm:right-[76px] sm:top-[-64px] sm:h-52 sm:w-52" />
          <div className="relative">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DFDDD7] bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#666575]">
                <span className={`h-1.5 w-1.5 rounded-full ${mode === 'cloud' ? 'bg-[#638D77]' : 'bg-[#B58749]'}`} />
                {mode === 'cloud' ? 'Cloud workspace' : 'Local development'}
              </span>
              <span className="text-[11px] text-[#9694A0]">{displayOrganization} <span className="px-1 text-[#C4C1BA">/</span> {displayWorkspace}</span>
            </div>
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                 <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77758B]">Workspace access</p>
                <h1 className="mt-2 text-[29px] font-semibold leading-tight tracking-[-0.045em] text-[#22222E] sm:text-[36px]">Administration</h1>
                <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#747381]">
                  A clear view of who you are here, what this workspace allows, and where project controls live.
                </p>
              </div>
              <button type="button" onClick={onBack} className="inline-flex min-h-9 w-fit items-center gap-2 rounded-lg border border-[#DCDAD4] bg-white px-3 text-[11px] font-semibold text-[#555461] transition-colors hover:border-[#C7C5F4] hover:bg-[#F8F7FF] hover:text-[#4D4DC2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] focus-visible:ring-offset-2">
                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Back to workspace
              </button>
            </div>
          </div>
        </header>

        {mode === 'cloud' ? (
          <aside role="note" className="mb-7 flex gap-3 rounded-xl border border-[#D9E4DD] bg-[#F0F5F1] px-4 py-3.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#DCE9E0] text-[11px] font-bold text-[#47745A]">i</span>
            <p className="text-[11px] leading-5 text-[#53685B]">
              <span className="font-semibold text-[#3D5F49]">Cloud access is reauthorized by the server.</span>{' '}
              The access shown here is a client-side view for orientation; every cloud operation must still be checked against your current server-side session and workspace membership.
            </p>
          </aside>
        ) : (
          <aside role="note" className="mb-7 flex gap-3 rounded-xl border border-[#E9DECD] bg-[#F7F1E8] px-4 py-3.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#EFE3D1] text-[11px] font-bold text-[#8B6B3D]">i</span>
            <p className="text-[11px] leading-5 text-[#75634A]">
              <span className="font-semibold text-[#6D5738]">Local development access.</span>{' '}
              This view reflects the local development context only. It is not a cloud role assignment or a server-enforced access record.
            </p>
          </aside>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,0.8fr)]">
          <section aria-labelledby="roles-heading" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-7">
             <SectionHeading id="roles-heading" index="01" eyebrow="Identity & access" title="Your workspace role" description="Current effective access for this session, calculated from its workspace membership." />
            <div className="mb-6 flex flex-col gap-4 rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#E8E7F7] text-[12px] font-semibold tracking-wide text-[#5555B1]">
                  {(context.user.name || context.user.email || 'U').trim().slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[#292936]">{context.user.name || 'Current user'}</p>
                  <p className="truncate text-[11px] text-[#858391]">{context.user.email || 'Signed-in workspace member'}</p>
                </div>
              </div>
              <div className="flex w-fit items-center gap-2 rounded-lg border border-[#DCD9EF] bg-[#F0EFFA] px-3 py-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#6462B6]" />
                <span className="text-[11px] font-semibold text-[#4D4B9B]">{role ? roleDetails[role].title : 'No active role'}</span>
              </div>
            </div>
             <p className="mb-4 text-[11px] leading-5 text-[#777685]">
              {role ? roleDetails[role].description : 'No workspace role is available for this context.'}
              {' '}Role assignments are read-only here; supported membership management is not available in this workspace.
            </p>
            <div className="overflow-hidden rounded-xl border border-[#E8E6E0]">
              <div className="flex items-center justify-between gap-3 border-b border-[#E8E6E0] bg-[#F8F7F4] px-4 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#777685]">Workspace permissions</p>
                <p className="text-[10px] text-[#9A98A2]">Effective for you</p>
              </div>
              <ul className="divide-y divide-[#ECEAE5]">
                {permissionLabels.map(permission => (
                  <li key={permission.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-medium text-[#393844]">{permission.label}</p>
                      <p className="mt-0.5 text-[10px] text-[#96949F]">{permission.note}</p>
                    </div>
                    <AccessMark allowed={access.workspace[permission.key]} />
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="flex flex-col gap-6">
            <MySettings key={`${mode}:${context.user.id}`} mode={mode} userId={context.user.id} />
            <section aria-labelledby="workspace-settings-heading" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-6">
               <SectionHeading id="workspace-settings-heading" index="03" eyebrow="Workspace" title="Workspace settings" description="Scope and configuration access for the current workspace." />
              <div className="divide-y divide-[#ECEAE5] rounded-xl border border-[#E8E6E0]">
                <div className="flex items-start justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="text-[11px] font-medium text-[#393844]">Organization</p>
                    <p className="mt-1 text-[10px] text-[#8C8A96]">{displayOrganization}</p>
                  </div>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#92909A]">Context</span>
                </div>
                <div className="flex items-start justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="text-[11px] font-medium text-[#393844]">Workspace</p>
                    <p className="mt-1 text-[10px] text-[#8C8A96]">{displayWorkspace}</p>
                  </div>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#92909A]">Context</span>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-[#F5F4F1] px-4 py-3.5">
                 <p className="text-[11px] font-semibold text-[#4A4955]">Settings are unavailable</p>
                <p className="mt-1 text-[10px] leading-5 text-[#84828E]">
                  Workspace settings and role assignments are shown as read-only. This screen does not have supported persistence for changing them.
                </p>
              </div>
            </section>

            <section aria-labelledby="project-settings-heading" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-6">
               <SectionHeading id="project-settings-heading" index="04" eyebrow="Project" title="Project settings" description="Project details are scoped by your effective project access." />
              {!project ? (
                <div className="rounded-xl border border-dashed border-[#DCDAD4] bg-[#F8F7F4] px-4 py-5">
                   <p className="text-[11px] font-semibold text-[#555460]">No project selected</p>
                  <p className="mt-1 text-[10px] leading-5 text-[#898793]">Project details and settings will appear here when a project is in scope.</p>
                </div>
              ) : !canReadProject ? (
                <div className="rounded-xl border border-[#E8E6E0] bg-[#F5F4F1] px-4 py-4">
                   <p className="text-[11px] font-semibold text-[#555460]">Project details are restricted</p>
                  <p className="mt-1 text-[10px] leading-5 text-[#898793]">Your current access does not include permission to read this project.</p>
                  <button type="button" disabled className="mt-4 min-h-9 cursor-not-allowed rounded-lg border border-[#E0DED9] bg-[#EFEEEB] px-3 text-[10px] font-semibold text-[#A3A1AA]" aria-disabled="true">
                    Project settings unavailable
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] px-4 py-3.5">
                    <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-[#92909A]">Current project</p>
                    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 text-[11px]">
                      <dt className="text-[#898793]">Name</dt><dd className="truncate font-medium text-[#42414D]">{project.name}</dd>
                      <dt className="text-[#898793]">Document type</dt><dd className="truncate font-medium text-[#42414D]">{project.documentType}</dd>
                      <dt className="text-[#898793]">Version</dt><dd className="truncate font-medium text-[#42414D]">{project.version || 'Not set'}</dd>
                    </dl>
                  </div>
                  <div className="mb-4 flex items-center justify-between rounded-lg bg-[#F3F2EF] px-3.5 py-2.5">
                    <span className="text-[10px] text-[#777685]">Project access</span>
                    <span className="text-[10px] font-medium text-[#5B5967]">{canWriteProject ? 'Read and write' : 'Read only'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={onProjectSettings}
                    disabled={!canWriteProject}
                    aria-disabled={!canWriteProject}
                    className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#5B5BD6] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#4A4AC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#E9E8E5] disabled:text-[#9997A0]"
                  >
                    {canWriteProject ? 'Open project settings' : 'Project settings are read-only'}
                    {canWriteProject && <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h7M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </button>
                </>
              )}
              {project && (!canReadProject || saveStatus === 'error') && <div className="mt-4 rounded-xl border border-[#E5C6A2] bg-[#FFF8ED] px-4 py-3 text-[11px] text-[#6E5335]">
                <p className="font-semibold">Cannot safely leave with unsaved changes</p>
                <p className="mt-1 leading-5">If access was removed or saving failed, you can discard unsaved edits in this tab and return to the workspace. Already saved changes are not undone.</p>
                <button type="button" onClick={() => setConfirmDiscard(true)} disabled={saveStatus === 'saving'}
                  className="mt-3 min-h-9 rounded-md border border-[#B98D5D] px-3 font-semibold hover:bg-[#FFF0D7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:cursor-not-allowed disabled:opacity-50">
                  Discard unsaved edits and leave project
                </button>
                {confirmDiscard && <div role="alertdialog" aria-labelledby="discard-project-title" aria-describedby="discard-project-description" className="mt-3 rounded-lg border border-[#B98D5D] bg-white p-3">
                  <p id="discard-project-title" className="font-semibold">Discard unsaved edits?</p>
                  <p id="discard-project-description" className="mt-1 leading-5">Edits not saved to this project will be lost. Saved project data remains unchanged.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={onDiscardProject} className="min-h-9 rounded-md bg-[#7B4B26] px-3 font-semibold text-white">Discard and leave</button>
                    <button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-9 rounded-md border border-[#D8D5CF] px-3">Keep working</button>
                  </div>
                </div>}
              </div>}
            </section>
          </div>
        </div>

        <footer className="mt-7 border-t border-[#E4E2DC] pt-4 text-[10px] leading-5 text-[#92909A]">
          Access is presented for clarity, not as an access-management surface. No changes are made from this screen.
        </footer>
      </div>
    </div>
  )
}