import { expect, test } from '@playwright/test'

const projectAssets = {
  topics: [
    { id: 'topic-intro', name: 'Introduction' },
    { id: 'topic-details', name: 'Details' },
  ],
  snippets: [{ id: 'snippet-note', name: 'Note' }],
  variables: [{ id: 'variable-color', name: 'Brand color' }],
  conditions: [{ id: 'condition-mobile', name: 'Mobile' }],
}

test('legacy hydration creates deterministic root placements and fixed system categories', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async ({ assets }) => {
      const { CONTENT_EXPLORER_MEDIA_CATEGORIES, CONTENT_EXPLORER_ROOTS,
        deriveContentExplorerTree, hydrateContentExplorerMetadata } =
        await import('/src/contentExplorerModel.ts' as string)
      const first = hydrateContentExplorerMetadata(undefined, assets)
      const repeated = hydrateContentExplorerMetadata(undefined, assets)
      return {
        first,
        repeated,
        roots: CONTENT_EXPLORER_ROOTS,
        categories: CONTENT_EXPLORER_MEDIA_CATEGORIES,
        tree: deriveContentExplorerTree(first, assets),
      }
    },
    { assets: projectAssets },
  )
  expect(result.roots.map((root: { name: string }) => root.name))
    .toEqual(['Topics', 'Snippets', 'Media', 'Variables', 'Conditions', 'References'])
  expect(result.first).toEqual(result.repeated)
  expect(result.first).toMatchObject({
    version: 1,
    folders: [],
    placements: [
      { assetType: 'topic', assetId: 'topic-intro', folderId: 'topics' },
      { assetType: 'topic', assetId: 'topic-details', folderId: 'topics' },
      { assetType: 'snippet', assetId: 'snippet-note', folderId: 'snippets' },
      { assetType: 'variable', assetId: 'variable-color', folderId: 'variables' },
      { assetType: 'condition', assetId: 'condition-mobile', folderId: 'conditions' },
    ],
  })
  expect(result.first.placements).toHaveLength(5)
  expect(result.first).not.toHaveProperty('topicContent')
  expect(result.tree.map((root: { name: string }) => root.name))
    .toEqual(['Topics', 'Snippets', 'Media', 'Variables', 'Conditions', 'References'])

  // The project-facing exports are also used by the Author integration. Check
  // the fixed media categories directly without storing them in metadata.
  const media = result.tree.find((root: { id: string }) => root.id === 'media')
  expect(media.children.map((category: { name: string }) => category.name))
    .toEqual(['Images', 'Videos', 'GIFs', 'Audio'])
})

test('folder operations are bounded, immutable, and reject unsafe sibling names', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const {
      createContentExplorerFolder,
      deleteContentExplorerFolder,
      hydrateContentExplorerMetadata,
      moveContentExplorerFolder,
      renameContentExplorerFolder,
    } = await import('/src/contentExplorerModel.ts' as string)
    const assets = { topics: [], snippets: [], variables: [], conditions: [] }
    const original = hydrateContentExplorerMetadata(undefined, assets)
    let nested = createContentExplorerFolder(original, 'topics', 'Guides', 'folder-guides')
    nested = createContentExplorerFolder(nested, 'folder-guides', 'Basics', 'folder-basics')
    const renamed = renameContentExplorerFolder(nested, 'folder-basics', 'Getting started')
    const moved = moveContentExplorerFolder(renamed, 'folder-basics', 'snippets')
    const deleted = deleteContentExplorerFolder(moved, 'folder-basics')
    const error = (operation: () => unknown) => {
      try {
        operation()
        return ''
      } catch (caught) {
        return caught instanceof Error ? caught.message : String(caught)
      }
    }
    const duplicateName = error(() =>
      createContentExplorerFolder(nested, 'topics', ' guides ', 'folder-duplicate'),
    )
    const nonEmptyDelete = error(() => deleteContentExplorerFolder(nested, 'folder-guides'))
    const immutable = original.folders.length === 0
    let deepest = original
    let parent = 'topics'
    for (let depth = 1; depth <= 8; depth += 1) {
      const id = `folder-depth-${depth}`
      deepest = createContentExplorerFolder(deepest, parent, `Level ${depth}`, id)
      parent = id
    }
    const depthLimit = error(() =>
      createContentExplorerFolder(deepest, parent, 'Too deep', 'folder-depth-9'),
    )
    const cycle = error(() => moveContentExplorerFolder(deepest, 'folder-depth-1', 'folder-depth-8'))
    return {
      original,
      nested,
      renamed,
      moved,
      deleted,
      duplicateName,
      nonEmptyDelete,
      immutable,
      depthLimit,
      cycle,
    }
  })
  expect(result.immutable).toBe(true)
  expect(result.nested.folders.map((folder: { name: string }) => folder.name))
    .toEqual(['Guides', 'Basics'])
  expect(result.renamed.folders.find((folder: { id: string }) => folder.id === 'folder-basics').name)
    .toBe('Getting started')
  expect(result.moved.folders.find((folder: { id: string }) => folder.id === 'folder-basics').parentId)
    .toBe('snippets')
  expect(result.deleted.folders.map((folder: { id: string }) => folder.id)).toEqual(['folder-guides'])
  expect(result.duplicateName).toContain('already exists')
  expect(result.nonEmptyDelete).toContain('must be empty')
  expect(result.depthLimit).toContain('cannot exceed')
  expect(result.cycle).toContain('descendant')
})

test('topic moves update placement only and hydrate prunes removed and places new topics once', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async assets => {
    const {
      createContentExplorerFolder,
      deriveContentExplorerTree,
      hydrateContentExplorerMetadata,
      moveContentExplorerItem,
    } = await import('/src/contentExplorerModel.ts' as string)
    const committedToc = [
      { id: 1, topicId: 'topic-intro', title: 'Introduction', order: 1 },
      { id: 2, topicId: 'topic-details', title: 'Details', order: 2 },
    ]
    const base = hydrateContentExplorerMetadata(undefined, assets)
    const folder = createContentExplorerFolder(base, 'topics', 'Research', 'folder-research')
    const moved = moveContentExplorerItem(folder, 'topic', 'topic-details', 'folder-research')
    const movedTree = deriveContentExplorerTree(moved, assets)
    const nextAssets = {
      ...assets,
      topics: [
        { id: 'topic-intro', name: 'Introduction' },
        { id: 'topic-new', name: 'New topic' },
      ],
    }
    const synchronized = hydrateContentExplorerMetadata(moved, nextAssets)
    const tree = deriveContentExplorerTree(synchronized, nextAssets)
    const walk = (nodes: Array<{ children: unknown[] }>): Array<{ assetId?: string }> =>
      nodes.flatMap(node => [
        ...(node.children as Array<{ children: unknown[] }>).length
          ? walk(node.children as Array<{ children: unknown[] }>)
          : [],
        node as { assetId?: string },
      ])
    return {
      committedToc,
      moved,
      synchronized,
      topicItems: walk(tree).filter(item => item.assetId),
      researchTree: movedTree[0].children.find(
        (node: { id: string }) => node.id === 'folder-research',
      ),
    }
  }, projectAssets)
  expect(result.committedToc).toEqual([
    { id: 1, topicId: 'topic-intro', title: 'Introduction', order: 1 },
    { id: 2, topicId: 'topic-details', title: 'Details', order: 2 },
  ])
  expect(result.moved.placements.find((placement: { assetId: string }) =>
    placement.assetId === 'topic-details').folderId).toBe('folder-research')
  expect(result.synchronized.placements.map((placement: { assetId: string }) => placement.assetId)
    .sort()).toEqual([
    'condition-mobile',
    'snippet-note',
    'topic-intro',
    'topic-new',
    'variable-color',
  ])
  expect(result.topicItems.filter((item: { assetId?: string }) =>
    item.assetId === 'topic-intro')).toHaveLength(1)
  expect(result.topicItems.filter((item: { assetId?: string }) =>
    item.assetId === 'topic-new')).toHaveLength(1)
  expect(result.topicItems.some((item: { assetId?: string }) =>
    item.assetId === 'topic-details')).toBe(false)
  expect(result.researchTree.children[0]).toMatchObject({
    id: 'topic:topic-details',
    name: 'Details',
  })
})

test('malformed metadata fails safely, including invalid placements and duplicated payload fields', async ({ page }) => {
  await page.goto('/')
  const errors = await page.evaluate(async () => {
    const { hydrateContentExplorerMetadata } = await import('/src/contentExplorerModel.ts' as string)
    const assets = { topics: [], snippets: [], variables: [], conditions: [] }
    const attempt = (value: unknown) => {
      try {
        hydrateContentExplorerMetadata(value, assets)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    return [
      attempt({ version: 2, folders: [], placements: [] }),
      attempt({
        version: 1,
        folders: [],
        placements: [{ assetType: 'topic', assetId: 'missing', folderId: 'snippets', order: 0 }],
      }),
      attempt({ version: 1, folders: [], placements: [], content: 'duplicated asset body' }),
    ]
  })
  expect(errors.every(Boolean)).toBe(true)
})

test('schema-five migration deterministically hydrates schema-four Author project references', async ({ page }) => {
  await page.goto('/')
  const outcome = await page.evaluate(async () => {
    const { migrateProjectRecord, CURRENT_PROJECT_SCHEMA_VERSION } =
      await import('/src/projectMigrations.ts' as string)
    const legacy = {
      projectId: 'legacy-author-project',
      projectName: 'Legacy author project',
      schemaVersion: 4,
      recordRevision: 2,
      ownerUserId: 'owner',
      workspaceId: 'workspace',
      appToc: [
        { id: 1, topicId: 'topic-one', title: 'One', level: 1 },
        { id: 2, title: 'Legacy two', level: 1 },
      ],
      snippets: [{ id: 'snippet-one', name: 'Reusable note', content: 'payload stays elsewhere' }],
      themeVariables: { active: [{ id: 'variable-one', name: 'Accent', value: '#fff' }] },
      projectMeta: { themeId: 'active' },
      conditionGroups: [{ id: 'condition-one', group: 'Platform', tags: ['mobile'] }],
    }
    const migrated = migrateProjectRecord(legacy)
    const repeated = migrateProjectRecord(migrated.record)
    return { migrated, repeated, currentVersion: CURRENT_PROJECT_SCHEMA_VERSION, legacy }
  })
  expect(outcome.currentVersion).toBe(5)
  expect(outcome.migrated).toMatchObject({ fromVersion: 4, changed: true })
  expect(outcome.migrated.record).toMatchObject({
    schemaVersion: 5,
    contentExplorer: {
      version: 1,
      folders: [],
      placements: [
        { assetType: 'topic', assetId: 'topic-one', folderId: 'topics' },
        { assetType: 'topic', assetId: 'legacy-2', folderId: 'topics' },
        { assetType: 'snippet', assetId: 'snippet-one', folderId: 'snippets' },
        { assetType: 'variable', assetId: 'variable-one', folderId: 'variables' },
        { assetType: 'condition', assetId: 'condition-one', folderId: 'conditions' },
      ],
    },
  })
  expect(outcome.migrated.record).not.toHaveProperty('contentExplorer.topicContent')
  expect(outcome.repeated).toEqual({
    record: outcome.migrated.record,
    fromVersion: 5,
    changed: false,
  })
  expect(outcome.legacy.appToc).toHaveLength(2)
})