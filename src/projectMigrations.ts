import {
  createEmptyReviewModel, remapReviewModelForDuplicate, REVIEW_MODEL_VERSION,
} from './reviewModel'
import { hydrateAuthorTopicMetadata, type AuthorMetadataTopic } from './authorMetadata'
import type { ProjectRecord } from './projectRepository'

export const CURRENT_PROJECT_SCHEMA_VERSION = 3

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
  if (!Number.isSafeInteger(record.recordRevision) || (record.recordRevision as number) < 0)
    throw new Error('Invalid project record revision.')
  return { record: record as unknown as ProjectRecord, fromVersion: fromVersion as number,
    changed: fromVersion !== CURRENT_PROJECT_SCHEMA_VERSION }
}

/** Check untrusted backup content before it can enter the live repository. */
export function validateRestorableProjectRecord(record: ProjectRecord): void {
  const fields = record as unknown as Record<string, unknown>
  const fail = (field: string): never => {
    throw new Error(`Invalid project backup: unusable ${field} in project record.`)
  }
  const isObject = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
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