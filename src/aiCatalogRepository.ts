import {
  aiDefinitionsEqual,
  canTransitionAiVersion,
  validateAiInitialAsset,
  validateAiAssetInput,
  validateAiRevision,
  validateAiTransition,
  type AiAssetInput,
  type AiAssetVersion,
  type AiCatalogCommand,
  type AiVersionState,
  type WorkflowDefinition,
} from './aiCatalogModel'
import { getAccessContext } from './authSession'
import { isCloudProjectMode } from './authorizedProjectService'

const DB_NAME = 'docflow-ai-catalog'
const DB_VERSION = 1
const STORE_VERSIONS = 'aiAssetVersions'
const WORKSPACE_INDEX = 'workspaceId'
const ASSET_INDEX = 'workspaceId-id'
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}$/

type StoredAiAssetVersion = AiAssetVersion & { deleted: boolean }
export type AiCatalogApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'MEMBERSHIP_INACTIVE'
  | 'MEMBERSHIP_LOOKUP_FAILED'
  | 'FORBIDDEN'
  | 'ASSET_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'WORKFLOW_REFERENCE_INVALID'
  | 'INVALID_CATALOG_COMMAND'
  | 'AI_CATALOG_SCHEMA_UNAVAILABLE'
  | 'AI_CATALOG_UNAVAILABLE'
  | 'STORAGE_RESPONSE_INVALID'
  | 'API_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'FOREIGN_WORKSPACE'
  | 'BAD_CONFIRMATION'
  | 'AI_CATALOG_REQUEST_FAILED'
  | 'INVALID_REQUEST'
  | 'INVALID_ASSET'
  | 'INVALID_ID'
  | 'INVALID_VERSION'
  | 'INVALID_STATE'
  | 'INVALID_TRANSITION'
  | 'INVALID_REVISION'
  | 'UNEXPECTED_FIELD'
  | 'SENSITIVE_FIELD'
  | 'REQUEST_TOO_LARGE'
  | 'AI_CATALOG_STORAGE_ERROR'
  | 'INVALID_ACTION'
  | 'INVALID_JSON'
  | 'REQUEST_READ_FAILED'

export class AiCatalogApiError extends Error {
  constructor(readonly status: number, readonly code: AiCatalogApiErrorCode, message: string) {
    super(message)
    this.name = 'AiCatalogApiError'
  }
}

function assertValidContext(mutation = false): { workspaceId: string; userId: string } {
  const context = getAccessContext()
  if (!context || !context.user || !context.workspace || !context.membership
    || typeof context.user.id !== 'string' || !context.user.id.trim()
    || typeof context.workspace.id !== 'string' || !context.workspace.id.trim()
    || context.membership.userId !== context.user.id
    || context.membership.workspaceId !== context.workspace.id
    || !['owner', 'admin', 'editor', 'viewer'].includes(context.membership.role)) {
    throw new AiCatalogApiError(403, 'MEMBERSHIP_INACTIVE', 'A matching active workspace membership is required.')
  }
  if (mutation && context.membership.role !== 'owner' && context.membership.role !== 'admin')
    throw new AiCatalogApiError(403, 'FORBIDDEN', `Workspace role "${context.membership.role}" cannot mutate the AI catalog.`)
  return { workspaceId: context.workspace.id, userId: context.user.id }
}

function requireLocalDevelopment(): void {
  if (!import.meta.env.DEV)
    throw new Error('Local AI catalog storage is available only in development; no local fallback was used.')
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_VERSIONS)) {
        const store = database.createObjectStore(STORE_VERSIONS, {
          keyPath: ['workspaceId', 'id', 'version'],
        })
        store.createIndex(WORKSPACE_INDEX, 'workspaceId', { unique: false })
        store.createIndex(ASSET_INDEX, ['workspaceId', 'id'], { unique: false })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('Could not open the local AI catalog database.'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('Opening the local AI catalog database was blocked.'))
    }
  })
  return databasePromise
}

function readAsset(value: unknown, expectedWorkspaceId?: string): AiAssetVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned an invalid asset version.')
  const asset = value as Record<string, unknown>
  if (typeof asset.workspaceId !== 'string' || !asset.workspaceId)
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned invalid asset metadata.')
  if (expectedWorkspaceId !== undefined && asset.workspaceId !== expectedWorkspaceId)
    throw new AiCatalogApiError(503, 'FOREIGN_WORKSPACE', 'AI catalog server returned an asset outside the active workspace.')
  if (Object.keys(asset).some(key => ![
    'workspaceId', 'id', 'kind', 'version', 'state', 'name', 'description',
    'definition', 'createdAt', 'createdBy',
  ].includes(key))
    || typeof asset.id !== 'string' || !SAFE_ID.test(asset.id)
    || !['workflow', 'prompt-pack', 'reference-set', 'blueprint'].includes(String(asset.kind))
    || !Number.isSafeInteger(asset.version) || (asset.version as number) < 1
    || !['draft', 'test', 'published', 'archived'].includes(String(asset.state))
    || typeof asset.name !== 'string' || typeof asset.description !== 'string'
    || typeof asset.createdAt !== 'string' || Number.isNaN(Date.parse(asset.createdAt))
    || typeof asset.createdBy !== 'string' || !asset.createdBy) {
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned invalid asset metadata.')
  }
  const input: AiAssetInput = {
    kind: asset.kind as AiAssetInput['kind'],
    name: asset.name,
    description: asset.description,
    definition: asset.definition as AiAssetInput['definition'],
  }
  if (!validateAiAssetInput(input))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned an asset with an invalid definition.')
  return {
    workspaceId: asset.workspaceId,
    id: asset.id,
    kind: input.kind,
    version: asset.version as number,
    state: asset.state as AiVersionState,
    name: input.name,
    description: input.description,
    definition: input.definition,
    createdAt: asset.createdAt,
    createdBy: asset.createdBy,
  }
}

function localRowsForWorkspace(workspaceId: string): Promise<StoredAiAssetVersion[]> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_VERSIONS, 'readonly')
    const request = transaction.objectStore(STORE_VERSIONS).index(WORKSPACE_INDEX).getAll(workspaceId)
    request.onsuccess = () => resolve(request.result as StoredAiAssetVersion[])
    request.onerror = () => reject(request.error ?? new Error('Could not read the local AI catalog.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Reading the local AI catalog was aborted.'))
  }))
}

function latestVersions(rows: StoredAiAssetVersion[]): Map<string, StoredAiAssetVersion> {
  const latest = new Map<string, StoredAiAssetVersion>()
  for (const row of rows) {
    const current = latest.get(row.id)
    if (!current || row.version > current.version) latest.set(row.id, row)
  }
  return latest
}

function toAsset(row: StoredAiAssetVersion): AiAssetVersion {
  const { deleted: _deleted, ...asset } = row
  return asset
}

function validateLocalWorkflowReferences(asset: AiAssetInput, rows: StoredAiAssetVersion[]): void {
  if (asset.kind !== 'workflow') return
  const definition = asset.definition as WorkflowDefinition
  const expectedKinds = {
    promptPack: 'prompt-pack',
    referenceSet: 'reference-set',
    blueprint: 'blueprint',
  } as const
  for (const field of Object.keys(expectedKinds) as (keyof typeof expectedKinds)[]) {
    const reference = definition[field]
    if (reference === null) continue
    const match = rows.find(row => row.id === reference.id
      && row.version === reference.version && row.kind === expectedKinds[field])
    if (!match)
      throw new Error(`Workflow ${field} must reference an existing ${expectedKinds[field]} version in this workspace.`)
  }
}

async function localList(): Promise<AiAssetVersion[]> {
  requireLocalDevelopment()
  const { workspaceId } = assertValidContext()
  const rows = await localRowsForWorkspace(workspaceId)
  return [...latestVersions(rows).values()]
    .filter(row => !row.deleted)
    .map(toAsset)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

async function localHistory(id: string): Promise<AiAssetVersion[]> {
  requireLocalDevelopment()
  if (!SAFE_ID.test(id)) throw new Error('AI asset ID is invalid.')
  const { workspaceId } = assertValidContext()
  const rows = await localRowsForWorkspace(workspaceId)
  return rows.filter(row => row.id === id).sort((a, b) => a.version - b.version).map(toAsset)
}

function mutationVersion(
  command: Exclude<AiCatalogCommand, { action: 'list' | 'history' }>,
  rows: StoredAiAssetVersion[],
  workspaceId: string,
  userId: string,
): StoredAiAssetVersion {
  if (command.action === 'create') {
    if (!validateAiInitialAsset(command.asset)) throw new Error('AI asset definition is invalid.')
    validateLocalWorkflowReferences(command.asset, rows)
    const id = `ai-${crypto.randomUUID()}`
    if (!SAFE_ID.test(id)) throw new Error('Secure random ID generation returned an invalid AI asset ID.')
    const now = new Date().toISOString()
    return { workspaceId, id, ...command.asset, version: 1, state: 'draft', createdAt: now, createdBy: userId, deleted: false }
  }
  if (!SAFE_ID.test(command.id)) throw new Error('AI asset ID is invalid.')
  const current = latestVersions(rows).get(command.id)
  if (!current || current.deleted) throw new Error(`AI asset "${command.id}" does not exist in this workspace.`)
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)
    throw new Error('Expected AI asset version must be a positive integer.')
  if (current.version !== command.expectedVersion)
    throw new Error(`AI asset "${command.id}" changed: expected version ${command.expectedVersion}, found ${current.version}.`)
  if (current.state === 'archived')
    throw new Error(`AI asset "${command.id}" is archived and cannot be revised, transitioned, or deleted.`)
  const version = current.version + 1
  const createdAt = new Date().toISOString()
  if (command.action === 'revise') {
    if (!validateAiAssetInput(command.asset)) throw new Error('AI asset revision is invalid.')
    validateLocalWorkflowReferences(command.asset, rows)
    const history = rows.filter(row => row.id === current.id).map(toAsset)
    if (!validateAiRevision(current, command.asset, history)) throw new Error('AI asset revision is invalid.')
    return {
      workspaceId, id: current.id, ...command.asset, version, state: 'draft',
      createdAt, createdBy: userId, deleted: false,
    }
  }
  if (command.action === 'transition') {
    if (!validateAiTransition(current, command.state))
      throw new Error(`AI asset cannot transition from "${current.state}" to "${command.state}".`)
    return { ...current, version, state: command.state, createdAt, createdBy: userId, deleted: false }
  }
  if (!canTransitionAiVersion(current.state, 'archived'))
    throw new Error(`AI asset cannot be deleted from state "${current.state}".`)
  return { ...current, version, state: 'archived', createdAt, createdBy: userId, deleted: true }
}

async function localMutate(
  command: Exclude<AiCatalogCommand, { action: 'list' | 'history' }>,
): Promise<AiAssetVersion> {
  requireLocalDevelopment()
  const { workspaceId, userId } = assertValidContext(true)
  const database = await openDatabase()
  let result: StoredAiAssetVersion | null = null
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_VERSIONS, 'readwrite')
    const store = transaction.objectStore(STORE_VERSIONS)
    const request = store.index(WORKSPACE_INDEX).getAll(workspaceId)
    request.onsuccess = () => {
      try {
        result = mutationVersion(command, request.result as StoredAiAssetVersion[], workspaceId, userId)
        store.add(result)
      } catch (error) {
        try { transaction.abort() } catch { /* transaction may already have aborted */ }
        reject(error)
      }
    }
    request.onerror = () => {
      try { transaction.abort() } catch { /* transaction may already have aborted */ }
      reject(request.error ?? new Error('Could not read the local AI catalog for mutation.'))
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('AI catalog mutation was aborted.'))
    transaction.onerror = () => { /* onabort reports the transaction failure */ }
  })
  if (!result) throw new Error('AI catalog mutation did not produce a saved version.')
  return toAsset(result)
}

function apiObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiCatalogApiError(0, 'INVALID_RESPONSE', 'AI catalog server returned an invalid response.')
  return value as Record<string, unknown>
}

const SERVER_ERROR_MESSAGES: Partial<Record<AiCatalogApiErrorCode, string>> = {
  UNAUTHENTICATED: 'A valid authenticated session is required.',
  MEMBERSHIP_INACTIVE: 'An active workspace membership is required.',
  MEMBERSHIP_LOOKUP_FAILED: 'Could not verify current workspace membership.',
  FORBIDDEN: 'The current workspace role does not allow this action.',
  ASSET_NOT_FOUND: 'AI catalog asset was not found in the active workspace.',
  VERSION_CONFLICT: 'The asset changed; reload its latest version before retrying.',
  WORKFLOW_REFERENCE_INVALID: 'Workflow references must resolve to exact asset versions in this workspace.',
  INVALID_CATALOG_COMMAND: 'AI catalog command is invalid for the current asset version.',
  AI_CATALOG_SCHEMA_UNAVAILABLE: 'AI catalog storage schema is unavailable.',
  AI_CATALOG_UNAVAILABLE: 'AI catalog storage is unavailable.',
  AI_CATALOG_STORAGE_ERROR: 'AI catalog storage could not complete the request.',
  STORAGE_RESPONSE_INVALID: 'AI catalog storage returned an invalid response.',
  INVALID_REQUEST: 'AI catalog request is invalid.',
  INVALID_ACTION: 'AI catalog action is not supported.',
  INVALID_JSON: 'AI catalog request must be valid JSON.',
  REQUEST_READ_FAILED: 'AI catalog request body could not be read.',
  INVALID_ASSET: 'AI catalog asset definition is invalid.',
  INVALID_ID: 'AI asset ID is invalid.',
  INVALID_VERSION: 'Expected AI asset version is invalid.',
  INVALID_STATE: 'AI asset state is invalid.',
  INVALID_TRANSITION: 'AI asset cannot transition from its current state.',
  INVALID_REVISION: 'AI asset revision is invalid.',
  UNEXPECTED_FIELD: 'Unexpected AI catalog request fields are not allowed.',
  SENSITIVE_FIELD: 'AI catalog assets cannot contain credentials or secret fields.',
  REQUEST_TOO_LARGE: 'AI catalog request exceeds the supported size limit.',
}

async function cloudRequest(command: AiCatalogCommand): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('/api/ai-catalog', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })
  } catch {
    throw new AiCatalogApiError(0, 'API_UNAVAILABLE', 'AI catalog server is unavailable; no local fallback was used.')
  }
  let body: Record<string, unknown>
  try {
    body = apiObject(await response.json())
  } catch (error) {
    if (error instanceof AiCatalogApiError) throw error
    throw new AiCatalogApiError(response.status, 'INVALID_RESPONSE', 'AI catalog server did not return valid JSON.')
  }
  if (!response.ok) {
    const code = typeof body.code === 'string' && Object.prototype.hasOwnProperty.call(SERVER_ERROR_MESSAGES, body.code)
      ? body.code as AiCatalogApiErrorCode
      : 'AI_CATALOG_UNAVAILABLE'
    throw new AiCatalogApiError(response.status, code,
      SERVER_ERROR_MESSAGES[code] ?? 'AI catalog request failed.')
  }
  return body
}

async function cloudList(): Promise<AiAssetVersion[]> {
  const { workspaceId } = assertValidContext()
  const body = await cloudRequest({ action: 'list' })
  if (Object.keys(body).length !== 1 || !Array.isArray(body.assets))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned an invalid asset list.')
  const assets = body.assets.map(value => readAsset(value, workspaceId))
  if (new Set(assets.map(asset => `${asset.id}:${asset.version}`)).size !== assets.length)
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned duplicate asset versions.')
  if (new Set(assets.map(asset => asset.id)).size !== assets.length || assets.some(asset => asset.state === 'archived'))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned an invalid latest asset list.')
  return assets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

async function cloudHistory(id: string): Promise<AiAssetVersion[]> {
  const { workspaceId } = assertValidContext()
  if (!SAFE_ID.test(id))
    throw new AiCatalogApiError(400, 'INVALID_ID', 'AI asset ID is invalid.')
  const body = await cloudRequest({ action: 'history', id })
  if (Object.keys(body).length !== 1 || !Array.isArray(body.versions))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned invalid asset history.')
  const history = body.versions.map(value => readAsset(value, workspaceId))
  if (history.some(asset => asset.id !== id)
    || new Set(history.map(asset => asset.version)).size !== history.length)
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned history with an invalid asset scope.')
  if (history.some((asset, index) => asset.version !== index + 1))
    throw new AiCatalogApiError(503, 'STORAGE_RESPONSE_INVALID', 'AI catalog server returned invalid asset version history.')
  return history.sort((a, b) => a.version - b.version)
}

async function cloudMutate(
  command: Exclude<AiCatalogCommand, { action: 'list' | 'history' }>,
): Promise<AiAssetVersion> {
  const { workspaceId } = assertValidContext()
  if (command.action !== 'create') {
    const history = await cloudHistory(command.id)
    const current = history[history.length - 1]
    if (!current) throw new AiCatalogApiError(404, 'ASSET_NOT_FOUND', 'AI catalog asset was not found in the active workspace.')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)
      throw new AiCatalogApiError(400, 'INVALID_VERSION', 'Expected AI asset version must be a positive integer.')
    if (current.version !== command.expectedVersion)
      throw new AiCatalogApiError(409, 'VERSION_CONFLICT',
        `Asset changed; expected version ${command.expectedVersion}, found ${current.version}.`)
    if (current.state === 'archived')
      throw new AiCatalogApiError(400, 'INVALID_TRANSITION',
        `AI asset "${command.id}" is archived and cannot be revised, transitioned, or deleted.`)
    if (command.action === 'revise' && !validateAiRevision(current, command.asset, history))
      throw new AiCatalogApiError(400, 'INVALID_REVISION', 'AI asset revision is invalid for its current version.')
    if (command.action === 'transition' && !validateAiTransition(current, command.state))
      throw new AiCatalogApiError(400, 'INVALID_TRANSITION',
        `AI asset cannot transition from "${current.state}" to "${command.state}".`)
    if (command.action === 'delete' && !canTransitionAiVersion(current.state, 'archived'))
      throw new AiCatalogApiError(400, 'INVALID_TRANSITION',
        `AI asset cannot be deleted from state "${current.state}".`)
  }
  const body = await cloudRequest(command)
  if (!body.asset || Object.keys(body).length !== 1)
    throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server did not confirm the saved asset version.')
  const asset = readAsset(body.asset, workspaceId)
  if (command.action === 'create') {
    if (asset.version !== 1 || asset.state !== 'draft')
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server returned an unexpected created asset version.')
    if (asset.kind !== command.asset.kind || asset.name !== command.asset.name
      || asset.description !== command.asset.description
      || !aiDefinitionsEqual(asset.definition, command.asset.definition))
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server did not confirm the requested asset definition.')
  } else {
    if (asset.id !== command.id || asset.version !== command.expectedVersion + 1)
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server returned an unexpected asset version.')
    if (command.action === 'revise'
      && (asset.kind !== command.asset.kind || asset.name !== command.asset.name
        || asset.description !== command.asset.description
        || !aiDefinitionsEqual(asset.definition, command.asset.definition)
        || asset.state !== 'draft'))
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server did not confirm the requested asset revision.')
    if (command.action === 'transition' && asset.state !== command.state)
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server did not confirm the requested state transition.')
    if (command.action === 'delete' && asset.state !== 'archived')
      throw new AiCatalogApiError(503, 'BAD_CONFIRMATION', 'AI catalog server did not confirm the deleted asset tombstone.')
  }
  return asset
}

export function listAiAssets(): Promise<AiAssetVersion[]> {
  return isCloudProjectMode() ? cloudList() : localList()
}

export function historyAiAsset(id: string): Promise<AiAssetVersion[]> {
  return isCloudProjectMode() ? cloudHistory(id) : localHistory(id)
}

export function executeAiCatalog(
  command: Exclude<AiCatalogCommand, { action: 'list' | 'history' }>,
): Promise<AiAssetVersion> {
  if (command.action === 'create' && !validateAiInitialAsset(command.asset))
    return Promise.reject(new AiCatalogApiError(400, 'INVALID_ASSET', 'AI asset definition is invalid.'))
  if (isCloudProjectMode()) return cloudMutate(command)
  return localMutate(command)
}