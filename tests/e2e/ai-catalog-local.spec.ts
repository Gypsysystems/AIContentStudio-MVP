import { expect, test, type Page } from '@playwright/test'

async function openApp(page: Page) {
  await page.goto('/')
}

test('local AI catalog preserves immutable revisions, validates transitions, and tombstones deletion', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { executeAiCatalog, historyAiAsset, listAiAssets } =
      await import('/src/aiCatalogRepository.ts' as string)
    const input = {
      kind: 'reference-set' as const,
      name: 'Approved references',
      description: '',
      definition: {
        entries: [{ id: 'term-one', type: 'terminology' as const, title: 'Calibration',
          locator: '', note: 'Use this term consistently.' }],
      },
    }
    const created = await executeAiCatalog({ action: 'create', asset: input })
    const revisedInput = {
      ...input,
      name: 'Updated approved references',
      definition: {
        entries: [{ ...input.definition.entries[0], note: 'Updated terminology guidance.' }],
      },
    }
    const revised = await executeAiCatalog({
      action: 'revise', id: created.id, expectedVersion: created.version, asset: revisedInput,
    })
    let staleRejected = false
    try {
      await executeAiCatalog({
        action: 'revise', id: created.id, expectedVersion: created.version, asset: revisedInput,
      })
    } catch (error) {
      staleRejected = error instanceof Error && /expected version 1, found 2/.test(error.message)
    }
    const tested = await executeAiCatalog({
      action: 'transition', id: created.id, expectedVersion: revised.version, state: 'test',
    })
    const published = await executeAiCatalog({
      action: 'transition', id: created.id, expectedVersion: tested.version, state: 'published',
    })
    let invalidTransitionRejected = false
    try {
      await executeAiCatalog({
        action: 'transition', id: created.id, expectedVersion: published.version, state: 'draft',
      })
    } catch (error) {
      invalidTransitionRejected = error instanceof Error && /cannot transition/.test(error.message)
    }
    const listedBeforeDelete = await listAiAssets()
    const deleted = await executeAiCatalog({
      action: 'delete', id: created.id, expectedVersion: published.version,
    })
    return {
      created, revised, tested, published, deleted, staleRejected, invalidTransitionRejected,
      listedBeforeDelete: listedBeforeDelete.some(asset => asset.id === created.id),
      listedAfterDelete: (await listAiAssets()).some(asset => asset.id === created.id),
      history: await historyAiAsset(created.id),
    }
  })

  expect(result.created).toMatchObject({ version: 1, state: 'draft', name: 'Approved references' })
  expect(result.revised).toMatchObject({ version: 2, state: 'draft', name: 'Updated approved references' })
  expect(result.tested).toMatchObject({ version: 3, state: 'test' })
  expect(result.published).toMatchObject({ version: 4, state: 'published' })
  expect(result.deleted).toMatchObject({ version: 5, state: 'archived' })
  expect(result.staleRejected).toBe(true)
  expect(result.invalidTransitionRejected).toBe(true)
  expect(result.listedBeforeDelete).toBe(true)
  expect(result.listedAfterDelete).toBe(false)
  expect(result.history.map(asset => asset.version)).toEqual([1, 2, 3, 4, 5])
  expect(result.history[0]).toMatchObject({ name: 'Approved references', state: 'draft' })
  expect(result.history[3]).toMatchObject({ name: 'Updated approved references', state: 'published' })
})

test('local AI catalog isolates workspaces and restricts mutations to owners and admins', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { executeAiCatalog, historyAiAsset, listAiAssets } =
      await import('/src/aiCatalogRepository.ts' as string)
    const setMembership = (workspaceId: string, userId: string, role: 'owner' | 'admin' | 'editor' | 'viewer') => {
      setCloudAuthSession({
        user: { id: userId },
        workspace: { id: workspaceId },
        membership: { userId, workspaceId, role },
      })
    }
    const input = {
      kind: 'blueprint' as const,
      name: 'Local blueprint',
      description: '',
      definition: { contentType: 'Quick Start' as const, sections: [] },
    }
    setMembership('catalog-workspace-one', 'catalog-owner', 'owner')
    const created = await executeAiCatalog({ action: 'create', asset: input })

    setMembership('catalog-workspace-one', 'catalog-editor', 'editor')
    let editorDenied = false
    try {
      await executeAiCatalog({ action: 'delete', id: created.id, expectedVersion: created.version })
    } catch (error) {
      editorDenied = error instanceof Error && /cannot mutate/.test(error.message)
    }
    const editorCanRead = (await listAiAssets()).some(asset => asset.id === created.id)

    setMembership('catalog-workspace-one', 'catalog-admin', 'admin')
    const adminRevision = await executeAiCatalog({
      action: 'revise', id: created.id, expectedVersion: created.version,
      asset: { ...input, name: 'Admin revision' },
    })

    setMembership('catalog-workspace-two', 'other-owner', 'owner')
    const otherWorkspaceList = await listAiAssets()
    const otherWorkspaceHistory = await historyAiAsset(created.id)
    let crossWorkspaceMutationDenied = false
    try {
      await executeAiCatalog({
        action: 'revise', id: created.id, expectedVersion: adminRevision.version,
        asset: { ...input, name: 'Cross-workspace revision' },
      })
    } catch (error) {
      crossWorkspaceMutationDenied = error instanceof Error && /does not exist in this workspace/.test(error.message)
    }
    setMembership('catalog-workspace-one', 'catalog-owner', 'owner')
    const ownerHistory = await historyAiAsset(created.id)
    return {
      createdId: created.id,
      editorDenied,
      editorCanRead,
      adminRevision,
      otherWorkspaceList,
      otherWorkspaceHistory,
      crossWorkspaceMutationDenied,
      ownerHistory,
    }
  })

  expect(result.editorDenied).toBe(true)
  expect(result.editorCanRead).toBe(true)
  expect(result.adminRevision).toMatchObject({ version: 2, name: 'Admin revision' })
  expect(result.otherWorkspaceList).toEqual([])
  expect(result.otherWorkspaceHistory).toEqual([])
  expect(result.crossWorkspaceMutationDenied).toBe(true)
  expect(result.ownerHistory.map(asset => asset.version)).toEqual([1, 2])
  expect(result.ownerHistory.every(asset => asset.id === result.createdId)).toBe(true)
})

test('local prompt-pack revisions prohibit prompt ID reuse and invalid new prompt versions', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { executeAiCatalog, historyAiAsset } =
      await import('/src/aiCatalogRepository.ts' as string)
    const base = {
      kind: 'prompt-pack' as const,
      name: 'Prompt history',
      description: '',
    }
    const prompt = (id: string, version: number, state: 'draft' | 'test' | 'published' = 'draft') => ({
      id, version, state, name: `Prompt ${id}`, template: 'Write {{subject}}.',
      variables: ['subject'],
    })
    const invalidInitialRejected = async (candidate: ReturnType<typeof prompt>) => {
      try {
        await executeAiCatalog({
          action: 'create', asset: { ...base, definition: { prompts: [candidate] } },
        })
        return false
      } catch (error) {
        return error instanceof Error && /definition is invalid/.test(error.message)
      }
    }
    const invalidInitialVersionRejected = await invalidInitialRejected(prompt('initial_version', 2))
    const invalidInitialStateRejected = await invalidInitialRejected(prompt('initial_state', 1, 'test'))
    const created = await executeAiCatalog({
      action: 'create', asset: { ...base, definition: { prompts: [prompt('reusable_prompt', 1)] } },
    })
    const removed = await executeAiCatalog({
      action: 'revise', id: created.id, expectedVersion: created.version,
      asset: { ...base, definition: { prompts: [] } },
    })
    const tryRevision = async (prompts: ReturnType<typeof prompt>[]) => {
      try {
        await executeAiCatalog({
          action: 'revise', id: created.id, expectedVersion: removed.version,
          asset: { ...base, definition: { prompts } },
        })
        return false
      } catch (error) {
        return error instanceof Error && /revision is invalid/.test(error.message)
      }
    }
    const reusedIdRejected = await tryRevision([prompt('reusable_prompt', 1)])
    const newPromptVersionRejected = await tryRevision([prompt('new_prompt_version', 2)])
    const newPromptTestStateRejected = await tryRevision([prompt('new_prompt_test', 1, 'test')])
    const accepted = await executeAiCatalog({
      action: 'revise', id: created.id, expectedVersion: removed.version,
      asset: { ...base, definition: { prompts: [prompt('brand_new_prompt', 1)] } },
    })
    return {
      created, removed, accepted, reusedIdRejected, newPromptVersionRejected,
      newPromptTestStateRejected, invalidInitialVersionRejected, invalidInitialStateRejected,
      history: await historyAiAsset(created.id),
    }
  })

  expect(result.invalidInitialVersionRejected).toBe(true)
  expect(result.invalidInitialStateRejected).toBe(true)
  expect(result.reusedIdRejected).toBe(true)
  expect(result.newPromptVersionRejected).toBe(true)
  expect(result.newPromptTestStateRejected).toBe(true)
  expect(result.accepted).toMatchObject({
    version: 3,
    definition: { prompts: [{ id: 'brand_new_prompt', version: 1, state: 'draft' }] },
  })
  expect(result.history.map(asset => asset.version)).toEqual([1, 2, 3])
})

test('cloud create and revise confirmations tolerate JSON key order but reject content differences', async ({ page }) => {
  await openApp(page)
  const persisted: Record<string, unknown>[] = []
  let requestCount = 0
  await page.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON() as {
      action: string
      asset?: { kind: string; name: string; description: string; definition: Record<string, unknown> }
      expectedVersion?: number
      id?: string
    }
    requestCount += 1
    if (command.action === 'history') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: persisted.filter(asset => asset.id === command.id) }),
      })
      return
    }
    const incoming = command.asset!
    const definition = incoming.definition as {
      entries: Array<{ id: string; type: string; title: string; locator: string; note: string }>
    }
    const entries = definition.entries.map(entry => ({
      note: command.action === 'create' && incoming.name === 'Mismatched response'
        ? 'Server altered this content.'
        : entry.note,
      locator: entry.locator,
      title: entry.title,
      type: entry.type,
      id: entry.id,
    }))
    const stored = {
      workspaceId: 'local-workspace',
      id: command.action === 'create' ? `ai-cloud-confirm-${persisted.length + 1}` : command.id,
      kind: incoming.kind,
      version: command.action === 'create' ? 1 : (command.expectedVersion ?? 0) + 1,
      state: 'draft',
      name: incoming.name,
      description: incoming.description,
      definition: { entries },
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'cloud-user',
    }
    persisted.push(stored)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ asset: stored }),
    })
  })

  const result = await page.evaluate(async () => {
    const { setCloudProjectMode } = await import('/src/authorizedProjectService.ts' as string)
    const { executeAiCatalog } = await import('/src/aiCatalogRepository.ts' as string)
    setCloudProjectMode(true)
    const input = {
      kind: 'reference-set' as const,
      name: 'Cloud confirmation',
      description: '',
      definition: {
        entries: [{ id: 'cloud-entry', type: 'terminology' as const, title: 'Alignment',
          locator: '', note: 'Keep property order stable only in data, not JSON.' }],
      },
    }
    try {
      const created = await executeAiCatalog({ action: 'create', asset: input })
      const revised = await executeAiCatalog({
        action: 'revise', id: created.id, expectedVersion: created.version,
        asset: { ...input, name: 'Cloud revised confirmation' },
      })
      let contentMismatchRejected = false
      try {
        await executeAiCatalog({
          action: 'create', asset: { ...input, name: 'Mismatched response' },
        })
      } catch (error) {
        contentMismatchRejected = error instanceof Error && /did not confirm/.test(error.message)
      }
      let invalidInitialRejected = false
      try {
        await executeAiCatalog({
          action: 'create',
          asset: {
            kind: 'prompt-pack',
            name: 'Invalid cloud initial prompt',
            description: '',
            definition: {
              prompts: [{ id: 'cloud-initial', version: 2, state: 'draft', name: 'Prompt',
                template: '', variables: [] }],
            },
          },
        })
      } catch (error) {
        invalidInitialRejected = error instanceof Error && /definition is invalid/.test(error.message)
      }
      return { created, revised, contentMismatchRejected, invalidInitialRejected }
    } finally {
      setCloudProjectMode(false)
    }
  })

  expect(result.created).toMatchObject({ version: 1, name: 'Cloud confirmation' })
  expect(result.revised).toMatchObject({ version: 2, name: 'Cloud revised confirmation' })
  expect(result.contentMismatchRejected).toBe(true)
  expect(result.invalidInitialRejected).toBe(true)
  expect(requestCount).toBe(4)
})

test('local workflow references must resolve to exact same-workspace versions of the expected kind', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { setCloudAuthSession } = await import('/src/authSession.ts' as string)
    const { executeAiCatalog } = await import('/src/aiCatalogRepository.ts' as string)
    const setMembership = (workspaceId: string, userId: string) => setCloudAuthSession({
      user: { id: userId },
      workspace: { id: workspaceId },
      membership: { userId, workspaceId, role: 'owner' },
    })
    const input = {
      kind: 'reference-set' as const,
      name: 'Workflow references',
      description: '',
      definition: { entries: [] },
    }
    const workflow = (refs: {
      promptPack?: { id: string; version: number } | null
      referenceSet?: { id: string; version: number } | null
      blueprint?: { id: string; version: number } | null
    }) => ({
      kind: 'workflow' as const,
      name: 'Reference-aware workflow',
      description: '',
      definition: {
        capability: 'draft',
        model: { mode: 'auto' as const },
        promptPack: refs.promptPack ?? null,
        referenceSet: refs.referenceSet ?? null,
        blueprint: refs.blueprint ?? null,
        steps: [],
      },
    })
    const rejected = async (operation: () => Promise<unknown>) => {
      try {
        await operation()
        return false
      } catch (error) {
        return error instanceof Error && /must reference an existing/.test(error.message)
      }
    }
    setMembership('catalog-refs-one', 'refs-owner-one')
    const source = await executeAiCatalog({ action: 'create', asset: input })
    const validWorkflow = await executeAiCatalog({
      action: 'create',
      asset: workflow({ referenceSet: { id: source.id, version: source.version } }),
    })
    const wrongKindRejected = await rejected(() => executeAiCatalog({
      action: 'create',
      asset: workflow({ promptPack: { id: source.id, version: source.version } }),
    }))
    const wrongVersionRejected = await rejected(() => executeAiCatalog({
      action: 'create',
      asset: workflow({ referenceSet: { id: source.id, version: source.version + 1 } }),
    }))
    const missingReferenceRejected = await rejected(() => executeAiCatalog({
      action: 'create',
      asset: workflow({ blueprint: { id: 'missing-blueprint', version: 1 } }),
    }))
    const invalidRevisionRejected = await rejected(() => executeAiCatalog({
      action: 'revise',
      id: validWorkflow.id,
      expectedVersion: validWorkflow.version,
      asset: workflow({ referenceSet: { id: source.id, version: source.version + 1 } }),
    }))

    setMembership('catalog-refs-two', 'refs-owner-two')
    const crossWorkspaceReferenceRejected = await rejected(() => executeAiCatalog({
      action: 'create',
      asset: workflow({ referenceSet: { id: source.id, version: source.version } }),
    }))
    return {
      validWorkflow,
      wrongKindRejected,
      wrongVersionRejected,
      missingReferenceRejected,
      invalidRevisionRejected,
      crossWorkspaceReferenceRejected,
    }
  })

  expect(result.validWorkflow).toMatchObject({ kind: 'workflow', version: 1 })
  expect(result.wrongKindRejected).toBe(true)
  expect(result.wrongVersionRejected).toBe(true)
  expect(result.missingReferenceRejected).toBe(true)
  expect(result.invalidRevisionRejected).toBe(true)
  expect(result.crossWorkspaceReferenceRejected).toBe(true)
})

test('archived local AI assets are terminal for every mutation', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { executeAiCatalog, historyAiAsset } =
      await import('/src/aiCatalogRepository.ts' as string)
    const input = {
      kind: 'blueprint' as const,
      name: 'Terminal blueprint',
      description: '',
      definition: { contentType: 'Quick Start' as const, sections: [] },
    }
    const created = await executeAiCatalog({ action: 'create', asset: input })
    const archived = await executeAiCatalog({
      action: 'transition', id: created.id, expectedVersion: created.version, state: 'archived',
    })
    const rejected = async (operation: () => Promise<unknown>) => {
      try {
        await operation()
        return false
      } catch (error) {
        return error instanceof Error && /is archived and cannot/.test(error.message)
      }
    }
    const reviseRejected = await rejected(() => executeAiCatalog({
      action: 'revise', id: created.id, expectedVersion: archived.version,
      asset: { ...input, name: 'Should not revise' },
    }))
    const transitionRejected = await rejected(() => executeAiCatalog({
      action: 'transition', id: created.id, expectedVersion: archived.version, state: 'draft',
    }))
    const deleteRejected = await rejected(() => executeAiCatalog({
      action: 'delete', id: created.id, expectedVersion: archived.version,
    }))
    return {
      archived, reviseRejected, transitionRejected, deleteRejected,
      history: await historyAiAsset(created.id),
    }
  })

  expect(result.archived).toMatchObject({ version: 2, state: 'archived' })
  expect(result.reviseRejected).toBe(true)
  expect(result.transitionRejected).toBe(true)
  expect(result.deleteRejected).toBe(true)
  expect(result.history.map(asset => asset.version)).toEqual([1, 2])
})