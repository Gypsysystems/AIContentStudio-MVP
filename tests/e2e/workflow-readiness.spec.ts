import { expect, test } from '@playwright/test'
import type { AiAssetVersion } from '../../src/aiCatalogModel'
import { resolveWorkflowReadiness } from '../../src/workflowReadiness'

const workspaceId = 'readiness-workspace'
const timestamp = '2026-09-26T12:00:00.000Z'

function workflow(version = 2, state: AiAssetVersion['state'] = 'published'): AiAssetVersion {
  return {
    workspaceId,
    id: 'workflow-1',
    kind: 'workflow',
    version,
    state,
    name: 'Workflow',
    description: '',
    definition: {
      capability: 'draft',
      model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-test' },
      promptPack: { id: 'pack-1', version: 2 },
      referenceSet: { id: 'references-1', version: 2 },
      blueprint: { id: 'blueprint-1', version: 2 },
      steps: [],
    },
    createdAt: timestamp,
    createdBy: 'user-1',
  }
}

function promptPack(
  version: 1 | 2,
  state: 'draft' | 'published',
  promptState: 'draft' | 'published',
): AiAssetVersion {
  return {
    workspaceId,
    id: 'pack-1',
    kind: 'prompt-pack',
    version,
    state,
    name: 'Pack metadata',
    description: '',
    definition: { prompts: [{
      id: 'prompt-1', version, state: promptState, name: 'Prompt title',
      template: 'Sensitive prompt source must never appear in readiness output.',
      variables: [],
    }] },
    createdAt: timestamp,
    createdBy: 'user-1',
  }
}

function referenceSet(version: 1 | 2, state: 'draft' | 'published'): AiAssetVersion {
  return {
    workspaceId, id: 'references-1', kind: 'reference-set', version, state,
    name: 'References', description: '', definition: { entries: [] },
    createdAt: timestamp, createdBy: 'user-1',
  }
}

function blueprint(version: 1 | 2, state: 'draft' | 'published'): AiAssetVersion {
  return {
    workspaceId, id: 'blueprint-1', kind: 'blueprint', version, state,
    name: 'Blueprint', description: '',
    definition: { contentType: 'SOP', sections: [] },
    createdAt: timestamp, createdBy: 'user-1',
  }
}

const publishedDependencies = {
  promptPack: [promptPack(1, 'draft', 'draft'), promptPack(2, 'published', 'published')],
  referenceSet: [referenceSet(1, 'draft'), referenceSet(2, 'published')],
  blueprint: [blueprint(1, 'draft'), blueprint(2, 'published')],
}

function resolve(
  changes: Partial<Parameters<typeof resolveWorkflowReadiness>[0]> = {},
) {
  return resolveWorkflowReadiness({
    workspaceId,
    id: 'workflow-1',
    version: 2,
    workflowHistory: [workflow(1, 'draft'), workflow()],
    dependencyHistories: publishedDependencies,
    connection: {
      providerId: 'openai', revision: 2, state: 'verified', credentialRevision: 2,
      discovery: { state: 'available', models: [{ providerId: 'openai', id: 'gpt-test' }] },
    },
    checkedAt: timestamp,
    ...changes,
  })
}

test('readiness resolves exact published dependencies and emits only safe metadata', () => {
  const readiness = resolve()
  expect(readiness).toMatchObject({
    status: 'ready',
    workflow: { id: 'workflow-1', version: 2 },
    dependencies: {
      promptPack: { id: 'pack-1', version: 2, name: 'Pack metadata', state: 'published' },
      referenceSet: { id: 'references-1', version: 2, state: 'published' },
      blueprint: { id: 'blueprint-1', version: 2, state: 'published' },
    },
    model: { providerId: 'openai', modelId: 'gpt-test' },
  })
  expect(readiness.blockers).toEqual([])
  expect(JSON.stringify(readiness)).not.toContain('Sensitive prompt source')
  expect(JSON.stringify(readiness)).not.toContain('definition')
})

test('ordinary readiness blocks draft/test versions while explicit publish candidates can pass', () => {
  const history = [workflow(1, 'draft'), workflow(2, 'test')]
  const detail = resolve({ workflowHistory: history })
  expect(detail.status).toBe('blocked')
  expect(detail.blockers.map(item => item.code)).toContain('WORKFLOW_NOT_PUBLISHED')

  const autoHistory = [
    workflow(1, 'draft'),
    { ...workflow(2, 'test'), definition: { ...workflow().definition, model: { mode: 'auto' } } },
  ]
  const autoDetail = resolve({ workflowHistory: autoHistory })
  expect(autoDetail.blockers.map(item => item.code)).toContain('MODEL_NOT_PINNED')

  const candidate = resolve({ workflowHistory: history, publishCandidate: true })
  expect(candidate.status).toBe('ready')
  expect(candidate.blockers).toEqual([])

  const autoCandidate = resolve({ workflowHistory: autoHistory, publishCandidate: true })
  expect(autoCandidate.status).toBe('blocked')
  expect(autoCandidate.blockers.map(item => item.code)).toContain('MODEL_NOT_PINNED')
})

test('missing exact dependency references block ordinary readiness and publish candidates', () => {
  const missingRefsHistory = [
    workflow(1, 'draft'),
    {
      ...workflow(2, 'test'),
      definition: {
        ...workflow(2, 'test').definition,
        promptPack: null,
        referenceSet: null,
        blueprint: null,
      },
    },
  ]
  for (const publishCandidate of [false, true]) {
    const result = resolve({
      workflowHistory: missingRefsHistory,
      dependencyHistories: { promptPack: [], referenceSet: [], blueprint: [] },
      publishCandidate,
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers.map(item => item.code)).toEqual(expect.arrayContaining([
      'DEPENDENCY_REFERENCE_MISSING',
    ]))
    expect(result.blockers.filter(item => item.code === 'DEPENDENCY_REFERENCE_MISSING')).toHaveLength(3)
  }
})

test('readiness blocks invalid history, draft nested prompts, and archived latest versions', () => {
  const draftNestedPrompt = resolve({
    dependencyHistories: {
      ...publishedDependencies,
      promptPack: [promptPack(1, 'draft', 'draft'), promptPack(2, 'published', 'draft')],
    },
    workflowHistory: [workflow(1, 'draft'), {
      ...workflow(),
      definition: { ...workflow().definition, model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-test' } },
    }],
    connection: {
      providerId: 'openai', revision: 1, state: 'verified', credentialRevision: 1,
      discovery: { state: 'available', models: [{ providerId: 'openai', id: 'gpt-test' }] },
    },
  })
  expect(draftNestedPrompt.status).toBe('blocked')
  expect(draftNestedPrompt.blockers.map(item => item.code)).toContain('PROMPT_NOT_PUBLISHED')

  const invalidHistory = resolve({
    workflowHistory: [workflow(1, 'draft'), { ...workflow(2), version: 3 }],
  })
  expect(invalidHistory.status).toBe('blocked')
  expect(invalidHistory.blockers.map(item => item.code)).toContain('WORKFLOW_HISTORY_INVALID')

  const archivedLatest = resolve({
    workflowHistory: [workflow(1, 'draft'), { ...workflow(2), state: 'archived' }],
  })
  expect(archivedLatest.status).toBe('blocked')
  expect(archivedLatest.blockers.map(item => item.code)).toContain('WORKFLOW_ARCHIVED')
})

test('readiness uses typed blockers for missing and foreign or wrong-kind upstream snapshots', () => {
  const missing = resolve({
    dependencyHistories: { promptPack: [], referenceSet: [], blueprint: [] },
  })
  expect(missing.blockers.map(item => item.code)).toContain('DEPENDENCY_VERSION_NOT_FOUND')

  const foreign = resolve({
    dependencyHistories: {
      promptPack: [{ ...promptPack(1, 'draft', 'draft'), workspaceId: 'other-workspace' },
        promptPack(2, 'published', 'published')],
      referenceSet: [], blueprint: [],
    },
  })
  expect(foreign.blockers.map(item => item.code)).toContain('DEPENDENCY_WRONG_WORKSPACE')

  const wrongKind = resolve({
    dependencyHistories: {
      promptPack: [
        { ...promptPack(1, 'draft', 'draft'), kind: 'blueprint' },
        { ...promptPack(2, 'published', 'published'), kind: 'blueprint' },
      ],
      referenceSet: publishedDependencies.referenceSet,
      blueprint: publishedDependencies.blueprint,
    },
  })
  expect(wrongKind.blockers.map(item => item.code)).toContain('DEPENDENCY_WRONG_KIND')

  const wrongWorkflowWorkspace = resolve({
    workflowHistory: [workflow(1, 'draft'), { ...workflow(), workspaceId: 'other-workspace' }],
  })
  expect(wrongWorkflowWorkspace.blockers.map(item => item.code)).toContain('WORKFLOW_WRONG_WORKSPACE')
})

test('malformed workflow references and pinned model definitions receive typed blockers', () => {
  const malformed = workflow()
  malformed.definition = {
    ...malformed.definition,
    promptPack: { id: '../unsafe', version: 0 },
    model: { mode: 'pinned', providerId: 'openai', modelId: 'not a model' },
    referenceSet: { id: 'references-1', version: 2 },
    blueprint: { id: 'blueprint-1', version: 2 },
  } as typeof malformed.definition
  const result = resolve({
    workflowHistory: [workflow(1, 'draft'), malformed],
  })
  expect(result.status).toBe('blocked')
  expect(result.blockers.map(item => item.code)).toContain('DEPENDENCY_REFERENCE_INVALID')
  expect(result.blockers.map(item => item.code)).toContain('MODEL_PIN_INVALID')
})

test('pinned readiness requires a verified same-revision connection and available model', () => {
  const pinnedWorkflow = workflow()
  pinnedWorkflow.definition = {
    ...pinnedWorkflow.definition,
    model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-test' },
  }
  const common = {
    workspaceId,
    id: pinnedWorkflow.id,
    version: pinnedWorkflow.version,
    workflowHistory: [workflow(1, 'draft'), pinnedWorkflow],
    dependencyHistories: publishedDependencies,
    checkedAt: timestamp,
  }
  const unverified = resolveWorkflowReadiness({
    ...common,
    connection: {
      providerId: 'openai', revision: 2, state: 'verified', credentialRevision: 1,
      discovery: { state: 'available', models: [{ providerId: 'openai', id: 'gpt-test' }] },
    },
  })
  expect(unverified.status).toBe('blocked')
  expect(unverified.blockers.map(item => item.code)).toContain('MODEL_CONNECTION_UNVERIFIED')

  const ready = resolveWorkflowReadiness({
    ...common,
    connection: {
      providerId: 'openai', revision: 2, state: 'verified', credentialRevision: 2,
      discovery: { state: 'available', models: [{ providerId: 'openai', id: 'gpt-test' }] },
    },
  })
  expect(ready.status).toBe('ready')
  expect(ready.model).toEqual({ providerId: 'openai', modelId: 'gpt-test' })

  for (const [discovery, blocker] of [
    [{ state: 'unsupported', models: [] }, 'MODEL_DISCOVERY_UNSUPPORTED'],
    [{ state: 'unavailable', models: [] }, 'MODEL_DISCOVERY_UNAVAILABLE'],
    [{ state: 'auth-failed', models: [] }, 'MODEL_DISCOVERY_AUTH_FAILED'],
    [{ state: 'available', models: [{ providerId: 'openai', id: 'other-model' }] }, 'MODEL_NOT_AVAILABLE'],
    [{ state: 'available', models: [{ providerId: 'wrong-provider', id: 'gpt-test' }] }, 'MODEL_DISCOVERY_MALFORMED'],
  ]) {
    const blocked = resolveWorkflowReadiness({
      ...common,
      connection: {
        providerId: 'openai', revision: 2, state: 'verified', credentialRevision: 2,
        discovery: discovery as { state: string; models: { providerId: string; id: string }[] },
      },
    })
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockers.map(item => item.code)).toContain(blocker)
  }
})

test('local catalog explicitly refuses workflow publication without server-verified readiness', async ({ page }) => {
  await page.goto('/')
  const outcome = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { setCloudProjectMode } = await import('/src/authorizedProjectService.ts' as string)
    const { executeAiCatalog, historyAiAsset } = await import('/src/aiCatalogRepository.ts' as string)
    setCloudProjectMode(false)
    setCloudAuthSession({
      user: { id: 'readiness-local-user' },
      workspace: { id: 'readiness-local-workspace' },
      membership: {
        userId: 'readiness-local-user', workspaceId: 'readiness-local-workspace', role: 'owner',
      },
    })
    const workflow = await executeAiCatalog({
      action: 'create',
      asset: {
        kind: 'workflow', name: 'Local workflow', description: '',
        definition: {
          capability: 'draft', model: { mode: 'auto' },
          promptPack: null, referenceSet: null, blueprint: null, steps: [],
        },
      },
    })
    let message = ''
    try {
      await executeAiCatalog({
        action: 'transition', id: workflow.id, expectedVersion: workflow.version, state: 'published',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    return { message, history: await historyAiAsset(workflow.id) }
  })
  expect(outcome.message).toContain('Workflow publishing requires server-verified readiness')
  expect(outcome.history).toHaveLength(1)
  expect(outcome.history[0]).toMatchObject({ version: 1, state: 'draft' })
})