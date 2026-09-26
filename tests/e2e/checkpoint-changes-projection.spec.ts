import { expect, test } from '@playwright/test'
import { buildCheckpointChangeSummary } from '../../src/checkpointChanges'
import type { CheckpointFileManifest, ProjectCheckpoint } from '../../src/projectCheckpoint'

const hash = (character: string) => character.repeat(64)

function file(fileId: string, sha256: string, name = `${fileId}.txt`): CheckpointFileManifest {
  return { fileId, sha256, name, type: 'text/plain', size: 12, uploadedAt: 1, storageRef: `archive/${fileId}` }
}

function saved(id: string, toc: unknown[], files: CheckpointFileManifest[] = []): ProjectCheckpoint {
  return {
    checkpointId: id, projectId: 'project', workspaceId: 'workspace',
    parentCheckpointId: id === 'first' ? null : 'first',
    reason: id, actorUserId: 'actor', createdAt: 1,
    originatingRecordRevision: 1, recordSchemaVersion: 4,
    recordDigest: '', integrityDigest: '', files,
    record: { projectId: 'project', workspaceId: 'workspace', schemaVersion: 4, appToc: toc } as unknown as ProjectCheckpoint['record'],
  }
}

test('summarizes only direct-parent saved topic identities and file IDs and hashes', () => {
  const parent = saved('first', [
    { topicId: 'alpha', title: 'Original Alpha' },
    { topicId: 'removed', title: 'Removed topic' },
    { topicId: 'same', title: 'Same title' },
  ], [file('changed', hash('a')), file('removed-file', hash('c')), file('same-file', hash('e'), 'Old name')])
  const child = saved('second', [
    { topicId: 'same', title: 'Same title' },
    { topicId: 'alpha', title: 'Renamed Alpha' },
    { topicId: 'added', title: 'Added topic' },
  ], [file('added-file', hash('d')), file('changed', hash('b')), file('same-file', hash('e'), 'New name')])
  const before = structuredClone({ parent, child })
  const result = buildCheckpointChangeSummary(child, parent)
  expect(result).toMatchObject({
    status: 'ready',
    topics: { status: 'ready', changes: [
      { kind: 'renamed', topicId: 'alpha', before: 'Original Alpha', after: 'Renamed Alpha' },
      { kind: 'added', topicId: 'added', after: 'Added topic' },
      { kind: 'removed', topicId: 'removed', before: 'Removed topic' },
    ] },
    files: { status: 'ready', changes: [
      { kind: 'added', fileId: 'added-file', afterHash: hash('d') },
      { kind: 'hash changed', fileId: 'changed', beforeHash: hash('a'), afterHash: hash('b') },
      { kind: 'removed', fileId: 'removed-file', beforeHash: hash('c') },
    ] },
  })
  expect({ parent, child }).toEqual(before)
})

test('baseline and missing or mismatched direct parents never invent changes', () => {
  const parent = saved('first', [{ topicId: 'stable', title: 'Saved' }])
  const child = saved('second', [{ topicId: 'stable', title: 'Saved' }])
  expect(buildCheckpointChangeSummary(parent, null)).toEqual({ status: 'baseline' })
  child.parentCheckpointId = '' as unknown as string
  expect(buildCheckpointChangeSummary(child, null)).toMatchObject({ status: 'unknown' })
  child.parentCheckpointId = undefined as unknown as string
  expect(buildCheckpointChangeSummary(child, null)).toMatchObject({ status: 'unknown' })
  child.parentCheckpointId = 'first'
  expect(buildCheckpointChangeSummary(child, null)).toMatchObject({ status: 'unknown' })
  child.parentCheckpointId = 'second'
  expect(buildCheckpointChangeSummary(child, child)).toMatchObject({ status: 'unknown', reason: expect.stringContaining('itself') })
  child.parentCheckpointId = 'first'
  const unrelated = { ...parent, checkpointId: 'not-parent' }
  expect(buildCheckpointChangeSummary(child, unrelated)).toMatchObject({ status: 'unknown' })
  expect(buildCheckpointChangeSummary(child, { ...parent, workspaceId: 'other' })).toMatchObject({ status: 'unknown' })
  parent.record.schemaVersion = 999
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({ status: 'unknown', reason: expect.stringContaining('unsupported') })
})

test('ambiguous legacy or duplicate topics are unknown without hiding independent file changes', () => {
  const parent = saved('first', [{ topicId: 'stable', title: 'Saved' }], [file('source', hash('a'))])
  const child = saved('second', [
    { id: 1, title: 'Legacy numeric only' },
    { topicId: 'stable', title: 'Saved' },
  ], [file('source', hash('b'))])
  const legacy = buildCheckpointChangeSummary(child, parent)
  expect(legacy).toMatchObject({
    status: 'ready', topics: { status: 'unknown' },
    files: { status: 'ready', changes: [{ kind: 'hash changed', fileId: 'source' }] },
  })
  child.record.appToc = [{ topicId: 'stable', title: 'Saved' }, { topicId: 'stable', title: 'Duplicate' }]
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({ status: 'ready', topics: { status: 'unknown' } })
  child.record.appToc = [{ topicId: 'stable', title: null }]
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({ status: 'ready', topics: { status: 'unknown' } })
})

test('malformed saved file IDs or hashes are unknown, without guessing from names or current data', () => {
  const parent = saved('first', [], [file('file', hash('a'))])
  const child = saved('second', [], [file('file', 'not-a-hash')])
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({
    status: 'ready', topics: { status: 'ready', changes: [] }, files: { status: 'unknown' },
  })
  child.files = [file('file', hash('b')), file('file', hash('c'))]
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({ status: 'ready', files: { status: 'unknown' } })
  child.record.appToc = {} as unknown as unknown[]
  expect(buildCheckpointChangeSummary(child, parent)).toMatchObject({ status: 'ready', topics: { status: 'unknown' } })
})