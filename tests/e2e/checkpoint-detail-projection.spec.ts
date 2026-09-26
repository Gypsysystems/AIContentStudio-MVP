import { expect, test } from '@playwright/test'
import { buildCheckpointDetail } from '../../src/checkpointDetail'
import {
  canonicalCheckpointJson, checkpointIntegrityDigest, checkpointSha256,
  type ProjectCheckpoint,
} from '../../src/projectCheckpoint'
import { readValidatedCheckpointRecord } from '../../src/checkpointRecordRead'

function fixture(): ProjectCheckpoint {
  return {
    checkpointId: 'saved', projectId: 'project', workspaceId: 'workspace',
    parentCheckpointId: null, reason: 'Saved baseline', actorUserId: 'actor',
    createdAt: 11, originatingRecordRevision: 2, recordSchemaVersion: 4,
    recordDigest: '', integrityDigest: '', files: [],
    record: {
      projectId: 'project', workspaceId: 'workspace', schemaVersion: 4,
      recordRevision: 2, projectName: 'Saved name',
      appToc: [
        { id: 1, topicId: 'stable', title: 'Saved title', level: 1 },
        { id: 2, topicId: 'second', title: 'Nested title', level: 2 },
      ],
      sourceFileIds: [],
    } as unknown as ProjectCheckpoint['record'],
  }
}

test('projects saved outline order, levels, titles, IDs and empty manifest without current state', () => {
  const saved = fixture()
  const before = structuredClone(saved)
  const detail = buildCheckpointDetail(saved)
  expect(detail).toMatchObject({
    projectName: 'Saved name',
    outlineCount: 2,
    outline: [
      { position: 1, topicId: 'stable', legacyNumericId: 1, title: 'Saved title', level: 1 },
      { position: 2, topicId: 'second', legacyNumericId: 2, title: 'Nested title', level: 2 },
    ],
    sourceFileIds: [],
    limitations: [],
  })
  expect(saved).toEqual(before)
})

test('does not infer topics from unsupported or malformed saved outlines', () => {
  const old = fixture()
  old.record.schemaVersion = 999
  expect(buildCheckpointDetail(old)).toMatchObject({
    outline: null,
    limitations: [expect.stringContaining('unsupported project schema')],
  })
  const malformed = fixture()
  malformed.record.appToc = [
    { id: 7, title: 'Legacy saved title', level: 1 },
    { topicId: 'dup', title: 'First', level: 2 },
    { topicId: 'dup', title: 'Second', level: 'bad' },
    { topicId: 'legacy-7', title: 'Real stable ID', level: 1 },
    null,
  ]
  const detail = buildCheckpointDetail(malformed)
  expect(detail.outlineCount).toBe(5)
  expect(detail.outline).toMatchObject([
    { topicId: null, legacyNumericId: 7, title: 'Legacy saved title' },
    { topicId: 'dup', level: 2 },
    { topicId: 'dup', level: null },
    { topicId: 'legacy-7', title: 'Real stable ID' },
  ])
  expect(detail.limitations.join(' ')).toContain('duplicate topic ID')
  expect(detail.limitations.join(' ')).toContain('no stable topic ID')
  expect(detail.limitations.join(' ')).toContain('unsupported shape')
  malformed.record.appToc = {} as unknown as unknown[]
  expect(buildCheckpointDetail(malformed).outline).toBeNull()
})

test('metadata-only checkpoint read rejects missing, mismatched and invalid records', async () => {
  const saved = fixture()
  saved.recordDigest = await checkpointSha256(canonicalCheckpointJson(saved.record))
  const { integrityDigest: _digest, ...content } = saved
  saved.integrityDigest = await checkpointIntegrityDigest(content)
  const { record: _record, ...summary } = saved
  let reads = 0
  const read = async () => { reads++; return saved }
  expect(await readValidatedCheckpointRecord('project', summary, read)).toEqual(saved)
  expect(reads).toBe(1)
  await expect(readValidatedCheckpointRecord('another-project', summary, read)).rejects.toThrow('selected project')
  await expect(readValidatedCheckpointRecord('project', summary, async () => null)).rejects.toThrow('not found')
  await expect(readValidatedCheckpointRecord('project', { ...summary, reason: 'Different' }, read)).rejects.toThrow('did not match')
  saved.record.projectName = 'Tampered'
  await expect(readValidatedCheckpointRecord('project', summary, read)).rejects.toThrow('digest')
})