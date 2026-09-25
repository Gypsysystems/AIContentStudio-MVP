import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const v1Fixture = JSON.parse(await readFile(
  new URL('../fixtures/project-record-v1.json', import.meta.url),
  'utf8',
)) as Record<string, any>
const v2Fixture = JSON.parse(await readFile(
  new URL('../fixtures/project-record-v2.json', import.meta.url),
  'utf8',
)) as Record<string, any>

async function openApp(page: Page) {
  await page.goto('/')
}

async function makeCurrentBackup(page: Page, projectId: string) {
  return page.evaluate(async ({ projectId, fixture }) => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, inspectProjectBackup, restoreProjectBackup } =
      await import('/src/projectBackup.ts' as string)
    const project = await projectRepository.createProject({
      projectId,
      projectName: 'Backup round-trip fixture',
      projectMeta: { contentType: 'user-guide', owner: 'Persistence QA' },
    })
    const stored = await projectRepository.saveFile(
      projectId,
      new File(['source bytes for a complete backup'], 'field-manual.md', { type: 'text/markdown' }),
    )
    const remapFixture = (value: unknown): unknown => {
      if (value === 'fixture-source-a') return stored.fileId
      if (value === 'fixture-v2-project') return projectId
      if (Array.isArray(value)) return value.map(remapFixture)
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key === 'fixture-source-a' ? stored.fileId : key,
          remapFixture(nested),
        ]))
      }
      return value
    }
    const record = remapFixture(fixture) as Record<string, any>
    const mediaDataUrl = 'data:image/png;base64,aGVsbG8tZGlhZ3JhbQ=='
    record.projectId = projectId
    record.projectName = 'Complete backup project'
    record.schemaVersion = 3
    record.recordRevision = project.recordRevision
    record.themes = [
      ...record.themes,
      { id: 'theme-backup-brand', name: 'Backup Brand', logoDataUrl: mediaDataUrl },
    ]
    record.projectMeta = { ...record.projectMeta, backupNote: 'round-trip metadata' }
    record.themeVariables = {
      ...record.themeVariables,
      unresolved: [{ name: 'UNKNOWN_SKU', value: '{{UnknownSku}}' }],
    }
    record.docBlocks = [
      ...record.docBlocks,
      { id: 'media-doc-block', type: 'image', mediaType: mediaDataUrl, mediaName: 'diagram.png' },
    ]
    record.topicContent['stable-setup'] = [
      ...record.topicContent['stable-setup'],
      { id: 'unresolved-author-block', type: 'para', content: 'Reserved for {{UnknownSku}}.' },
    ]
    record.publishConfig = {
      ...record.publishConfig,
      customVariable: '{{UnknownSku}}',
      logoDataUrl: mediaDataUrl,
    }
    const saved = await projectRepository.saveProjectIfCurrent(record, project.recordRevision)
    const archive = await createProjectBackup(projectId)
    const summary = await inspectProjectBackup(archive)
    const restored = await restoreProjectBackup(archive, { mode: 'new' })
    const restoredFiles = await projectRepository.loadProjectFiles(restored.projectId)
    return {
      originalId: projectId,
      originalFileId: stored.fileId,
      restoredId: restored.projectId,
      originalRevision: saved.recordRevision,
      summary,
      restored,
      restoredFileIds: restoredFiles.map(file => file.fileId),
      restoredBlobText: await restoredFiles[0]?.blob.text(),
      mediaDataUrl,
    }
  }, { projectId, fixture: v2Fixture })
}

test('backup round-trip preserves complete project state, assets, provenance, and IDs after reload', async ({ page }) => {
  await openApp(page)
  const projectId = `backup-round-trip-${Date.now()}`
  const result = await makeCurrentBackup(page, projectId)

  expect(result.summary).toMatchObject({
    projectId,
    projectName: 'Complete backup project',
    projectSchemaVersion: 4,
    fileCount: 1,
  })
  expect(result.restoredId).not.toBe(projectId)
  expect(result.restoredFileIds).toHaveLength(1)
  expect(result.restoredFileIds[0]).not.toBe(result.originalFileId)
  expect(result.restoredBlobText).toBe('source bytes for a complete backup')
  expect(result.restored).toMatchObject({
    projectName: 'Complete backup project (Restored)',
    schemaVersion: 4,
    recordRevision: 0,
    themes: v2Fixture.themes.concat([{
      id: 'theme-backup-brand',
      name: 'Backup Brand',
      logoDataUrl: result.mediaDataUrl,
    }]),
    projectMeta: { owner: 'Operations', backupNote: 'round-trip metadata' },
    activeStyleProfileId: 'style-field',
    appToc: v2Fixture.appToc,
    topicContent: {
      ...v2Fixture.topicContent,
      'stable-setup': [
        ...v2Fixture.topicContent['stable-setup'],
        { id: 'unresolved-author-block', type: 'para', content: 'Reserved for {{UnknownSku}}.' },
      ],
    },
    reviewStage: 2,
    reviewRevision: 4,
    reviewModel: {
      projectId: result.restoredId,
      activeReviewRunId: 'review-run-fixture',
      runs: [{ reviewRunId: 'review-run-fixture', projectId: result.restoredId }],
      findings: [{
        findingId: 'finding-fixture',
        projectId: result.restoredId,
        topicId: 'stable-setup',
        status: 'resolved',
        resolutionHistory: [{ status: 'resolved', reason: 'updated' }],
        sourceReferences: [{ projectId: result.restoredId, sourceId: result.restoredFileIds[0], fileId: result.restoredFileIds[0] }],
      }],
    },
    publishConfig: {
      ...v2Fixture.publishConfig,
      customVariable: '{{UnknownSku}}',
      logoDataUrl: result.mediaDataUrl,
    },
  })
  expect(result.restored.sourceFileIds).toEqual(result.restoredFileIds)
  expect(result.restored.sourceExtractions).toHaveProperty(result.restoredFileIds[0])
  expect(result.restored.sourceExtractions).not.toHaveProperty(result.originalFileId)
  expect(result.restored.sourceExtractions[result.restoredFileIds[0]].sourceId).toBe(result.restoredFileIds[0])
  expect(result.restored.evidenceIndex.items[0]).toMatchObject({
    id: 'evidence-fixture-1',
    sourceId: result.restoredFileIds[0],
    fileId: result.restoredFileIds[0],
  })
  expect(result.restored.tocProposal.items.map((item: { topicId: string }) => item.topicId))
    .toEqual(v2Fixture.tocProposal.items.map((item: { topicId: string }) => item.topicId))
  expect(result.restored.authorTopicMetadata['stable-setup']).toMatchObject({
    topicId: 'stable-setup',
    evidenceIds: ['evidence-fixture-1'],
    sourceFileIds: [result.restoredFileIds[0]],
    provenance: { styleProfileId: 'style-field' },
  })
  expect(result.restored.reviewModel.findings[0]).toMatchObject({
    findingId: 'finding-fixture',
    topicId: 'stable-setup',
    projectId: result.restoredId,
    status: 'resolved',
    resolutionHistory: [{ status: 'resolved', reason: 'updated' }],
    sourceReferences: [{ sourceId: result.restoredFileIds[0], fileId: result.restoredFileIds[0] }],
  })
  expect(result.restored.docBlocks).toContainEqual({
    id: 'media-doc-block',
    type: 'image',
    mediaType: result.mediaDataUrl,
    mediaName: 'diagram.png',
  })
  expect(result.restored.themeVariables.unresolved).toEqual([
    { name: 'UNKNOWN_SKU', value: '{{UnknownSku}}' },
  ])
  expect(result.restored.topicContent['stable-setup'][2].content).toContain('{{UnknownSku}}')

  await page.reload()
  const reloaded = await page.evaluate(async restoredId => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const record = await projectRepository.loadProject(restoredId)
    const files = await projectRepository.loadProjectFiles(restoredId)
    return {
      record,
      files: await Promise.all(files.map(async file => ({
        fileId: file.fileId,
        name: file.name,
        bytes: await file.blob.text(),
      }))),
    }
  }, result.restoredId)
  expect(reloaded.record).toMatchObject({
    projectId: result.restoredId,
    projectName: 'Complete backup project (Restored)',
    schemaVersion: 4,
    topicContent: result.restored.topicContent,
    reviewModel: result.restored.reviewModel,
  })
  expect(reloaded.files).toEqual([{
    fileId: result.restoredFileIds[0],
    name: 'field-manual.md',
    bytes: 'source bytes for a complete backup',
  }])
})

test('v1 and v2 project records inside backups migrate safely before restore', async ({ page }) => {
  await openApp(page)
  const restored = await page.evaluate(async ({ v1, v2 }) => {
    const { serializeProjectBackup, restoreProjectBackup } = await import('/src/projectBackup.ts' as string)
    const createOldBackup = async (source: Record<string, any>, id: string) => {
      const sourceId = `${id}-source`
      const map = (value: unknown): unknown => {
        if (value === source.projectId) return id
        if (value === 'fixture-source-a' || value === 'fixture-v1-source') return sourceId
        if (Array.isArray(value)) return value.map(map)
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
            key === 'fixture-source-a' || key === 'fixture-v1-source' ? sourceId : key,
            map(nested),
          ]))
        }
        return value
      }
      const record = map(source) as Record<string, any>
      record.projectId = id
      const blob = new Blob([`legacy bytes for ${id}`], { type: 'text/plain' })
      const snapshot = {
        record,
        files: [{
          fileId: sourceId, projectId: id, name: `${id}.txt`, type: 'text/plain',
          size: blob.size, uploadedAt: 1700000000000, blob,
        }],
      }
      return serializeProjectBackup(snapshot as any, 1700000001000)
    }
    const v1Archive = await createOldBackup(v1, `backup-v1-${Date.now()}`)
    const v2Archive = await createOldBackup(v2, `backup-v2-${Date.now()}`)
    const v1Restored = await restoreProjectBackup(v1Archive, { mode: 'new' })
    const v2Restored = await restoreProjectBackup(v2Archive, { mode: 'new' })
    return { v1Restored, v2Restored }
  }, { v1: v1Fixture, v2: v2Fixture })

  expect(restored.v1Restored).toMatchObject({
    schemaVersion: 4,
    recordRevision: 0,
    projectName: `${v1Fixture.projectName} (Restored)`,
    appToc: v1Fixture.appToc,
    topicContent: v1Fixture.topicContent,
  })
  expect(restored.v1Restored.sourceFileIds).toHaveLength(1)
  expect(restored.v2Restored).toMatchObject({
    schemaVersion: 4,
    recordRevision: 0,
    projectName: `${v2Fixture.projectName} (Restored)`,
    appToc: v2Fixture.appToc,
    topicContent: v2Fixture.topicContent,
    publishConfig: v2Fixture.publishConfig,
    reviewStage: v2Fixture.reviewStage,
  })
  expect(restored.v2Restored.sourceFileIds).toHaveLength(1)
})

test('tampered manifests, corrupt checksums, and missing blobs are rejected without partial restore', async ({ page }) => {
  await openApp(page)
  const results = await page.evaluate(async () => {
    const JSZip = (await import('/node_modules/.vite/deps/jszip.js' as string)).default
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, inspectProjectBackup, restoreProjectBackup } =
      await import('/src/projectBackup.ts' as string)
    const id = `backup-corruption-${Date.now()}`
    await projectRepository.createProject({ projectId: id, projectName: 'Protected original' })
    const file = await projectRepository.saveFile(id, new File(['blob must be complete'], 'asset.bin'))
    const loaded = await projectRepository.loadProject(id)
    if (!loaded) throw new Error('Missing seed project')
    await projectRepository.saveProjectIfCurrent({ ...loaded, sourceFileIds: [file.fileId] }, loaded.recordRevision)
    const valid = await createProjectBackup(id)
    const attempt = async (archive: Blob) => {
      try {
        await restoreProjectBackup(archive, { mode: 'new' })
        return { rejected: false, message: '' }
      } catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) }
      }
    }
    const tamperedZip = await JSZip.loadAsync(await valid.arrayBuffer())
    const manifest = JSON.parse(await tamperedZip.file('manifest.json')!.async('string'))
    manifest.projectName = 'tampered'
    tamperedZip.file('manifest.json', JSON.stringify(manifest))
    const tamperedManifest = await tamperedZip.generateAsync({ type: 'blob' })
    const badPayloadZip = await JSZip.loadAsync(await valid.arrayBuffer())
    badPayloadZip.file('files/0.bin', 'changed bytes')
    const badPayload = await badPayloadZip.generateAsync({ type: 'blob' })
    const missingZip = await JSZip.loadAsync(await valid.arrayBuffer())
    missingZip.remove('files/0.bin')
    const missingBlob = await missingZip.generateAsync({ type: 'blob' })
    const attempts = await Promise.all([
      attempt(tamperedManifest),
      attempt(badPayload),
      attempt(missingBlob),
    ])
    let inspectError = ''
    try {
      await inspectProjectBackup(missingBlob)
    } catch (error) {
      inspectError = error instanceof Error ? error.message : String(error)
    }
    const projects = await projectRepository.listProjects()
    return {
      id,
      attempts,
      inspectError,
      projectIds: projects.map(project => project.projectId),
      original: await projectRepository.loadProject(id),
      sourceFileCount: (await projectRepository.loadProjectFiles(id)).length,
    }
  })
  for (const attempt of results.attempts) expect(attempt.rejected).toBe(true)
  expect(results.attempts[0].message).toMatch(/manifest checksum/i)
  expect(results.attempts[1].message).toMatch(/checksum|size mismatch/i)
  expect(results.attempts[2].message).toMatch(/missing|unexpected/i)
  expect(results.inspectError).toMatch(/missing|unexpected/i)
  expect(results.projectIds).toContain(results.id)
  expect(results.original).toMatchObject({ projectName: 'Protected original', sourceFileIds: [expect.any(String)] })
  expect(results.sourceFileCount).toBe(1)
  expect(results.projectIds).toHaveLength(1)
})

test('duplicate project IDs require explicit restore mode; guarded replacement rejects stale revisions', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, restoreProjectBackup } = await import('/src/projectBackup.ts' as string)
    const id = `backup-id-collision-${Date.now()}`
    const source = await projectRepository.createProject({ projectId: id, projectName: 'Archived version' })
    const file = await projectRepository.saveFile(id, new File(['archived bytes'], 'archive.txt'))
    await projectRepository.saveProjectIfCurrent({
      ...source,
      sourceFileIds: [file.fileId],
      projectMeta: { state: 'archived' },
    }, source.recordRevision)
    const archive = await createProjectBackup(id)
    const current = await projectRepository.loadProject(id)
    if (!current) throw new Error('Missing project before conflict test')
    const newer = await projectRepository.saveProjectIfCurrent({
      ...current,
      projectName: 'Concurrent newer version',
      projectMeta: { state: 'newer' },
    }, current.recordRevision)
    let staleConflict = ''
    try {
      await restoreProjectBackup(archive, { mode: 'replace', expectedRevision: current.recordRevision,
        expectedFileIds: [file.fileId] })
    } catch (error) {
      staleConflict = error instanceof Error ? error.message : String(error)
    }
    const afterConflict = await projectRepository.loadProject(id)
    const copy = await restoreProjectBackup(archive, { mode: 'new' })
    const afterCopy = await projectRepository.loadProject(id)
    const replaced = await restoreProjectBackup(archive, { mode: 'replace', expectedRevision: newer.recordRevision,
      expectedFileIds: [file.fileId] })
    const files = await projectRepository.loadProjectFiles(id)
    return {
      id,
      staleConflict,
      newerRevision: newer.recordRevision,
      afterConflict,
      copyId: copy.projectId,
      originalAfterCopy: afterCopy,
      replaced,
      files: files.map(file => file.fileId),
    }
  })
  expect(result.staleConflict).toMatch(/expected revision \d+, found \d+/)
  expect(result.afterConflict).toMatchObject({
    projectName: 'Concurrent newer version',
    recordRevision: result.newerRevision,
    projectMeta: { state: 'newer' },
  })
  expect(result.copyId).not.toBe(result.id)
  expect(result.originalAfterCopy).toMatchObject({
    projectId: result.id,
    projectName: 'Concurrent newer version',
    projectMeta: { state: 'newer' },
  })
  expect(result.replaced).toMatchObject({
    projectId: result.id,
    projectName: 'Archived version',
    projectMeta: { state: 'archived' },
    recordRevision: result.newerRevision + 1,
  })
  expect(result.replaced.sourceFileIds).toEqual(result.files)
})

test('Dashboard downloads a verified backup and requires explicit restore choices', async ({ page }) => {
  test.setTimeout(60_000)
  await openApp(page)
  const projectName = `Dashboard backup ${Date.now()}`
  const projectId = `dashboard-backup-${Date.now()}`
  await page.evaluate(async ({ projectId, projectName }) => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const created = await projectRepository.createProject({ projectId, projectName })
    const file = await projectRepository.saveFile(
      projectId, new File(['dashboard binary content'], 'dashboard.txt', { type: 'text/plain' }),
    )
    await projectRepository.saveProjectIfCurrent(
      { ...created, sourceFileIds: [file.fileId] }, created.recordRevision,
    )
  }, { projectId, projectName })
  await page.reload()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  await page.getByText(projectName, { exact: true }).hover()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-backup\.docflow\.zip$/)
  const archivePath = await download.path()
  if (!archivePath) throw new Error('Backup download has no file path')
  const archiveBytes = await readFile(archivePath)
  const selectArchive = async () => {
    await page.getByLabel('Choose project backup').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: archiveBytes,
    })
    await expect(page.getByRole('dialog', { name: 'Restore project backup' })).toBeVisible()
    await expect(page.getByText('The project record and every file passed integrity checks.')).toBeVisible()
  }

  await selectArchive()
  await expect(page.getByText(`Existing project: ${projectName}`, { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Restore as new' }).click()
  await expect(page.getByRole('status')).toContainText('as a new project')
  await expect(page.getByText(`${projectName} (Restored)`, { exact: true })).toBeVisible()

  const currentName = `${projectName} (Current)`
  await page.evaluate(async ({ projectId, currentName }) => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const current = await projectRepository.loadProject(projectId)
    if (!current) throw new Error('Existing project disappeared')
    await projectRepository.saveProjectIfCurrent(
      { ...current, projectName: currentName }, current.recordRevision,
    )
  }, { projectId, currentName })
  await selectArchive()
  await expect(page.getByText(`Existing project: ${currentName}`, { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Replace existing…' }).click()
  await expect(page.getByRole('button', { name: 'Confirm replacement' })).toBeDisabled()
  await page.getByLabel('Project name').fill(projectName)
  await expect(page.getByRole('button', { name: 'Confirm replacement' })).toBeDisabled()
  await page.getByLabel('Project name').fill(currentName)
  await page.getByRole('button', { name: 'Confirm replacement' }).click()
  await expect(page.getByRole('status')).toContainText(`Replaced ${projectName}`)
  const state = await page.evaluate(async projectId => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const record = await projectRepository.loadProject(projectId)
    const files = await projectRepository.loadProjectFiles(projectId)
    return { revision: record?.recordRevision, projectCount: (await projectRepository.listProjects()).length,
      bytes: await files[0]?.blob.text() }
  }, projectId)
  expect(state).toEqual({ revision: 3, projectCount: 2, bytes: 'dashboard binary content' })
})

test('valid checksums cannot import unusable records or overwrite files changed after confirmation', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { serializeProjectBackup, createProjectBackup, restoreProjectBackup } =
      await import('/src/projectBackup.ts' as string)
    const id = `backup-adversarial-${Date.now()}`
    const created = await projectRepository.createProject({ projectId: id, projectName: 'Safe original' })
    const source = await projectRepository.saveFile(id, new File(['original'], 'source.txt'))
    await projectRepository.saveProjectIfCurrent({
      ...created, sourceFileIds: [source.fileId],
    }, created.recordRevision)
    const snapshot = await projectRepository.loadProjectSnapshot(id)
    if (!snapshot) throw new Error('Missing original snapshot')
    const malformed = await serializeProjectBackup({
      ...snapshot, record: { ...snapshot.record, themes: {} } as any,
    })
    let malformedError = ''
    try { await restoreProjectBackup(malformed, { mode: 'new' }) }
    catch (error) { malformedError = (error as Error).message }
    const nestedArchive = await serializeProjectBackup({
      ...snapshot,
      record: { ...snapshot.record, themes: [{ id: 'broken', styleProfiles: {} }] } as any,
    })
    let nestedError = ''
    try { await restoreProjectBackup(nestedArchive, { mode: 'new' }) }
    catch (error) { nestedError = (error as Error).message }
    const brokenMasterArchive = await serializeProjectBackup({
      ...snapshot,
      record: { ...snapshot.record, htmlMasterPages: [{ id: 'broken-master', blocks: {} }] } as any,
    })
    let masterError = ''
    try { await restoreProjectBackup(brokenMasterArchive, { mode: 'new' }) }
    catch (error) { masterError = (error as Error).message }
    const brokenReviewArchive = await serializeProjectBackup({
      ...snapshot,
      record: {
        ...snapshot.record,
        reviewModel: {
          ...snapshot.record.reviewModel,
          runs: [{ reviewRunId: 'broken-run', findingIds: 1 }],
          findings: [],
        },
      } as any,
    })
    let reviewError = ''
    try {
      await restoreProjectBackup(brokenReviewArchive, {
        mode: 'replace', expectedRevision: snapshot.record.recordRevision,
        expectedFileIds: snapshot.files.map(file => file.fileId),
      })
    } catch (error) { reviewError = (error as Error).message }
    const brokenAuthorArchive = await serializeProjectBackup({
      ...snapshot,
      record: {
        ...snapshot.record,
        authorTopicMetadata: { 'stable-topic': null },
      } as any,
    })
    let authorError = ''
    try {
      await restoreProjectBackup(brokenAuthorArchive, {
        mode: 'replace', expectedRevision: snapshot.record.recordRevision,
        expectedFileIds: snapshot.files.map(file => file.fileId),
      })
    } catch (error) { authorError = (error as Error).message }

    const archive = await createProjectBackup(id)
    const added = await projectRepository.saveFile(id, new File(['newer'], 'newer.txt'))
    let fileConflict = ''
    try {
      await restoreProjectBackup(archive, {
        mode: 'replace', expectedRevision: snapshot.record.recordRevision,
        expectedFileIds: snapshot.files.map(file => file.fileId),
      })
    } catch (error) { fileConflict = (error as Error).message }
    const files = await projectRepository.loadProjectFiles(id)
    return {
      malformedError, nestedError, masterError, reviewError, authorError, fileConflict,
      revision: (await projectRepository.loadProject(id))?.recordRevision,
      files: await Promise.all(files.map(async file => ({ fileId: file.fileId, content: await file.blob.text() }))),
      sourceId: source.fileId, newerId: added.fileId,
      projectCount: (await projectRepository.listProjects()).length,
    }
  })
  expect(result.malformedError).toMatch(/unusable themes/)
  expect(result.nestedError).toMatch(/unusable themes.styleProfiles/)
  expect(result.masterError).toMatch(/unusable htmlMasterPages.blocks/)
  expect(result.reviewError).toMatch(/unusable reviewModel/)
  expect(result.authorError).toMatch(/unusable authorTopicMetadata/)
  expect(result.fileConflict).toMatch(/files changed since restore confirmation/)
  expect(result.revision).toBe(1)
  expect(result.files).toEqual(expect.arrayContaining([
    { fileId: result.sourceId, content: 'original' },
    { fileId: result.newerId, content: 'newer' },
  ]))
  expect(result.projectCount).toBe(1)
})

test('a failed file write rolls back the entire explicit replacement', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { createProjectBackup, restoreProjectBackup } = await import('/src/projectBackup.ts' as string)
    const id = `backup-rollback-${Date.now()}`
    const created = await projectRepository.createProject({ projectId: id, projectName: 'Must stay intact' })
    const file = await projectRepository.saveFile(id, new File(['must survive'], 'original.txt'))
    const current = await projectRepository.saveProjectIfCurrent(
      { ...created, sourceFileIds: [file.fileId] }, created.recordRevision,
    )
    const archive = await createProjectBackup(id)
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value: any, ...args: any[]) {
      if (this.name === 'files' && value.fileId === file.fileId) {
        throw new DOMException('Injected file write failure', 'DataError')
      }
      return originalPut.apply(this, [value, ...args] as any)
    }
    let failure = ''
    try {
      await restoreProjectBackup(archive, {
        mode: 'replace', expectedRevision: current.recordRevision, expectedFileIds: [file.fileId],
      })
    } catch (error) { failure = (error as Error).message }
    finally { IDBObjectStore.prototype.put = originalPut }
    const after = await projectRepository.loadProject(id)
    const files = await projectRepository.loadProjectFiles(id)
    return {
      failure, revision: after?.recordRevision, name: after?.projectName,
      files: await Promise.all(files.map(async stored => ({
        id: stored.fileId, content: await stored.blob.text(),
      }))),
    }
  })
  expect(result.failure).toMatch(/Injected file write failure/)
  expect(result.revision).toBe(1)
  expect(result.name).toBe('Must stay intact')
  expect(result.files).toHaveLength(1)
  expect(result.files[0].content).toBe('must survive')
})