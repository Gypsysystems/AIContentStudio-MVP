import { createEmptyReviewModel } from './reviewModel'
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