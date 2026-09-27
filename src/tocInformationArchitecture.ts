import type { EvidenceItem } from './evidenceIndex'

const USER_GUIDE_BLOCKED = /\b(?:admin(?:istrator)?(?:-only)?(?: reference| guide| manual)?|test(?:ing)? scenarios?|validation scenarios?|release notes?|suggested (?:table of contents|to[c]?s?)|expected concepts?|pipeline[- ]tests?|not covered|not in scope|qa checklist)\b/i
const USER_GUIDE_ADMIN_AREA = /\b(?:administration|administrative|admin(?:istration|istrator)?(?:[- ]only)?|permissions?|roles?|tenant\s+(?:config(?:uration)?|settings?|management|polic(?:y|ies)))\b/i
const USER_GUIDE_ADMIN_ACTION = /\b(?:configure|manage|set up|change|update|edit|assign|create|add|remove|delete|grant|revoke)\b[^.!?\n]{0,55}\b(?:tenant(?:s| configuration| settings?)?|permissions?|roles?)\b|\b(?:tenant(?:s| configuration| settings?)?|permissions?|roles?)\b[^.!?\n]{0,55}\b(?:configure|manage|set up|assign|grant|revoke)\b/i
const USER_GUIDE_TASK_WORDS = /\b(?:navigate|browse|search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|notify|notification|profile|case|evidence|report|dashboard|troubleshoot|recover|sign in|log in|install|save|select|choose|click)\b/i
const USER_GUIDE_ACTION = /\b(?:you|users?|readers?)\s+(?:(?:can|may|must|should|will|need to)\s+)?(?:navigate|browse|search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|receive|configure|set up|troubleshoot|recover|sign in|log in|install|save|select|choose|click)\b|\b(?:how to|to|click|select|choose|open|enter|selecting|clicking)\s+(?:navigate|browse|search|find|filter|open|view|create|edit|update|manage|review|approve|attach|upload|add|remove|download|export|share|generate|run|complete|submit|track|receive|configure|set up|troubleshoot|recover|sign in|log in|install|save|select|choose|click)\b/i

function guideText(value: string): string {
  return value.normalize('NFKC').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Identifies user-guide content types across the labels stored by the app. */
export function isUserGuideContentType(contentType: string): boolean {
  return guideText(contentType).toLocaleLowerCase('en-US') === 'user guide'
}

/**
 * Removes common source-outline and transcript prefixes before a heading is
 * considered as a reader-facing title.
 */
export function cleanUserGuideHeading(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/^\s*\d+(?:\.\d+)*(?:[.)])?\s+(?=\D)/, '')
    .replace(/^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?[\])]?\s*(?:(?:-|–|—|to)\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?[\])]?\s*)?(?:[-–—:|]\s*)?/i, '')
    .replace(/^\s*\d+(?:\.\d+)*(?:[.)])?\s+(?=\D)/, '')
    .replace(/^\s*(?:chapter|section)\s+\d+(?:\.\d+)*[.:)]?\s*/i, '')
    .replace(/^\s*[-–—:|.)]+\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.:–—-]+|[\s.:–—-]+$/g, '')
    .trim()
}

/**
 * Scores evidence for User Guide selection. Negative values mark material that
 * should not enter a User Guide proposal; larger positive values favor
 * actionable, user-facing sources over administrative or scaffolding material.
 */
export function scoreUserGuideEvidence(item: EvidenceItem): number {
  const fileName = guideText(item.sourceFileName).toLocaleLowerCase('en-US')
  const section = (item.sectionPath ?? []).map(guideText).join(' ').toLocaleLowerCase('en-US')
  const text = guideText(item.text).toLocaleLowerCase('en-US')
  const context = `${fileName} ${section} ${text}`
  const administrativeContext = `${fileName} ${section} ${item.blockType === 'heading' ? text : ''}`
  const profileFacingContext = /\b(?:personal profile|your profile|my profile|profile preferences|profile settings|profile and notifications|notifications and profile)\b/i
    .test(`${section} ${text}`)
  const adminArea = USER_GUIDE_ADMIN_AREA.test(administrativeContext) && !profileFacingContext

  if (/\b(?:test scenario|testing scenario|qa test|pipeline test|release notes?|suggested toc|expected concepts?|not covered|not in scope)\b/i.test(context)
    || /\b(?:admin|administrator)(?:istration)?\s+(?:reference|guide|manual)\b/i.test(fileName)
    || adminArea
    || USER_GUIDE_ADMIN_ACTION.test(text)) {
    return -100
  }

  let score = 0
  if (/\b(?:walk ?through|user guide|user manual|end user|how[- ]to|training walkthrough)\b/i.test(fileName)) score += 30
  if (/\b(?:features?|capabilities|product guide|help guide)\b/i.test(fileName)) score += 24
  if (/\b(?:admin|administrator)(?:istration)?\b/i.test(fileName)) score -= 70
  if (/\b(?:test|testing|qa|validation|release|pipeline)\b/i.test(fileName)) score -= 60
  if (USER_GUIDE_BLOCKED.test(section) || USER_GUIDE_BLOCKED.test(text)) score -= 55
  if (/\b(?:admin|administrator)(?:istration)?[- ]only\b/i.test(context)) score -= 70
  if (/\b(?:navigation|search|case|evidence|report|export|notification|profile|troubleshoot|workflow|task)\b/i.test(section)) score += 8
  if (USER_GUIDE_TASK_WORDS.test(`${section} ${text}`)) score += 9
  if (USER_GUIDE_ACTION.test(text)) score += 36
  if (item.blockType === 'heading') score += 2
  if (cleanUserGuideHeading(item.text) !== item.text.trim()) score += 1
  return score
}

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