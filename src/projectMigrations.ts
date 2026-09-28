import {
  createEmptyReviewModel, remapReviewModelForDuplicate, REVIEW_MODEL_VERSION,
} from './reviewModel'
import {
  hydrateAuthorTopicMetadata, stableAuthorTopicId, type AuthorMetadataTopic,
} from './authorMetadata'
import {
  hydrateContentExplorerMetadata,
  type ContentExplorerAssets,
} from './contentExplorerModel'
import type { ProjectRecord } from './projectRepository'
import { LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from './ownership'

export const CURRENT_PROJECT_SCHEMA_VERSION = 5

export class UnsupportedProjectSchemaError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported project schema version ${version}; this app supports up to ${CURRENT_PROJECT_SCHEMA_VERSION}.`)
    this.name = 'UnsupportedProjectSchemaError'
  }
}

function v1Defaults(projectId: string): Record<string, unknown> {
  // These are the historical empty-project values. No clock, random ID, or
  // current UI state is used, so the same legacy record always upgrades alike.
  // Keep missing theme/layout/condition fields absent: App hydration supplies
  // functional defaults for absence, which differ from an explicit empty value.
  return {
    documentType: 'user-guide', version: '1.0', createdAt: 0, modifiedAt: 0,
    isDemoMode: false, projectMeta: {}, activeStyleProfileId: '',
    sourceFileIds: [], sourcesRevision: 0, sourceExtractions: {}, evidenceIndex: null,
    analysisResult: null, analysisRevision: -1, conceptAnalysis: null, unsupportedAnalysis: null,
    appToc: [], tocProposal: null, tocRevision: 0, tocGeneratedFromRev: -1,
    tocGeneratedFromEvidenceSourcesRevision: -1, tocGeneratedFromEvidenceExtractionRevision: '',
    tocGeneratedFromConceptBuiltAt: -1, tocGeneratedFromContentType: '',
    tocHumanModified: false, masterAssignments: {}, docBlocks: [], topicContent: {},
    authorTopicMetadata: {}, contentRevision: 0,
    reviewModel: createEmptyReviewModel(projectId), findingStatuses: {}, aiReviewDone: false,
    reviewStage: 1, reviewRevision: -1, snippets: [], docComments: [],
    publishConfig: { selectedFormats: [], activeVariant: '' },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assetReferences(
  values: unknown,
  idField: 'id',
  nameField: 'name' | 'group',
): Array<{ id: string; name: string }> {
  if (!Array.isArray(values)) return []
  return values.flatMap(value => {
    if (!isObject(value) || typeof value[idField] !== 'string' ||
        typeof value[nameField] !== 'string') return []
    const id = (value[idField] as string).trim()
    const name = (value[nameField] as string).trim()
    return id && name ? [{ id, name }] : []
  })
}

/** Project payloads are reduced to stable IDs and display names for the tree. */
export function contentExplorerAssetsForProject(record: unknown): ContentExplorerAssets {
  const source = isObject(record) ? record : {}
  const topics = Array.isArray(source.appToc)
    ? source.appToc.flatMap(value => {
      if (!isObject(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) ||
          typeof value.title !== 'string' || !value.title.trim()) return []
      const topic = {
        id: value.id,
        ...(typeof value.topicId === 'string' ? { topicId: value.topicId } : {}),
      }
      return [{ id: stableAuthorTopicId(topic), name: value.title.trim() }]
    })
    : []
  const snippets = assetReferences(source.snippets, 'id', 'name')
  const conditionGroups = assetReferences(source.conditionGroups, 'id', 'group')

  const variablesById = new Map<string, { id: string; name: string }>()
  const themeVariables = isObject(source.themeVariables) ? source.themeVariables : {}
  const projectMeta = isObject(source.projectMeta) ? source.projectMeta : {}
  const activeThemeId = typeof projectMeta.themeId === 'string' ? projectMeta.themeId : ''
  const activeVariables = activeThemeId && Array.isArray(themeVariables[activeThemeId])
    ? themeVariables[activeThemeId]
    : Object.values(themeVariables).flatMap(value => Array.isArray(value) ? value : [])
  for (const reference of assetReferences(activeVariables, 'id', 'name')) {
    if (!variablesById.has(reference.id)) variablesById.set(reference.id, reference)
  }

  return {
    topics,
    snippets,
    variables: [...variablesById.values()],
    conditions: conditionGroups,
    references: [],
    media: [],
  }
}

export function migrateProjectRecord(raw: unknown): {
  record: ProjectRecord
  fromVersion: number
  changed: boolean
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid project record.')
  const input = raw as Record<string, unknown>
  if (typeof input.projectId !== 'string' || !input.projectId ||
      typeof input.projectName !== 'string')
    throw new Error('Project record is missing its identity.')
  const fromVersion = input.schemaVersion === undefined ? 1 : input.schemaVersion
  if (!Number.isInteger(fromVersion) || (fromVersion as number) < 1)
    throw new Error('Invalid project schema version.')
  if ((fromVersion as number) > CURRENT_PROJECT_SCHEMA_VERSION)
    throw new UnsupportedProjectSchemaError(fromVersion as number)

  let record = input
  let contentExplorerChanged = false
  if (fromVersion === 1) {
    const defaults = v1Defaults(input.projectId)
    record = { ...defaults, ...record, schemaVersion: 2 }
    for (const [key, value] of Object.entries(defaults))
      if (record[key] === undefined) record[key] = value
  }
  if (record.schemaVersion === 2) {
    const defaults = v1Defaults(input.projectId)
    record = { ...defaults, ...record, schemaVersion: 3, recordRevision: 0 }
    for (const [key, value] of Object.entries(defaults))
      if (record[key] === undefined) record[key] = value
  }
  if (record.schemaVersion === 3) {
    // All pre-ownership records were local-only. Do not fill an incomplete
    // ownership pair: that could silently turn future remote data into local data.
    const missingOwner = record.ownerUserId === undefined
    const missingWorkspace = record.workspaceId === undefined
    if (missingOwner !== missingWorkspace)
      throw new Error('Project record has incomplete ownership.')
    record = {
      ...record,
      ownerUserId: missingOwner ? LOCAL_USER_ID : record.ownerUserId,
      workspaceId: missingWorkspace ? LOCAL_WORKSPACE_ID : record.workspaceId,
      schemaVersion: 4,
    }
  }
  if (record.schemaVersion === 4 || record.schemaVersion === 5) {
    const assets = contentExplorerAssetsForProject(record)
    const contentExplorer = hydrateContentExplorerMetadata(record.contentExplorer, assets)
    const contentOrigins = hydrateContentOrigins(record.contentOrigins)
    contentExplorerChanged = JSON.stringify(record.contentExplorer) !== JSON.stringify(contentExplorer)
      || JSON.stringify(record.contentOrigins) !== JSON.stringify(contentOrigins)
    record = {
      ...record,
      contentExplorer,
      contentOrigins,
      schemaVersion: 5,
    }
  }
  if (typeof record.ownerUserId !== 'string' || !record.ownerUserId.trim() ||
    typeof record.workspaceId !== 'string' || !record.workspaceId.trim())
    throw new Error('Project record has invalid ownership.')
  if (!Number.isSafeInteger(record.recordRevision) || (record.recordRevision as number) < 0)
    throw new Error('Invalid project record revision.')
  return { record: record as unknown as ProjectRecord, fromVersion: fromVersion as number,
    changed: fromVersion !== CURRENT_PROJECT_SCHEMA_VERSION || contentExplorerChanged }
}

function hydrateContentOrigins(value: unknown): ProjectRecord['contentOrigins'] {
  const empty: ProjectRecord['contentOrigins'] = {
    topic: {}, snippet: {}, variable: {}, condition: {},
  }
  if (value === undefined || value === null) return empty
  if (!isObject(value)) throw new Error('Project record has invalid content origin metadata.')
  for (const key of Object.keys(value))
    if (!['topic', 'snippet', 'variable', 'condition'].includes(key))
      throw new Error('Project record has invalid content origin metadata.')
  const result = { ...empty }
  for (const type of ['topic', 'snippet', 'variable', 'condition'] as const) {
    const entries = value[type]
    if (entries === undefined) continue
    if (!isObject(entries)) throw new Error('Project record has invalid content origin metadata.')
    const normalized: ProjectRecord['contentOrigins'][typeof type] = {}
    for (const [localId, origin] of Object.entries(entries)) {
      if (!localId || localId.length > 512 || !isObject(origin)
        || Object.keys(origin).sort().join(',') !== 'originItemId,originProjectId,originVersion'
        || typeof origin.originItemId !== 'string' || !origin.originItemId.trim()
        || typeof origin.originProjectId !== 'string' || !origin.originProjectId.trim()
        || !Number.isSafeInteger(origin.originVersion) || (origin.originVersion as number) < 1)
        throw new Error('Project record has invalid content origin metadata.')
      normalized[localId] = {
        originItemId: origin.originItemId,
        originProjectId: origin.originProjectId,
        originVersion: origin.originVersion as number,
      }
    }
    result[type] = normalized
  }
  return result
}

/** Check untrusted backup content before it can enter the live repository. */
export function validateRestorableProjectRecord(record: ProjectRecord): void {
  const fields = record as unknown as Record<string, unknown>
  const fail = (field: string): never => {
    throw new Error(`Invalid project backup: unusable ${field} in project record.`)
  }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  try {
    hydrateContentExplorerMetadata(
      fields.contentExplorer,
      contentExplorerAssetsForProject(record),
    )
  } catch {
    fail('contentExplorer')
  }
  try {
    hydrateContentOrigins(fields.contentOrigins)
  } catch {
    fail('contentOrigins')
  }
  const arrays = ['sourceFileIds', 'appToc', 'docBlocks', 'snippets', 'docComments']
  for (const field of arrays) if (!Array.isArray(fields[field])) fail(field)
  // Legacy missing presentation/condition fields are intentional: App supplies
  // functional defaults. An explicitly supplied value must still be usable.
  for (const field of ['themes', 'pageLayouts', 'htmlMasterPages', 'conditionGroups']) {
    const value = fields[field]
    if (value !== undefined && (!Array.isArray(value) || value.some(item => !isObject(item))))
      fail(field)
  }
  for (const theme of (fields.themes as Record<string, unknown>[] | undefined) ?? []) {
    for (const field of ['brandProfiles', 'styleProfiles', 'outputTemplatePacks']) {
      const value = theme[field]
      if (value !== undefined && (!Array.isArray(value) || value.some(item => !isObject(item))))
        fail(`themes.${field}`)
    }
  }
  for (const master of (fields.htmlMasterPages as Record<string, unknown>[] | undefined) ?? []) {
    const blocks = master.blocks
    if (blocks !== undefined && (!Array.isArray(blocks) || blocks.some(block => !isObject(block))))
      fail('htmlMasterPages.blocks')
  }
  if (fields.appToc && (fields.appToc as unknown[]).some(item => !isObject(item)))
    fail('appToc')
  if ((fields.docBlocks as unknown[]).some(item => !isObject(item)))
    fail('docBlocks')
  for (const field of [
    'projectMeta', 'themeVariables', 'masterAssignments', 'sourceExtractions',
    'topicContent', 'authorTopicMetadata', 'findingStatuses', 'publishConfig',
  ]) {
    const value = fields[field]
    const optional = ['themeVariables', 'publishConfig', 'projectMeta'].includes(field)
    if (value === undefined && optional) continue
    if (value === null && (field === 'projectMeta' || field === 'publishConfig')) continue
    if (!isObject(value)) fail(field)
  }
  for (const field of ['themeVariables', 'topicContent']) {
    const value = fields[field]
    if (value === undefined && field === 'themeVariables') continue
    if (Object.values(value as Record<string, unknown>).some(item =>
      !Array.isArray(item) || item.some(nested => !isObject(nested))))
      fail(field)
  }
  if (Object.values(fields.authorTopicMetadata as Record<string, unknown>).some(value =>
    !isObject(value) || !isObject((value as Record<string, unknown>).provenance)))
    fail('authorTopicMetadata')
  try {
    hydrateAuthorTopicMetadata(
      record.authorTopicMetadata,
      record.topicContent,
      record.appToc as AuthorMetadataTopic[],
      { contentType: record.documentType, variables: [] },
    )
  } catch {
    fail('authorTopicMetadata')
  }
  if (Object.values(fields.sourceExtractions as Record<string, unknown>).some(item => !isObject(item)))
    fail('sourceExtractions')
  for (const field of ['evidenceIndex', 'conceptAnalysis', 'unsupportedAnalysis', 'tocProposal', 'reviewModel']) {
    const value = fields[field]
    if (value !== null && value !== undefined && !isObject(value)) fail(field)
  }
  for (const field of ['evidenceIndex', 'tocProposal']) {
    const value = fields[field]
    if (value && (!Array.isArray((value as Record<string, unknown>).items) ||
      ((value as Record<string, unknown>).items as unknown[]).some(item => !isObject(item))))
      fail(`${field}.items`)
  }
  if (fields.tocProposal) {
    const proposal = fields.tocProposal as Record<string, unknown>
    if (proposal.method !== undefined
      && proposal.method !== 'evidence-grounded-toc-v1'
      && proposal.method !== 'ai-grounded-toc-v1') fail('tocProposal.method')
    if (proposal.method === 'ai-grounded-toc-v1') {
      const provenance = proposal.aiProvenance
      const reference = (value: unknown): boolean => isObject(value)
        && Object.keys(value).sort().join(',') === 'id,version'
        && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(value.id)
        && Number.isSafeInteger(value.version) && (value.version as number) > 0
      if (!isObject(provenance)
        || Object.keys(provenance).sort().join(',')
          !== 'analysisBuiltAt,blueprint,evidenceExtractionRevision,evidenceSourcesRevision,modelId,promptPack,providerId,referenceSet,workflow'
        || typeof provenance.providerId !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(provenance.providerId)
        || typeof provenance.modelId !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(provenance.modelId)
        || !reference(provenance.workflow)
        || !reference(provenance.promptPack)
        || !reference(provenance.referenceSet)
        || !reference(provenance.blueprint)
        || !Number.isSafeInteger(provenance.evidenceSourcesRevision)
        || typeof provenance.evidenceExtractionRevision !== 'string'
        || !provenance.evidenceExtractionRevision
        || !Number.isFinite(provenance.analysisBuiltAt)
        || provenance.analysisBuiltAt !== proposal.groundedAnalysisBuiltAt
        || provenance.evidenceSourcesRevision !== proposal.evidenceSourcesRevision
        || provenance.evidenceExtractionRevision !== proposal.evidenceExtractionRevision)
        fail('tocProposal.aiProvenance')
    } else if (proposal.aiProvenance !== undefined) {
      fail('tocProposal.aiProvenance')
    }
  }
  if (fields.reviewModel) {
    const review = fields.reviewModel as Record<string, unknown>
    if (!Array.isArray(review.runs) || !Array.isArray(review.findings) ||
      review.runs.some(item => !isObject(item)) || review.findings.some(item => !isObject(item)))
      fail('reviewModel')
    if (review.version !== REVIEW_MODEL_VERSION) fail('reviewModel.version')
    try {
      // This walks the same nested run/finding/provenance structures used by
      // hydration and duplication, without changing the backed-up record.
      remapReviewModelForDuplicate(review, record.projectId, record.projectId, {})
    } catch {
      fail('reviewModel')
    }
  }
  for (const field of ['createdAt', 'modifiedAt', 'sourcesRevision', 'tocRevision', 'contentRevision']) {
    if (typeof fields[field] !== 'number' || !Number.isFinite(fields[field]))
      fail(field)
  }
}