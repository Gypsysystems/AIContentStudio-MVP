import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const v1Fixture = JSON.parse(await readFile(
  new URL('../fixtures/project-record-v1.json', import.meta.url),
  'utf8',
)) as Record<string, unknown>
const v2Fixture = JSON.parse(await readFile(
  new URL('../fixtures/project-record-v2.json', import.meta.url),
  'utf8',
)) as Record<string, unknown>

async function openApp(page: Page) {
  await page.goto('/')
}

async function seedRawRecord(page: Page, record: Record<string, unknown>) {
  await page.evaluate(async rawRecord => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    // Initialize the application's current DB version before inserting a legacy record.
    await projectRepository.createProject({
      projectId: `db-initializer-${Date.now()}`,
      projectName: 'Database initializer',
    })
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB open was blocked'))
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put(rawRecord)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Seed transaction aborted'))
    })
    db.close()
  }, record)
}

test('both project service adapters expose the same repository behavior', async ({ page }) => {
  await openApp(page)
  const outcomes = await page.evaluate(async () => {
    const { projectRepository, indexedDbProjectRepository } =
      await import('/src/projectService.ts' as string)
    const legacy = await import('/src/projectRepository.ts' as string)
    const { ProjectConflictError } = legacy
    const adapters = [
      ['projectRepository', projectRepository],
      ['indexedDbProjectRepository', indexedDbProjectRepository],
    ] as const

    const results = []
    for (const [name, repository] of adapters) {
      const id = `adapter-contract-${name}-${Date.now()}`
      const created = await repository.createProject({ projectId: id, projectName: 'Parity project' })
      const createdRevision = created.recordRevision
      await repository.setActiveProjectId(id)
      const storedFile = await repository.saveFile(id, new File(['source bytes'], `${name}.txt`, {
        type: 'text/plain',
      }))
      const initial = await repository.loadProject(id)
      if (!initial) throw new Error(`Could not reload ${name} project`)
      await repository.saveProject({
        ...initial,
        projectName: 'Saved parity project',
        sourceFileIds: [storedFile.fileId],
      })
      const saved = await repository.loadProject(id)
      if (!saved) throw new Error(`Could not reload saved ${name} project`)
      const accepted = await repository.saveProjectIfCurrent(
        { ...saved, projectName: 'Guarded parity project' },
        saved.recordRevision,
      )
      let staleWriteRejected = false
      try {
        await repository.saveProjectIfCurrent(
          { ...accepted, projectName: 'Stale overwrite' },
          saved.recordRevision,
        )
      } catch (error) {
        staleWriteRejected = error instanceof ProjectConflictError
      }
      const afterStaleWrite = await repository.loadProject(id)
      if (!afterStaleWrite) throw new Error(`Could not reload ${name} project after stale write`)

      const duplicate = await repository.duplicateProject(id, 'Parity copy')
      if (!duplicate) throw new Error(`${name} did not duplicate the project`)
      const duplicateFiles = await repository.loadProjectFiles(duplicate.projectId)
      const originalFile = await repository.loadFile(storedFile.fileId)
      const listed = await repository.listProjects()
      await repository.removeFile(storedFile.fileId)
      const removedFile = await repository.loadFile(storedFile.fileId)
      await repository.deleteProject(duplicate.projectId)
      const deletedDuplicate = await repository.loadProject(duplicate.projectId)
      const activeBeforeClear = repository.getActiveProjectId()
      await repository.setActiveProjectId(null)

      results.push({
        name,
        createdRevision,
        savedRevision: saved.recordRevision,
        acceptedRevision: accepted.recordRevision,
        staleWriteRejected,
        nameAfterStaleWrite: afterStaleWrite.projectName,
        activeBeforeClear,
        listedOriginal: listed.some((item: { projectId: string }) => item.projectId === id),
        duplicateRevision: duplicate.recordRevision,
        duplicateFileIds: duplicateFiles.map((file: { fileId: string }) => file.fileId),
        originalFileName: originalFile?.name,
        removedFile: removedFile === null,
        deletedDuplicate: deletedDuplicate === null,
        activeAfterClear: repository.getActiveProjectId(),
      })
      await repository.deleteProject(id)
    }
    const legacyId = `legacy-guarded-write-${Date.now()}`
    const legacyCreated = await legacy.createProject({
      projectId: legacyId,
      projectName: 'Legacy guarded write',
    })
    const legacySaved = await legacy.saveProjectIfCurrent(legacyCreated, legacyCreated.recordRevision)
    await legacy.deleteProject(legacyId)
    return { results, legacyGuardedRevision: legacySaved.recordRevision }
  })

  expect(outcomes.results).toHaveLength(2)
  for (const outcome of outcomes.results) {
    expect(outcome).toMatchObject({
      createdRevision: 0,
      savedRevision: 1,
      acceptedRevision: 2,
      staleWriteRejected: true,
      nameAfterStaleWrite: 'Guarded parity project',
      activeBeforeClear: expect.stringContaining('adapter-contract-'),
      listedOriginal: true,
      duplicateRevision: 0,
      originalFileName: expect.stringMatching(/\.txt$/),
      removedFile: true,
      deletedDuplicate: true,
      activeAfterClear: null,
    })
    expect(outcome.duplicateFileIds).toHaveLength(1)
  }
  expect(outcomes.results[0]).toMatchObject({
    savedRevision: outcomes.results[1].savedRevision,
    acceptedRevision: outcomes.results[1].acceptedRevision,
    staleWriteRejected: outcomes.results[1].staleWriteRejected,
    duplicateRevision: outcomes.results[1].duplicateRevision,
  })
  expect(outcomes.legacyGuardedRevision).toBe(1)
})

test('v1 and v2 migration is deterministic, idempotent, and rejects future schemas', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async ({ v1, v2 }) => {
    const { migrateProjectRecord } = await import('/src/projectRepository.ts' as string)
    const migrate = (raw: Record<string, unknown>) => migrateProjectRecord(raw)
    const migratedV1 = migrate(v1)
    const repeatedV1 = migrate(migratedV1.record)
    const migratedV2 = migrate(v2)
    const repeatedV2 = migrate(migratedV2.record)
    let futureVersionError = ''
    try {
      migrate({ ...v2, schemaVersion: 999 })
    } catch (error) {
      futureVersionError = error instanceof Error ? error.message : String(error)
    }
    return {
      migratedV1,
      repeatedV1,
      migratedV2,
      repeatedV2,
      futureVersionError,
    }
  }, { v1: v1Fixture, v2: v2Fixture })

  expect(result.migratedV1).toMatchObject({ changed: true, fromVersion: 1 })
  expect(result.migratedV1.record).toMatchObject({
    schemaVersion: 4,
    recordRevision: 0,
    projectId: 'fixture-v1-project',
    sourceExtractions: {},
    authorTopicMetadata: {},
    reviewModel: { projectId: 'fixture-v1-project', findings: [] },
  })
  expect(result.migratedV1.record.topicContent).toEqual(v1Fixture.topicContent)
  for (const omittedLegacyField of [
    'themes',
    'pageLayouts',
    'htmlMasterPages',
    'themeVariables',
    'conditionGroups',
  ]) {
    expect(v1Fixture).not.toHaveProperty(omittedLegacyField)
    expect(result.migratedV1.record).not.toHaveProperty(omittedLegacyField)
  }
  expect(result.repeatedV1).toEqual({
    record: result.migratedV1.record,
    changed: false,
    fromVersion: 4,
  })
  expect(result.migratedV2).toMatchObject({
    changed: true,
    fromVersion: 2,
    record: { schemaVersion: 4, recordRevision: 0 },
  })
  expect(result.migratedV2.record.sourceExtractions).toEqual(v2Fixture.sourceExtractions)
  expect(result.migratedV2.record.appToc).toEqual(v2Fixture.appToc)
  expect(result.migratedV2.record.topicContent).toEqual(v2Fixture.topicContent)
  expect(result.migratedV2.record.reviewModel).toEqual(v2Fixture.reviewModel)
  expect(result.repeatedV2).toEqual({
    record: result.migratedV2.record,
    changed: false,
    fromVersion: 4,
  })
  expect(result.futureVersionError).toMatch(/unsupported|future|version/i)
})

test('loading old persisted records upgrades the IndexedDB records in place', async ({ page }) => {
  await openApp(page)
  const v1 = { ...v1Fixture, projectId: `persisted-v1-${Date.now()}` }
  const v2 = { ...v2Fixture, projectId: `persisted-v2-${Date.now()}` }
  await seedRawRecord(page, v1)
  await seedRawRecord(page, v2)

  const persisted = await page.evaluate(async projectIds => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const loaded = await Promise.all(projectIds.map(id => projectRepository.loadProject(id)))
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll()
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return projectIds.map((id, index) => ({
      loaded: loaded[index],
      stored: records.find(record => record.projectId === id),
    }))
  }, [v1.projectId, v2.projectId])

  expect(persisted).toHaveLength(2)
  for (const item of persisted) {
    expect(item.loaded).toMatchObject({ schemaVersion: 4, recordRevision: 0 })
    expect(item.stored).toMatchObject({ schemaVersion: 4, recordRevision: 0 })
  }
  expect(persisted[1].stored?.sourceExtractions).toEqual(v2Fixture.sourceExtractions)
  expect(persisted[1].loaded?.authorTopicMetadata).toEqual(v2Fixture.authorTopicMetadata)
})

test('v1 App hydration restores default styles, layouts, and conditions after reload', async ({ page }) => {
  await openApp(page)
  const legacy = { ...v1Fixture, projectId: `app-hydration-v1-${Date.now()}` }
  await seedRawRecord(page, legacy)
  await page.evaluate(async projectId => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    projectRepository.setActiveProjectId(projectId)
  }, legacy.projectId as string)
  await page.reload()

  const expectDefaultsInApp = async () => {
    await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()

    await page.getByRole('button', { name: /Theme$/ }).click()
    await expect(page.getByRole('heading', { name: 'Theme & Style Profiles' })).toBeVisible()
    await expect(page.getByPlaceholder('Search profiles…')).toHaveValue('Presight Brand')
    await page.getByRole('button', { name: 'Output Templates', exact: true }).click()

    const layouts = page.locator('select').filter({
      has: page.locator('option[value="pl1"]'),
    }).first()
    await expect(layouts).toHaveValue('pl1')
    await expect(layouts.locator('option')).toHaveCount(2)
    await expect(page.getByTestId('page-layout-preview')).toHaveAttribute(
      'data-heading-font',
      'Inter',
    )

    await page.getByRole('button', { name: 'HTML Master Pages', exact: true }).click()
    const masters = page.locator('select').filter({
      has: page.locator('option[value="hmp1"]'),
    }).first()
    await expect(masters.locator('option')).toHaveCount(2)
    await masters.selectOption('hmp1')
    await expect(masters).toHaveValue('hmp1')
    await page.getByRole('button', { name: 'Variables', exact: true }).click()
    await expect(page.getByText('{{ProductName}}', { exact: true })).toBeVisible()
    await expect(page.getByText('{{Version}}', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Author', exact: true }).click()
    await page.getByRole('button', { name: 'Conditions', exact: true }).click()
    await expect(page.getByText('Audience', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Beginner', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Manage…', exact: true }).click()
    await expect(page.getByText('Manage Conditions', { exact: true })).toBeVisible()
    await expect(page.getByText('Platform', { exact: true })).toBeVisible()
    await expect(page.getByText('Enterprise', { exact: true })).toBeVisible()
  }

  await expectDefaultsInApp()
  const storedBeforeReload = await page.evaluate(async projectId => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    return projectRepository.loadProject(projectId)
  }, legacy.projectId as string)
  expect(storedBeforeReload).toMatchObject({ schemaVersion: 4, projectId: legacy.projectId })

  await page.reload()
  await expectDefaultsInApp()
})

test('same-origin tabs reject stale guarded writes and reload the winning revision', async ({ page }) => {
  await openApp(page)
  const secondTab = await page.context().newPage()
  await secondTab.goto('/')
  try {
    const projectId = `two-tab-guard-${Date.now()}`
    const initial = await page.evaluate(async id => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      return projectRepository.createProject({ projectId: id, projectName: 'Two-tab baseline' })
    }, projectId)
    const staleSnapshot = await secondTab.evaluate(async id => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      const record = await projectRepository.loadProject(id)
      if (!record) throw new Error('Second tab could not load the project')
      return record
    }, projectId)

    const accepted = await page.evaluate(async ({ record }) => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      return projectRepository.saveProjectIfCurrent(
        { ...record, projectName: 'Winning newer write' },
        record.recordRevision,
      )
    }, { record: initial })
    const staleAttempt = await secondTab.evaluate(async ({ record }) => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      const { ProjectConflictError } = await import('/src/projectRepository.ts' as string)
      try {
        await projectRepository.saveProjectIfCurrent(
          { ...record, projectName: 'Rejected stale write' },
          record.recordRevision,
        )
        return { rejected: false, conflict: false }
      } catch (error) {
        return {
          rejected: true,
          conflict: error instanceof ProjectConflictError,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }, { record: staleSnapshot })

    expect(initial.recordRevision).toBe(0)
    expect(accepted).toMatchObject({ projectName: 'Winning newer write', recordRevision: 1 })
    expect(staleAttempt).toMatchObject({
      rejected: true,
      conflict: true,
      message: /expected revision 0, found 1/,
    })
    const beforeReload = await secondTab.evaluate(async id => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      return projectRepository.loadProject(id)
    }, projectId)
    expect(beforeReload).toMatchObject({ projectName: 'Winning newer write', recordRevision: 1 })

    await Promise.all([page.reload(), secondTab.reload()])
    const [firstAfterReload, secondAfterReload] = await Promise.all([
      page.evaluate(async id => {
        const { projectRepository } = await import('/src/projectService.ts' as string)
        return projectRepository.loadProject(id)
      }, projectId),
      secondTab.evaluate(async id => {
        const { projectRepository } = await import('/src/projectService.ts' as string)
        return projectRepository.loadProject(id)
      }, projectId),
    ])
    for (const reloaded of [firstAfterReload, secondAfterReload]) {
      expect(reloaded).toMatchObject({
        projectId,
        projectName: 'Winning newer write',
        recordRevision: 1,
      })
    }
    await page.evaluate(async id => {
      const { projectRepository } = await import('/src/projectService.ts' as string)
      await projectRepository.deleteProject(id)
    }, projectId)
  } finally {
    await secondTab.close()
  }
})

test('reload and duplicate preserve stable project content IDs while remapping file references', async ({ page }) => {
  await openApp(page)
  const originalId = `fixture-duplicate-${Date.now()}`
  const duplicateId = await page.evaluate(async ({ id, fixture }) => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    await projectRepository.createProject({ projectId: id, projectName: fixture.projectName })
    const storedFile = await projectRepository.saveFile(
      id,
      new File(['fixture source bytes'], 'field-manual.md', { type: 'text/markdown' }),
    )
    const replaceSourceId = (value: unknown): unknown => {
      if (value === 'fixture-source-a') return storedFile.fileId
      if (value === fixture.projectId) return id
      if (Array.isArray(value)) return value.map(replaceSourceId)
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
          .map(([key, nested]) => [
            key === 'fixture-source-a' ? storedFile.fileId : key,
            replaceSourceId(nested),
          ]))
      }
      return value
    }
    const record = replaceSourceId(fixture) as Record<string, unknown>
    record.projectId = id
    record.projectName = fixture.projectName
    record.schemaVersion = 3
    record.recordRevision = 6
    await new Promise<void>((resolve, reject) => {
      const dbRequest = indexedDB.open('docflow-db')
      dbRequest.onerror = () => reject(dbRequest.error)
      dbRequest.onsuccess = () => {
        const db = dbRequest.result
        const transaction = db.transaction('projects', 'readwrite')
        transaction.objectStore('projects').put(record)
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('Fixture seed aborted'))
      }
    })
    const copy = await projectRepository.duplicateProject(id, 'Field Operations Guide Copy')
    if (!copy) throw new Error('Fixture project could not be duplicated')
    return copy.projectId
  }, { id: originalId, fixture: v2Fixture })

  await page.reload()
  const state = await page.evaluate(async ({ originalId, duplicateId }) => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const original = await projectRepository.loadProject(originalId)
    const duplicate = await projectRepository.loadProject(duplicateId)
    if (!original || !duplicate) throw new Error('Original or duplicate missing after reload')
    const files = await projectRepository.loadProjectFiles(duplicateId)
    return {
      original,
      duplicate,
      duplicateFiles: files.map((file: { fileId: string; name: string }) => ({
        fileId: file.fileId,
        name: file.name,
      })),
    }
  }, { originalId, duplicateId })

  expect(state.original.sourceFileIds).toHaveLength(1)
  const sourceFileId = state.original.sourceFileIds[0]
  const duplicateFileId = state.duplicate.sourceFileIds[0]
  expect(duplicateFileId).not.toBe(sourceFileId)
  expect(state.duplicate).toMatchObject({
    projectName: 'Field Operations Guide Copy',
    schemaVersion: 4,
    recordRevision: 0,
    appToc: v2Fixture.appToc,
    topicContent: v2Fixture.topicContent,
    publishConfig: v2Fixture.publishConfig,
  })
  expect(state.duplicate.sourceExtractions).toHaveProperty(duplicateFileId)
  expect(state.duplicate.sourceExtractions).not.toHaveProperty(sourceFileId)
  expect(state.duplicate.sourceExtractions[duplicateFileId].sourceId).toBe(duplicateFileId)
  expect(state.duplicate.sourceExtractions[duplicateFileId].blocks
    .every((block: { sourceId: string }) => block.sourceId === duplicateFileId)).toBe(true)
  expect(state.duplicate.evidenceIndex.items[0]).toMatchObject({
    id: 'evidence-fixture-1',
    sourceId: duplicateFileId,
    fileId: duplicateFileId,
  })
  expect(state.duplicate.authorTopicMetadata['stable-setup'].sourceFileIds).toEqual([duplicateFileId])
  expect(state.duplicate.reviewModel).toMatchObject({
    projectId: duplicateId,
    activeReviewRunId: 'review-run-fixture',
    runs: [{ reviewRunId: 'review-run-fixture', projectId: duplicateId }],
    findings: [{
      findingId: 'finding-fixture',
      projectId: duplicateId,
      sourceReferences: [{ sourceId: duplicateFileId, fileId: duplicateFileId }],
      resolutionHistory: [{ status: 'resolved', reason: 'updated' }],
    }],
  })
  expect(state.duplicateFiles).toEqual([{ fileId: duplicateFileId, name: 'field-manual.md' }])
  expect(state.original.sourceFileIds).toEqual([sourceFileId])
  expect(state.original.reviewModel.findings[0].projectId).toBe(originalId)
  expect(state.duplicate.reviewModel.findings[0].findingId)
    .toBe(state.original.reviewModel.findings[0].findingId)
})

test('duplicates fresh evidence, analysis, and TOC graphs with remapped source IDs', async ({ page }) => {
  await openApp(page)
  const duplicated = await page.evaluate(async () => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    const { buildEvidenceIndex, isEvidenceIndexFresh } =
      await import('/src/evidenceIndex.ts' as string)
    const { buildConceptAnalysis, isConceptAnalysisFresh } =
      await import('/src/conceptAnalysis.ts' as string)
    const { buildTocProposal, isTocProposalFresh } =
      await import('/src/tocProposal.ts' as string)

    const sourceProjectId = `fresh-graph-${Date.now()}`
    const project = await projectRepository.createProject({
      projectId: sourceProjectId,
      projectName: 'Fresh Evidence Graph',
      projectMeta: { contentType: 'user-guide' },
    })
    const storedFile = await projectRepository.saveFile(
      sourceProjectId,
      new File(['# Calibration\n\nCalibrate the optical sensor before use.'], 'calibration.md', {
        type: 'text/markdown',
      }),
    )
    const extraction = {
      sourceId: storedFile.fileId,
      fileName: storedFile.name,
      fileType: storedFile.type,
      status: 'extracted',
      blocks: [
        {
          id: 'stable-calibration-heading',
          sourceId: storedFile.fileId,
          type: 'heading',
          text: 'Calibration',
          order: 0,
          headingLevel: 1,
          sectionPath: ['Calibration'],
        },
        {
          id: 'stable-calibration-paragraph',
          sourceId: storedFile.fileId,
          type: 'paragraph',
          text: 'Calibrate the optical sensor before use.',
          order: 1,
          sectionPath: ['Calibration'],
        },
      ],
      extractedText: 'Calibration\nCalibrate the optical sensor before use.',
      warnings: [],
      extractedAt: 1700000000000,
      sourceRevision: 1,
      extractionRevision: 1,
    }
    const sourceExtractions = { [storedFile.fileId]: extraction }
    const evidenceIndex = buildEvidenceIndex(sourceExtractions, 1)
    const conceptAnalysis = buildConceptAnalysis(evidenceIndex)
    const tocProposal = buildTocProposal(evidenceIndex, conceptAnalysis, 'user-guide')
    const appToc = tocProposal.items.map((item: {
      id: number
      topicId: string
      [key: string]: unknown
    }) => ({ ...item }))
    const committed = await projectRepository.saveProjectIfCurrent({
      ...project,
      sourceFileIds: [storedFile.fileId],
      sourcesRevision: 1,
      sourceExtractions,
      evidenceIndex,
      conceptAnalysis,
      tocProposal,
      appToc,
      tocRevision: 1,
      tocGeneratedFromRev: 1,
      tocGeneratedFromEvidenceSourcesRevision: evidenceIndex.sourcesRevision,
      tocGeneratedFromEvidenceExtractionRevision: evidenceIndex.extractionRevision,
      tocGeneratedFromConceptBuiltAt: conceptAnalysis.builtAt,
      tocGeneratedFromContentType: 'user-guide',
    }, project.recordRevision)
    const originalIsFresh = {
      evidence: isEvidenceIndexFresh(
        committed.evidenceIndex,
        committed.sourceExtractions,
        committed.sourcesRevision,
      ),
      analysis: isConceptAnalysisFresh(committed.conceptAnalysis, committed.evidenceIndex),
      toc: isTocProposalFresh(
        committed.tocProposal,
        committed.evidenceIndex,
        committed.conceptAnalysis,
        'user-guide',
      ),
    }
    const copy = await projectRepository.duplicateProject(sourceProjectId, 'Fresh Evidence Graph Copy')
    if (!copy) throw new Error('Fresh evidence project could not be duplicated')
    const copiedEx = copy.sourceExtractions as Record<string, typeof extraction>
    const copiedFreshness = {
      evidence: isEvidenceIndexFresh(copy.evidenceIndex, copiedEx, copy.sourcesRevision),
      analysis: isConceptAnalysisFresh(copy.conceptAnalysis, copy.evidenceIndex),
      toc: isTocProposalFresh(copy.tocProposal, copy.evidenceIndex, copy.conceptAnalysis, 'user-guide'),
    }
    const copiedCommittedTocIsCurrent =
      copy.tocGeneratedFromEvidenceSourcesRevision === copy.evidenceIndex.sourcesRevision
      && copy.tocGeneratedFromEvidenceExtractionRevision === copy.evidenceIndex.extractionRevision
      && copy.tocGeneratedFromConceptBuiltAt === copy.conceptAnalysis.builtAt
      && copy.tocGeneratedFromContentType === 'user-guide'
    return {
      originalProjectId: sourceProjectId,
      originalFileId: storedFile.fileId,
      originalIsFresh,
      originalTocIds: appToc.map((item: { id: number; topicId: string }) =>
        [item.id, item.topicId],
      ),
      copy,
      copiedFileId: copy.sourceFileIds[0],
      copiedFreshness,
      copiedCommittedTocIsCurrent,
    }
  })

  expect(duplicated.originalIsFresh).toEqual({ evidence: true, analysis: true, toc: true })
  expect(duplicated.copiedFreshness).toEqual({ evidence: true, analysis: true, toc: true })
  expect(duplicated.copiedCommittedTocIsCurrent).toBe(true)
  expect(duplicated.copiedFileId).not.toBe(duplicated.originalFileId)
  expect(duplicated.copy.sourceExtractions[duplicated.copiedFileId].sourceId)
    .toBe(duplicated.copiedFileId)
  expect(duplicated.copy.evidenceIndex.items.length).toBeGreaterThan(0)
  expect(duplicated.copy.evidenceIndex.items.every((item: { fileId: string; sourceId: string }) =>
    item.fileId === duplicated.copiedFileId && item.sourceId === duplicated.copiedFileId,
  )).toBe(true)
  expect(duplicated.copy.conceptAnalysis.concepts.every((concept: {
    evidenceRefs: Array<{ fileId: string; sourceId: string }>
  }) => concept.evidenceRefs.every(reference =>
    reference.fileId === duplicated.copiedFileId && reference.sourceId === duplicated.copiedFileId,
  ))).toBe(true)
  expect(duplicated.copy.appToc.map((item: { id: number; topicId: string }) =>
    [item.id, item.topicId],
  )).toEqual(duplicated.originalTocIds)
  expect(duplicated.copy.tocProposal.items.map((item: { id: number; topicId: string }) =>
    [item.id, item.topicId],
  )).toEqual(duplicated.originalTocIds)
})