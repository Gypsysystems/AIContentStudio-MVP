import { expect, test } from '@playwright/test'

test('content catalog client bounds pages and exposes metadata-only list rows', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { listContentCatalogItems } = await import('/src/contentCatalogClient.ts' as string)
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ url: String(input), init, body })
      return new Response(JSON.stringify({
        items: [{
          itemId: 'catalog-item-1',
          projectId: 'source-project',
          assetType: 'snippet',
          displayName: 'Shared intro',
          currentVersion: 4,
          updatedAt: '2026-10-02T12:00:00.000Z',
          workspaceId: 'private-workspace-field',
          localAssetId: 'private-local-id',
          payload: { source: 'must not be returned from list' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    let boundsError = ''
    try {
      await listContentCatalogItems('workspace-1', { limit: 101, offset: 0 })
    } catch (error) {
      boundsError = error instanceof Error ? error.message : String(error)
    }
    let sameProjectError = ''
    try {
      await listContentCatalogItems('workspace-1', {
        projectId: 'destination', excludeProjectId: 'destination', limit: 50, offset: 0,
      })
    } catch (error) {
      sameProjectError = error instanceof Error ? error.message : String(error)
    }
    const items = await listContentCatalogItems('workspace-1', {
      projectId: 'source-project', excludeProjectId: 'destination',
      assetType: 'snippet', search: 'intro', limit: 50, offset: 100,
    })
    globalThis.fetch = originalFetch
    return { requests, items, boundsError, sameProjectError }
  })
  expect(result.boundsError).toContain('page size')
  expect(result.sameProjectError).toContain('excluded destination')
  expect(result.requests).toHaveLength(1)
  expect(result.requests[0].url).toBe('/api/content-catalog')
  expect(result.requests[0].init?.credentials).toBe('same-origin')
  expect(result.requests[0].body).toEqual({
    action: 'list',
    workspaceId: 'workspace-1',
    projectId: 'source-project',
    excludeProjectId: 'destination',
    assetType: 'snippet',
    search: 'intro',
    limit: 50,
    offset: 100,
  })
  expect(result.items).toEqual([{
    itemId: 'catalog-item-1',
    projectId: 'source-project',
    assetType: 'snippet',
    displayName: 'Shared intro',
    currentVersion: 4,
    updatedAt: '2026-10-02T12:00:00.000Z',
  }])
})

test('preview reads payload while copy sends only exact reference and CAS fields', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { copyContentCatalogItem, loadContentCatalogVersion } =
      await import('/src/contentCatalogClient.ts' as string)
    const originalFetch = globalThis.fetch
    const requests: Array<{ body: Record<string, unknown>; credentials?: RequestCredentials }> = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ body, credentials: init?.credentials })
      if (body.action === 'version') {
        return new Response(JSON.stringify({
          item: {
            itemId: 'catalog-item-2', projectId: 'source-project', assetType: 'topic',
            displayName: 'Shared topic', currentVersion: 7, updatedAt: '2026-10-02T12:00:00.000Z',
            originItemId: 'not-in-preview-contract',
          },
          version: { version: 3, payload: { title: 'Old title', blocks: [] }, sourceProjectRevision: 33 },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        projectId: 'destination', recordRevision: 12, assetType: 'topic',
        asset: { id: 'local-topic', title: 'Shared topic', topicId: 'stable-topic', alreadyAvailable: false },
        record: { sourcePayload: 'must not be consumed' },
      }), { status: 200 })
    }) as typeof fetch
    const preview = await loadContentCatalogVersion(
      'workspace-1',
      { itemId: 'catalog-item-2', currentVersion: 7 },
      3,
    )
    const copied = await copyContentCatalogItem({
      workspaceId: 'workspace-1',
      sourceItemId: 'catalog-item-2',
      sourceVersion: 3,
      destinationProjectId: 'destination',
      expectedRevision: 11,
      insertion: { afterTopicId: 'stable-selected-topic' },
    })
    globalThis.fetch = originalFetch
    return { requests, preview, copied }
  })
  expect(result.preview).toEqual({
    item: {
      itemId: 'catalog-item-2',
      projectId: 'source-project',
      assetType: 'topic',
      displayName: 'Shared topic',
      currentVersion: 7,
      updatedAt: '2026-10-02T12:00:00.000Z',
    },
    version: { version: 3, payload: { title: 'Old title', blocks: [] } },
  })
  expect(result.requests[0].body).toEqual({
    action: 'version', workspaceId: 'workspace-1', itemId: 'catalog-item-2', version: 3,
  })
  expect(result.requests[1]).toEqual({
    credentials: 'same-origin',
    body: {
      action: 'copy',
      workspaceId: 'workspace-1',
      sourceItemId: 'catalog-item-2',
      sourceVersion: 3,
      destinationProjectId: 'destination',
      expectedRevision: 11,
      insertion: { afterTopicId: 'stable-selected-topic' },
    },
  })
  expect(result.copied).toEqual({
    projectId: 'destination',
    recordRevision: 12,
    assetType: 'topic',
    asset: { id: 'local-topic', title: 'Shared topic', topicId: 'stable-topic', alreadyAvailable: false },
  })
})

test('legacy project hydration initializes content origins and keeps saved origins', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { migrateProjectRecord } = await import('/src/projectMigrations.ts' as string)
    const base = {
      projectId: 'destination',
      projectName: 'Destination',
      schemaVersion: 5,
      recordRevision: 9,
      ownerUserId: 'user-1',
      workspaceId: 'workspace-1',
    }
    const old = migrateProjectRecord(base).record
    const savedOrigins = {
      topic: {},
      snippet: {
        'snippet-local-1': {
          originItemId: 'catalog-item-1',
          originProjectId: 'source-project',
          originVersion: 4,
        },
      },
      variable: {},
      condition: {},
    }
    const restored = migrateProjectRecord({ ...base, contentOrigins: savedOrigins }).record
    return { old: old.contentOrigins, restored: restored.contentOrigins }
  })
  expect(result.old).toEqual({ topic: {}, snippet: {}, variable: {}, condition: {} })
  expect(result.restored.snippet['snippet-local-1']).toEqual({
    originItemId: 'catalog-item-1',
    originProjectId: 'source-project',
    originVersion: 4,
  })
})