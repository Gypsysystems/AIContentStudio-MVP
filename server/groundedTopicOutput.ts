import type { EvidenceIndex, EvidenceItem } from '../src/evidenceIndex'

export type GeneratedTopicBlock = {
  id: string
  type: 'para' | 'procedure' | 'callout'
  content: string
  evidenceIds: string[]
  calloutVariant?: 'note' | 'warning'
  procedureSteps?: string[]
}

export class GroundedTopicOutputError extends Error {
  constructor() {
    super('The provider output is not a valid evidence-grounded topic draft.')
    this.name = 'GroundedTopicOutputError'
  }
}

const MAX_OUTPUT_BYTES = 48_000
const MAX_BLOCKS = 20
const MAX_CONTENT_LENGTH = 3_000
const MAX_STEP_LENGTH = 500
const MAX_STEPS = 8
const MAX_IDS_PER_BLOCK = 8
const NON_FACTUAL_TOKENS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'if', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'must', 'of', 'on',
  'or', 'our', 'should', 'the', 'their', 'them', 'then', 'there', 'these',
  'this', 'those', 'to', 'was', 'were', 'will', 'with', 'would', 'you', 'your',
])
const NEGATION_TOKENS = new Set([
  'cannot', 'cant', 'except', 'never', 'no', 'not', 'unless', 'unavailable',
  'unsupported', 'without', 'wont',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function cleanText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
}

function parse(raw: string): unknown {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_OUTPUT_BYTES)
    throw new GroundedTopicOutputError()
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new GroundedTopicOutputError()
  }
}

function normalizedToken(token: string): string {
  if (token.length > 7 && token.endsWith('ation')) return token.slice(0, -5)
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function canonicalText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/n['’]t\b/gu, ' not')
}

function tokenGroups(text: string): string[][] {
  return canonicalText(text)
    .split(/[.!?;]+/u)
    .map(sentence => sentence.split(/[^\p{L}\p{N}]+/u)
      .filter(token => token && !NON_FACTUAL_TOKENS.has(token))
      .map(normalizedToken))
    .filter(tokens => tokens.length > 0)
}

function isNegated(tokens: string[]): boolean {
  return tokens.some(token => NEGATION_TOKENS.has(token)
    || token.endsWith("n't"))
}

function isOrderedListItem(item: EvidenceItem): boolean {
  return item.orderedList === true && item.blockType === 'list-item'
}

function sentenceSupportsClaim(
  claimTokens: string[],
  claimNegated: boolean,
  evidence: string[],
): boolean {
  const claimCore = claimTokens.filter(token => !NEGATION_TOKENS.has(token) && !token.endsWith("n't"))
  if (claimCore.length === 0) return false
  let supported = false
  for (const group of evidence.flatMap(tokenGroups)) {
    const evidenceCore = group.filter(token => !NEGATION_TOKENS.has(token) && !token.endsWith("n't"))
    let cursor = 0
    const matched = claimCore.every(token => {
      const found = evidenceCore.indexOf(token, cursor)
      if (found < 0) return false
      cursor = found + 1
      return true
    })
    if (!matched) continue
    if (isNegated(group) !== claimNegated) return false
    supported = true
  }
  return supported
}

function textSupportedByEvidence(text: string, items: EvidenceItem[]): boolean {
  const claims = tokenGroups(text)
  if (claims.length === 0) return false
  const excerpts = items.map(item => item.text)
  const allTextTokens = canonicalText(text)
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(normalizedToken)
  const claimGroups = canonicalText(text)
    .split(/[.!?;]+/u)
    .map(sentence => sentence.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(normalizedToken))
    .filter(tokens => tokens.some(token => !NON_FACTUAL_TOKENS.has(token)))
  return claims.every((tokens, index) => {
    const rawTokens = claimGroups[index] ?? allTextTokens
    return sentenceSupportsClaim(tokens, isNegated(rawTokens), excerpts)
  })
}

function orderedProcedureSupported(steps: string[], items: EvidenceItem[]): boolean {
  const orderedItems = items.filter(isOrderedListItem)
  if (steps.some(step => !textSupportedByEvidence(step, orderedItems))) return false
  const orderedByGroup = new Map<string, EvidenceItem[]>()
  for (const item of orderedItems) {
    const groupKey = `${item.sourceId}\u0000${item.listLevel ?? 0}\u0000${JSON.stringify(item.sectionPath ?? [])}`
    const group = orderedByGroup.get(groupKey) ?? []
    group.push(item)
    orderedByGroup.set(groupKey, group)
  }
  return [...orderedByGroup.values()].some(group => {
    const ordered = group.sort((left, right) => left.order - right.order)
    return ordered.some((_first, start) => steps.every((step, stepIndex) => {
      const item = ordered[start + stepIndex]
      if (!item || (stepIndex > 0 && item.order !== ordered[start + stepIndex - 1].order + 1))
        return false
      return textSupportedByEvidence(step, [item])
    }))
  })
}

function validateBlock(
  value: unknown,
  index: number,
  evidenceById: Map<string, EvidenceItem>,
  packetIds: Set<string>,
): GeneratedTopicBlock {
  if (!isRecord(value) || typeof value.type !== 'string')
    throw new GroundedTopicOutputError()
  let type: GeneratedTopicBlock['type']
  let keys: string[]
  if (value.type === 'para') {
    type = 'para'
    keys = ['type', 'content', 'evidenceIds']
  } else if (value.type === 'procedure') {
    type = 'procedure'
    keys = ['type', 'content', 'steps', 'evidenceIds']
  } else if (value.type === 'callout') {
    type = 'callout'
    keys = ['type', 'content', 'calloutVariant', 'evidenceIds']
  } else {
    throw new GroundedTopicOutputError()
  }
  if (!exactKeys(value, keys)
    || !cleanText(value.content, MAX_CONTENT_LENGTH)
    || !Array.isArray(value.evidenceIds)
    || value.evidenceIds.length === 0
    || value.evidenceIds.length > MAX_IDS_PER_BLOCK
    || value.evidenceIds.some(id => typeof id !== 'string' || !packetIds.has(id))
    || new Set(value.evidenceIds).size !== value.evidenceIds.length) {
    throw new GroundedTopicOutputError()
  }
  const cited = (value.evidenceIds as string[]).map(id => evidenceById.get(id)!)
  if (cited.every(item => item.blockType === 'heading' || !item.text.trim()))
    throw new GroundedTopicOutputError()
  if (!textSupportedByEvidence(value.content as string, cited))
    throw new GroundedTopicOutputError()
  if (type === 'callout'
    && value.calloutVariant !== 'note' && value.calloutVariant !== 'warning') {
    throw new GroundedTopicOutputError()
  }
  let procedureSteps: string[] | undefined
  if (type === 'procedure') {
    if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > MAX_STEPS
      || value.steps.some(step => !cleanText(step, MAX_STEP_LENGTH))
      || !orderedProcedureSupported(value.steps as string[], cited)) {
      throw new GroundedTopicOutputError()
    }
    procedureSteps = (value.steps as string[]).map(step => step.trim())
  }
  return {
    id: `ai-topic-block-${index + 1}`,
    type,
    content: value.content.trim(),
    evidenceIds: [...value.evidenceIds as string[]],
    ...(type === 'callout' ? { calloutVariant: value.calloutVariant as 'note' | 'warning' } : {}),
    ...(procedureSteps ? { procedureSteps } : {}),
  }
}

export function validateGroundedTopicOutput(
  raw: string,
  evidenceIndex: EvidenceIndex,
  packetEvidenceIds: Set<string>,
): GeneratedTopicBlock[] {
  const parsed = parse(raw)
  if (!isRecord(parsed) || !exactKeys(parsed, ['blocks'])
    || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0
    || parsed.blocks.length > MAX_BLOCKS) {
    throw new GroundedTopicOutputError()
  }
  const evidenceById = new Map(evidenceIndex.items.map(item => [item.id, item]))
  const blocks = parsed.blocks.map((block, index) =>
    validateBlock(block, index, evidenceById, packetEvidenceIds))
  return blocks
}