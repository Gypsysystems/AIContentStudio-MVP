import { expect, test } from '@playwright/test'

test('project-name normalization and suggestions are stable and case-insensitive', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const names = await import('/src/projectNames.ts' as string)
    return {
      normalized: names.normalizeProjectName('  Asteria \t  2  '),
      firstKey: names.projectNameKey('Asteria 2'),
      equivalentKey: names.projectNameKey(' asteria   2 '),
      available: names.suggestUniqueProjectName('Asteria 2', ['Other Project']),
      copy: names.suggestUniqueProjectName('Asteria 2', [' asteria   2 ']),
      numbered: names.suggestUniqueProjectName('Asteria 2 Copy', [
        'Asteria 2', 'Asteria 2 Copy', 'Asteria 2 Copy (2)',
      ]),
    }
  })

  expect(result).toEqual({
    normalized: 'Asteria 2',
    firstKey: 'asteria 2',
    equivalentKey: 'asteria 2',
    available: 'Asteria 2',
    copy: 'Asteria 2 Copy',
    numbered: 'Asteria 2 Copy (3)',
  })
})

test('local create and concurrent create reject normalized duplicates in one workspace', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const stem = `project-name-create-${crypto.randomUUID()}`
    const first = await repo.createProject({ projectId: `${stem}-first`, projectName: 'Asteria 2' })
    let conflict: { name: string; suggestedName: string; message: string } | null = null
    try {
      await repo.createProject({ projectId: `${stem}-conflict`, projectName: ' asteria   2 ' })
    } catch (error) {
      conflict = {
        name: (error as Error).name,
        suggestedName: (error as { suggestedName: string }).suggestedName,
        message: (error as Error).message,
      }
    }

    const concurrent = await Promise.all([
      repo.createProject({ projectId: `${stem}-race-a`, projectName: 'Concurrent Name' })
        .then(record => ({ id: record.projectId, conflict: false }))
        .catch(error => ({ id: null, conflict: error instanceof repo.ProjectNameConflictError })),
      repo.createProject({ projectId: `${stem}-race-b`, projectName: ' concurrent   name ' })
        .then(record => ({ id: record.projectId, conflict: false }))
        .catch(error => ({ id: null, conflict: error instanceof repo.ProjectNameConflictError })),
    ])
    for (const created of concurrent) if (created.id) await repo.deleteProject(created.id)
    await repo.deleteProject(first.projectId)
    return { conflict, concurrent }
  })

  expect(result.conflict).toMatchObject({
    name: 'ProjectNameConflictError',
    suggestedName: 'asteria 2 Copy',
  })
  expect(result.conflict?.message).toContain('already exists in this workspace')
  expect(result.concurrent.filter(item => !item.conflict)).toHaveLength(1)
  expect(result.concurrent.filter(item => item.conflict)).toHaveLength(1)
})

test('both local save paths reject rename conflicts but allow edits without renaming', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const stem = `project-name-rename-${crypto.randomUUID()}`
    const first = await repo.createProject({ projectId: `${stem}-first`, projectName: 'First Project' })
    const second = await repo.createProject({ projectId: `${stem}-second`, projectName: 'Second Project' })
    const noRename = await repo.saveProjectIfCurrent(
      { ...first, version: '2.0' }, first.recordRevision,
    )
    const conflicts: string[] = []
    for (const save of [
      () => repo.saveProjectIfCurrent(
        { ...second, projectName: ' FIRST   PROJECT ' }, second.recordRevision,
      ),
      () => repo.saveProject({ ...second, projectName: 'first project' }),
    ]) {
      try {
        await save()
      } catch (error) {
        conflicts.push((error as Error).name)
      }
    }
    await repo.deleteProject(first.projectId)
    await repo.deleteProject(second.projectId)
    return { noRename: noRename.version, conflicts }
  })

  expect(result).toEqual({ noRename: '2.0', conflicts: ['ProjectNameConflictError', 'ProjectNameConflictError'] })
})

test('duplicate and restore-as-new require an available explicit name and suggest copies', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const stem = `project-name-copy-${crypto.randomUUID()}`
    const source = await repo.createProject({ projectId: `${stem}-source`, projectName: 'Project Name' })
    const existingCopy = await repo.createProject({
      projectId: `${stem}-copy`, projectName: 'Project Name Copy',
    })
    const conflictDetails = async (operation: () => Promise<unknown>) => {
      try {
        await operation()
        return null
      } catch (error) {
        return {
          name: (error as Error).name,
          suggestedName: (error as { suggestedName: string }).suggestedName,
        }
      }
    }
    const duplicateConflict = await conflictDetails(
      () => repo.duplicateProject(source.projectId, ' project name copy '),
    )
    const restoreConflict = await conflictDetails(() => repo.restoreProjectSnapshot(
      { record: source, files: [] },
      { mode: 'new', newName: 'Project Name Copy' },
    ))
    const restored = await repo.restoreProjectSnapshot(
      { record: source, files: [] },
      { mode: 'new', newName: 'Project Name Copy (2)' },
    )
    const restoredLoaded = await repo.loadProject(restored.projectId)
    await repo.deleteProject(source.projectId)
    await repo.deleteProject(existingCopy.projectId)
    await repo.deleteProject(restored.projectId)
    return {
      duplicateConflict, restoreConflict,
      restored: { name: restored.projectName, id: restored.projectId, loadedId: restoredLoaded?.projectId },
      sourceId: source.projectId,
    }
  })

  expect(result.duplicateConflict).toEqual({
    name: 'ProjectNameConflictError',
    suggestedName: 'project name Copy (2)',
  })
  expect(result.restoreConflict).toEqual({
    name: 'ProjectNameConflictError',
    suggestedName: 'Project Name Copy (2)',
  })
  expect(result.restored.name).toBe('Project Name Copy (2)')
  expect(result.restored.id).not.toBe(result.sourceId)
  expect(result.restored.loadedId).toBe(result.restored.id)
})

test('same normalized project name is allowed in a different local workspace', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const stem = `project-name-workspace-${crypto.randomUUID()}`
    const name = 'Cross Workspace Name'
    const first = await repo.createProject({ projectId: `${stem}-first`, projectName: name })
    const otherContext = {
      user: { id: 'second-local-user' },
      workspace: { id: `${stem}-workspace` },
      membership: { userId: 'second-local-user', workspaceId: `${stem}-workspace`, role: 'owner' },
    }
    const second = await repo.createProject({
      projectId: `${stem}-second`, projectName: ' cross   workspace name ',
    }, otherContext)
    await repo.deleteProject(first.projectId)
    await repo.deleteProject(second.projectId, otherContext)
    return {
      firstWorkspaceId: first.workspaceId,
      secondWorkspaceId: second.workspaceId,
      sameNameKey: repo.projectNameKey(first.projectName) === repo.projectNameKey(second.projectName),
    }
  })

  expect(result.sameNameKey).toBe(true)
  expect(result.firstWorkspaceId).not.toBe(result.secondWorkspaceId)
})