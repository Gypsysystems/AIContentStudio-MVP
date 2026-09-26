import { cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  BLUEPRINT_CONTENT_TYPES,
  canTransitionAiVersion,
  validateAiTransition,
  validateAiAssetInput,
  aiDefinitionsEqual,
  type AiAssetInput,
  type AiAssetKind,
  type AiAssetVersion,
  type AiDefinition,
  type AiVersionState,
  type BlueprintContentType,
  type BlueprintDefinition,
  type PromptDefinition,
  type PromptPackDefinition,
  type ReferenceSetDefinition,
  type WorkflowDefinition,
} from '../aiCatalogModel'
import { AiCatalogApiError, executeAiCatalog, historyAiAsset, listAiAssets } from '../aiCatalogRepository'
import type { ProjectAccessContext } from '../ownership'

type Props = { mode: 'local-dev' | 'cloud'; context: ProjectAccessContext }
type Area = 'connections' | AiAssetKind
type EditorDraft = { kind: AiAssetKind; name: string; description: string; definition: AiDefinition }
type Notice = { type: 'success' | 'error' | 'info'; text: string }

function catalogErrorMessage(error: unknown, fallback: string) {
  const code = (error instanceof AiCatalogApiError ? error.code
    : error && typeof error === 'object' && 'code' in error ? String(error.code) : '').toUpperCase()
  const status = error instanceof AiCatalogApiError ? error.status
    : error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
  if (/SCHEMA|MIGRATION/.test(code)) return 'The AI catalog is not available yet because its storage schema has not been installed.'
  if (/UNAUTHENTICATED|AUTH_REQUIRED/.test(code) || status === 401)
    return 'Sign in again to access this workspace catalog.'
  if (/MEMBERSHIP_LOOKUP_FAILED|MEMBERSHIP_CHECK_FAILED/.test(code))
    return 'We could not verify your workspace membership. Try again later or contact your workspace administrator.'
  if (/MEMBERSHIP_INACTIVE/.test(code))
    return 'Your workspace membership is inactive. Ask a workspace administrator to restore access.'
  if (/FORBIDDEN|NOT_AUTHORIZED/.test(code) || status === 403)
    return 'Your workspace role does not allow this catalog action.'
  if (/CONFLICT|VERSION_MISMATCH/.test(code) || status === 409)
    return 'This definition changed elsewhere. Your draft is still here; refresh the catalog and reopen the latest version before revising.'
  if (/INVALID_REFERENCE|REFERENCE_INVALID|WORKFLOW_REFERENCE_INVALID/.test(code)) return 'A linked definition is unavailable in this workspace. Review the references and try again.'
  if (/FOREIGN_WORKSPACE|WORKSPACE_SCOPE_INVALID/.test(code))
    return 'The catalog response included records outside this workspace. No records are displayed.'
  if (/BAD_CONFIRMATION|CONFIRMATION_MISMATCH/.test(code))
    return 'The server could not confirm this catalog change. Refresh to verify the current saved state.'
  if (/ASSET_NOT_FOUND|DEFINITION_NOT_FOUND/.test(code))
    return 'This definition is no longer available in the current workspace. Refresh the catalog and select an available version.'
  if (/INVALID_ASSET|ASSET_INVALID/.test(code))
    return 'This definition does not meet the catalog requirements. Review its fields and try again.'
  if (/INVALID_REVISION|REVISION_INVALID/.test(code))
    return 'This revision is not valid for the current definition. Review its versioned fields and try again.'
  if (/INVALID_TRANSITION|TRANSITION_INVALID/.test(code))
    return 'This lifecycle change is not allowed for the current version.'
  if (/API_UNAVAILABLE|CATALOG_UNAVAILABLE/.test(code))
    return 'The AI catalog service is currently unavailable. No local fallback was used; retry when the service is available.'
  if (/INVALID_RESPONSE|RESPONSE_INVALID|STORAGE_RESPONSE_INVALID/.test(code))
    return 'The catalog response could not be verified, so it is not being displayed as confirmed. Refresh to check the current saved state.'
  return error instanceof Error && error.message ? error.message : fallback
}

function isConfirmedAsset(value: unknown, workspaceId: string, command: AiAssetInput, expected?: AiAssetVersion, transitionState?: AiVersionState): value is AiAssetVersion {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<AiAssetVersion>
  return asset.workspaceId === workspaceId
    && typeof asset.id === 'string' && asset.id.length > 0
    && asset.kind === command.kind
    && Number.isSafeInteger(asset.version) && (asset.version as number) > 0
    && ['draft', 'test', 'published', 'archived'].includes(String(asset.state))
    && typeof asset.name === 'string' && typeof asset.description === 'string'
    && typeof asset.createdAt === 'string' && !Number.isNaN(Date.parse(asset.createdAt))
    && typeof asset.createdBy === 'string' && asset.createdBy.length > 0
    && validateAiAssetInput({ kind: asset.kind, name: asset.name, description: asset.description, definition: asset.definition })
    && (expected
      ? asset.id === expected.id && asset.version === expected.version + 1
        && (transitionState ? asset.state === transitionState
          : asset.state === 'draft' && asset.name === command.name && asset.description === command.description
            && aiDefinitionsEqual(asset.definition, command.definition))
      : asset.version === 1 && asset.state === 'draft' && asset.name === command.name
        && asset.description === command.description && aiDefinitionsEqual(asset.definition, command.definition))
}

const areas: { id: Area; label: string; number: string }[] = [
  { id: 'connections', label: 'Connections', number: '01' },
  { id: 'workflow', label: 'Workflows', number: '02' },
  { id: 'prompt-pack', label: 'Prompt library', number: '03' },
  { id: 'reference-set', label: 'Reference sets', number: '04' },
  { id: 'blueprint', label: 'Content blueprints', number: '05' },
]
const kindTitles: Record<AiAssetKind, string> = {
  workflow: 'Workflow',
  'prompt-pack': 'Prompt pack',
  'reference-set': 'Reference set',
  blueprint: 'Content blueprint',
}
const kindDescriptions: Record<AiAssetKind, string> = {
  workflow: 'Define a documentation capability and its grounded inputs.',
  'prompt-pack': 'Maintain reusable prompts with explicit versions and variables.',
  'reference-set': 'Keep approved-example and terminology metadata traceable.',
  blueprint: 'Set content types, section structure, and editorial rules.',
}
const stateLabels: Record<AiVersionState, string> = {
  draft: 'Draft',
  test: 'Test / review',
  published: 'Published',
  archived: 'Archived',
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function blankDefinition(kind: AiAssetKind): AiDefinition {
  if (kind === 'workflow') return {
    capability: '', model: { mode: 'auto' }, promptPack: null, referenceSet: null, blueprint: null, steps: [],
  }
  if (kind === 'prompt-pack') return { prompts: [] }
  if (kind === 'reference-set') return { entries: [] }
  return { contentType: 'User Guide', sections: [] }
}

function initialDraft(kind: AiAssetKind): EditorDraft {
  return { kind, name: '', description: '', definition: blankDefinition(kind) }
}

function getDefinition<T extends AiDefinition>(asset: AiAssetVersion | null, fallback: T): T {
  return asset ? asset.definition as T : fallback
}

function Button({ children, onClick, disabled, kind = 'secondary', type = 'button', title }: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger'
  type?: 'button' | 'submit'
  title?: string
}) {
  const color = kind === 'primary'
    ? 'border-transparent bg-[#5B5BD6] text-white hover:bg-[#4949C4]'
    : kind === 'danger'
      ? 'border-[#E8C9C0] bg-[#FFF8F5] text-[#945442] hover:bg-[#FBECE7]'
      : kind === 'quiet'
        ? 'border-transparent bg-transparent text-[#74738A] hover:bg-[#F1F0ED] hover:text-[#3D3C49]'
        : 'border-[#DCDAD4] bg-white text-[#555461] hover:border-[#C7C5F4] hover:bg-[#F8F7FF] hover:text-[#4D4DC2]'
  return <button type={type} title={title} onClick={onClick} disabled={disabled}
    className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${color}`}>
    {children}
  </button>
}

function StatePill({ state }: { state: AiVersionState }) {
  const style = state === 'published' ? 'border-[#D8E6DC] bg-[#EFF5F0] text-[#52715C]'
    : state === 'archived' ? 'border-[#E5E3DE] bg-[#F3F2EF] text-[#85828A]'
      : state === 'test' ? 'border-[#E7DDC9] bg-[#F8F3E8] text-[#8B7040]'
        : 'border-[#DCD9EF] bg-[#F1F0FA] text-[#5F5C9E]'
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${style}`}>{stateLabels[state]}</span>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId()
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children
  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-[11px] font-semibold text-[#393844]">{label}</label>
      {hint && <span className="text-[10px] text-[#92909A]">{hint}</span>}
    </div>
    {child}
  </div>
}

const inputClass = 'min-h-10 w-full rounded-lg border border-[#DCDAD4] bg-white px-3 text-[12px] text-[#33323E] placeholder:text-[#AAA8B0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]'
const textAreaClass = 'w-full rounded-lg border border-[#DCDAD4] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#33323E] placeholder:text-[#AAA8B0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]'

function DefinitionEditor({ draft, update, assets, promptBaseVersions }: {
  draft: EditorDraft
  update: (definition: AiDefinition) => void
  assets: AiAssetVersion[]
  promptBaseVersions: Record<string, number>
}) {
  const { kind, definition } = draft
  if (kind === 'workflow') {
    const data = definition as WorkflowDefinition
    return <div className="space-y-4">
      <Field label="Capability" hint="What documentation task does this workflow support?">
        <input className={inputClass} value={data.capability} maxLength={100} placeholder="For example, release notes"
          onChange={event => update({ ...data, capability: event.target.value })} />
      </Field>
      <Field label="Model selection" hint="Auto is the only available mode until a real connection exists">
        <div className="flex min-h-10 items-center justify-between rounded-lg border border-[#E5E3DD] bg-[#F7F6F3] px-3">
          <span className="text-[12px] font-medium text-[#454450]">Auto — selected at execution time</span>
          <span className="rounded-full bg-[#ECEBE7] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[#898792]">No model pinned</span>
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ['promptPack', 'Prompt pack', 'prompt-pack'],
          ['referenceSet', 'Reference set', 'reference-set'],
          ['blueprint', 'Blueprint', 'blueprint'],
        ] as const).map(([key, label, kindValue]) => {
          return <Field key={key} label={label}>
            <select className={inputClass} value={data[key]?.id ?? ''} onChange={event => {
              const selected = assets.find(item => item.kind === kindValue && item.id === event.target.value)
              update({ ...data, [key]: selected ? { id: selected.id, version: selected.version } : null })
            }}>
              <option value="">Not linked</option>
              {assets.filter(item => item.kind === kindValue && item.state !== 'archived').map(item =>
                <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
            </select>
          </Field>
        })}
      </div>
      <WorkflowSteps data={data} update={update} />
    </div>
  }
  if (kind === 'prompt-pack') {
    const data = definition as PromptPackDefinition
    const change = (index: number, value: PromptDefinition) => update({ prompts: data.prompts.map((item, i) => i === index ? value : item) })
    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[11px] font-semibold text-[#393844]">Prompts</p><p className="text-[10px] text-[#898793]">Each prompt carries its own version and review state.</p></div>
        <Button disabled={data.prompts.length >= 50} onClick={() => update({ prompts: [...data.prompts, {
          id: newId('prompt'), version: 1, state: 'draft', name: '', template: '', variables: [],
        }] })}>Add prompt</Button>
      </div>
      {data.prompts.length === 0 && <EmptyInset title="No prompts yet" text="Add the first prompt to define a reusable instruction." />}
      {data.prompts.map((prompt, index) => {
        const isPersistedPrompt = promptBaseVersions[prompt.id] !== undefined
        const locked = promptBaseVersions[prompt.id] === prompt.version
        const updatePrompt = (next: PromptDefinition) => change(index, next)
        return <div key={prompt.id} className="rounded-xl border border-[#E7E5DF] bg-[#F8F7F4] p-3.5 sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-semibold text-[#3C3B47]">Prompt {index + 1}</p><p className="mt-0.5 font-mono text-[9px] text-[#9694A0]">{prompt.id} · v{prompt.version} · {stateLabels[prompt.state]}</p></div>
          <div className="flex flex-wrap justify-end gap-1">
            {locked && <Button title={`Create a new version of ${prompt.name || `prompt ${index + 1}`}`} onClick={() => updatePrompt({ ...prompt, version: prompt.version + 1, state: 'draft' })}>Revise prompt</Button>}
            {isPersistedPrompt && !locked && (['test', 'published', 'draft'] as const).filter(state => canTransitionAiVersion(prompt.state, state)).map(state =>
              <Button key={state} title={`Set this prompt version to ${stateLabels[state].toLowerCase()}`}
                onClick={() => updatePrompt({ ...prompt, state })}>{state === 'test' ? 'Move to review' : state === 'published' ? 'Publish' : 'Return to draft'}</Button>)}
            <Button kind="quiet" title={`Remove prompt ${index + 1}`} onClick={() => update({ prompts: data.prompts.filter((_, i) => i !== index) })}>Remove</Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prompt name"><input disabled={locked} className={inputClass} value={prompt.name} maxLength={120} onChange={event => change(index, { ...prompt, name: event.target.value })} /></Field>
          <div className="flex min-h-10 items-center rounded-lg border border-[#E5E3DD] bg-white px-3 text-[10px] text-[#777581]">{locked ? 'Snapshot locked · revise to edit' : isPersistedPrompt ? `Editing v${prompt.version} · ${stateLabels[prompt.state]}` : 'New prompt · saves as v1 Draft with this pack'}</div>
          <div className="sm:col-span-2"><Field label="Prompt template" hint="Keep provenance instructions explicit; no document source text belongs here.">
            <textarea disabled={locked} className={`${textAreaClass} min-h-28 disabled:bg-[#F0EFEB] disabled:text-[#8D8B95]`} maxLength={8000} value={prompt.template} onChange={event => change(index, { ...prompt, template: event.target.value })} placeholder="Write the reusable prompt template…" />
          </Field></div>
          <div className="sm:col-span-2"><Field label="Variables" hint="Comma-separated identifiers, for example audience, tone">
            <input disabled={locked} className={`${inputClass} disabled:bg-[#F0EFEB] disabled:text-[#8D8B95]`} value={prompt.variables.join(', ')} onChange={event => change(index, { ...prompt, variables: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} />
          </Field></div>
        </div>
      </div>})}
    </div>
  }
  if (kind === 'reference-set') {
    const data = definition as ReferenceSetDefinition
    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] font-semibold text-[#393844]">Reference metadata</p><p className="text-[10px] text-[#898793]">Record provenance pointers and editorial context only—not document content or files.</p></div>
        <Button disabled={data.entries.length >= 100} onClick={() => update({ entries: [...data.entries, { id: newId('ref'), type: 'approved-example', title: '', locator: '', note: '' }] })}>Add reference</Button>
      </div>
      {data.entries.length === 0 && <EmptyInset title="No reference metadata" text="Add a locator for an approved example or terminology source." />}
      {data.entries.map((entry, index) => <div key={entry.id} className="rounded-xl border border-[#E7E5DF] bg-[#F8F7F4] p-3.5 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><p className="font-mono text-[9px] text-[#9694A0]">{entry.id}</p><Button kind="quiet" title={`Remove reference ${index + 1}`} onClick={() => update({ entries: data.entries.filter((_, i) => i !== index) })}>Remove</Button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entry type"><select className={inputClass} value={entry.type} onChange={event => update({ entries: data.entries.map((item, i) => i === index ? { ...item, type: event.target.value as typeof item.type } : item) })}>
            <option value="approved-example">Approved example</option><option value="terminology">Terminology</option>
          </select></Field>
          <Field label="Title"><input className={inputClass} value={entry.title} maxLength={160} onChange={event => update({ entries: data.entries.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></Field>
          <div className="sm:col-span-2"><Field label="Locator" hint="A stable link, document identifier, or section reference—not pasted content">
            <input className={inputClass} value={entry.locator} maxLength={500} placeholder="https://… or internal reference" onChange={event => update({ entries: data.entries.map((item, i) => i === index ? { ...item, locator: event.target.value } : item) })} />
          </Field></div>
          <div className="sm:col-span-2"><Field label="Editorial note"><textarea className={textAreaClass} rows={2} maxLength={1000} value={entry.note} onChange={event => update({ entries: data.entries.map((item, i) => i === index ? { ...item, note: event.target.value } : item) })} placeholder="Why this reference is approved or how terminology should be used." /></Field></div>
        </div>
      </div>)}
    </div>
  }
  const data = definition as BlueprintDefinition
  return <div className="space-y-4">
    <Field label="Content type"><select className={inputClass} value={data.contentType} onChange={event => update({ ...data, contentType: event.target.value as BlueprintContentType })}>
      {BLUEPRINT_CONTENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
    </select></Field>
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] font-semibold text-[#393844]">Sections & rules</p><p className="text-[10px] text-[#898793]">Use rules to make expected evidence and structure clear.</p></div>
      <Button disabled={data.sections.length >= 100} onClick={() => update({ ...data, sections: [...data.sections, { id: newId('section'), title: '', required: true, rules: [] }] })}>Add section</Button>
    </div>
    {data.sections.length === 0 && <EmptyInset title="Blueprint has no sections" text="Add a section to describe the required content structure." />}
    {data.sections.map((section, index) => <div key={section.id} className="rounded-xl border border-[#E7E5DF] bg-[#F8F7F4] p-3.5 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold text-[#3C3B47]">Section {index + 1}</p><p className="font-mono text-[9px] text-[#9694A0]">{section.id}</p></div><Button kind="quiet" title={`Remove section ${index + 1}`} onClick={() => update({ ...data, sections: data.sections.filter((_, i) => i !== index) })}>Remove</Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Section title"><input className={inputClass} value={section.title} maxLength={160} onChange={event => update({ ...data, sections: data.sections.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></Field>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[#E4E2DC] bg-white px-3 text-[11px] font-medium text-[#555461]">
          <input type="checkbox" checked={section.required} onChange={event => update({ ...data, sections: data.sections.map((item, i) => i === index ? { ...item, required: event.target.checked } : item) })} className="h-4 w-4 accent-[#5B5BD6]" />
          Required section
        </label>
        <div className="sm:col-span-2"><Field label="Rules" hint="One concise rule per line, up to 20">
          <textarea className={textAreaClass} rows={3} value={section.rules.join('\n')} onChange={event => update({ ...data, sections: data.sections.map((item, i) => i === index ? { ...item, rules: event.target.value.split('\n').map(rule => rule.trim()).filter(Boolean).slice(0, 20) } : item) })} placeholder="State what should be included…" />
        </Field></div>
      </div>
    </div>)}
  </div>
}

function WorkflowSteps({ data, update }: { data: WorkflowDefinition; update: (definition: AiDefinition) => void }) {
  return <div className="rounded-xl border border-[#E7E5DF] bg-[#F8F7F4] p-3.5 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] font-semibold text-[#393844]">Workflow steps</p><p className="text-[10px] text-[#898793]">Capability labels only; no execution occurs here.</p></div>
      <Button disabled={data.steps.length >= 30} onClick={() => update({ ...data, steps: [...data.steps, { id: newId('step'), capability: '' }] })}>Add step</Button>
    </div>
    {data.steps.length === 0 && <p className="rounded-lg border border-dashed border-[#DEDCD6] px-3 py-3 text-[10px] text-[#8C8A95]">No additional steps defined.</p>}
    <div className="space-y-2">{data.steps.map((step, index) => <div key={step.id} className="flex items-center gap-2">
      <span className="w-5 flex-none text-center font-mono text-[9px] text-[#92909A]">{String(index + 1).padStart(2, '0')}</span>
      <input aria-label={`Step ${index + 1} capability`} className={inputClass} value={step.capability} maxLength={100} placeholder="Capability"
        onChange={event => update({ ...data, steps: data.steps.map((item, i) => i === index ? { ...item, capability: event.target.value } : item) })} />
      <Button kind="quiet" title={`Remove step ${index + 1}`} onClick={() => update({ ...data, steps: data.steps.filter((_, i) => i !== index) })}>Remove</Button>
    </div>)}</div>
  </div>
}

function EmptyInset({ title, text }: { title: string; text: string }) {
  return <div className="rounded-xl border border-dashed border-[#DCDAD4] bg-[#F8F7F4] px-4 py-5">
    <p className="text-[11px] font-semibold text-[#555460]">{title}</p><p className="mt-1 text-[10px] leading-5 text-[#898793]">{text}</p>
  </div>
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AiControlCenter({ mode, context }: Props) {
  const canManage = context.membership.role === 'owner' || context.membership.role === 'admin'
  const [area, setArea] = useState<Area>('connections')
  const [assets, setAssets] = useState<AiAssetVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [selected, setSelected] = useState<AiAssetVersion | null>(null)
  const [history, setHistory] = useState<AiAssetVersion[] | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [isRevising, setIsRevising] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const requestSequence = useRef(0)
  const historyRequestSequence = useRef(0)
  const selectedAssetKey = useRef<string | null>(null)
  const kind = area === 'connections' ? null : area

  function assetKey(asset: AiAssetVersion | null) {
    return asset ? `${asset.id}:${asset.version}` : null
  }
  function invalidateHistory() {
    historyRequestSequence.current += 1
    setHistory(null)
    setHistoryBusy(false)
    setHistoryError('')
  }
  function selectAsset(asset: AiAssetVersion | null) {
    selectedAssetKey.current = assetKey(asset)
    setSelected(asset)
  }

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current
    setLoading(true)
    setLoadError('')
    try {
      const result = await listAiAssets()
      if (!Array.isArray(result)) throw new Error('Catalog returned an invalid asset list.')
      if (result.some(asset => !asset || asset.workspaceId !== context.workspace.id))
        throw new Error('The catalog response included records outside this workspace. No definitions are shown.')
      if (requestId !== requestSequence.current) return
      setAssets(result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch (error) {
      if (requestId !== requestSequence.current) return
      setAssets([])
      selectAsset(null)
      invalidateHistory()
      setLoadError(catalogErrorMessage(error, 'Definitions could not be loaded.'))
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [context.workspace.id])

  useEffect(() => { void refresh() }, [refresh])
  const latestAssets = useMemo(() => {
    const latest = new Map<string, AiAssetVersion>()
    for (const asset of assets) {
      const previous = latest.get(asset.id)
      if (!previous || asset.version > previous.version) latest.set(asset.id, asset)
    }
    return [...latest.values()]
  }, [assets])
  const visibleAssets = useMemo(() => latestAssets.filter(asset => asset.kind === kind && asset.state !== 'archived')
    .sort((a, b) => a.name.localeCompare(b.name)), [latestAssets, kind])

  function openCreate() {
    if (!kind || !canManage) return
    setDraft(initialDraft(kind))
    selectAsset(null)
    invalidateHistory()
    setIsRevising(false)
    setNotice(null)
  }
  function openRevise(asset: AiAssetVersion) {
    setDraft({ kind: asset.kind, name: asset.name, description: asset.description, definition: structuredClone(asset.definition) })
    selectAsset(asset)
    invalidateHistory()
    setIsRevising(true)
    setNotice(null)
  }
  function closeEditor() {
    setDraft(null)
    setIsRevising(false)
  }
  function selectArea(next: Area) {
    setArea(next)
    selectAsset(null)
    invalidateHistory()
    setNotice(null)
    setDraft(null)
  }
  function updateDefinition(definition: AiDefinition) {
    setDraft(current => current ? { ...current, definition } : null)
  }
  async function saveDraft(event: FormEvent) {
    event.preventDefault()
    if (!draft || !canManage || busy) return
    const clean: AiAssetInput = {
      kind: draft.kind,
      name: draft.name.trim(),
      description: draft.description.trim(),
      definition: draft.definition,
    }
    if (!validateAiAssetInput(clean)) {
      setNotice({ type: 'error', text: 'Check required fields, unique IDs, and the catalog limits before saving.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const saved = isRevising && selected
        ? await executeAiCatalog({ action: 'revise', id: selected.id, expectedVersion: selected.version, asset: clean })
        : await executeAiCatalog({ action: 'create', asset: clean })
      if (!isConfirmedAsset(saved, context.workspace.id, clean, isRevising ? selected ?? undefined : undefined))
        throw new AiCatalogApiError(0, 'INVALID_RESPONSE', 'The catalog did not confirm the requested definition.')
      setNotice({ type: 'success', text: `${kindTitles[saved.kind]} ${isRevising ? 'revision' : 'definition'} saved as v${saved.version}.` })
      selectAsset(saved)
      invalidateHistory()
      closeEditor()
      await refresh()
    } catch (error) {
      const conflict = (error instanceof AiCatalogApiError && (error.code === 'VERSION_CONFLICT' || error.status === 409))
        || (error instanceof Error && /conflict|version|409/i.test(error.message))
      setNotice({ type: 'error', text: conflict
        ? catalogErrorMessage(error, 'This definition changed elsewhere. Your draft is still here.')
        : catalogErrorMessage(error, 'The definition could not be saved.') })
    } finally {
      setBusy(false)
    }
  }
  async function transition(asset: AiAssetVersion, state: AiVersionState) {
    if (!canManage || busy || loading || loadError) return
    setBusy(true)
    setNotice(null)
    setConfirmArchive(false)
    try {
      const result = await executeAiCatalog({ action: 'transition', id: asset.id, expectedVersion: asset.version, state })
      const transitionInput: AiAssetInput = { kind: asset.kind, name: asset.name, description: asset.description, definition: asset.definition }
      if (!isConfirmedAsset(result, context.workspace.id, transitionInput, asset, state))
        throw new AiCatalogApiError(0, 'INVALID_RESPONSE', 'The catalog did not confirm the requested state change.')
      selectAsset(result)
      invalidateHistory()
      setNotice({ type: 'success', text: `${kindTitles[result.kind]} moved to ${stateLabels[result.state].toLowerCase()}.` })
      await refresh()
    } catch (error) {
      const conflict = (error instanceof AiCatalogApiError && (error.code === 'VERSION_CONFLICT' || error.status === 409))
        || (error instanceof Error && /conflict|version|409/i.test(error.message))
      setNotice({ type: 'error', text: conflict
        ? catalogErrorMessage(error, 'A newer version exists. Refresh the catalog, then review the latest version before changing state.')
        : catalogErrorMessage(error, 'The state change could not be saved.') })
      if (conflict) await refresh()
    } finally { setBusy(false) }
  }
  async function loadHistory(asset: AiAssetVersion) {
    if (loading || loadError || historyBusy) return
    const requestId = ++historyRequestSequence.current
    const expectedAssetKey = assetKey(asset)
    setHistoryBusy(true)
    setHistory(null)
    setHistoryError('')
    const stillCurrent = () => requestId === historyRequestSequence.current
      && selectedAssetKey.current === expectedAssetKey
    try {
      const items = await historyAiAsset(asset.id)
      if (!Array.isArray(items) || items.some(item => !item || item.workspaceId !== context.workspace.id || item.id !== asset.id))
        throw new AiCatalogApiError(0, 'INVALID_RESPONSE', 'History included records outside this workspace.')
      if (stillCurrent()) setHistory(items.sort((a, b) => b.version - a.version))
    } catch (error) {
      if (stillCurrent()) setHistoryError(catalogErrorMessage(error, 'Version history could not be loaded.'))
    } finally {
      if (stillCurrent()) setHistoryBusy(false)
    }
  }
  function chooseHistoryVersion(version: AiAssetVersion) {
    selectAsset(version)
    invalidateHistory()
    setDraft(null)
    setConfirmArchive(false)
  }

  const allowedTransitions = selected && canManage
    ? (['test', 'published', 'archived', 'draft'] as AiVersionState[]).filter(state => validateAiTransition(selected, state))
    : []

  return <section className="mt-7" aria-labelledby="ai-control-title" data-testid="ai-control-center">
    <header className="relative mb-6 overflow-hidden rounded-2xl border border-[#E1DFD9] bg-[#FCFBF9] px-5 py-6 sm:px-8 sm:py-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-14 h-48 w-48 rounded-full border border-[#E7E4DD] sm:right-12 sm:top-[-90px] sm:h-64 sm:w-64" />
      <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${mode === 'cloud' ? 'border-[#D9E4DD] bg-[#F0F5F1] text-[#52715C]' : 'border-[#E9DECD] bg-[#F7F1E8] text-[#8B6B3D]'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${mode === 'cloud' ? 'bg-[#638D77]' : 'bg-[#B58749]'}`} />
              {mode === 'cloud' ? 'Cloud workspace' : 'Local development'}
            </span>
            <span className="text-[10px] text-[#9694A0]">{context.workspace.name || 'Workspace'} · {context.membership.role}</span>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77758B]">Content Studio / Administration</p>
          <h2 id="ai-control-title" className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.04em] text-[#22222E] sm:text-[32px]">AI Control Center</h2>
          <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[#747381]">A careful registry for documentation workflows, prompts, references, and blueprints. Definitions are versioned; content is never generated here.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${canManage ? 'border-[#D8E6DC] bg-[#EFF5F0] text-[#52715C]' : 'border-[#E3E1DC] bg-[#F4F3F0] text-[#777581]'}`}>
            {canManage ? 'Owner / admin controls' : 'Read-only access'}
          </span>
          <Button onClick={() => { void refresh() }} disabled={loading || busy} title="Reload persisted definitions">Refresh</Button>
        </div>
      </div>
    </header>

    <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="AI Control Center sections" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-2">
        <p className="px-3 pb-2 pt-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#9694A0]">Catalog</p>
        <ul className="space-y-1">{areas.map(item => {
          const active = area === item.id
          return <li key={item.id}><button type="button" onClick={() => selectArea(item.id)} aria-current={active ? 'page' : undefined}
            className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] ${active ? 'bg-[#F0EFFA] text-[#4F4DA4]' : 'text-[#62616D] hover:bg-[#F5F4F1] hover:text-[#33323E]'}`}>
            <span className={`font-mono text-[9px] ${active ? 'text-[#7775BC]' : 'text-[#AAA8B0]'}`}>{item.number}</span>
            <span className="text-[11px] font-semibold">{item.label}</span>
            {item.id !== 'connections' && <span className="ml-auto text-[9px] text-[#9694A0]">{loading || loadError ? '—' : latestAssets.filter(asset => asset.kind === item.id && asset.state !== 'archived').length}</span>}
          </button></li>
        })}</ul>
        <div className="mx-2 mt-3 border-t border-[#ECEAE5] px-1 pt-3">
          <p className="text-[9px] leading-4 text-[#9694A0]">Versioned workspace definitions only. No prompts are executed from this area.</p>
        </div>
      </nav>

      <main className="min-w-0" aria-busy={loading || busy}>
        {area === 'connections' ? <Connections mode={mode} /> : <>
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74738A]">{kindTitles[kind!]}</p>
              <h3 className="mt-1 text-[19px] font-semibold tracking-[-0.03em] text-[#292834]">{areas.find(item => item.id === area)?.label}</h3>
              <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#777685]">{kindDescriptions[kind!]}</p>
            </div>
            {canManage && <Button kind="primary" onClick={openCreate} disabled={loading || !!loadError || busy}>Create {kindTitles[kind!].toLowerCase()}</Button>}
          </div>
          <div className="sr-only" role={busy || loading || historyBusy ? 'status' : undefined} aria-live="polite">
            {loading ? 'Loading catalog definitions.' : busy ? 'Saving catalog changes.' : historyBusy ? 'Loading version history.' : ''}
          </div>
          {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}
          {loadError ? <div role="alert" className="rounded-xl border border-[#E9C9C2] bg-[#FFF7F4] p-4 text-[11px] text-[#854F42]">
            <p className="font-semibold">Catalog could not be loaded</p><p className="mt-1 leading-5">{loadError}</p>
            <Button onClick={() => { void refresh() }} disabled={loading} >Retry loading</Button>
          </div> : loading ? <CatalogSkeleton /> : visibleAssets.length === 0 ? <EmptyInset title={`No ${areas.find(item => item.id === area)?.label.toLowerCase()} yet`} text={canManage ? 'Create a definition when the team is ready to establish a versioned baseline.' : 'Persisted definitions for this area will appear here when available.'} /> : <div className="grid gap-3">
            {visibleAssets.map(asset => <AssetRow key={asset.id} asset={asset} active={selected?.id === asset.id && selected.version === asset.version}
              onSelect={() => { if (!loading && !loadError) { selectAsset(asset); invalidateHistory(); setDraft(null); setNotice(null) } }} />)}
          </div>}
          {!loading && !loadError && selected && selected.kind === kind && <AssetDetail asset={selected}
             canManage={canManage && !loading && !loadError && latestAssets.some(item => item.id === selected.id && item.version === selected.version)}
             isCurrentVersion={latestAssets.some(item => item.id === selected.id && item.version === selected.version)} busy={busy || loading || !!loadError}
            onRevise={() => openRevise(selected)} onTransition={state => { if (state === 'archived') setConfirmArchive(true); else void transition(selected, state) }}
             onHistory={() => { void loadHistory(selected) }} history={history} historyBusy={historyBusy} historyError={historyError}
            onSelectVersion={chooseHistoryVersion} allowedTransitions={allowedTransitions} />}
          {!loading && !loadError && confirmArchive && selected && <div className="mt-3 rounded-xl border border-[#E8C9C0] bg-[#FFF8F5] p-4" role="alertdialog" aria-labelledby="archive-title" aria-describedby="archive-description">
            <p id="archive-title" className="text-[12px] font-semibold text-[#75483C]">Archive this version?</p>
            <p id="archive-description" className="mt-1 text-[11px] leading-5 text-[#8A6258]">The definition remains in version history and will no longer appear among active definitions.</p>
            <div className="mt-3 flex flex-wrap gap-2"><Button kind="danger" disabled={busy} onClick={() => { void transition(selected, 'archived') }}>Archive definition</Button><Button disabled={busy} onClick={() => setConfirmArchive(false)}>Keep active</Button></div>
          </div>}
          {draft && <EditorDialog draft={draft} isRevising={isRevising} baseVersion={selected?.version} busy={busy}
            assets={latestAssets} originalAsset={isRevising ? selected : null}
            notice={notice?.type === 'error' ? notice : null} onDismissNotice={() => setNotice(null)}
            onChange={setDraft} onSubmit={saveDraft} onClose={closeEditor} />}
        </>}
      </main>
    </div>
    <footer className="mt-6 border-t border-[#E4E2DC] pt-3 text-[10px] leading-5 text-[#92909A]">
      Catalog actions are workspace-scoped and version-checked. Authorization must be enforced by the persistence layer as well as this interface.
    </footer>
  </section>
}

function Connections({ mode }: { mode: 'local-dev' | 'cloud' }) {
  return <section aria-labelledby="connections-title" className="rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-5 sm:p-7">
    <div className="flex flex-col justify-between gap-3 border-b border-[#ECEAE5] pb-5 sm:flex-row sm:items-start">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74738A]">Provider access</p>
        <h3 id="connections-title" className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-[#292834]">Connections</h3>
        <p className="mt-1 max-w-xl text-[11px] leading-5 text-[#777685]">A transparent status surface. This workspace has no provider configuration available to inspect or manage.</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#E6DDC9] bg-[#F8F3E8] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#8B7040]"><span className="h-1.5 w-1.5 rounded-full bg-[#B58749]" />Unconfigured</span>
    </div>
    <div className="mt-5 rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[#E3E1DA] bg-[#F0EFEB] text-[#777581]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.1 9.9 9.9 6.1M5.2 6.4l-1.1 1.1a2.4 2.4 0 0 0 3.4 3.4l1.1-1.1M10.8 9.6l1.1-1.1a2.4 2.4 0 0 0-3.4-3.4L7.4 6.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[#393844]">No connection record</p>
          <p className="mt-1 text-[11px] leading-5 text-[#777685]">{mode === 'cloud'
            ? 'The server has not exposed a configured connection for this workspace.'
            : 'Local development does not provide a persisted provider connection.'}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-[#E9E7E1] rounded-lg border border-[#E6E4DE] bg-[#FCFBF9]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3"><dt className="text-[10px] text-[#858391]">Provider identity</dt><dd className="text-[10px] font-medium text-[#777581]">Not available</dd></div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3"><dt className="text-[10px] text-[#858391]">Verification time</dt><dd className="text-[10px] font-medium text-[#777581]">Not available</dd></div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3"><dt className="text-[10px] text-[#858391]">Model selection</dt><dd className="text-[10px] font-medium text-[#777581]">Auto only</dd></div>
      </dl>
    </div>
    <aside role="note" className="mt-4 rounded-xl border border-[#E9DECD] bg-[#F7F1E8] px-4 py-3.5">
      <p className="text-[11px] font-semibold text-[#6D5738]">No provider operations are available here</p>
      <p className="mt-1 text-[10px] leading-5 text-[#75634A]">There is no credential field, connect or test action, provider/model catalogue, or AI execution in this surface. Workflow definitions remain provider-neutral until a real connection contract exists.</p>
    </aside>
  </section>
}

function AssetRow({ asset, active, onSelect }: { asset: AiAssetVersion; active: boolean; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} aria-pressed={active}
    className={`w-full rounded-xl border px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] ${active ? 'border-[#C9C7EF] bg-[#F7F6FE]' : 'border-[#E2E0DA] bg-[#FCFBF9] hover:border-[#D0CEE8] hover:bg-[#FAF9FE]'}`}>
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-semibold text-[#32313E]">{asset.name}</span><StatePill state={asset.state} /></div>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#81808C]">{asset.description || 'No description recorded.'}</p></div>
      <div className="flex flex-none items-center gap-3 text-[9px] text-[#898793]"><span className="font-mono">v{asset.version}</span><span>{formatDate(asset.createdAt)}</span><span aria-hidden="true" className="text-[#A7A5AE]">›</span></div>
    </div>
  </button>
}

function AssetDetail({ asset, canManage, isCurrentVersion, busy, onRevise, onTransition, onHistory, history, historyBusy, historyError, onSelectVersion, allowedTransitions }: {
  asset: AiAssetVersion
  canManage: boolean
  isCurrentVersion: boolean
  busy: boolean
  onRevise: () => void
  onTransition: (state: AiVersionState) => void
  onHistory: () => void
  history: AiAssetVersion[] | null
  historyBusy: boolean
  historyError: string
  onSelectVersion: (asset: AiAssetVersion) => void
  allowedTransitions: AiVersionState[]
}) {
  return <section aria-labelledby="asset-detail-title" className="mt-4 rounded-2xl border border-[#E2E0DA] bg-[#FCFBF9] p-4 sm:p-6">
    <div className="flex flex-col justify-between gap-4 border-b border-[#ECEAE5] pb-4 sm:flex-row sm:items-start">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 id="asset-detail-title" className="break-words text-[16px] font-semibold tracking-[-0.02em] text-[#2D2C38]">{asset.name}</h4><StatePill state={asset.state} /></div>
        <p className="mt-1 text-[10px] text-[#898793]">{kindTitles[asset.kind]} · version {asset.version} · created {formatDate(asset.createdAt)}</p>
        <p className="mt-3 max-w-3xl whitespace-pre-wrap text-[11px] leading-5 text-[#666571]">{asset.description || 'No description recorded.'}</p>
      </div>
      {canManage && <div className="flex flex-wrap gap-2">
        {asset.state !== 'archived' && <Button onClick={onRevise} disabled={busy}>Revise</Button>}
        {allowedTransitions.filter(state => state !== 'archived').map(state => <Button key={state} onClick={() => onTransition(state)} disabled={busy} kind={state === 'published' ? 'primary' : 'secondary'}>
          {state === 'published' ? 'Publish' : state === 'test' ? 'Move to review' : 'Return to draft'}
        </Button>)}
        {allowedTransitions.includes('archived') && <Button kind="danger" onClick={() => onTransition('archived')} disabled={busy}>Archive</Button>}
      </div>}
    </div>
    <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(200px,0.55fr)]">
      <DefinitionSummary asset={asset} />
      <div className="rounded-xl border border-[#E8E6E0] bg-[#F8F7F4] p-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#8B8994]">Provenance</p>
        <dl className="mt-3 space-y-3 text-[10px]">
          <div><dt className="text-[#9795A0]">Created by</dt><dd className="mt-0.5 break-all font-medium text-[#4E4D59]">{asset.createdBy || 'Not recorded'}</dd></div>
          <div><dt className="text-[#9795A0]">Workspace</dt><dd className="mt-0.5 break-all font-mono text-[9px] text-[#4E4D59]">{asset.workspaceId}</dd></div>
          <div><dt className="text-[#9795A0]">Version identity</dt><dd className="mt-0.5 break-all font-mono text-[9px] text-[#4E4D59]">{asset.id} · v{asset.version}</dd></div>
        </dl>
      </div>
    </div>
    <div className="border-t border-[#ECEAE5] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] font-semibold text-[#4A4955]">Version history</p><p className="text-[10px] text-[#92909A]">Review prior snapshots without changing them.</p></div>
        <Button onClick={onHistory} disabled={busy || historyBusy}>{historyBusy ? 'Loading history…' : history ? 'Reload history' : 'Load history'}</Button>
      </div>
      {historyBusy && <div role="status" className="mt-3 h-12 animate-pulse rounded-lg bg-[#F2F1EE]" />}
      {historyError && <div role="alert" className="mt-3 rounded-lg border border-[#E9C9C2] bg-[#FFF7F4] p-3 text-[10px] leading-5 text-[#854F42]">
        <p>{historyError}</p><Button onClick={onHistory} disabled={historyBusy || busy}>Retry history</Button>
      </div>}
      {history && <div className="mt-3 divide-y divide-[#ECEAE5] rounded-xl border border-[#E8E6E0]">
        {history.length === 0 ? <p className="px-3 py-4 text-[10px] text-[#898793]">No history is available for this definition.</p> : history.map(version => <button key={`${version.id}:${version.version}`} type="button" onClick={() => onSelectVersion(version)}
          className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 text-left hover:bg-[#F8F7F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5B5BD6]">
          <span className="flex items-center gap-2"><span className="font-mono text-[10px] text-[#555461]">v{version.version}</span><StatePill state={version.state} />{version.version === asset.version && <span className="text-[9px] text-[#77758B]">Selected</span>}</span>
          <span className="text-[9px] text-[#92909A]">{formatDate(version.createdAt)}</span>
        </button>)}
      </div>}
      {!canManage && <p className="mt-3 text-[10px] text-[#92909A]">{isCurrentVersion
        ? 'Changes to definitions and their lifecycle are reserved for workspace owners and administrators.'
        : 'This historical snapshot is read-only. Select the latest version to make an authorized change.'}</p>}
    </div>
  </section>
}

function DefinitionSummary({ asset }: { asset: AiAssetVersion }) {
  const data = asset.definition
  return <div className="min-w-0 rounded-xl border border-[#E8E6E0] bg-white p-3.5">
    <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#8B8994]">Definition snapshot</p>
    {asset.kind === 'workflow' && <div className="mt-3 space-y-3 text-[10px]">
      <SummaryLine label="Capability" value={(data as WorkflowDefinition).capability || 'Not set'} />
      <SummaryLine label="Model mode" value="Auto · no pinned model" />
      <SummaryLine label="Linked records" value={['promptPack', 'referenceSet', 'blueprint'].map(key => {
        const ref = (data as WorkflowDefinition)[key as 'promptPack' | 'referenceSet' | 'blueprint']
        return ref ? `${key}: v${ref.version}` : null
      }).filter(Boolean).join(' · ') || 'None'} />
      <SummaryLine label="Additional steps" value={String((data as WorkflowDefinition).steps.length)} />
    </div>}
    {asset.kind === 'prompt-pack' && <div className="mt-3 space-y-2">
      {(data as PromptPackDefinition).prompts.length ? (data as PromptPackDefinition).prompts.map(prompt => <div key={prompt.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EFEB] pb-2 last:border-0">
        <div className="min-w-0"><p className="truncate text-[10px] font-semibold text-[#484752]">{prompt.name}</p><p className="mt-0.5 font-mono text-[9px] text-[#92909A]">{prompt.id} · v{prompt.version} · {prompt.variables.length} variables</p></div>
        <StatePill state={prompt.state} />
      </div>) : <p className="text-[10px] text-[#92909A]">No prompts in this pack.</p>}
    </div>}
    {asset.kind === 'reference-set' && <div className="mt-3 space-y-2">
      {(data as ReferenceSetDefinition).entries.length ? (data as ReferenceSetDefinition).entries.map(entry => <div key={entry.id} className="border-b border-[#F0EFEB] pb-2 last:border-0">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-semibold text-[#484752]">{entry.title}</p><span className="rounded-full bg-[#F1F0FA] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#615F9A]">{entry.type === 'approved-example' ? 'Approved example' : 'Terminology'}</span></div>
        <p className="mt-1 break-all font-mono text-[9px] text-[#92909A]">{entry.locator || 'No locator'}</p>
      </div>) : <p className="text-[10px] text-[#92909A]">No reference metadata.</p>}
    </div>}
    {asset.kind === 'blueprint' && <div className="mt-3">
      <p className="mb-2 text-[10px] font-semibold text-[#484752]">{(data as BlueprintDefinition).contentType}</p>
      {(data as BlueprintDefinition).sections.length ? <div className="space-y-2">{(data as BlueprintDefinition).sections.map(section => <div key={section.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EFEB] pb-2 last:border-0">
        <span className="text-[10px] text-[#484752]">{section.title}</span><span className="text-[9px] text-[#92909A]">{section.required ? 'Required' : 'Optional'} · {section.rules.length} rules</span>
      </div>)}</div> : <p className="text-[10px] text-[#92909A]">No sections defined.</p>}
    </div>}
  </div>
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] text-[#9795A0]">{label}</p><p className="mt-0.5 break-words font-medium text-[#4E4D59]">{value}</p></div>
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const color = notice.type === 'error' ? 'border-[#E9C9C2] bg-[#FFF7F4] text-[#854F42]'
    : notice.type === 'success' ? 'border-[#D9E4DD] bg-[#F0F5F1] text-[#4D6B56]'
      : 'border-[#DEDCE9] bg-[#F4F3FA] text-[#5F5C83]'
  return <div role={notice.type === 'error' ? 'alert' : 'status'} className={`mb-3 flex items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-[11px] leading-5 ${color}`}>
    <p>{notice.text}</p><button type="button" onClick={onDismiss} aria-label="Dismiss message" className="rounded px-1 font-semibold hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6]">×</button>
  </div>
}

function CatalogSkeleton() {
  return <div role="status" aria-label="Loading catalog definitions" className="space-y-3">
    {[0, 1, 2].map(item => <div key={item} className="h-[86px] animate-pulse rounded-xl border border-[#E8E6E0] bg-[#FCFBF9] p-4">
      <div className="h-3 w-1/3 rounded bg-[#EBE9E3]" /><div className="mt-3 h-2 w-2/3 rounded bg-[#F0EFEB]" />
    </div>)}
  </div>
}

function EditorDialog({ draft, isRevising, baseVersion, busy, assets, originalAsset, notice, onDismissNotice, onChange, onSubmit, onClose }: {
  draft: EditorDraft
  isRevising: boolean
  baseVersion?: number
  busy: boolean
  assets: AiAssetVersion[]
  originalAsset: AiAssetVersion | null
  notice: Notice | null
  onDismissNotice: () => void
  onChange: (draft: EditorDraft) => void
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#25242C]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="editor-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose() }} className="max-h-[94dvh] w-full max-w-3xl overflow-hidden rounded-t-2xl border border-[#E1DFD9] bg-[#FCFBF9] shadow-[0_18px_70px_rgba(37,36,44,0.18)] sm:rounded-2xl">
      <form onSubmit={onSubmit} className="flex max-h-[94dvh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-[#ECEAE5] px-5 py-4 sm:px-6">
          <div><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#77758B]">{isRevising ? `New snapshot · based on v${baseVersion}` : 'New definition'}</p>
            <h3 id="editor-title" className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#292834]">{isRevising ? `Revise ${kindTitles[draft.kind].toLowerCase()}` : `Create ${kindTitles[draft.kind].toLowerCase()}`}</h3>
            <p className="mt-1 text-[10px] leading-4 text-[#898793]">Saved as a new versioned catalog record. No content generation occurs.</p>
          </div>
          <button type="button" aria-label="Close editor" onClick={onClose} disabled={busy} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[20px] text-[#858391] hover:bg-[#F1F0ED] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B5BD6] disabled:opacity-50">×</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {notice && <NoticeBanner notice={notice} onDismiss={onDismissNotice} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input autoFocus required className={inputClass} value={draft.name} maxLength={120} onChange={event => onChange({ ...draft, name: event.target.value })} placeholder={`Untitled ${kindTitles[draft.kind].toLowerCase()}`} /></Field>
            <Field label="Description" hint={`${draft.description.length}/1000`}><input className={inputClass} value={draft.description} maxLength={1000} onChange={event => onChange({ ...draft, description: event.target.value })} placeholder="Purpose and scope" /></Field>
          </div>
          <div className="border-t border-[#ECEAE5] pt-4"><DefinitionEditor draft={draft} assets={assets}
            promptBaseVersions={Object.fromEntries(originalAsset?.kind === 'prompt-pack'
              ? (originalAsset.definition as PromptPackDefinition).prompts.map(prompt => [prompt.id, prompt.version])
              : [])}
            update={definition => onChange({ ...draft, definition })} /></div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ECEAE5] bg-[#F8F7F4] px-5 py-3.5 sm:px-6">
          <p className="text-[9px] text-[#92909A]">{isRevising ? 'Original snapshot stays unchanged.' : 'Creates a new draft definition.'}</p>
          <div className="flex gap-2"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" kind="primary" disabled={busy}>{busy ? 'Saving…' : isRevising ? 'Save revision' : 'Create definition'}</Button></div>
        </footer>
      </form>
    </section>
  </div>
}