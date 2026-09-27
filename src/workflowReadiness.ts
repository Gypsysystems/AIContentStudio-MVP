import {
  canTransitionAiVersion,
  validateAiInitialAsset,
  validateAiAssetInput,
  validateAiRevision,
  type AiAssetVersion,
  type PromptPackDefinition,
  type WorkflowDefinition,
} from './aiCatalogModel'

export type WorkflowReadinessStatus = 'ready' | 'blocked'
export const WORKFLOW_READINESS_BLOCKER_CODES = [
  'WORKFLOW_HISTORY_INVALID', 'WORKFLOW_VERSION_NOT_FOUND', 'WORKFLOW_ARCHIVED',
  'WORKFLOW_WRONG_KIND', 'WORKFLOW_WRONG_WORKSPACE', 'WORKFLOW_NOT_PUBLISHED',
  'WORKFLOW_NOT_PUBLISHABLE', 'DEPENDENCY_HISTORY_UNAVAILABLE', 'DEPENDENCY_HISTORY_INVALID',
  'DEPENDENCY_VERSION_NOT_FOUND', 'DEPENDENCY_REFERENCE_INVALID', 'DEPENDENCY_REFERENCE_MISSING', 'DEPENDENCY_WRONG_KIND',
  'DEPENDENCY_WRONG_WORKSPACE', 'DEPENDENCY_ARCHIVED', 'DEPENDENCY_NOT_PUBLISHED',
  'PROMPT_NOT_PUBLISHED', 'MODEL_PIN_INVALID', 'MODEL_NOT_PINNED', 'MODEL_CONNECTION_MISSING',
  'MODEL_CONNECTION_UNVERIFIED', 'MODEL_DISCOVERY_UNSUPPORTED', 'MODEL_DISCOVERY_UNAVAILABLE',
  'MODEL_DISCOVERY_AUTH_FAILED', 'MODEL_DISCOVERY_MALFORMED', 'MODEL_NOT_AVAILABLE',
] as const
export type WorkflowReadinessBlockerCode = typeof WORKFLOW_READINESS_BLOCKER_CODES[number]
export type WorkflowReadinessAsset = {
  id: string
  version: number
  name: string
  state: AiAssetVersion['state']
}
export type WorkflowReadiness = {
  status: WorkflowReadinessStatus
  workflow: { id: string; version: number } | null
  dependencies: {
    promptPack: WorkflowReadinessAsset | null
    referenceSet: WorkflowReadinessAsset | null
    blueprint: WorkflowReadinessAsset | null
  }
  model: { providerId: string; modelId: string } | null
  checkedAt: string
  blockers: { code: WorkflowReadinessBlockerCode; message: string }[]
}

export type WorkflowReadinessConnection = {
  providerId: string
  revision: number
  state: string
  credentialRevision: number | null
  discovery: { state: string; models: { providerId: string; id: string }[] } | null
} | null

export type WorkflowReadinessInput = {
  workspaceId: string
  id: string
  version: number
  workflowHistory: readonly unknown[]
  dependencyHistories: {
    promptPack: readonly unknown[] | null
    referenceSet: readonly unknown[] | null
    blueprint: readonly unknown[] | null
  }
  connection?: WorkflowReadinessConnection
  checkedAt?: string
  publishCandidate?: boolean
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validAsset(value: unknown, workspaceId: string): value is AiAssetVersion {
  if (!isObject(value)
    || Object.keys(value).some(key => ![
      'workspaceId', 'id', 'kind', 'version', 'state', 'name', 'description',
      'definition', 'createdAt', 'createdBy',
    ].includes(key))
    || value.workspaceId !== workspaceId
    || typeof value.id !== 'string' || !SAFE_ID.test(value.id)
    || !['workflow', 'prompt-pack', 'reference-set', 'blueprint'].includes(String(value.kind))
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !['draft', 'test', 'published', 'archived'].includes(String(value.state))
    || typeof value.name !== 'string' || typeof value.description !== 'string'
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.createdBy !== 'string' || !value.createdBy) return false
  return validateAiAssetInput({
    kind: value.kind,
    name: value.name,
    description: value.description,
    definition: value.definition,
  })
}

function validHistory(
  values: readonly unknown[],
  workspaceId: string,
  id: string,
  kind: AiAssetVersion['kind'],
): AiAssetVersion[] | null {
  const assets: AiAssetVersion[] = []
  for (const value of values) {
    if (!validAsset(value, workspaceId)) return null
    assets.push(value)
  }
  if (assets.some(asset => asset.id !== id || asset.kind !== kind)
    || assets.some((asset, index) => asset.version !== index + 1)) return null
  if (assets.length && !validateAiInitialAsset({
    kind: assets[0].kind,
    name: assets[0].name,
    description: assets[0].description,
    definition: assets[0].definition,
  })) return null
  for (let index = 1; index < assets.length; index++) {
    const previous = assets[index - 1]
    const current = assets[index]
    if (!validateAiRevision(previous, {
      kind: current.kind,
      name: current.name,
      description: current.description,
      definition: current.definition,
    }, assets.slice(0, index))) return null
  }
  return assets
}

function historyScopeIssue(
  values: readonly unknown[],
  workspaceId: string,
  id: string,
  kind: AiAssetVersion['kind'],
): 'WORKFLOW_WRONG_WORKSPACE' | 'WORKFLOW_WRONG_KIND' | 'DEPENDENCY_WRONG_WORKSPACE' | 'DEPENDENCY_WRONG_KIND' | null {
  for (const value of values) {
    if (!isObject(value)) continue
    if (value.workspaceId !== workspaceId)
      return kind === 'workflow' ? 'WORKFLOW_WRONG_WORKSPACE' : 'DEPENDENCY_WRONG_WORKSPACE'
    if (value.id === id && value.kind !== kind)
      return kind === 'workflow' ? 'WORKFLOW_WRONG_KIND' : 'DEPENDENCY_WRONG_KIND'
  }
  return null
}

function malformedWorkflowDetails(history: readonly unknown[], id: string, version: number): WorkflowReadinessBlockerCode[] {
  const selected = history.find(value => isObject(value) && value.id === id && value.version === version
    && value.kind === 'workflow')
  if (!isObject(selected) || !isObject(selected.definition)) return []
  const definition = selected.definition
  const codes: WorkflowReadinessBlockerCode[] = []
  for (const field of ['promptPack', 'referenceSet', 'blueprint']) {
    const ref = definition[field]
    if (ref !== null && (!isObject(ref) || typeof ref.id !== 'string' || !SAFE_ID.test(ref.id)
      || Object.keys(ref).sort().join(',') !== 'id,version'
      || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1))
      codes.push('DEPENDENCY_REFERENCE_INVALID')
  }
  const model = definition.model
  const validAuto = isObject(model) && model.mode === 'auto'
    && Object.keys(model).length === 1
  const validPinned = isObject(model) && model.mode === 'pinned'
    && Object.keys(model).sort().join(',') === 'mode,modelId,providerId'
    && typeof model.providerId === 'string' && SAFE_ID.test(model.providerId)
    && typeof model.modelId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model.modelId)
  if (!validAuto && !validPinned)
    codes.push('MODEL_PIN_INVALID')
  return codes
}

function metadata(asset: AiAssetVersion | undefined): WorkflowReadinessAsset | null {
  return asset ? { id: asset.id, version: asset.version, name: asset.name, state: asset.state } : null
}

/**
 * Evaluates only validated, workspace-scoped snapshots and safe connection metadata.
 * It never returns asset definitions, prompt text, credentials, or provider payloads.
 */
export function resolveWorkflowReadiness(input: WorkflowReadinessInput): WorkflowReadiness {
  const blockers: WorkflowReadiness['blockers'] = []
  const add = (code: WorkflowReadinessBlockerCode, message: string) => {
    if (!blockers.some(blocker => blocker.code === code && blocker.message === message))
      blockers.push({ code, message })
  }
  const checkedAt = input.checkedAt && !Number.isNaN(Date.parse(input.checkedAt))
    ? new Date(input.checkedAt).toISOString()
    : new Date().toISOString()
  for (const code of malformedWorkflowDetails(input.workflowHistory, input.id, input.version)) {
    if (code === 'DEPENDENCY_REFERENCE_INVALID')
      add(code, 'A workflow dependency reference is invalid.')
    else add(code, 'The workflow pinned model definition is invalid.')
  }
  const workflowScopeIssue = historyScopeIssue(input.workflowHistory, input.workspaceId, input.id, 'workflow')
  const workflowHistory = validHistory(input.workflowHistory, input.workspaceId, input.id, 'workflow')
  const selected = workflowHistory?.find(asset => asset.version === input.version)
  if (!workflowHistory) {
    const code = workflowScopeIssue ?? 'WORKFLOW_HISTORY_INVALID'
    add(code, code === 'WORKFLOW_WRONG_WORKSPACE'
      ? 'Workflow history contains a version from another workspace.'
      : code === 'WORKFLOW_WRONG_KIND'
        ? 'The requested asset is not a workflow.'
        : 'Workflow version history could not be verified.')
  }
  else if (!selected) add('WORKFLOW_VERSION_NOT_FOUND', 'The requested workflow version was not found.')
  if (workflowHistory?.[workflowHistory.length - 1]?.state === 'archived')
    add('WORKFLOW_ARCHIVED', 'The latest workflow version is archived.')
  if (selected && !input.publishCandidate && selected.state !== 'published')
    add('WORKFLOW_NOT_PUBLISHED', 'The selected workflow version must be published.')
  if (selected && input.publishCandidate) {
    if (!canTransitionAiVersion(selected.state, 'published'))
      add('WORKFLOW_NOT_PUBLISHABLE', 'The selected workflow version cannot be published from its current state.')
    if (workflowHistory?.[workflowHistory.length - 1]?.version !== selected.version)
      add('WORKFLOW_NOT_PUBLISHABLE', 'Only the latest workflow version can be published.')
  }

  const workflow = selected ? { id: selected.id, version: selected.version } : null
  const dependencies: WorkflowReadiness['dependencies'] = {
    promptPack: null, referenceSet: null, blueprint: null,
  }
  let model: WorkflowReadiness['model'] = null

  if (selected) {
    const definition = selected.definition as WorkflowDefinition
    const refs = {
      promptPack: { ref: definition.promptPack, kind: 'prompt-pack' as const },
      referenceSet: { ref: definition.referenceSet, kind: 'reference-set' as const },
      blueprint: { ref: definition.blueprint, kind: 'blueprint' as const },
    }
    for (const key of Object.keys(refs) as (keyof typeof refs)[]) {
      const { ref, kind } = refs[key]
      if (!ref) {
        add('DEPENDENCY_REFERENCE_MISSING', `A ${key} reference is required.`)
        continue
      }
      const rows = input.dependencyHistories[key]
      const scopeIssue = rows ? historyScopeIssue(rows, input.workspaceId, ref.id, kind) : null
      const history = rows === null ? null : rows && validHistory(rows, input.workspaceId, ref.id, kind)
      if (rows === null) {
        add('DEPENDENCY_HISTORY_UNAVAILABLE', `The ${key} version history could not be verified.`)
        continue
      }
      if (!history) {
        const code = scopeIssue ?? 'DEPENDENCY_HISTORY_INVALID'
        add(code, code === 'DEPENDENCY_WRONG_WORKSPACE'
          ? `The ${key} history contains a version from another workspace.`
          : code === 'DEPENDENCY_WRONG_KIND'
            ? `The referenced ${key} ID resolves to a different asset kind.`
            : `The ${key} version history is invalid.`)
        continue
      }
      const exact = history.find(asset => asset.version === ref.version)
      dependencies[key] = metadata(exact)
      if (!exact) {
        add('DEPENDENCY_VERSION_NOT_FOUND', `The referenced ${key} version was not found.`)
        continue
      }
      if (exact.state !== 'published')
        add('DEPENDENCY_NOT_PUBLISHED', `The referenced ${key} version must be published.`)
      if (history[history.length - 1]?.state === 'archived')
        add('DEPENDENCY_ARCHIVED', `The latest ${key} version is archived.`)
      if (key === 'promptPack' && exact.kind === 'prompt-pack'
        && !(exact.definition as PromptPackDefinition).prompts.every(prompt => prompt.state === 'published'))
        add('PROMPT_NOT_PUBLISHED', 'Every prompt in the referenced prompt pack must be published.')
    }
    if (definition.model.mode === 'auto') {
      add('MODEL_NOT_PINNED', 'A pinned model is required for workflow readiness.')
    } else if (definition.model.mode === 'pinned') {
      const pinnedModel = definition.model
      model = { providerId: pinnedModel.providerId, modelId: pinnedModel.modelId }
      const connection = input.connection ?? null
      if (!connection || connection.providerId !== pinnedModel.providerId) {
        add('MODEL_CONNECTION_MISSING', 'A verified connection for the pinned model provider is required.')
      } else if (connection.state !== 'verified' || !Number.isSafeInteger(connection.revision)
        || connection.revision < 1
        || !Number.isSafeInteger(connection.credentialRevision)
        || connection.credentialRevision !== connection.revision) {
        add('MODEL_CONNECTION_UNVERIFIED', 'The pinned model provider connection is not currently verified.')
      } else if (!connection.discovery) {
        add('MODEL_DISCOVERY_UNAVAILABLE', 'The pinned model could not be confirmed with its provider.')
      } else if (connection.discovery.state === 'unsupported') {
        add('MODEL_DISCOVERY_UNSUPPORTED', 'The pinned model provider is not supported.')
      } else if (connection.discovery.state === 'auth-failed') {
        add('MODEL_DISCOVERY_AUTH_FAILED', 'The provider rejected its verified connection credential.')
      } else if (connection.discovery.state === 'unavailable') {
        add('MODEL_DISCOVERY_UNAVAILABLE', 'The pinned model could not be confirmed with its provider.')
      } else if (connection.discovery.state !== 'available') {
        add('MODEL_DISCOVERY_MALFORMED', 'Provider model discovery returned invalid data.')
      } else if (!Array.isArray(connection.discovery.models)
        || connection.discovery.models.length > 1000
        || connection.discovery.models.some(item => !item || Object.keys(item).sort().join(',') !== 'id,providerId'
          || item.providerId !== pinnedModel.providerId || typeof item.id !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(item.id))
        || new Set(connection.discovery.models.map(item => item.id)).size !== connection.discovery.models.length) {
        add('MODEL_DISCOVERY_MALFORMED', 'Provider model discovery returned invalid data.')
      } else if (!connection.discovery.models.some(item => item.providerId === pinnedModel.providerId
        && item.id === pinnedModel.modelId)) {
        add('MODEL_NOT_AVAILABLE', 'The pinned model is not available for the verified provider connection.')
      }
    }
  }

  return {
    status: blockers.length === 0 ? 'ready' : 'blocked',
    workflow,
    dependencies,
    model,
    checkedAt,
    blockers,
  }
}