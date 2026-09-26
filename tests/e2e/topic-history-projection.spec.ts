import { expect, test } from '@playwright/test'
import { buildTopicHistory } from '../../src/topicHistory'
import type { ProjectCheckpoint } from '../../src/projectCheckpoint'

type Snapshot = {
  appToc: unknown[]
  topicContent: Record<string, unknown[]>
  authorTopicMetadata: Record<string, unknown>
  schemaVersion?: number
  recordRevision?: number
}

function checkpoint(checkpointId: string, createdAt: number, snapshot: Snapshot): ProjectCheckpoint {
  return {
    checkpointId,
    workspaceId: 'workspace',
    projectId: 'project',
    parentCheckpointId: null,
    reason: `Saved ${checkpointId}`,
    actorUserId: 'actor',
    createdAt,
    originatingRecordRevision: snapshot.recordRevision ?? createdAt,
    recordSchemaVersion: snapshot.schemaVersion ?? 4,
    recordDigest: '',
    integrityDigest: '',
    record: {
      schemaVersion: snapshot.schemaVersion ?? 4,
      recordRevision: snapshot.recordRevision ?? createdAt,
      appToc: snapshot.appToc,
      topicContent: snapshot.topicContent,
      authorTopicMetadata: snapshot.authorTopicMetadata,
    } as unknown as ProjectCheckpoint['record'],
    files: [],
  }
}

function snapshot(
  appToc: unknown[],
  topicContent: Record<string, unknown[]>,
  authorTopicMetadata: Record<string, unknown> = {},
  recordRevision?: number,
): Snapshot {
  return { appToc, topicContent, authorTopicMetadata, recordRevision }
}

test('projects committed versions by stable identity across rename and reorder, ignoring current edits', () => {
  const checkpoints = [
    checkpoint('first', 1, snapshot(
      [{ id: 1, topicId: 'topic-a', title: 'Alpha' }, { id: 2, topicId: 'topic-b', title: 'Beta' }],
      { 'topic-a': [{ text: 'same' }], 'topic-b': [] },
    )),
    checkpoint('second', 2, snapshot(
      [{ id: 2, topicId: 'topic-b', title: 'Beta' }, { id: 1, topicId: 'topic-a', title: 'Renamed Alpha' }],
      { 'topic-a': [{ text: 'same' }], 'topic-b': [] },
    )),
  ]
  const result = buildTopicHistory(checkpoints, [
    { id: 2, topicId: 'topic-b', title: 'Current Beta' },
    { id: 1, topicId: 'topic-a', title: 'Current Alpha' },
    { id: 3, topicId: 'current-only', title: 'Only Current' },
  ])
  expect(result.map(topic => [topic.topicId, topic.currentTitle, topic.versions.map(v => v.title)]))
    .toEqual([
      ['topic-b', 'Current Beta', ['Beta', 'Beta']],
      ['topic-a', 'Current Alpha', ['Alpha', 'Renamed Alpha']],
      ['current-only', 'Only Current', []],
    ])
  expect(result.find(topic => topic.topicId === 'topic-a')?.versions.map(version => version.changed))
    .toEqual([null, false])
})

test('compares canonical persisted blocks, retains empty content and repeated-revision observations', () => {
  const history = buildTopicHistory([
    checkpoint('one', 1, snapshot([{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ a: 1, b: 2 }] }, {}, 7)),
    checkpoint('two', 2, snapshot([{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ b: 2, a: 1 }] }, {}, 7)),
    checkpoint('three', 3, snapshot([{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [] }, {}, 7)),
  ], [])
  expect(history[0].versions.map(version => version.changed)).toEqual([null, false, true])
  expect(history[0].versions.map(version => version.blocks)).toEqual([[{ a: 1, b: 2 }], [{ b: 2, a: 1 }], []])
  expect(history[0].versions.map(version => version.originatingRecordRevision)).toEqual([7, 7, 7])
  expect(history[0].currentTitle).toBeNull()
})

test('supports unambiguous legacy numeric content keys and includes deleted topics', () => {
  const history = buildTopicHistory([
    checkpoint('legacy', 1, snapshot(
      [{ id: 42, title: 'Old topic' }],
      { '42': [{ value: 'legacy body' }] },
    )),
  ], [])
  expect(history).toHaveLength(1)
  expect(history[0]).toMatchObject({
    topicId: 'legacy-42',
    currentTitle: null,
    versions: [{ title: 'Old topic', blocks: [{ value: 'legacy body' }] }],
  })
})

test('surfaces duplicate IDs and numeric collisions rather than assigning ambiguous records', () => {
  const history = buildTopicHistory([
    checkpoint('duplicates', 1, snapshot(
      [{ id: 1, topicId: 'dup', title: 'First' }, { id: 2, topicId: 'dup', title: 'Second' }],
      { dup: [{ value: 'cannot choose' }] },
    )),
    checkpoint('collision', 2, snapshot(
      [{ id: 7, topicId: 'stable-seven', title: 'Seven' }, { id: 8, topicId: '7', title: 'Literal seven' }],
      { '7': [{ value: 'ambiguous numeric key' }] },
    )),
  ], [])
  const duplicate = history.find(topic => topic.topicId === 'dup')
  expect(duplicate?.limitations.join(' ')).toContain('Duplicate topic IDs')
  expect(duplicate?.versions[0].blocks).toEqual([])
  const collided = history.find(topic => topic.topicId === 'stable-seven')
  expect(collided?.limitations.join(' ')).toContain('ambiguous')
  expect(collided?.versions[0].blocks).toEqual([])
})

test('reports unsupported record schemas without deriving guessed versions', () => {
  const history = buildTopicHistory([
    checkpoint('unsupported', 1, {
      ...snapshot([{ id: 1, topicId: 'stable', title: 'Unknown schema topic' }], { stable: [{ text: 'do not read' }] }),
      schemaVersion: 999,
    }),
  ], [{ id: 1, topicId: 'stable', title: 'Current title' }])
  expect(history[0].versions).toEqual([])
  expect(history[0].limitations.join(' ')).toContain('unsupported project schema')
})

test('a missing middle checkpoint makes the following change comparison unknown', () => {
  const first = checkpoint('first', 1, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ content: 'same' }] },
  ))
  const missing = checkpoint('missing', 2, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ content: 'unknown middle' }] },
  ))
  const last = checkpoint('last', 3, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ content: 'same' }] },
  ))
  const history = buildTopicHistory([first, last], [], [first, missing, last])
  expect(history[0].versions.map(version => version.changed)).toEqual([null, null])
  expect(history[0].limitations.join(' ')).toContain('Checkpoint missing could not be read')
})

test('parent linkage determines preceding checkpoint when timestamps tie', () => {
  const parent = checkpoint('z-parent', 1, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ content: 'before' }] },
  ))
  const child = checkpoint('a-child', 1, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }], { stable: [{ content: 'after' }] },
  ))
  child.parentCheckpointId = parent.checkpointId
  const versions = buildTopicHistory([child, parent], [])[0].versions
  expect(versions.map(version => version.checkpointId)).toEqual(['z-parent', 'a-child'])
  expect(versions.map(version => version.changed)).toEqual([null, true])
})

test('malformed saved author metadata is reported, not treated as displayable metadata', () => {
  const saved = checkpoint('malformed', 1, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Topic' }],
    { stable: [{ content: 'saved' }] },
    { stable: { topicId: 'stable' } },
  ))
  const history = buildTopicHistory([saved], [])
  expect(history[0].versions[0].metadata).toBeNull()
  expect(history[0].versions[0].limitations.join(' ')).toContain('incomplete or malformed')
})

test('does not mutate checkpoint or current TOC input data', () => {
  const blocks = [{ nested: { value: 'unchanged' } }]
  const metadata = { topicId: 'stable', custom: { items: ['kept'] } }
  const saved = checkpoint('saved', 1, snapshot(
    [{ id: 1, topicId: 'stable', title: 'Saved' }],
    { stable: blocks },
    { stable: metadata },
  ))
  const current = [{ id: 1, topicId: 'stable', title: 'Now' }]
  const before = structuredClone({ saved, current })
  const projection = buildTopicHistory([saved], current)
  projection[0].versions[0].blocks[0] && ((projection[0].versions[0].blocks[0] as { nested: { value: string } }).nested.value = 'changed')
  expect({ saved, current }).toEqual(before)
})