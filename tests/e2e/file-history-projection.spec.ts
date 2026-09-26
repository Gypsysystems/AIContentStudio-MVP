import { expect, test } from '@playwright/test'
import { buildFileHistory, listedFileIds, loadProjectFileHistory } from '../../src/fileHistory'
import {
  canonicalCheckpointJson, checkpointIntegrityDigest, checkpointSha256,
  type ProjectCheckpoint, type ProjectCheckpointSummary,
} from '../../src/projectCheckpoint'

const hash = (value: string) => value.repeat(64)

function snapshot(id: string, parentId: string | null, files: unknown[], schemaVersion = 4): ProjectCheckpoint {
  return {
    checkpointId: id, parentCheckpointId: parentId, projectId: 'project', workspaceId: 'workspace',
    createdAt: 100, reason: `Saved ${id}`, actorUserId: 'actor',
    originatingRecordRevision: 1, recordSchemaVersion: schemaVersion,
    recordDigest: '', integrityDigest: '', files: files as ProjectCheckpoint['files'],
    record: {
      projectId: 'project', workspaceId: 'workspace', schemaVersion, recordRevision: 1,
      projectName: 'Saved project', documentType: 'user-guide',
      createdAt: 100, modifiedAt: 100, sourcesRevision: 0, tocRevision: 0, contentRevision: 0,
      sourceFileIds: [], appToc: [], docBlocks: [], snippets: [], docComments: [],
      masterAssignments: {}, sourceExtractions: {}, topicContent: {},
      authorTopicMetadata: {}, findingStatuses: {},
    } as unknown as ProjectCheckpoint['record'],
  }
}

function manifest(fileId: string, sha256: string, name = 'source.txt') {
  return { fileId, sha256, name, type: 'text/plain', size: 10, uploadedAt: 10, storageRef: `archive/${fileId}` }
}

function summary(record: ProjectCheckpoint): ProjectCheckpointSummary {
  const { record: _savedRecord, ...savedSummary } = record
  return savedSummary
}

test('one file ID is independently absent, present, unchanged and changed across saved checkpoints', () => {
  const records = [
    snapshot('one', null, []),
    snapshot('two', 'one', [manifest('target', hash('a'))]),
    snapshot('three', 'two', [manifest('target', hash('a'))]),
    snapshot('four', 'three', [manifest('target', hash('b')), manifest('other', hash('c'))]),
  ]
  const before = structuredClone(records)
  const summaries = records.map(summary)
  expect(listedFileIds('project', summaries)).toEqual(['other', 'target'])
  const rows = buildFileHistory('target', summaries, records.map(checkpoint => ({ checkpoint })))
  expect(rows.map(row => row.status)).toEqual(['absent', 'present', 'present', 'present'])
  expect(rows.map(row => row.sha256)).toEqual([undefined, hash('a'), hash('a'), hash('b')])
  expect(rows.map(row => row.ancestryIssue)).toEqual([undefined, undefined, undefined, undefined])
  expect(rows[2]).toMatchObject({ reason: 'Saved three', actorUserId: 'actor', originatingRecordRevision: 1 })
  expect(records).toEqual(before)
})

test('unreadable and unlisted ancestors remain unknown without erasing known independent snapshots', () => {
  const root = snapshot('root', null, [])
  const middle = snapshot('middle', 'root', [manifest('target', hash('a'))])
  const latest = snapshot('latest', 'middle', [manifest('target', hash('b'))])
  const rows = buildFileHistory('target', [summary(root), summary(middle), summary(latest)], [
    { checkpoint: root }, { error: 'Access denied' }, { checkpoint: latest },
  ])
  expect(rows[1]).toMatchObject({ status: 'unknown', issue: 'Access denied' })
  expect(rows[2]).toMatchObject({ status: 'unknown', ancestryIssue: expect.stringContaining('could not be read') })
  expect(rows[2].sha256).toBeUndefined()
  const missing = buildFileHistory('target', [summary(root), summary(latest)], [
    { checkpoint: root }, { checkpoint: latest },
  ])
  expect(missing[1]).toMatchObject({ status: 'unknown', ancestryIssue: expect.stringContaining('absent or ambiguous') })
})

test('legacy, malformed, duplicate, cyclic and cross-workspace metadata never imply reliable history', () => {
  const root = snapshot('root', null, [])
  const legacy = snapshot('old', 'root', [manifest('target', hash('a'))], 3)
  const malformed = snapshot('malformed', 'old', [manifest('target', 'not-a-hash')])
  const duplicate = snapshot('duplicate', 'malformed', [manifest('target', hash('a')), manifest('target', hash('b'))])
  const cycle = snapshot('cycle', 'cycle', [manifest('target', hash('a'))])
  const records = [root, legacy, malformed, duplicate, cycle]
  const rows = buildFileHistory('target', records.map(summary), records.map(checkpoint => ({ checkpoint })))
  expect(rows[1]).toMatchObject({ status: 'unknown', issue: expect.stringContaining('Legacy') })
  expect(rows[2]).toMatchObject({ status: 'unknown', issue: expect.stringContaining('hashes') })
  expect(rows[3]).toMatchObject({ status: 'unknown', issue: expect.stringContaining('duplicate') })
  expect(rows[4]).toMatchObject({ status: 'unknown', ancestryIssue: expect.stringContaining('cycle') })
  const wrongWorkspace = snapshot('other', 'root', [manifest('target', hash('a'))])
  wrongWorkspace.workspaceId = 'foreign'
  const scoped = buildFileHistory('target', [summary(root), summary(wrongWorkspace)], [
    { checkpoint: root }, { checkpoint: wrongWorkspace },
  ])
  expect(scoped[1]).toMatchObject({ status: 'unknown', ancestryIssue: expect.stringContaining('different project or workspace') })
  expect(scoped[0].status).toBe('absent')
  expect(listedFileIds('project', [summary({ ...wrongWorkspace, projectId: 'foreign' })])).toEqual([])
})

test('metadata-only loader validates scope and digests; it never reads bytes or writes snapshots', async () => {
  const root = snapshot('root', null, [])
  const latest = snapshot('latest', 'root', [manifest('target', hash('a'))])
  for (const checkpoint of [root, latest]) {
    checkpoint.recordDigest = await checkpointSha256(canonicalCheckpointJson(checkpoint.record))
    const { integrityDigest: _oldDigest, ...content } = checkpoint
    checkpoint.integrityDigest = await checkpointIntegrityDigest(content)
  }
  const records = [root, latest]
  const original = structuredClone(records)
  const summaries = records.map(summary)
  const reads: string[] = []
  const getRecord = async (_projectId: string, id: string) => {
    reads.push(id)
    return records.find(checkpoint => checkpoint.checkpointId === id) || null
  }
  const rows = await loadProjectFileHistory('project', 'target', summaries, getRecord)
  expect(rows.map(row => row.status)).toEqual(['absent', 'present'])
  expect(rows[1].sha256).toBe(hash('a'))
  expect(reads).toEqual(['root', 'latest'])
  expect(records).toEqual(original)

  let called = 0
  const forbidden = async () => { called++; return null }
  await expect(loadProjectFileHistory('another', 'target', summaries, forbidden)).rejects.toThrow('authorized project')
  await expect(loadProjectFileHistory('project', 'arbitrary', summaries, forbidden)).rejects.toThrow('authorized checkpoint list')
  await expect(loadProjectFileHistory('project', 'target', [
    ...summaries, { ...summaries[0], workspaceId: 'other' },
  ], forbidden)).rejects.toThrow('workspace')
  expect(called).toBe(0)
  latest.record.projectName = 'Tampered'
  const tampered = await loadProjectFileHistory('project', 'target', summaries, getRecord)
  expect(tampered[1]).toMatchObject({ status: 'unknown', issue: expect.stringContaining('digest') })
  expect(tampered[0].status).toBe('absent')
})

test('digest-valid current-schema records with incomplete metadata remain unknown, matching cloud strictness', async () => {
  const saved = snapshot('saved', null, [manifest('target', hash('a'))])
  const sign = async () => {
    saved.recordDigest = await checkpointSha256(canonicalCheckpointJson(saved.record))
    const { integrityDigest: _oldDigest, ...content } = saved
    saved.integrityDigest = await checkpointIntegrityDigest(content)
  }
  await sign()
  const read = async () => saved
  expect((await loadProjectFileHistory('project', 'target', [summary(saved)], read))[0].status).toBe('present')

  saved.files[0].storageRef = undefined as unknown as string
  await sign()
  expect((await loadProjectFileHistory('project', 'target', [summary(saved)], read))[0]).toMatchObject({
    status: 'unknown', issue: expect.stringContaining('manifest'),
  })
  saved.files[0].storageRef = 'archive/target'
  saved.record.docBlocks = undefined as unknown as unknown[]
  await sign()
  expect((await loadProjectFileHistory('project', 'target', [summary(saved)], read))[0]).toMatchObject({
    status: 'unknown', issue: expect.stringContaining('project record'),
  })
})

test('a digest-valid legacy or malformed ancestor cannot certify a descendant file history', async () => {
  const root = snapshot('root', null, [manifest('target', hash('a'))], 3)
  const child = snapshot('child', 'root', [manifest('target', hash('b'))])
  const sign = async (checkpoint: ProjectCheckpoint) => {
    checkpoint.recordDigest = await checkpointSha256(canonicalCheckpointJson(checkpoint.record))
    const { integrityDigest: _oldDigest, ...content } = checkpoint
    checkpoint.integrityDigest = await checkpointIntegrityDigest(content)
  }
  await sign(root)
  await sign(child)
  const read = async (_projectId: string, id: string) => id === 'root' ? root : child
  const load = () => loadProjectFileHistory('project', 'target', [summary(root), summary(child)], read)
  const legacy = await load()
  expect(legacy.map(row => row.status)).toEqual(['unknown', 'unknown'])
  expect(legacy[1].ancestryIssue).toContain('unsupported or ambiguous')
  expect(legacy[1].sha256).toBeUndefined()

  root.record.schemaVersion = 4
  root.recordSchemaVersion = 4
  root.files[0].storageRef = '' // valid digest, unusable manifest
  await sign(root)
  const malformed = await load()
  expect(malformed.map(row => row.status)).toEqual(['unknown', 'unknown'])
  expect(malformed[1].sha256).toBeUndefined()

  root.files[0].storageRef = 'archive/target'
  root.record.sourceFileIds = [null] as unknown as string[]
  await sign(root)
  const invalidSource = await load()
  expect(invalidSource.map(row => row.status)).toEqual(['unknown', 'unknown'])
  expect(invalidSource[0].issue).toContain('source references')
  expect(invalidSource[1].sha256).toBeUndefined()

  root.record.sourceFileIds = ['missing-from-manifest']
  await sign(root)
  const orphanSource = await load()
  expect(orphanSource.map(row => row.status)).toEqual(['unknown', 'unknown'])
})