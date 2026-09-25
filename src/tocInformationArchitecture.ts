import type { EvidenceItem } from './evidenceIndex'

type HeadingIntent =
  | 'start' | 'navigation' | 'workflow' | 'feature' | 'search'
  | 'review' | 'export' | 'troubleshooting' | 'concept'

const ACTION_VERBS = 'sign in|log in|navigate|browse|search|find|filter|review|approve|export|download|share|publish|create|edit|configure|manage|upload|submit|run|rotate|update|install|set up|troubleshoot'

export type OrganizedHeading = {
  section: string
  sectionOrder: number
  title: string
  intent: HeadingIntent
}

function actionIn(text: string): string | null {
  // A capability must be described as something a person can do. A passive
  // mention ("is reviewed by") alone is not evidence of a user workflow.
  const match = text.match(new RegExp(
    `\\b(?:users?|operators?|administrators?|readers?)\\s+(?:(?:can|may|must|should|will)\\s+)?(${ACTION_VERBS})\\b|\\b(?:to|how to)\\s+(${ACTION_VERBS})\\b`,
    'i',
  ))
  return (match?.[1] ?? match?.[2] ?? '').toLowerCase() || null
}

function explicitTaskTitle(sectionEvidence: EvidenceItem[]): string | null {
  for (const item of sectionEvidence) {
    const match = item.text.match(new RegExp(
      `\\b(?:users?|operators?|administrators?|readers?)\\s+(?:can|may|must|should|will)\\s+((?:${ACTION_VERBS})\\b[^.!?\\n]{0,85})`,
      'i',
    ))
    if (match) {
      const task = match[1].trim().replace(/\btheir\b/gi, 'your')
      return task[0].toUpperCase() + task.slice(1)
    }
  }
  return null
}

function intentFor(heading: EvidenceItem, sectionEvidence: EvidenceItem[]): HeadingIntent {
  const label = heading.text.toLowerCase()
  const body = sectionEvidence.map(item => item.text).join(' ')
  // A technical heading such as "Export adapter" is not proof that users
  // can export. Task categories require a local user action or a how-to heading.
  const action = actionIn(body) ?? label.match(/^how to\s+(sign in|log in|navigate|browse|search|find|filter|review|approve|export|download|share|publish|create|edit|configure|manage|upload|submit|run|rotate|update|install|set up|troubleshoot)\b/)?.[1]
  if (/\b(getting started|quick start|onboard|install|setup|set up|sign[\s-]?in|log[\s-]?in|first steps?)\b/.test(label) || /^(sign in|log in|install|set up)$/.test(action ?? '')) return 'start'
  if (/\b(troubleshoot|error|problem|issue|recovery|failure)\b/.test(label) || action === 'troubleshoot') return 'troubleshooting'
  if (['search', 'find', 'filter'].includes(action ?? '')) return 'search'
  if (['export', 'download', 'publish', 'share'].includes(action ?? '')) return 'export'
  if (['review', 'approve'].includes(action ?? '')) return 'review'
  if (['navigate', 'browse'].includes(action ?? '')) return 'navigation'
  if (action) return 'workflow'
  if (/\b(feature|report|notification|integration|tool)\w*/.test(label) && body.trim()) return 'feature'
  return 'concept'
}

const USER_GUIDE_SECTIONS: Record<HeadingIntent, [string, number]> = {
  start: ['Getting started', 0],
  navigation: ['Navigate the product', 1],
  workflow: ['Complete common workflows', 2],
  feature: ['Use key features', 3],
  search: ['Search', 4],
  review: ['Review', 5],
  export: ['Export', 6],
  troubleshooting: ['Troubleshooting', 7],
  concept: ['Key concepts', 8],
}

const ADMIN_SECTIONS: Record<HeadingIntent, [string, number]> = {
  start: ['Set up the system', 0],
  navigation: ['Workspace and navigation', 1],
  workflow: ['Tasks and procedures', 2],
  feature: ['System features', 3],
  search: ['Find and inspect records', 4],
  review: ['Review and audit', 5],
  export: ['Export and distribution', 6],
  troubleshooting: ['Troubleshooting', 7],
  concept: ['Administration concepts', 8],
}

const REFERENCE_SECTIONS: Record<HeadingIntent, [string, number]> = {
  start: ['Setup reference', 0],
  navigation: ['Interface reference', 1],
  workflow: ['Operations reference', 2],
  feature: ['Feature reference', 3],
  search: ['Search reference', 4],
  review: ['Review reference', 5],
  export: ['Export reference', 6],
  troubleshooting: ['Errors and troubleshooting', 7],
  concept: ['Concept reference', 8],
}

function sectionsFor(contentType: string): Record<HeadingIntent, [string, number]> {
  const type = contentType.toLowerCase().replace(/[_\s]+/g, '-')
  if (type.includes('admin')) return ADMIN_SECTIONS
  if (type.includes('api') || type.includes('reference') || type.includes('knowledge-base')) return REFERENCE_SECTIONS
  if (type.includes('sop') || type.includes('runbook') || type.includes('playbook')) {
    return {
      ...REFERENCE_SECTIONS,
      start: ['Prerequisites and setup', 0],
      workflow: ['Procedures', 2],
      review: ['Validate and review', 5],
      troubleshooting: ['Recovery and troubleshooting', 7],
    }
  }
  if (type.includes('training') || type.includes('course')) {
    return {
      ...USER_GUIDE_SECTIONS,
      start: ['Begin learning', 0],
      workflow: ['Practice workflows', 2],
      concept: ['Learn the concepts', 8],
    }
  }
  return USER_GUIDE_SECTIONS
}

function topicTitle(heading: string, intent: HeadingIntent, contentType: string, sectionEvidence: EvidenceItem[]): string {
  const subject = heading.trim().replace(/[.:]+$/, '')
  const type = contentType.toLowerCase()
  if (type.includes('api') || type.includes('reference') || type.includes('knowledge-base')) {
    return `${subject} reference`
  }
  if (type.includes('admin')) return `About ${subject}`
  if (type.includes('sop') || type.includes('runbook') || type.includes('playbook')) return `Operational context: ${subject}`
  if (type.includes('training') || type.includes('course')) return `Learn about ${subject}`
  const supportedTask = explicitTaskTitle(sectionEvidence)
  if (supportedTask) return supportedTask
  if (intent === 'concept') return `Understand ${subject}`
  if (/^(create|edit|configure|manage|search|review|export|navigate|install|sign in|log in|upload|submit|run|rotate|update)\b/i.test(subject)) {
    return `About ${subject}`
  }
  switch (intent) {
    case 'start': return `Get started with ${subject}`
    case 'navigation': return `Navigate with ${subject}`
    case 'workflow': return `Work with ${subject}`
    case 'feature': return `Use ${subject}`
    case 'search': return `Search with ${subject}`
    case 'review': return `Review ${subject}`
    case 'export': return `Export from ${subject}`
    case 'troubleshooting': return `Troubleshoot ${subject}`
  }
}

export function organizeHeading(
  heading: EvidenceItem,
  sectionEvidence: EvidenceItem[],
  contentType: string,
): OrganizedHeading {
  const intent = intentFor(heading, sectionEvidence)
  const [defaultSection, sectionOrder] = sectionsFor(contentType)[intent]
  const type = contentType.toLowerCase().replace(/[_\s]+/g, '-')
  const body = sectionEvidence.map(item => item.text).join(' ')
  const section = !type.includes('admin') && !type.includes('api') && !type.includes('reference')
    && !type.includes('knowledge-base') && !type.includes('runbook') && !type.includes('playbook')
    && !type.includes('sop') && !type.includes('training') && !type.includes('course')
    ? intent === 'review' && (/\bapprov(?:e|al)\b/i.test(heading.text) || /\b(?:users?|operators?|administrators?)\s+(?:can|may|must|should|will)\s+(?:review\s+and\s+)?approve\b/i.test(body))
      ? 'Review and approve'
      : intent === 'export' && (/\bshare\b/i.test(heading.text) || /\b(?:users?|operators?|administrators?)\s+(?:can|may|must|should|will)\s+(?:export\s+and\s+)?share\b/i.test(body))
        ? 'Export and share'
        : defaultSection
    : defaultSection
  return { section, sectionOrder, title: topicTitle(heading.text, intent, contentType, sectionEvidence), intent }
}