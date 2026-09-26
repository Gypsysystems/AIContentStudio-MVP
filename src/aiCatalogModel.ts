/** Workspace-scoped, non-secret definitions. No provider credentials or execution requests belong here. */
export type AiAssetKind = 'workflow' | 'prompt-pack' | 'reference-set' | 'blueprint'
export type AiVersionState = 'draft' | 'test' | 'published' | 'archived'
export type BlueprintContentType =
  | 'User Guide' | 'Admin Guide' | 'SOP' | 'Quick Start'
  | 'Training' | 'Features & Capabilities'

export type AiVersionRef = { id: string; version: number }
export type ProviderDescriptor = { id: string; label: string }
export type ModelDescriptor = { providerId: string; id: string; label: string }
export type ConnectionMetadata = {
  providerId: string
  state: 'unconfigured' | 'configured' | 'unavailable'
  verifiedAt: string | null
}

export type WorkflowDefinition = {
  capability: string
  model: { mode: 'auto' } | { mode: 'pinned'; providerId: string; modelId: string }
  promptPack: AiVersionRef | null
  referenceSet: AiVersionRef | null
  blueprint: AiVersionRef | null
  steps: { id: string; capability: string }[]
}
export type PromptDefinition = {
  id: string
  version: number
  state: 'draft' | 'test' | 'published'
  name: string
  template: string
  variables: string[]
}
export type PromptPackDefinition = { prompts: PromptDefinition[] }
export type ReferenceSetDefinition = {
  entries: { id: string; type: 'approved-example' | 'terminology'; title: string; locator: string; note: string }[]
}
export type BlueprintDefinition = {
  contentType: BlueprintContentType
  sections: { id: string; title: string; required: boolean; rules: string[] }[]
}
export type AiDefinition = WorkflowDefinition | PromptPackDefinition | ReferenceSetDefinition | BlueprintDefinition

export type AiAssetVersion = {
  workspaceId: string
  id: string
  kind: AiAssetKind
  version: number
  state: AiVersionState
  name: string
  description: string
  definition: AiDefinition
  createdAt: string
  createdBy: string
}
export type AiAssetInput = Pick<AiAssetVersion, 'kind' | 'name' | 'description' | 'definition'>
export type AiCatalogCommand =
  | { action: 'list' }
  | { action: 'history'; id: string }
  | { action: 'create'; asset: AiAssetInput }
  | { action: 'revise'; id: string; expectedVersion: number; asset: AiAssetInput }
  | { action: 'transition'; id: string; expectedVersion: number; state: AiVersionState }
  | { action: 'delete'; id: string; expectedVersion: number }

export const AI_ASSET_KINDS: AiAssetKind[] = ['workflow', 'prompt-pack', 'reference-set', 'blueprint']
export const BLUEPRINT_CONTENT_TYPES: BlueprintContentType[] =
  ['User Guide', 'Admin Guide', 'SOP', 'Quick Start', 'Training', 'Features & Capabilities']

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}
function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0)
}
function stableId(value: unknown): value is string {
  return text(value, 90) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)
}
function ref(value: unknown): value is AiVersionRef {
  return object(value) && exact(value, ['id', 'version']) && stableId(value.id)
    && Number.isSafeInteger(value.version) && (value.version as number) > 0
}
function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map(item => item.id)).size === items.length
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (object(value)) return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  )
  return value
}

/** PostgreSQL jsonb reorders object keys, so confirmations must ignore key insertion order. */
export function aiDefinitionsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export function validateAiAssetInput(value: unknown): value is AiAssetInput {
  if (!object(value) || !exact(value, ['kind', 'name', 'description', 'definition'])
    || !AI_ASSET_KINDS.includes(value.kind as AiAssetKind)
    || !text(value.name, 120) || !text(value.description, 1000, true)
    || !object(value.definition) || JSON.stringify(value).length > 32_000) return false
  const data = value.definition
  switch (value.kind) {
    case 'workflow': {
      if (!exact(data, ['capability', 'model', 'promptPack', 'referenceSet', 'blueprint', 'steps'])
        || !text(data.capability, 100) || !object(data.model)
        || !(data.model.mode === 'auto' && exact(data.model, ['mode'])
          || data.model.mode === 'pinned' && exact(data.model, ['mode', 'providerId', 'modelId'])
          && stableId(data.model.providerId) && stableId(data.model.modelId))
        || !['promptPack', 'referenceSet', 'blueprint'].every(key => data[key] === null || ref(data[key]))
        || !Array.isArray(data.steps) || data.steps.length > 30) return false
      const steps = data.steps as unknown[]
      return steps.every(step => object(step) && exact(step, ['id', 'capability'])
        && stableId(step.id) && text(step.capability, 100)) && uniqueIds(steps as { id: string }[])
    }
    case 'prompt-pack': {
      if (!exact(data, ['prompts']) || !Array.isArray(data.prompts) || data.prompts.length > 50) return false
      const prompts = data.prompts as unknown[]
      return prompts.every(prompt => object(prompt) && exact(prompt, ['id', 'version', 'state', 'name', 'template', 'variables'])
        && stableId(prompt.id) && Number.isSafeInteger(prompt.version) && (prompt.version as number) > 0
        && ['draft', 'test', 'published'].includes(String(prompt.state))
        && text(prompt.name, 120) && text(prompt.template, 8000, true)
        && Array.isArray(prompt.variables) && prompt.variables.length <= 30
        && prompt.variables.every(variable => stableId(variable)))
        && uniqueIds(prompts as { id: string }[])
    }
    case 'reference-set': {
      if (!exact(data, ['entries']) || !Array.isArray(data.entries) || data.entries.length > 100) return false
      const entries = data.entries as unknown[]
      return entries.every(entry => object(entry) && exact(entry, ['id', 'type', 'title', 'locator', 'note'])
        && stableId(entry.id) && ['approved-example', 'terminology'].includes(String(entry.type))
        && text(entry.title, 160) && text(entry.locator, 500, true) && text(entry.note, 1000, true))
        && uniqueIds(entries as { id: string }[])
    }
    case 'blueprint': {
      if (!exact(data, ['contentType', 'sections'])
        || !BLUEPRINT_CONTENT_TYPES.includes(data.contentType as BlueprintContentType)
        || !Array.isArray(data.sections) || data.sections.length > 100) return false
      const sections = data.sections as unknown[]
      return sections.every(section => object(section) && exact(section, ['id', 'title', 'required', 'rules'])
        && stableId(section.id) && text(section.title, 160) && typeof section.required === 'boolean'
        && Array.isArray(section.rules) && section.rules.length <= 20
        && section.rules.every(rule => text(rule, 500)))
        && uniqueIds(sections as { id: string }[])
    }
    default: return false
  }
}

export function validateAiInitialAsset(value: unknown): value is AiAssetInput {
  return validateAiAssetInput(value)
    && (value.kind !== 'prompt-pack'
      || (value.definition as PromptPackDefinition).prompts.every(prompt => prompt.version === 1 && prompt.state === 'draft'))
}

export function canTransitionAiVersion(from: AiVersionState, to: AiVersionState): boolean {
  return from === 'draft' && ['test', 'published', 'archived'].includes(to)
    || from === 'test' && ['draft', 'published', 'archived'].includes(to)
    || from === 'published' && to === 'archived'
}

/** Revisions always create new rows; publishing never edits the published snapshot. */
export function validateAiRevision(
  previous: AiAssetVersion,
  next: AiAssetInput,
  history: AiAssetVersion[] = [previous],
): boolean {
  if (previous.kind !== next.kind || !validateAiAssetInput(next)) return false
  if (previous.kind !== 'prompt-pack') return true
  const before = (previous.definition as PromptPackDefinition).prompts
  const after = (next.definition as PromptPackDefinition).prompts
  return after.every(prompt => {
    const prior = before.find(candidate => candidate.id === prompt.id)
    if (!prior) {
      const usedBefore = history.some(item => item.id === previous.id && item.kind === 'prompt-pack'
        && (item.definition as PromptPackDefinition).prompts.some(candidate => candidate.id === prompt.id))
      return !usedBefore && prompt.version === 1 && prompt.state === 'draft'
    }
    return (prompt.version === prior.version
      ? aiDefinitionsEqual(prompt, prior)
      : prompt.version === prior.version + 1
        && (prompt.state === 'draft' || canTransitionAiVersion(prior.state, prompt.state)))
  })
}

export function validateAiTransition(previous: AiAssetVersion, state: AiVersionState): boolean {
  return canTransitionAiVersion(previous.state, state)
    && (state !== 'published' || previous.kind !== 'prompt-pack'
      || (previous.definition as PromptPackDefinition).prompts.every(prompt => prompt.state === 'published'))
}