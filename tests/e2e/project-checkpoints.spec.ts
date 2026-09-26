import { expect, test, type Page } from '@playwright/test'

async function openApp(page: Page) {
  await page.goto('/')
}

test('local checkpoints are explicit immutable baselines with complete byte manifests', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `checkpoint-baseline-${crypto.randomUUID()}`
    const project = await repo.createProject({ projectId, projectName: 'Checkpoint baseline' })
    const before = await repo.listProjectCheckpoints(projectId)
    const source = await repo.saveFile(
      projectId,
      new File(['original private source bytes'], 'source.txt', { type: 'text/plain' }),
    )
    const current = await repo.loadProject(projectId)
    if (!current) throw new Error('Project disappeared before checkpoint capture')
    const saved = await repo.saveProjectIfCurrent({
      ...current,
      sourceFileIds: [source.fileId],
    }, current.recordRevision)
    const checkpoint = await repo.captureProjectCheckpoint(
      projectId,
      saved.recordRevision,
      [source.fileId],
      ' Approved release baseline ',
    )
    const history = await repo.listProjectCheckpoints(projectId)
    const read = await repo.getProjectCheckpoint(projectId, checkpoint.checkpointId)
    if (!read) throw new Error('Captured checkpoint could not be read')
    return {
      project,
      before,
      checkpoint,
      history,
      read: {
        checkpoint: read.checkpoint,
        bytes: await read.files[0].blob.text(),
      },
      verification: await repo.verifyProjectCheckpoint(projectId, checkpoint.checkpointId),
    }
  })

  expect(result.before).toEqual([])
  expect(result.project.recordRevision).toBe(0)
  expect(result.history).toHaveLength(1)
  expect(result.checkpoint).toMatchObject({
    projectId: result.project.projectId,
    workspaceId: 'local-workspace',
    parentCheckpointId: null,
    reason: 'Approved release baseline',
    actorUserId: 'local-user',
    originatingRecordRevision: 1,
    recordSchemaVersion: result.checkpoint.record.schemaVersion,
    record: { projectId: result.project.projectId, sourceFileIds: [result.checkpoint.files[0].fileId] },
  })
  expect(result.checkpoint.checkpointId).toMatch(/^checkpoint-/)
  expect(result.checkpoint.recordDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.checkpoint.integrityDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.checkpoint.files).toHaveLength(1)
  expect(result.checkpoint.files[0]).toMatchObject({
    fileId: result.checkpoint.record.sourceFileIds[0],
    name: 'source.txt',
    type: 'text/plain',
    size: 'original private source bytes'.length,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    storageRef: expect.stringContaining(result.checkpoint.checkpointId),
  })
  expect(result.read.checkpoint).toEqual(result.checkpoint)
  expect(result.read.bytes).toBe('original private source bytes')
  expect(result.verification).toMatchObject({
    valid: true,
    issues: [],
    usable: true,
    usabilityIssues: [],
  })
  expect(JSON.stringify(result.history[0])).not.toContain('"record":')
})

test('checkpoint history appends uniquely and retains bytes when CURRENT files are deleted or replaced', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `checkpoint-append-${crypto.randomUUID()}`
    await repo.createProject({ projectId, projectName: 'Append-only history' })
    const original = await repo.saveFile(
      projectId,
      new File(['first immutable payload'], 'asset.txt', { type: 'text/plain' }),
    )
    let record = await repo.loadProject(projectId)
    if (!record) throw new Error('Project missing')
    record = await repo.saveProjectIfCurrent({ ...record, sourceFileIds: [original.fileId] }, record.recordRevision)
    const first = await repo.captureProjectCheckpoint(
      projectId, record.recordRevision, [original.fileId], 'Before replacement',
    )

    await repo.removeFile(original.fileId)
    const replacement = await repo.saveFile(
      projectId,
      new File(['replacement current payload'], 'asset.txt', { type: 'text/plain' }),
    )
    const afterReplacement = await repo.loadProject(projectId)
    if (!afterReplacement) throw new Error('Project missing after replacement')
    record = await repo.saveProjectIfCurrent({
      ...afterReplacement, sourceFileIds: [replacement.fileId],
    }, afterReplacement.recordRevision)
    const second = await repo.captureProjectCheckpoint(
      projectId, record.recordRevision, [replacement.fileId], 'After replacement',
    )
    const oldRead = await repo.getProjectCheckpoint(projectId, first.checkpointId)
    const newRead = await repo.getProjectCheckpoint(projectId, second.checkpointId)
    if (!oldRead || !newRead) throw new Error('Checkpoint disappeared after current-file replacement')
    return {
      first, second,
      oldRecordSourceIds: oldRead.checkpoint.record.sourceFileIds,
      history: await repo.listProjectCheckpoints(projectId),
      firstVerified: await repo.verifyProjectCheckpoint(projectId, first.checkpointId),
      secondVerified: await repo.verifyProjectCheckpoint(projectId, second.checkpointId),
      oldBytes: await oldRead.files[0].blob.text(),
      newBytes: await newRead.files[0].blob.text(),
    }
  })

  expect(result.first.checkpointId).not.toBe(result.second.checkpointId)
  expect(result.second.parentCheckpointId).toBe(result.first.checkpointId)
  expect(result.first.parentCheckpointId).toBeNull()
  expect(result.history).toHaveLength(2)
  expect(result.history.map(item => item.checkpointId)).toContain(result.first.checkpointId)
  expect(result.history.map(item => item.checkpointId)).toContain(result.second.checkpointId)
  expect(result.oldBytes).toBe('first immutable payload')
  expect(result.newBytes).toBe('replacement current payload')
  expect(result.oldRecordSourceIds).toEqual([result.first.files[0].fileId])
  expect(result.second.files[0].fileId).not.toBe(result.first.files[0].fileId)
  expect(result.firstVerified.valid).toBe(true)
  expect(result.secondVerified.valid).toBe(true)
})

test('capture rejects stale revisions and changed file sets without appending partial history', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `checkpoint-guard-${crypto.randomUUID()}`
    let record = await repo.createProject({ projectId, projectName: 'Guarded capture' })
    const file = await repo.saveFile(projectId, new File(['guarded'], 'guarded.txt'))
    const loaded = await repo.loadProject(projectId)
    if (!loaded) throw new Error('Project missing')
    record = await repo.saveProjectIfCurrent({ ...loaded, sourceFileIds: [file.fileId] }, loaded.recordRevision)

    const outcomes = []
    try {
      await repo.captureProjectCheckpoint(projectId, record.recordRevision - 1, [file.fileId], 'Stale revision')
      outcomes.push({ rejected: false, message: '' })
    } catch (error) {
      outcomes.push({ rejected: true, message: error instanceof Error ? error.message : String(error) })
    }
    try {
      await repo.captureProjectCheckpoint(projectId, record.recordRevision, [], 'Changed files')
      outcomes.push({ rejected: false, message: '' })
    } catch (error) {
      outcomes.push({ rejected: true, message: error instanceof Error ? error.message : String(error) })
    }
    return { outcomes, history: await repo.listProjectCheckpoints(projectId) }
  })

  expect(result.outcomes).toHaveLength(2)
  expect(result.outcomes[0]).toMatchObject({ rejected: true, message: /expected revision/i })
  expect(result.outcomes[1]).toMatchObject({ rejected: true, message: /files changed/i })
  expect(result.history).toEqual([])
})

test('same-fileId equal-size byte replacement during checkpoint hashing cannot commit a bad checkpoint', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const projectId = `checkpoint-byte-race-${crypto.randomUUID()}`
    await repo.createProject({ projectId, projectName: 'Same ID byte race' })
    const originalBytes = 'original payload for race'
    const replacementBytes = 'mutation payload for race'
    if (originalBytes.length !== replacementBytes.length)
      throw new Error('Race fixture byte payloads must have equal lengths')
    const file = await repo.saveFile(projectId, new File([originalBytes], 'race.txt', { type: 'text/plain' }))
    const project = await repo.loadProject(projectId)
    if (!project) throw new Error('Project missing before checkpoint race')
    const current = await repo.saveProjectIfCurrent({
      ...project, sourceFileIds: [file.fileId],
    }, project.recordRevision)
    const snapshotFiles = await repo.loadProjectFiles(projectId)

    const subtle = crypto.subtle
    const originalDigest = subtle.digest.bind(subtle)
    const originalDescriptor = Object.getOwnPropertyDescriptor(subtle, 'digest')
    let replacementCompleted = false
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      writable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const digest = await originalDigest(algorithm, data)
        if (!replacementCompleted) {
          await repo.restoreProjectSnapshot({
            record: current,
            files: snapshotFiles.map(stored => ({
              ...stored,
              blob: new Blob([replacementBytes], { type: stored.type }),
            })),
          }, {
            mode: 'replace',
            expectedRevision: current.recordRevision,
            expectedFileIds: [file.fileId],
          })
          replacementCompleted = true
        }
        return digest
      },
    })
    let captureRejected = false
    let captureError = ''
    try {
      await repo.captureProjectCheckpoint(
        projectId, current.recordRevision, [file.fileId], 'Hash race must abort',
      )
    } catch (error) {
      captureRejected = true
      captureError = error instanceof Error ? error.message : String(error)
    } finally {
      if (originalDescriptor) Object.defineProperty(subtle, 'digest', originalDescriptor)
      else delete (subtle as unknown as Record<string, unknown>).digest
    }
    const history = await repo.listProjectCheckpoints(projectId)
    const latestFile = await repo.loadFile(file.fileId)
    return {
      replacementCompleted,
      captureRejected,
      captureError,
      historyCount: history.length,
      latestBytes: await latestFile?.blob.text(),
    }
  })

  expect(result.replacementCompleted).toBe(true)
  expect(result.latestBytes).toBe('mutation payload for race')
  expect(result.captureRejected, result.captureError).toBe(true)
  expect(result.historyCount).toBe(0)
})

test('tampered checkpoint bytes fail integrity verification and checkpoint access is workspace-scoped', async ({ page }) => {
  await openApp(page)
  const result = await page.evaluate(async () => {
    const repo = await import('/src/projectRepository.ts' as string)
    const local = await import('/src/ownership.ts' as string)
    const foreignContext = {
      user: { id: 'checkpoint-workspace-user' },
      workspace: { id: 'checkpoint-other-workspace' },
      membership: {
        userId: 'checkpoint-workspace-user',
        workspaceId: 'checkpoint-other-workspace',
        role: 'owner',
      },
    }
    const projectId = `checkpoint-private-${crypto.randomUUID()}`
    await repo.createProject({
      projectId,
      projectName: 'Private checkpoint',
      ownerUserId: foreignContext.user.id,
      workspaceId: foreignContext.workspace.id,
    }, foreignContext)
    const file = await repo.saveFile(projectId, new File(['secret checkpoint payload'], 'private.txt'), foreignContext)
    const project = await repo.loadProject(projectId, foreignContext)
    if (!project) throw new Error('Foreign project missing')
    const saved = await repo.saveProjectIfCurrent({
      ...project, sourceFileIds: [file.fileId],
    }, project.recordRevision, foreignContext)
    const checkpoint = await repo.captureProjectCheckpoint(
      projectId, saved.recordRevision, [file.fileId], 'Private workspace baseline', foreignContext,
    )

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('projectCheckpointFiles', 'readwrite')
      const store = transaction.objectStore('projectCheckpointFiles')
      const request = store.get([checkpoint.checkpointId, file.fileId])
      request.onsuccess = () => {
        const stored = request.result
        if (!stored) return reject(new Error('Immutable checkpoint bytes were not stored'))
        stored.blob = new Blob(['altered checkpoint payload'], { type: stored.type })
        store.put(stored)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Tamper transaction aborted'))
    })
    database.close()

    let crossWorkspaceDenied = false
    try {
      await repo.getProjectCheckpoint(projectId, checkpoint.checkpointId, local.LOCAL_ACCESS_CONTEXT)
    } catch {
      crossWorkspaceDenied = true
    }
    return {
      crossWorkspaceDenied,
      verification: await repo.verifyProjectCheckpoint(projectId, checkpoint.checkpointId, foreignContext),
    }
  })

  expect(result.crossWorkspaceDenied).toBe(true)
  expect(result.verification.valid).toBe(false)
  expect(result.verification.issues.join(' ')).toMatch(/integrity|failed/i)
})

test('History panel accepts a reason, refreshes the checkpoint list, and verifies a listed checkpoint', async ({ page }) => {
  await openApp(page)
  const projectId = `history-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await page.evaluate(async id => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    await projectRepository.createProject({ projectId: id, projectName: 'History UI project' })
    projectRepository.setActiveProjectId(id)
  }, projectId)
  await page.reload()

  await expect(page.getByTestId('topbar-project-history')).toBeVisible()
  await page.getByTestId('topbar-project-history').click()
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByText('No checkpoints yet')).toBeVisible()
  await page.getByLabel(/Checkpoint note/).fill('Approved before publication')
  await page.getByRole('button', { name: 'Create checkpoint' }).click()
  await expect(page.getByText('Approved before publication', { exact: true })).toBeVisible()
  await expect(page.getByText('local-user')).toBeVisible()
  await expect(page.getByText('None (first checkpoint)')).toBeVisible()
  await page.getByRole('button', { name: 'Verify integrity' }).click()
  await expect(page.getByText('Integrity verified')).toBeVisible()

  const persisted = await page.evaluate(async id => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    return {
      checkpoints: await projectRepository.listProjectCheckpoints(id),
      project: await projectRepository.loadProject(id),
    }
  }, projectId)
  expect(persisted.checkpoints).toHaveLength(1)
  expect(persisted.checkpoints[0].reason).toBe('Approved before publication')
  expect(persisted.checkpoints[0].originatingRecordRevision).toBe(persisted.project?.recordRevision)
  expect(persisted.checkpoints[0]).not.toHaveProperty('record')
})