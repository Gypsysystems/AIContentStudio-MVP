import type { AuthorTopicMetadataMap } from './authorMetadata'
import type { ReviewFinding, ReviewModel, ReviewRun } from './reviewModel'
import type { ReviewInputSnapshot } from './reviewInput'
import type { SourceExtraction } from './sourceExtractor'

export type ProjectHomeStage = 'sources' | 'analysis' | 'studio' | 'quality' | 'publish'
export type ProjectHomeDestination = ProjectHomeStage | 'structure' | 'branding'
export type ProjectHomeStatus = 'Not started' | 'In progress' | 'Needs attention' | 'Ready' | 'Complete' | 'Demo complete'
export type ProjectHomeIssue = {
  id: string
  title: string
  detail: string
  stage: ProjectHomeDestination
  destination?: ProjectHomeDestination
  topicId?: string
  findingId?: string
  authorTargetEligible?: boolean
  severity: 'attention' | 'blocker'
}
export type ProjectHomeBlock = {
  type: string
  content: string
  tableExcerpt?: string
  tableData?: { rows: string[][] }
  procedureSteps?: string[]
  listItems?: Array<{ text: string }>
  caption?: string
}
export type ProjectHomeInput = {
  sources: Array<{ fileId: string; name: string }>
  sourceExtractions: Record<string, SourceExtraction>
  evidenceFresh: boolean
  conceptAnalysisFresh: boolean
  unsupportedAnalysisFresh: boolean
  hasEvidenceIndex: boolean
  hasConceptAnalysis: boolean
  hasUnsupportedAnalysis: boolean
  materialConflicts: Array<{ id: string; label: string; detail?: string }>
  committedTocStale: boolean
  topics: Array<{ topicId: string; title: string; hasContent: boolean; blocks?: ProjectHomeBlock[] }>
  topicMetadata: AuthorTopicMetadataMap
  reviewSnapshot: ReviewInputSnapshot | null
  reviewModel: ReviewModel
  publishConfig: { selectedFormats: string[] }
  isDemoMode: boolean
  demoProgress?: {
    hasSources: boolean
    analysisCurrent: boolean
    structureAccepted: boolean
    reviewComplete: boolean
    formatsSelected: boolean
  }
  reviewFindingEligibility: (findingId: string) => boolean
}
export type ProjectHomeSummary = {
  stages: Record<ProjectHomeStage, ProjectHomeStatus>
  issues: ProjectHomeIssue[]
  continueStage: ProjectHomeStage
  continueDestination: ProjectHomeDestination
  continueLabel: string
  usableSourceCount: number
  topicCount: number
  demoMode: boolean
  demoSourceCount: number
  activeRun: ReviewRun | null
  recentRun: ReviewRun | null
  currentRequiredOpenFindingCount: number
}

function hasSubstantiveTopicContent(blocks: ProjectHomeBlock[]): boolean {
  return blocks.some(block => {
    if (/^h[1-4]$/i.test(block.type) || block.type === 'divider' || block.type === 'bookmark') return false
    return !!block.content.trim()
      || !!block.caption?.trim()
      || !!block.tableExcerpt?.trim()
      || !!block.tableData?.rows.some(row => row.some(cell => cell.trim()))
      || !!block.procedureSteps?.some(step => step.trim())
      || !!block.listItems?.some(item => item.text.trim())
  })
}

export function summarizeProjectHome(input: ProjectHomeInput): ProjectHomeSummary {
  const extractions = input.sources.map(source => input.sourceExtractions[source.fileId])
  const usableSourceCount = extractions.filter(extraction =>
    extraction?.status === 'extracted' || extraction?.status === 'partial').length
  const authoredTopicContent = input.topics.map(topic => {
    const snapshotTopic = input.reviewSnapshot?.topics.find(item => item.topicId === topic.topicId)
    if (snapshotTopic) return hasSubstantiveTopicContent(snapshotTopic.blocks)
    if (topic.blocks) return hasSubstantiveTopicContent(topic.blocks)
    return topic.hasContent
  })
  const hasTopicGroundingIssues = input.topics.some(topic => {
    const freshness = input.topicMetadata[topic.topicId]?.generatedFreshness
    return freshness === 'stale' || freshness === 'needs-grounding'
  })
  const needsAuthoring = authoredTopicContent.some(hasContent => !hasContent)
  if (input.isDemoMode) {
    const demo = input.demoProgress ?? {
      hasSources: input.sources.length > 0,
      analysisCurrent: input.hasConceptAnalysis,
      structureAccepted: input.topics.length > 0,
      reviewComplete: false,
      formatsSelected: input.publishConfig.selectedFormats.length > 0,
    }
    let continueStage: ProjectHomeStage
    let continueDestination: ProjectHomeDestination
    let continueLabel: string
    if (!demo.hasSources) {
      continueStage = 'sources'
      continueDestination = 'sources'
      continueLabel = 'Add demo sources'
    } else if (!demo.analysisCurrent) {
      continueStage = 'analysis'
      continueDestination = 'analysis'
      continueLabel = 'Continue demo analysis'
    } else if (!demo.structureAccepted) {
      continueStage = 'analysis'
      continueDestination = 'structure'
      continueLabel = 'Review demo structure'
    } else if (needsAuthoring) {
      continueStage = 'studio'
      continueDestination = 'studio'
      continueLabel = 'Continue demo authoring'
    } else if (!demo.reviewComplete) {
      continueStage = 'quality'
      continueDestination = 'quality'
      continueLabel = 'Continue demo Review'
    } else {
      continueStage = 'publish'
      continueDestination = 'publish'
      continueLabel = demo.formatsSelected ? 'Open demo publication' : 'Prepare demo outputs'
    }
    const stages: Record<ProjectHomeStage, ProjectHomeStatus> = {
      sources: demo.hasSources ? 'Demo complete' : 'Not started',
      analysis: !demo.hasSources ? 'Not started' : demo.analysisCurrent ? 'Demo complete' : 'In progress',
      studio: !demo.structureAccepted ? 'Not started'
        : needsAuthoring ? 'In progress' : 'Demo complete',
      quality: !demo.structureAccepted || needsAuthoring ? 'Not started'
        : demo.reviewComplete ? 'Demo complete' : 'In progress',
      publish: !demo.reviewComplete ? 'Not started'
        : demo.formatsSelected ? 'Demo complete' : 'In progress',
    }
    return {
      stages,
      issues: [],
      continueStage,
      continueDestination,
      continueLabel,
      usableSourceCount: 0,
      topicCount: input.topics.length,
      demoMode: true,
      demoSourceCount: input.sources.length,
      activeRun: null,
      recentRun: null,
      currentRequiredOpenFindingCount: 0,
    }
  }
  const issues: ProjectHomeIssue[] = []
  const activeRun = input.reviewModel.runs.find(run =>
    run.reviewRunId === input.reviewModel.activeReviewRunId) ?? null
  const recentRun = input.reviewModel.runs
    .filter(run => typeof run.completedAt === 'number' && Number.isFinite(run.completedAt) && run.completedAt > 0)
    .sort((left, right) => right.completedAt! - left.completedAt!)[0] ?? null
  const activeRunFindings = new Set(activeRun?.findingIds ?? [])
  const snapshotId = input.reviewSnapshot?.snapshotId
  if (!input.sources.length) {
    issues.push({ id: 'sources-none', title: 'Add project sources', detail: 'No source files are attached to this project.', stage: 'sources', severity: 'blocker' })
  }
  input.sources.forEach(source => {
    const extraction = input.sourceExtractions[source.fileId]
    if (!extraction || extraction.status === 'not-extracted' || extraction.status === 'failed' || extraction.status === 'unsupported') {
      issues.push({
        id: `extraction-${source.fileId}`,
        title: extraction?.status === 'failed' ? 'Extraction failed' : 'Source extraction needed',
        detail: extraction?.extractionError || `${source.name} is not ready for analysis.`,
        stage: 'sources',
        severity: 'blocker',
      })
    }
  })
  if (input.sources.length > 0 && !input.evidenceFresh) {
    issues.push({ id: 'evidence-stale', title: input.hasEvidenceIndex ? 'Evidence Index is stale' : 'Build the Evidence Index', detail: 'Refresh evidence before relying on analysis or Review.', stage: 'sources', severity: 'blocker' })
  }
  if (input.sources.length > 0 && (!input.conceptAnalysisFresh || !input.hasConceptAnalysis)) {
    issues.push({ id: 'analysis-stale', title: input.hasConceptAnalysis ? 'Grounded analysis is stale' : 'Build grounded analysis', detail: 'Concepts and terminology need current source evidence.', stage: 'analysis', severity: 'blocker' })
  }
  if (input.sources.length > 0 && (!input.unsupportedAnalysisFresh || !input.hasUnsupportedAnalysis)) {
    issues.push({ id: 'unsupported-stale', title: input.hasUnsupportedAnalysis ? 'Claim check is stale' : 'Build the claim check', detail: 'Unsupported-claim analysis is not current.', stage: 'analysis', severity: 'attention' })
  }
  if (input.hasConceptAnalysis && input.conceptAnalysisFresh && input.committedTocStale) {
    issues.push({ id: 'toc-stale', title: 'Committed structure is out of date', detail: 'The table of contents no longer matches current analysis inputs.', stage: 'analysis', destination: 'structure', severity: 'blocker' })
  }
  if (input.hasConceptAnalysis && input.conceptAnalysisFresh && !input.topics.length) {
    issues.push({ id: 'toc-missing', title: 'Accept a table of contents', detail: 'A committed structure is needed before authoring.', stage: 'analysis', destination: 'structure', severity: 'blocker' })
  }
  input.materialConflicts.forEach(conflict => {
    issues.push({
      id: `conflict-${conflict.id}`,
      title: `Material conflict: ${conflict.label}`,
      detail: conflict.detail || 'Source material contains conflicting evidence that needs review.',
      stage: 'analysis',
      severity: 'attention',
    })
  })

  input.topics.forEach((topic, index) => {
    const metadata = input.topicMetadata[topic.topicId]
    if (metadata?.generatedFreshness === 'stale' || metadata?.generatedFreshness === 'needs-grounding') {
      issues.push({
        id: `grounding-${topic.topicId}`,
        title: metadata.generatedFreshness === 'needs-grounding' ? 'Topic needs grounding' : 'Topic grounding is stale',
        detail: `${topic.title} needs a provenance refresh before Review.`,
        stage: 'studio',
        topicId: topic.topicId,
        severity: 'blocker',
      })
    }
    if (!authoredTopicContent[index]) {
      issues.push({ id: `content-${topic.topicId}`, title: 'Topic needs content', detail: `${topic.title} has no authored content yet.`, stage: 'studio', topicId: topic.topicId, severity: 'blocker' })
    }
  })
  const currentRun = !!activeRun
    && activeRun.status === 'complete'
    && !!snapshotId
    && activeRun.inputSnapshotId === snapshotId
    && input.reviewModel.inputSnapshot?.snapshotId === snapshotId
  const currentRequiredOpenFindings = currentRun
    ? input.reviewModel.findings.filter(finding =>
        activeRunFindings.has(finding.findingId)
        && finding.required
        && (finding.status === 'open' || finding.status === 'in-review')
        && finding.freshness.status === 'current'
        && finding.inputSnapshotId === snapshotId)
    : []
  const currentRequiredOpenFindingCount = currentRequiredOpenFindings.length
  currentRequiredOpenFindings.forEach((finding: ReviewFinding) => {
    issues.push({
      id: `finding-${finding.findingId}`,
      title: `${finding.severity === 'critical' ? 'Critical' : 'Required'} Review finding`,
      detail: finding.rationale || finding.category,
      stage: 'quality',
      findingId: finding.findingId,
      authorTargetEligible: input.reviewFindingEligibility(finding.findingId),
      severity: 'blocker',
    })
  })
  const reviewReady = input.reviewSnapshot?.readiness === 'ready'
    && !input.isDemoMode
  const publishLogicallyReachable = reviewReady && currentRun && currentRequiredOpenFindingCount === 0
    && !needsAuthoring && !hasTopicGroundingIssues
  if (reviewReady && !currentRun && !needsAuthoring && !hasTopicGroundingIssues) {
    issues.push({
      id: 'review-run-current',
      title: 'Run a current Review',
      detail: 'The authored content is ready, but there is no completed Review run for these inputs.',
      stage: 'quality',
      severity: 'blocker',
    })
  }
  if (input.reviewSnapshot && !reviewReady) {
    input.reviewSnapshot.issues.forEach((issue, index) => {
      const workflowStage: ProjectHomeStage = issue.code.includes('analysis') ? 'analysis'
        : issue.code.includes('source') || issue.code.includes('evidence') ? 'sources'
          : issue.code.includes('toc') ? 'analysis'
            : issue.code.includes('author') || issue.code.includes('topic-content') ? 'studio'
              : 'quality'
      const stage: ProjectHomeDestination = issue.code === 'style-profile-missing' ? 'branding' : workflowStage
      const topic = issue.topicId ? input.topics.find(item => item.topicId === issue.topicId) : undefined
      issues.push({
        id: issue.code === 'style-profile-missing'
          ? 'style-profile-missing'
          : `review-input-${issue.code}-${issue.topicId ?? issue.sourceId ?? index}`,
        title: issue.code === 'author-grounding-stale' ? 'Author grounding needs attention' : issue.message,
        detail: topic ? topic.title : issue.message,
        stage,
        ...(issue.code === 'style-profile-missing' ? { destination: 'branding' as const }
          : issue.code.includes('toc') ? { destination: 'structure' as const }
            : {}),
        ...(issue.topicId ? { topicId: issue.topicId } : {}),
        severity: 'blocker',
      })
    })
  }
  if (publishLogicallyReachable && !input.publishConfig.selectedFormats.length) {
    issues.push({ id: 'publish-format', title: 'Choose an output format', detail: 'Select at least one format in Publish.', stage: 'publish', severity: 'attention' })
  }
  const openIssues = (stage: ProjectHomeStage) => issues.filter(issue => issue.stage === stage)
  const stages: Record<ProjectHomeStage, ProjectHomeStatus> = {
    sources: !input.sources.length ? 'Not started'
      : openIssues('sources').length ? 'Needs attention'
        : input.evidenceFresh ? 'Complete' : 'In progress',
    analysis: !usableSourceCount ? 'Not started'
      : openIssues('analysis').length ? 'Needs attention'
        : input.hasConceptAnalysis && input.conceptAnalysisFresh ? 'Complete' : 'In progress',
    studio: !input.topics.length ? 'Not started'
      : openIssues('studio').some(issue => issue.id.startsWith('grounding-') || issue.id.includes('author-grounding-stale')) ? 'Needs attention'
        : authoredTopicContent.every(Boolean) ? 'Complete' : 'In progress',
    quality: currentRequiredOpenFindingCount ? 'Needs attention'
      : currentRun ? needsAuthoring || hasTopicGroundingIssues ? 'In progress' : 'Complete'
        : reviewReady && !needsAuthoring && !hasTopicGroundingIssues ? 'Ready' : 'Not started',
    publish: currentRequiredOpenFindingCount ? 'Needs attention'
      : !publishLogicallyReachable ? 'Not started'
        : openIssues('publish').length ? 'Needs attention' : 'Ready',
  }

  let continueStage: ProjectHomeStage
  if (!usableSourceCount) continueStage = 'sources'
  else if (!input.evidenceFresh || !input.hasEvidenceIndex) continueStage = 'sources'
  else if (!input.hasConceptAnalysis || !input.conceptAnalysisFresh || !input.unsupportedAnalysisFresh || !input.hasUnsupportedAnalysis) continueStage = 'analysis'
  else if (input.committedTocStale || !input.topics.length) continueStage = 'analysis'
  else if (hasTopicGroundingIssues || needsAuthoring) continueStage = 'studio'
  else if (currentRun) continueStage = currentRequiredOpenFindingCount ? 'quality' : 'publish'
  else if (reviewReady) continueStage = 'quality'
  else if (openIssues('studio').length) continueStage = 'studio'
  else continueStage = 'quality'
  const analysisPrerequisitesCurrent = input.hasConceptAnalysis && input.conceptAnalysisFresh
    && input.hasUnsupportedAnalysis && input.unsupportedAnalysisFresh
  const continueDestination: ProjectHomeDestination = continueStage === 'analysis'
    && analysisPrerequisitesCurrent
    && (input.committedTocStale || !input.topics.length)
    ? 'structure'
    : continueStage
  const continueLabel = continueDestination === 'structure' ? 'Review structure'
    : continueDestination === 'analysis' && input.hasConceptAnalysis && input.conceptAnalysisFresh
      && (!input.hasUnsupportedAnalysis || !input.unsupportedAnalysisFresh)
      ? 'Refresh claim check'
      : ({
          sources: usableSourceCount ? 'Refresh the Evidence Index' : 'Add or prepare sources',
          analysis: 'Refresh analysis',
          studio: 'Continue authoring',
          quality: currentRequiredOpenFindingCount ? 'Resolve required findings' : 'Run or refresh Review',
          publish: 'Prepare publication',
          structure: 'Review structure',
          branding: 'Set Style Profile',
        } satisfies Record<ProjectHomeDestination, string>)[continueDestination]

  return {
    stages,
    issues: issues.filter((issue, index, all) => all.findIndex(candidate => candidate.id === issue.id) === index),
    continueStage,
    continueDestination,
    continueLabel,
    usableSourceCount,
    topicCount: input.topics.length,
    demoMode: false,
    demoSourceCount: 0,
    activeRun,
    recentRun,
    currentRequiredOpenFindingCount,
  }
}
