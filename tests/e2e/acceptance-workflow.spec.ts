import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const groundedText = 'Users can recover a workspace file from the verified backup archive.'
const unsupportedClaim = 'The workspace always recovers in exactly five minutes.'
const recoverTopicTitle = 'Recover a workspace file from the verified backup archive'
const accessTopicTitle = 'Review your workspace access'
const sourceMarkdown = [
  '# Workspace Operations',
  '',
  'Use these procedures to manage workspace files and access.',
  '',
  '## Review workspace access',
  '',
  'Users can review their workspace access.',
  '',
  '## Recover a workspace file',
  '',
  groundedText,
  '',
].join('\n')

async function createProject(page: Page, projectName: string) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole('button', { name: 'Continue — Theme & Styles' }).click()
  await page.getByRole('button', { name: 'Continue — Sources' }).click()
  await expect(page.getByRole('heading', { name: 'Add Source Material' })).toBeVisible()
}

async function uploadGroundedMarkdown(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'workspace-operations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(sourceMarkdown),
  })
  await expect(page.getByTestId('evidence-freshness')).toHaveText('Current', { timeout: 15_000 })
}

async function readPersistedProjectState(page: Page) {
  return page.evaluate(async () => {
    const { getActiveProjectId, loadProject, loadProjectFiles } =
      await import('/src/projectRepository.ts' as string)
    const projectId = getActiveProjectId()
    if (!projectId) throw new Error('The active local project is missing.')
    const [record, files] = await Promise.all([
      loadProject(projectId),
      loadProjectFiles(projectId),
    ])
    if (!record) throw new Error(`The active local project record is missing: ${projectId}`)
    const proposalItems = (record.tocProposal as {
      items?: Array<{ topicId: string; title: string }>
    } | null)?.items ?? []
    return {
      appToc: record.appToc.map(item => {
        const topic = item as { topicId?: string; title?: string }
        return { topicId: topic.topicId ?? '', title: topic.title ?? '' }
      }),
      topicContent: record.topicContent,
      proposalItems: proposalItems.map(item => ({ topicId: item.topicId, title: item.title })),
      sourceFileIds: record.sourceFileIds,
      sourceFiles: await Promise.all(files.map(async file => ({
        fileId: file.fileId,
        name: file.name,
        content: await file.blob.text(),
      }))),
    }
  })
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function occurrences(text: string, value: string) {
  return text.split(value).length - 1
}

test('local-dev deterministic acceptance workflow: Markdown through reviewed publish (not real cloud/provider acceptance)', async ({ page }) => {
  // This is the real browser/local repository workflow with deterministic local analysis.
  // It intentionally does not claim to validate cloud authentication or a provider-backed run.
  // pdfjs-dist's legacy-build Node warning, if emitted by the test process, is not a browser error.
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const projectName = `Local acceptance ${Date.now()}`
  await createProject(page, projectName)
  await uploadGroundedMarkdown(page)

  await page.getByTestId('analyze-sources').click()
  await expect(page.getByTestId('concept-analysis-freshness')).toHaveText('Current')
  await page.getByTestId('analysis-generate-toc').click()
  const proposal = page.getByTestId('toc-proposal-review')
  await expect(proposal).toBeVisible()
  const reviewedTopics = await proposal.getByTestId('toc-proposal-topic').evaluateAll(items =>
    items.map(item => ({
      topicId: item.getAttribute('data-topic-id') ?? '',
      title: item.getAttribute('aria-label')?.replace(/^Proposed topic: /, '') ?? '',
    })),
  )
  expect(reviewedTopics.map(topic => topic.title)).toEqual([
    'Navigate the workspace',
    accessTopicTitle,
    'Troubleshoot issues',
    recoverTopicTitle,
  ])
  const recoverProposalTopic = proposal.getByTestId('toc-proposal-topic')
    .filter({ hasText: recoverTopicTitle })
  const accessProposalTopic = proposal.getByTestId('toc-proposal-topic')
    .filter({ hasText: accessTopicTitle })
  await expect(recoverProposalTopic).toHaveAttribute('data-topic-kind', 'evidence-backed')
  await expect(accessProposalTopic).toHaveAttribute('data-topic-kind', 'evidence-backed')
  await recoverProposalTopic.click()
  const proposalEvidence = page.getByTestId('toc-topic-details')
  await expect(proposalEvidence).toContainText('workspace-operations.md')
  await expect(proposalEvidence).toContainText(groundedText)
  await expect(proposalEvidence).toContainText(/Recover a workspace file/i)

  // The reviewed proposal is saved, but remains separate from the committed TOC.
  // Verify the uploaded source itself is still present and unchanged before acceptance.
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  const beforeAcceptance = await readPersistedProjectState(page)
  expect(beforeAcceptance.appToc).toEqual([])
  expect(beforeAcceptance.topicContent).toEqual({})
  expect(beforeAcceptance.proposalItems).toEqual(reviewedTopics)
  expect(beforeAcceptance.sourceFileIds).toEqual(beforeAcceptance.sourceFiles.map(file => file.fileId))
  expect(beforeAcceptance.sourceFiles).toEqual([{
    fileId: beforeAcceptance.sourceFileIds[0],
    name: 'workspace-operations.md',
    content: sourceMarkdown,
  }])

  // Acceptance is explicit: clicking Commit moves the same reviewed proposal into the TOC.
  await expect(page.getByTestId('commit-toc-proposal')).toBeEnabled()
  await page.getByTestId('commit-toc-proposal').click()
  await expect(page.getByTestId('author-stage-heading')).toBeVisible()
  await expect(page.getByRole('navigation', { name: /Project (?:navigation|modules)/ })
    .getByRole('button', { name: 'Author', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  const afterAcceptance = await readPersistedProjectState(page)
  expect(afterAcceptance.appToc).toEqual(reviewedTopics)
  expect(afterAcceptance.sourceFileIds).toEqual(beforeAcceptance.sourceFileIds)
  expect(afterAcceptance.sourceFiles).toEqual(beforeAcceptance.sourceFiles)

  const outline = page.getByTestId('author-outline')
  const recoveryTopic = outline.getByTestId('author-topic-row').filter({ hasText: recoverTopicTitle }).first()
  await expect(recoveryTopic).toBeVisible()
  await recoveryTopic.getByText(recoverTopicTitle, { exact: true }).click()
  const editor = page.getByTestId('author-editor')
  await expect(editor).toContainText(recoverTopicTitle)
  const bodyParagraphs = editor.locator('[data-author-block-id] div[contenteditable="true"]')
  await expect.poll(() => bodyParagraphs.count()).toBeGreaterThan(0)

  // Keep a fact stated in the uploaded source and add a concrete unsupported claim
  // so Review has a required finding to resolve in this acceptance flow.
  const authoredBody = bodyParagraphs.last()
  await authoredBody.fill(`${groundedText} ${unsupportedClaim}`)
  await authoredBody.press('Tab')
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  await expect(authoredBody).toContainText(groundedText)
  await expect(authoredBody).toContainText(unsupportedClaim)

  const runReview = page.getByTestId('author-run-review')
  if (await runReview.isDisabled()) {
    const refreshClaimCheck = page.getByTestId('author-review-next-step')
      .getByRole('button', { name: 'Refresh Claim Check' })
    await expect(refreshClaimCheck).toBeVisible()
    await refreshClaimCheck.click()
    await expect(page.getByTestId('analysis-next-step')).toContainText('claim check is stale')
    await page.getByTestId('analysis-next-step').getByRole('button', { name: 'Rebuild Claim Check' }).click()
    await expect(page.getByTestId('unsupported-analysis-freshness')).toHaveText('Current')
    await page.getByRole('navigation', { name: /Project (?:navigation|modules)/ })
      .getByRole('button', { name: 'Author', exact: true }).click()
  }

  await expect(page.getByTestId('author-run-review')).toBeEnabled()
  await page.getByTestId('author-run-review').click()
  await expect(page.getByTestId('real-review-findings')).toBeVisible()
  const unsupportedFinding = page.getByTestId('grounded-review-finding')
    .filter({ hasText: unsupportedClaim })
  await expect(unsupportedFinding).toBeVisible()
  await expect(unsupportedFinding).toContainText(/Unsupported Claim/)
  await expect(unsupportedFinding).toContainText(/Required/)

  // Resolve each required finding explicitly; the unsupported finding is asserted above.
  for (let i = 0; i < 30 && await page.getByTestId('review-preview-publish').isDisabled(); i++) {
    const finding = page.getByTestId('grounded-review-finding')
      .filter({ hasText: /Required.*(?:open|in-review)/i }).first()
    await expect(finding).toBeVisible()
    if (await finding.getByRole('button', { name: 'Inspect' }).count()) {
      await finding.getByRole('button', { name: 'Inspect' }).click()
    }
    await finding.getByRole('button', { name: 'Mark resolved' }).click()
  }
  await expect(page.getByTestId('review-preview-publish')).toBeEnabled()

  await page.getByTestId('review-preview-publish').click()
  const preview = page.getByTestId('project-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText(groundedText)
  await expect(preview).toContainText(unsupportedClaim)
  await page.getByRole('button', { name: /Go to Publish/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Publish outputs' })).toBeVisible()

  // A full reload must restore the accepted structure and authored state from the
  // normal local persistence path, without re-running analysis or duplicating content.
  await expect(page.locator('header').getByText('All changes saved', { exact: true })).toBeVisible()
  await page.reload()
  const modules = page.getByRole('navigation', { name: /Project (?:navigation|modules)/ })
  await expect(modules).toBeVisible()
  await modules.getByRole('button', { name: 'Structure', exact: true }).click()
  await expect(page.getByTestId('committed-toc-panel')).toContainText(recoverTopicTitle)
  await expect(page.getByTestId('committed-toc-panel').getByText(recoverTopicTitle, { exact: true }))
    .toHaveCount(1)
  await modules.getByRole('button', { name: 'Author', exact: true }).click()
  const restoredOutline = page.getByTestId('author-outline')
  const restoredRecoveryTopic = restoredOutline.getByTestId('author-topic-row')
    .filter({ hasText: recoverTopicTitle }).first()
  await expect(restoredRecoveryTopic).toBeVisible()
  await restoredRecoveryTopic.getByText(recoverTopicTitle, { exact: true }).click()
  const restoredEditor = page.getByTestId('author-editor')
  await expect(restoredEditor).toContainText(groundedText)
  await expect(restoredEditor).toContainText(unsupportedClaim)
  await expect(restoredEditor.locator('[contenteditable="true"]').filter({ hasText: unsupportedClaim }))
    .toHaveCount(1)

  await modules.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByTestId('real-review-findings')).toBeVisible()
  await page.getByRole('combobox', { name: 'Status' }).selectOption('Resolved')
  await expect(page.getByTestId('grounded-review-finding').filter({ hasText: unsupportedClaim }))
    .toContainText(/resolved/i)
  await page.getByTestId('review-preview-publish').click()
  await expect(page.getByTestId('project-preview')).toContainText(groundedText)
  await page.getByRole('button', { name: /Go to Publish/ }).first().click()

  for (const format of ['PDF', 'Word', 'HTML']) {
    await page.getByRole('checkbox', { name: new RegExp(format) }).check()
  }
  await expect(page.getByTestId('publish-generate-outputs')).toBeEnabled()
  await page.getByTestId('publish-generate-outputs').click()
  const results = page.getByTestId('publish-output-results')
  for (const readyLabel of ['PDF Ready', 'Word Ready', 'HTML Ready']) {
    await expect(results.getByText(readyLabel, { exact: true })).toBeVisible({ timeout: 30_000 })
  }

  const downloaded = new Map<string, Buffer>()
  const downloadFormats = [
    { extension: '.pdf', name: /\.pdf$/i },
    { extension: '.docx', name: /\.docx$/i },
    { extension: '-html.zip', name: /-html\.zip$/i },
  ]
  const downloadButtons = results.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadButtons).toHaveCount(3)
  for (let index = 0; index < downloadFormats.length; index++) {
    const downloadPromise = page.waitForEvent('download')
    await downloadButtons.nth(index).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(downloadFormats[index].name)
    downloaded.set(downloadFormats[index].extension, await readFile(await download.path()))
  }

  const pdfBytes = downloaded.get('.pdf')
  const wordBytes = downloaded.get('.docx')
  const htmlBytes = downloaded.get('-html.zip')
  expect(pdfBytes).toBeTruthy()
  expect(wordBytes).toBeTruthy()
  expect(htmlBytes).toBeTruthy()

  const wordArchive = await JSZip.loadAsync(wordBytes!)
  const wordXml = await wordArchive.file('word/document.xml')!.async('string')
  const wordText = normalizeWhitespace(
    [...wordXml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join(' '),
  )
  expect(wordText).toContain(groundedText)
  expect(wordText).toContain(unsupportedClaim)
  expect(occurrences(wordText, unsupportedClaim)).toBe(1)

  const htmlArchive = await JSZip.loadAsync(htmlBytes!)
  const topicPages = await Promise.all(Object.keys(htmlArchive.files)
    .filter(path => path.startsWith('topics/') && path.endsWith('.html'))
    .map(async path => htmlArchive.file(path)!.async('string')))
  const groundedTopicPage = topicPages.find(html => html.includes(unsupportedClaim))
  expect(groundedTopicPage).toBeTruthy()
  expect(groundedTopicPage).toContain(groundedText)
  expect(occurrences(groundedTopicPage!, unsupportedClaim)).toBe(1)

  const pdf = await getDocument({ data: new Uint8Array(pdfBytes!) }).promise
  const pdfPageTexts: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const pdfPage = await pdf.getPage(pageNumber)
    const content = await pdfPage.getTextContent()
    pdfPageTexts.push(content.items
      .filter((item): item is typeof item & { str: string } => 'str' in item)
      .map(item => item.str).join(' '))
  }
  const pdfText = normalizeWhitespace(pdfPageTexts.join(' '))
  expect(pdfText).toContain(groundedText)
  expect(pdfText).toContain(unsupportedClaim)

  expect(pageErrors, 'browser page errors').toEqual([])
  expect(consoleErrors, 'browser console errors').toEqual([])
})