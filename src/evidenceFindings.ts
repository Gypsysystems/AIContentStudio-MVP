import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'

export type FindingEvidenceReference = {
  evidenceId: string
  sourceId: string
  fileId: string
  sourceFileName: string
  location: string
}

export type ConflictSide = {
  id: string
  label: string
  claimText: string
  evidenceIds: string[]
  evidenceRefs: FindingEvidenceReference[]
}

export type GroundedConflict = {
  id: string
  subject: string
  kind: 'polarity' | 'explicit-value'
  summary: string
  rationale: string
  sides: ConflictSide[]
  evidenceIds: string[]
  evidenceRefs: FindingEvidenceReference[]
}

export type GroundedGap = {
  id: string
  category: 'explicit-missing-information' | 'empty-section' | 'unresolved-reference' | 'incomplete-workflow' | 'insufficient-coverage'
  status: 'not-found-in-sources' | 'insufficiently-covered'
  title: string
  rationale: string
  evidenceIds: string[]
  evidenceRefs: FindingEvidenceReference[]
}

type ConceptInput = {
  label: string
  sourceCount: number
  evidenceIds: string[]
}

type Claim = {
  key: string
  subject: string
  kind: GroundedConflict['kind']
  value: string
  claimText: string
  evidence: EvidenceItem
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[“”"'`()[\]{}]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanStatement(value: string): string {
  return value.trim().replace(/^[\s•*-]+/, '').replace(/\s+/g, ' ').replace(/[.;:,]+$/, '')
}

function referenceFor(item: EvidenceItem): FindingEvidenceReference {
  return {
    evidenceId: item.id,
    sourceId: item.sourceId,
    fileId: item.fileId,
    sourceFileName: item.sourceFileName,
    location: item.location,
  }
}

function uniqueEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [])
    .map(cleanStatement)
    .filter(statement => statement.length >= 6 && statement.length <= 240)
}

function claimsFor(item: EvidenceItem): Claim[] {
  if (item.blockType === 'heading' || item.blockType === 'code') return []
  const claims: Claim[] = []

  for (const statement of sentences(item.text)) {
    const modal = statement.match(/^(.{2,80}?)\s+(must not|shall not|should not|may not|cannot|can't|must|shall|should|may|can)\s+(.{2,120})$/i)
    if (modal) {
      const subject = cleanStatement(modal[1])
      const modalValue = modal[2].toLocaleLowerCase('en-US')
      const action = cleanStatement(modal[3])
      const subjectKey = normalized(subject)
      const actionKey = normalized(action)
      if (subjectKey && actionKey) {
        claims.push({
          key: `polarity|${subjectKey}|${actionKey}`,
          subject,
          kind: 'polarity',
          value: modalValue.includes('not') || modalValue === 'cannot' || modalValue === "can't"
            ? 'prohibited'
            : 'permitted-or-required',
          claimText: statement,
          evidence: item,
        })
      }
      continue
    }

    const state = statement.match(/^(.{2,80}?)\s+(?:is|are)\s+(enabled|disabled|required|mandatory|optional|allowed|prohibited|supported|unsupported|available|unavailable)$/i)
    if (state) {
      const subject = cleanStatement(state[1])
      const stateValue = state[2].toLocaleLowerCase('en-US')
      const oppositions: Record<string, [string, string]> = {
        enabled: ['availability', 'enabled'],
        disabled: ['availability', 'disabled'],
        available: ['availability', 'enabled'],
        unavailable: ['availability', 'disabled'],
        required: ['requirement', 'required'],
        mandatory: ['requirement', 'required'],
        optional: ['requirement', 'optional'],
        allowed: ['permission', 'allowed'],
        prohibited: ['permission', 'prohibited'],
        supported: ['support', 'supported'],
        unsupported: ['support', 'unsupported'],
      }
      const [dimension, value] = oppositions[stateValue]
      const subjectKey = normalized(subject)
      if (subjectKey) {
        claims.push({
          key: `polarity|${dimension}|${subjectKey}`,
          subject,
          kind: 'polarity',
          value,
          claimText: statement,
          evidence: item,
        })
      }
      continue
    }

    const explicitValue = statement.match(/^([A-Za-z][A-Za-z0-9 _/-]{2,60}?)(?:\s+is|\s*[:=])\s+(\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|kb|mb|gb|tb|%|percent)?)$/i)
    if (explicitValue) {
      const subject = cleanStatement(explicitValue[1])
      const value = normalized(explicitValue[2])
      const subjectKey = normalized(subject)
      if (subjectKey && value) {
        claims.push({
          key: `explicit-value|${subjectKey}`,
          subject,
          kind: 'explicit-value',
          value,
          claimText: statement,
          evidence: item,
        })
      }
    }
  }

  return claims
}

function buildConflicts(evidenceIndex: EvidenceIndex): GroundedConflict[] {
  const grouped = new Map<string, Claim[]>()
  for (const item of evidenceIndex.items) {
    for (const claim of claimsFor(item)) {
      grouped.set(claim.key, [...(grouped.get(claim.key) ?? []), claim])
    }
  }

  const conflicts: GroundedConflict[] = []
  for (const [key, claims] of grouped) {
    const values = [...new Set(claims.map(claim => claim.value))].sort()
    const sourceIds = new Set(claims.map(claim => claim.evidence.fileId))
    if (values.length < 2 || sourceIds.size < 2) continue

    const valueSources = new Map(values.map(value => [
      value,
      new Set(claims.filter(claim => claim.value === value).map(claim => claim.evidence.fileId)),
    ]))
    const hasCrossSourceOpposition = values.some((left, index) =>
      values.slice(index + 1).some(right =>
        [...valueSources.get(left)!].some(sourceId => !valueSources.get(right)!.has(sourceId))
        || [...valueSources.get(right)!].some(sourceId => !valueSources.get(left)!.has(sourceId))))
    if (!hasCrossSourceOpposition) continue

    const sides: ConflictSide[] = values.map(value => {
      const sideClaims = claims.filter(claim => claim.value === value)
      const sideEvidence = uniqueEvidence(sideClaims.map(claim => claim.evidence))
      return {
        id: `side-${stableHash(`${key}|${value}`)}`,
        label: value.replace(/-/g, ' '),
        claimText: sideClaims.map(claim => claim.claimText).sort()[0],
        evidenceIds: sideEvidence.map(item => item.id),
        evidenceRefs: sideEvidence.map(referenceFor),
      }
    })
    const evidence = uniqueEvidence(claims.map(claim => claim.evidence))
    const subject = claims.map(claim => claim.subject).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]

    conflicts.push({
      id: `conflict-${stableHash(`${key}|${values.join('|')}`)}`,
      subject,
      kind: claims[0].kind,
      summary: claims[0].kind === 'explicit-value'
        ? `Sources give different explicit values for ${subject}.`
        : `Sources make opposing statements about ${subject}.`,
      rationale: `Concrete statements in ${sourceIds.size} sources use incompatible ${claims[0].kind === 'explicit-value' ? 'values' : 'positions'}: ${values.join(' versus ')}.`,
      sides,
      evidenceIds: evidence.map(item => item.id),
      evidenceRefs: evidence.map(referenceFor),
    })
  }

  return conflicts.sort((left, right) => left.subject.localeCompare(right.subject) || left.id.localeCompare(right.id))
}

function makeGap(
  signature: string,
  category: GroundedGap['category'],
  status: GroundedGap['status'],
  title: string,
  rationale: string,
  evidence: EvidenceItem[],
): GroundedGap {
  const unique = uniqueEvidence(evidence)
  return {
    id: `gap-${stableHash(signature)}`,
    category,
    status,
    title,
    rationale,
    evidenceIds: unique.map(item => item.id),
    evidenceRefs: unique.map(referenceFor),
  }
}

function buildGaps(evidenceIndex: EvidenceIndex, concepts: ConceptInput[]): GroundedGap[] {
  const gaps: GroundedGap[] = []
  const evidenceById = new Map(evidenceIndex.items.map(item => [item.id, item]))
  const headings = new Set(
    evidenceIndex.items
      .filter(item => item.blockType === 'heading')
      .map(item => normalized(item.text)),
  )

  for (const item of evidenceIndex.items) {
    if (/\b(?:tbd|todo|to be determined|to be defined|details? (?:are |is )?(?:not available|unavailable|not documented|missing)|documentation (?:is )?missing|not specified in (?:this|the) (?:document|source))\b/i.test(item.text)) {
      gaps.push(makeGap(
        `explicit|${item.id}`,
        'explicit-missing-information',
        'not-found-in-sources',
        'Source explicitly identifies missing information',
        'The source itself marks information as missing, unavailable, unspecified, or still to be defined. No missing content is inferred beyond that statement.',
        [item],
      ))
    }

    const quotedReferences = [...item.text.matchAll(/\b(?:see|refer to)\s+(?:the\s+)?(?:section\s+)?["“]([^"”]{2,60})["”]/gi)]
    const sectionReferences = [...item.text.matchAll(/\b(?:see|refer to)\s+(?:the\s+)?section\s+([A-Z][A-Za-z0-9 /_-]{2,60}?)(?:[.;,]|$)/g)]
    for (const match of [...quotedReferences, ...sectionReferences]) {
      const target = cleanStatement(match[1])
      const targetKey = normalized(target)
      if (!targetKey || headings.has(targetKey)) continue
      gaps.push(makeGap(
        `reference|${targetKey}|${item.id}`,
        'unresolved-reference',
        'not-found-in-sources',
        `Referenced topic not found: ${target}`,
        `A source explicitly points to “${target}”, but no matching source heading is present in the current Evidence Index.`,
        [item],
      ))
    }
  }

  const itemsByFile = new Map<string, EvidenceItem[]>()
  for (const item of evidenceIndex.items) {
    itemsByFile.set(item.fileId, [...(itemsByFile.get(item.fileId) ?? []), item])
  }
  for (const items of itemsByFile.values()) {
    const ordered = [...items].sort((left, right) => left.order - right.order)
    const workflowSteps = ordered.flatMap(item =>
      [...item.text.matchAll(/\bstep\s+(\d+)\b/gi)].map(match => ({
        number: Number(match[1]),
        evidence: item,
      })))
    const stepsByNumber = new Map<number, EvidenceItem[]>()
    for (const step of workflowSteps) {
      stepsByNumber.set(step.number, [...(stepsByNumber.get(step.number) ?? []), step.evidence])
    }
    const stepNumbers = [...stepsByNumber.keys()].sort((left, right) => left - right)
    if (stepNumbers.length >= 2) {
      for (let number = stepNumbers[0] + 1; number < stepNumbers[stepNumbers.length - 1]; number++) {
        if (stepsByNumber.has(number)) continue
        const previousNumber = [...stepNumbers].reverse().find(stepNumber => stepNumber < number)!
        const nextNumber = stepNumbers.find(stepNumber => stepNumber > number)!
        gaps.push(makeGap(
          `workflow-step|${ordered[0]?.fileId}|${number}`,
          'incomplete-workflow',
          'not-found-in-sources',
          `Workflow step ${number} not found in source`,
          `This source explicitly labels Step ${previousNumber} and Step ${nextNumber}, but no Step ${number} is present between them.`,
          [...(stepsByNumber.get(previousNumber) ?? []), ...(stepsByNumber.get(nextNumber) ?? [])],
        ))
      }
    }

    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index]
      if (item.blockType !== 'heading') continue
      const next = ordered[index + 1]
      if (next && next.blockType !== 'heading') continue
      gaps.push(makeGap(
        `empty-section|${item.id}`,
        'empty-section',
        'not-found-in-sources',
        `No source content under “${cleanStatement(item.text)}”`,
        'This heading is followed by another heading or the end of its source without any supporting content.',
        [item],
      ))
    }
  }

  for (const concept of concepts) {
    if (concept.sourceCount < 2) continue
    const supportingItems = concept.evidenceIds.flatMap(id => {
      const item = evidenceById.get(id)
      return item ? [item] : []
    })
    if (!supportingItems.length || supportingItems.some(item => item.blockType !== 'heading')) continue
    gaps.push(makeGap(
      `coverage|${normalized(concept.label)}`,
      'insufficient-coverage',
      'insufficiently-covered',
      `Insufficient source coverage for ${concept.label}`,
      `“${concept.label}” appears as a heading in ${concept.sourceCount} sources, but its supporting evidence contains no explanatory content.`,
      supportingItems,
    ))
  }

  const uniqueById = new Map(gaps.map(gap => [gap.id, gap]))
  return [...uniqueById.values()].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
}

export function buildEvidenceFindings(
  evidenceIndex: EvidenceIndex,
  concepts: ConceptInput[],
): { conflicts: GroundedConflict[]; gaps: GroundedGap[] } {
  return {
    conflicts: buildConflicts(evidenceIndex),
    gaps: buildGaps(evidenceIndex, concepts),
  }
}
