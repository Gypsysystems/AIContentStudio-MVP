import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixture = JSON.parse(await readFile(
  new URL('../fixtures/project-record-v2.json', import.meta.url),
  'utf8',
)) as Record<string, any>

async function openTableOfContents(page: Page) {
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
}

test('keeps AI Generate TOC unavailable in local project mode', async ({ page }) => {
  await page.goto('/')
  const projectId = `grounded-toc-local-gate-${Date.now()}`
  await page.evaluate(async id => {
    const { projectRepository } = await import('/src/projectService.ts' as string)
    await projectRepository.createProject({ projectId: id, projectName: 'Local TOC gate project' })
    await projectRepository.setActiveProjectId(id)
  }, projectId)
  await page.reload()

  await openTableOfContents(page)
  await expect(page.getByTestId('real-toc-screen')).toBeVisible()
  await expect(page.getByTestId('ai-toc-controls')).toHaveCount(0)
})

test('AI proposal provenance remains safe through backup validation and duplication', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async source => {
    const { migrateProjectRecord, validateProjectSnapshot, createProjectCopySnapshot } =
      await import('/src/projectRepository.ts' as string)
    const base = migrateProjectRecord({
      ...source,
      projectId: `grounded-toc-backup-${Date.now()}`,
      projectName: 'Grounded TOC backup fixture',
    }).record
    const evidenceIndex = base.evidenceIndex as Record<string, any>
    const analysis = base.conceptAnalysis as Record<string, any>
    const proposal = base.tocProposal as Record<string, any>
    const aiProvenance = {
      providerId: 'openai',
      modelId: 'gpt-example-model',
      workflow: { id: 'workflow-grounded-toc', version: 2 },
      promptPack: { id: 'prompt-grounded-toc', version: 3 },
      referenceSet: { id: 'reference-grounded-toc', version: 4 },
      blueprint: { id: 'blueprint-grounded-toc', version: 5 },
      evidenceSourcesRevision: evidenceIndex.sourcesRevision,
      evidenceExtractionRevision: evidenceIndex.extractionRevision,
      analysisBuiltAt: analysis.builtAt,
    }
    const aiRecord = {
      ...base,
      tocProposal: {
        ...proposal,
        method: 'ai-grounded-toc-v1',
        evidenceSourcesRevision: evidenceIndex.sourcesRevision,
        evidenceExtractionRevision: evidenceIndex.extractionRevision,
        groundedAnalysisBuiltAt: analysis.builtAt,
        aiProvenance,
      },
    }
    const file = {
      fileId: 'fixture-source-a',
      projectId: aiRecord.projectId,
      name: 'field-manual.md',
      type: 'text/markdown',
      size: 13,
      uploadedAt: 0,
      blob: new Blob(['fixture bytes']),
    }
    const snapshot = validateProjectSnapshot({ record: aiRecord, files: [file] })
    const duplicate = createProjectCopySnapshot(
      snapshot,
      'grounded-toc-copy',
      'Grounded TOC duplicate',
      100,
      { 'fixture-source-a': 'grounded-toc-copy-source' },
    )
    const validatedDuplicate = validateProjectSnapshot(duplicate)

    let rejectedRawProvenance = false
    try {
      validateProjectSnapshot({
        record: {
          ...aiRecord,
          tocProposal: {
            ...aiRecord.tocProposal,
            aiProvenance: { ...aiProvenance, rawPrompt: 'private provider instructions' },
          },
        },
        files: [file],
      })
    } catch {
      rejectedRawProvenance = true
    }
    return {
      sourceProposal: snapshot.record.tocProposal,
      duplicateProposal: validatedDuplicate.record.tocProposal,
      duplicateFileIds: validatedDuplicate.record.sourceFileIds,
      rejectedRawProvenance,
    }
  }, fixture)

  expect(result.sourceProposal).toMatchObject({
    method: 'ai-grounded-toc-v1',
    aiProvenance: {
      providerId: 'openai',
      modelId: 'gpt-example-model',
      workflow: { id: 'workflow-grounded-toc', version: 2 },
      promptPack: { id: 'prompt-grounded-toc', version: 3 },
      referenceSet: { id: 'reference-grounded-toc', version: 4 },
      blueprint: { id: 'blueprint-grounded-toc', version: 5 },
    },
  })
  expect(result.duplicateProposal).toMatchObject({
    method: 'ai-grounded-toc-v1',
    aiProvenance: {
      workflow: { id: 'workflow-grounded-toc', version: 2 },
      promptPack: { id: 'prompt-grounded-toc', version: 3 },
      referenceSet: { id: 'reference-grounded-toc', version: 4 },
      blueprint: { id: 'blueprint-grounded-toc', version: 5 },
    },
  })
  expect(result.duplicateFileIds).toEqual(['grounded-toc-copy-source'])
  expect(result.rejectedRawProvenance).toBe(true)
})

test('cloud AI TOC UI gates roles, confirms replacement, restores failures, and saves success without changing committed TOC', async ({ page, context }) => {
  const projectId = `grounded-toc-ui-cloud-${Date.now()}`
  const reviewedProposalTitle = 'Reviewed proposal with pending edit'
  const oldProposal = {
    version: 1,
    method: 'evidence-grounded-toc-v1',
    contentType: 'user-guide',
    evidenceSourcesRevision: 0,
    evidenceExtractionRevision: '',
    groundedAnalysisBuiltAt: 0,
    generatedAt: 100,
    items: [{
      id: 501,
      topicId: 'reviewed-previous-proposal',
      title: 'Reviewed previous proposal',
      level: 1,
      words: 100,
      order: 0,
      rationale: 'Existing reviewed content.',
      supportingEvidenceIds: [],
      proposalKind: 'manual',
    }],
  }
  const committedToc = [{ id: 701, topicId: 'approved-current-toc', title: 'Approved committed topic', level: 1, words: 80, order: 0 }]
  let projectRecord: Record<string, any> | null = null
  let failGeneration = true
  let simulateConcurrentEdit = false
  let delayGeneration = false
  let notifyDelayedGenerationStarted: (() => void) | null = null
  const generateRequests: Array<Record<string, unknown>> = []
  const restoredProposals: Array<Record<string, unknown>> = []
  const clearedProposals: Array<Record<string, unknown>> = []
  const workflow = {
    workspaceId: 'grounded-toc-ui-workspace',
    id: 'workflow-grounded-toc-ui',
    kind: 'workflow',
    version: 1,
    state: 'published',
    name: 'Grounded TOC workflow',
    description: '',
    definition: {
      capability: 'Generate TOC',
      model: { mode: 'pinned', providerId: 'openai', modelId: 'gpt-test-model' },
      promptPack: { id: 'toc-prompt-ui', version: 1 },
      referenceSet: { id: 'toc-reference-ui', version: 1 },
      blueprint: { id: 'toc-blueprint-ui', version: 1 },
      steps: [{ id: 'generate', capability: 'Generate TOC' }],
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'grounded-toc-ui-owner',
  }
  const successProposal = {
    version: 1,
    method: 'ai-grounded-toc-v1',
    contentType: 'user-guide',
    evidenceSourcesRevision: 0,
    evidenceExtractionRevision: 'ui-test-extraction-revision',
    groundedAnalysisBuiltAt: 1,
    generatedAt: 200,
    items: [{
      id: 801,
      topicId: 'ai-proposed-topic',
      title: 'AI proposed topic',
      level: 1,
      words: 120,
      order: 0,
      rationale: 'A test proposal for review.',
      supportingEvidenceIds: [],
      proposalKind: 'optional-structural',
    }],
    aiProvenance: {
      providerId: 'openai',
      modelId: 'gpt-test-model',
      workflow: { id: workflow.id, version: workflow.version },
      promptPack: { id: 'toc-prompt-ui', version: 1 },
      referenceSet: { id: 'toc-reference-ui', version: 1 },
      blueprint: { id: 'toc-blueprint-ui', version: 1 },
      evidenceSourcesRevision: 0,
      evidenceExtractionRevision: 'ui-test-extraction-revision',
      analysisBuiltAt: 1,
    },
  }

  await context.route('**/api/cloud-projects', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: projectRecord ? [projectRecord] : [] }) })
    } else if (command.action === 'create') {
      projectRecord = command.record as Record<string, any>
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record: projectRecord }) })
    } else if (command.action === 'read') {
      await route.fulfill(projectRecord
        ? { status: 200, contentType: 'application/json', body: JSON.stringify({ record: projectRecord }) }
        : { status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PROJECT_NOT_FOUND', error: 'Not found' }) })
    } else if (command.action === 'save') {
      if (!projectRecord || command.expectedRevision !== projectRecord.recordRevision) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PROJECT_CONFLICT', error: 'Project changed' }) })
      } else {
        const incoming = command.record as Record<string, any>
        if (projectRecord.tocProposal && !incoming.tocProposal)
          clearedProposals.push(projectRecord.tocProposal)
        if (!projectRecord.tocProposal && incoming.tocProposal)
          restoredProposals.push(incoming.tocProposal)
        projectRecord = {
          ...incoming,
          recordRevision: Number(command.expectedRevision) + 1,
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record: projectRecord }) })
      }
    } else if (command.action === 'load-files') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    }
  })
  await context.route('**/api/ai-catalog', async route => {
    const command = route.request().postDataJSON()
    if (command.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets: [workflow] }) })
    } else if (command.action === 'history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [workflow] }) })
    } else if (command.action === 'readiness') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          readiness: {
            status: 'ready',
            workflow: { id: workflow.id, version: workflow.version },
            dependencies: {
              promptPack: { id: 'toc-prompt-ui', version: 1, name: 'TOC prompt', state: 'published' },
              referenceSet: { id: 'toc-reference-ui', version: 1, name: 'TOC reference', state: 'published' },
              blueprint: { id: 'toc-blueprint-ui', version: 1, name: 'TOC blueprint', state: 'published' },
            },
            model: { providerId: 'openai', modelId: 'gpt-test-model' },
            checkedAt: '2026-10-01T00:00:00.000Z',
            blockers: [],
          },
        }),
      })
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_ACTION', error: 'Unsupported' }) })
    }
  })
  await context.route('**/api/generate-toc', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    generateRequests.push(body)
    expect(Object.keys(body).sort()).toEqual(['projectId', 'workflowId', 'workflowVersion'])
    expect(body).toEqual({ projectId, workflowId: workflow.id, workflowVersion: workflow.version })
    expect(projectRecord?.tocProposal).toBeNull()
    if (delayGeneration) {
      notifyDelayedGenerationStarted?.()
      notifyDelayedGenerationStarted = null
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (failGeneration) {
      if (simulateConcurrentEdit && projectRecord) {
        projectRecord = {
          ...projectRecord,
          appToc: [{ id: 990, topicId: 'concurrent-approved-topic', title: 'Concurrent committed edit', level: 1, words: 90 }],
          recordRevision: projectRecord.recordRevision + 1,
        }
      }
      try {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PROVIDER_ERROR', error: 'provider detail must not be shown' }),
        })
      } catch {
        // The durability regression intentionally closes this request's page.
      }
      return
    }
    if (!projectRecord) throw new Error('The mocked cloud project was not initialized')
    projectRecord = {
      ...projectRecord,
      tocProposal: successProposal,
      recordRevision: projectRecord.recordRevision + 1,
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proposal: successProposal, recordRevision: projectRecord.recordRevision }),
    })
  })

  await page.goto('/')
  await page.evaluate(async ({ id, proposal, toc }) => {
    const [auth, mode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'grounded-toc-ui-owner' },
      workspace: { id: 'grounded-toc-ui-workspace', name: 'Grounded TOC UI workspace' },
      membership: { userId: 'grounded-toc-ui-owner', workspaceId: 'grounded-toc-ui-workspace', role: 'editor' },
    })
    mode.setCloudProjectMode(true)
    const record = await repository.authorizedProjectRepository.createProject({
      projectId: id,
      projectName: 'Grounded TOC cloud UI project',
      tocProposal: proposal,
      appToc: toc,
    })
    await repository.authorizedProjectRepository.setActiveProjectId(record.projectId)
  }, { id: projectId, proposal: oldProposal, toc: committedToc })

  await page.getByTestId('topbar-administration').click()
  await page.locator('header').getByRole('button', { name: /Content Studio/ }).click()
  const projectRow = page.locator('main div.group').filter({ has: page.getByText('Grounded TOC cloud UI project', { exact: true }) })
  await projectRow.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  await expect(page.getByTestId('ai-toc-controls')).toHaveCount(0)

  await page.evaluate(async () => {
    const auth = await import('/src/authSession.ts' as string)
    auth.setCloudAuthSession({
      user: { id: 'grounded-toc-ui-owner' },
      workspace: { id: 'grounded-toc-ui-workspace', name: 'Grounded TOC UI workspace' },
      membership: { userId: 'grounded-toc-ui-owner', workspaceId: 'grounded-toc-ui-workspace', role: 'owner' },
    })
  })
  await page.getByTestId('topbar-project-home').click()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  await expect(page.getByTestId('ai-toc-readiness')).toContainText('Workflow ready')
  const aiControls = page.getByTestId('ai-toc-controls')
  const generate = aiControls.getByTestId('generate-ai-toc')
  await expect(generate).toBeEnabled()

  let acceptReplacement = false
  let acceptRecovery = false
  let recoveryPrompt = ''
  page.on('dialog', async dialog => {
    if (dialog.message().startsWith('Restore the reviewed proposal')) {
      recoveryPrompt = dialog.message()
      if (acceptRecovery) await dialog.accept()
      else await dialog.dismiss()
    } else if (acceptReplacement) await dialog.accept()
    else await dialog.dismiss()
  })
  await page.getByTestId('toc-proposal-topic').getByRole('button', { name: 'Rename topic' }).click()
  const renameInput = page.getByTestId('toc-proposal-rename-input')
  await renameInput.fill(reviewedProposalTitle)
  await renameInput.press('Enter')
  await expect(page.getByTestId('toc-proposal-topic')).toContainText(reviewedProposalTitle)
  await generate.click()
  await expect.poll(() => generateRequests.length).toBe(0)
  await expect(projectRecord?.tocProposal).toMatchObject({ items: [{ title: 'Reviewed previous proposal' }] })

  acceptReplacement = true
  await generate.click()
  await expect(page.getByTestId('ai-toc-recovery')).toHaveCount(0)
  await expect(aiControls).toContainText('The previous proposal was safely restored.')
  await expect(page.getByTestId('toc-proposal-topic')).toContainText(reviewedProposalTitle)
  expect(generateRequests).toEqual([{ projectId, workflowId: workflow.id, workflowVersion: workflow.version }])
  expect(clearedProposals[0]).toMatchObject({ items: [{ title: reviewedProposalTitle }] })
  expect(projectRecord?.tocProposal).toMatchObject({ items: [{ title: reviewedProposalTitle }] })
  expect(restoredProposals[0]).toMatchObject({
    items: [{
      title: reviewedProposalTitle,
      rationale: 'Existing reviewed content.',
      supportingEvidenceIds: [],
    }],
  })
  expect(projectRecord?.appToc).toEqual(committedToc)

  failGeneration = false
  await generate.click()
  await expect(page.getByTestId('ai-toc-provenance')).toContainText('AI-generated proposal')
  await expect(page.getByTestId('toc-proposal-topic')).toContainText('AI proposed topic')
  expect(generateRequests).toHaveLength(2)
  expect(projectRecord?.appToc).toEqual(committedToc)

  await page.reload()
  await page.evaluate(async id => {
    const [auth, mode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'grounded-toc-ui-owner' },
      workspace: { id: 'grounded-toc-ui-workspace', name: 'Grounded TOC UI workspace' },
      membership: { userId: 'grounded-toc-ui-owner', workspaceId: 'grounded-toc-ui-workspace', role: 'owner' },
    })
    mode.setCloudProjectMode(true)
    await repository.authorizedProjectRepository.setActiveProjectId(id)
  }, projectId)
  await page.getByTestId('topbar-administration').click()
  await page.locator('header').getByRole('button', { name: /Content Studio/ }).click()
  const reloadedRow = page.locator('main div.group').filter({ has: page.getByText('Grounded TOC cloud UI project', { exact: true }) })
  await reloadedRow.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  await expect(page.getByTestId('ai-toc-provenance')).toContainText('AI-generated proposal')
  await expect(page.getByTestId('toc-proposal-topic')).toContainText('AI proposed topic')
  expect(projectRecord?.appToc).toEqual(committedToc)

  failGeneration = true
  simulateConcurrentEdit = true
  await generate.click()
  await expect(page.getByTestId('ai-toc-recovery')).toContainText('Previous proposal retained as a recovery snapshot')
  await expect(page.getByTestId('ai-toc-recovery')).toContainText('AI proposed topic')
  expect(projectRecord?.tocProposal).toBeNull()
  expect(projectRecord?.appToc).toMatchObject([{ topicId: 'concurrent-approved-topic', title: 'Concurrent committed edit' }])

  await page.reload()
  await page.evaluate(async id => {
    const [auth, mode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'grounded-toc-ui-owner' },
      workspace: { id: 'grounded-toc-ui-workspace', name: 'Grounded TOC UI workspace' },
      membership: { userId: 'grounded-toc-ui-owner', workspaceId: 'grounded-toc-ui-workspace', role: 'owner' },
    })
    mode.setCloudProjectMode(true)
    await repository.authorizedProjectRepository.setActiveProjectId(id)
  }, projectId)
  await page.getByTestId('topbar-administration').click()
  await page.locator('header').getByRole('button', { name: /Content Studio/ }).click()
  const recoveredRow = page.locator('main div.group').filter({ has: page.getByText('Grounded TOC cloud UI project', { exact: true }) })
  await recoveredRow.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await page.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  const recoveryPanel = page.getByTestId('ai-toc-recovery')
  await expect(recoveryPanel).toContainText('AI proposed topic')
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-ai-toc-recovery').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('grounded-toc-recovery.json')

  acceptRecovery = true
  await page.getByTestId('retry-ai-toc-recovery').click()
  await expect.poll(() => recoveryPrompt).toMatch(/revision \d+/)
  const consentedRevision = Number(recoveryPrompt.match(/revision (\d+)/)?.[1])
  expect(projectRecord?.recordRevision).toBe(consentedRevision + 1)
  await expect(page.getByTestId('ai-toc-recovery')).toHaveCount(0)
  await expect(page.getByTestId('toc-proposal-topic')).toContainText('AI proposed topic')
  expect(projectRecord?.tocProposal).toMatchObject({ items: [{ title: 'AI proposed topic' }] })
  expect(projectRecord?.appToc).toMatchObject([{ topicId: 'concurrent-approved-topic', title: 'Concurrent committed edit' }])

  delayGeneration = true
  simulateConcurrentEdit = false
  const delayedRequestCount = generateRequests.length
  const generationStarted = new Promise<void>(resolve => {
    notifyDelayedGenerationStarted = resolve
  })
  await generate.click()
  await generationStarted
  await expect.poll(() => generateRequests.length).toBe(delayedRequestCount + 1)
  expect(projectRecord?.tocProposal).toBeNull()
  expect(projectRecord?.appToc).toMatchObject([{ topicId: 'concurrent-approved-topic', title: 'Concurrent committed edit' }])

  await page.close()
  const reopenedPage = await context.newPage()
  await reopenedPage.goto('/')
  await reopenedPage.evaluate(async id => {
    const [auth, mode, repository] = await Promise.all([
      import('/src/authSession.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
      import('/src/authorizedProjectService.ts' as string),
    ])
    auth.setCloudAuthSession({
      user: { id: 'grounded-toc-ui-owner' },
      workspace: { id: 'grounded-toc-ui-workspace', name: 'Grounded TOC UI workspace' },
      membership: { userId: 'grounded-toc-ui-owner', workspaceId: 'grounded-toc-ui-workspace', role: 'owner' },
    })
    mode.setCloudProjectMode(true)
    await repository.authorizedProjectRepository.setActiveProjectId(id)
  }, projectId)
  await reopenedPage.getByTestId('topbar-administration').click()
  await reopenedPage.locator('header').getByRole('button', { name: /Content Studio/ }).click()
  const tabCloseRow = reopenedPage.locator('main div.group').filter({ has: reopenedPage.getByText('Grounded TOC cloud UI project', { exact: true }) })
  await tabCloseRow.getByRole('button', { name: 'Open', exact: true }).click()
  await reopenedPage.locator('header').getByRole('button', { name: /^Analyze & Structure/ }).click()
  await reopenedPage.locator('header').getByRole('button', { name: /^Table of contents/ }).click()
  await expect(reopenedPage.getByTestId('ai-toc-recovery')).toContainText('AI proposed topic')
  const durableDownloadPromise = reopenedPage.waitForEvent('download')
  await reopenedPage.getByTestId('export-ai-toc-recovery').click()
  expect((await durableDownloadPromise).suggestedFilename()).toBe('grounded-toc-recovery.json')
  expect(projectRecord?.tocProposal).toBeNull()
  expect(projectRecord?.appToc).toMatchObject([{ topicId: 'concurrent-approved-topic', title: 'Concurrent committed edit' }])
})