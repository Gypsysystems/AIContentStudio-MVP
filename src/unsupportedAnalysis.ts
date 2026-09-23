import type { ConceptAnalysis } from './conceptAnalysis'
import type { EvidenceIndex, EvidenceItem } from './evidenceIndex'

export const UNSUPPORTED_ANALYSIS_METHOD = 'deterministic-evidence-support-v1' as const

export type AnalyzableContentItem = {
  id: string
  text: string
  contextType: 'document-block' | 'topic-block' | 'procedure-step' | 'list-item' | 'table-cell'
  location: string
  blockId: string
  topicId?: string
}

export type UnsupportedEvidenceCandidate = {
  evidenceId: string
  sourceId: string
  fileId: string
  sourceFileName: string
  location: string
  text: string
  similarity: number
  relationship: 'near-match' | 'opposing-near-match'
}

export type UnsupportedFinding = {
  id: string
  claimText: string
  reason: string
  evidenceStatus: 'unsupported'
  context: {
    contextType: AnalyzableContentItem['contextType']
    location: string
    blockId: string
    topicId?: string
  }
  nearMatches: UnsupportedEvidenceCandidate[]
}

export type UnsupportedAnalysis = {
  version: 1
  method: typeof UNSUPPORTED_ANALYSIS_METHOD
  evidenceSourcesRevision: number
  evidenceExtractionRevision: string
  groundedAnalysisBuiltAt: number
  contentRevision: number
  contentFingerprint: string
  builtAt: number
  status: 'complete' | 'no-analyzable-content'
  analyzedClaimCount: number
  supportedClaimCount: number
  findings: UnsupportedFinding[]
}

type Proposition = {
  tokens: Set<string>
  negated: boolean
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for', 'from',
  'has', 'have', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'will', 'with', 'would', 'should', 'must', 'may',
  'can', 'could', 'needs', 'need', 'required', 'requires',
])

const TOKEN_ALIASES: Record<string, string> = {
  activated: 'enable',
  activate: 'enable',
  enabled: 'enable',
  enabling: 'enable',
  turnedon: 'enable',
  admins: 'administrator',
  administrators: 'administrator',
  logging: 'log',
  logs: 'log',
  prior: 'before',
  users: 'user',
  workspaces: 'workspace',
  projects: 'project',
  records: 'record',
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\b(?:turned|turn)\s+on\b/g, ' turnedon ')
    .replace(/\bprior\s+to\b/g, ' before ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stemToken(token: string): string {
  const aliased = TOKEN_ALIASES[token]
  if (aliased) return aliased
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 5 && token.endsWith('ing')) {
    const stem = token.slice(0, -3)
    return stem.endsWith(stem.slice(-1).repeat(2)) ? stem.slice(0, -1) : stem
  }
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function proposition(value: string): Proposition {
  const normalized = normalizedText(value)
  const negated = /\b(?:not|never|cannot|cant|without|disabled|prohibited|unsupported|unavailable)\b/.test(normalized)
  const tokens = new Set(
    normalized
      .split(' ')
      .filter(token => token.length > 1 && !STOP_WORDS.has(token) && !['not', 'never', 'cannot', 'cant', 'without'].includes(token))
      .map(stemToken)
      .filter(token => token.length > 1),
  )
  return { tokens, negated }
}

function similarity(left: Proposition, right: Proposition): number {
  if (!left.tokens.size || !right.tokens.size) return 0
  const intersection = [...left.tokens].filter(token => right.tokens.has(token)).length
  const claimCoverage = intersection / left.tokens.size
  const union = new Set([...left.tokens, ...right.tokens]).size
  const jaccard = union ? intersection / union : 0
  return Math.min(1, claimCoverage * 0.8 + jaccard * 0.2)
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [])
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(value => value.length >= 12 && proposition(value).tokens.size >= 2)
}

function glossaryAliases(analysis: ConceptAnalysis): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const term of analysis.terminology) {
    const canonical = normalizedText(term.normalizedLabel)
    for (const exact of term.exactTerms) {
      aliases.set(normalizedText(exact), canonical)
    }
  }
  return aliases
}

function applyGlossary(value: string, aliases: Map<string, string>): string {
  let normalized = normalizedText(value)
  for (const [alias, canonical] of [...aliases.entries()].sort(([left], [right]) => right.length - left.length)) {
    if (alias === canonical || alias.length < 3) continue
    normalized = normalized.replace(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), canonical)
  }
  return normalized
}

function candidateFor(
  item: EvidenceItem,
  score: number,
  opposing: boolean,
): UnsupportedEvidenceCandidate {
  return {
    evidenceId: item.id,
    sourceId: item.sourceId,
    fileId: item.fileId,
    sourceFileName: item.sourceFileName,
    location: item.location,
    text: item.text,
    similarity: Math.round(score * 100) / 100,
    relationship: opposing ? 'opposing-near-match' : 'near-match',
  }
}

export function getUnsupportedContentFingerprint(items: AnalyzableContentItem[]): string {
  const payload = [...items]
    .sort((left, right) => left.id.localeCompare(right.id) || left.location.localeCompare(right.location))
    .map(item => ({
      id: item.id,
      text: item.text,
      contextType: item.contextType,
      location: item.location,
      blockId: item.blockId,
      topicId: item.topicId ?? null,
    }))
  return `content-${stableHash(JSON.stringify(payload))}`
}

export function buildUnsupportedAnalysis(
  evidenceIndex: EvidenceIndex,
  groundedAnalysis: ConceptAnalysis,
  contentRevision: number,
  contentItems: AnalyzableContentItem[],
): UnsupportedAnalysis {
  const aliases = glossaryAliases(groundedAnalysis)
  const evidencePropositions = evidenceIndex.items
    .filter(item => item.blockType !== 'heading' && item.blockType !== 'code')
    .flatMap(item => sentences(item.text).map(text => ({
      item,
      proposition: proposition(applyGlossary(text, aliases)),
    })))
  const claims = contentItems.flatMap(item =>
    sentences(item.text).map(claimText => ({
      item,
      claimText,
      proposition: proposition(applyGlossary(claimText, aliases)),
    })))
  const findings: UnsupportedFinding[] = []
  let supportedClaimCount = 0

  for (const claim of claims) {
    const ranked = evidencePropositions
      .map(candidate => ({
        ...candidate,
        score: similarity(claim.proposition, candidate.proposition),
        opposing: claim.proposition.negated !== candidate.proposition.negated,
      }))
      .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))

    const supported = ranked.some(candidate =>
      candidate.score >= 0.72
      && !candidate.opposing
      && [...claim.proposition.tokens].filter(token => candidate.proposition.tokens.has(token)).length >= 2)
    if (supported) {
      supportedClaimCount++
      continue
    }

    const nearMatches = ranked
      .filter(candidate => candidate.score >= 0.32)
      .filter((candidate, index, all) => all.findIndex(entry => entry.item.id === candidate.item.id) === index)
      .slice(0, 3)
      .map(candidate => candidateFor(candidate.item, candidate.score, candidate.opposing))
    const hasOpposingCandidate = nearMatches.some(candidate => candidate.relationship === 'opposing-near-match')
    const reason = hasOpposingCandidate
      ? 'No current evidence supports this proposition. A near-match uses opposing language and is shown only as a candidate, not as support.'
      : nearMatches.length
        ? 'No current evidence supports the same proposition. Related evidence candidates share terminology but do not meet the support threshold.'
        : 'No current Evidence Index item supports the same proposition, and no reliable near-match candidate was found.'

    findings.push({
      id: `unsupported-${stableHash(`${claim.item.id}|${normalizedText(claim.claimText)}`)}`,
      claimText: claim.claimText,
      reason,
      evidenceStatus: 'unsupported',
      context: {
        contextType: claim.item.contextType,
        location: claim.item.location,
        blockId: claim.item.blockId,
        topicId: claim.item.topicId,
      },
      nearMatches,
    })
  }

  return {
    version: 1,
    method: UNSUPPORTED_ANALYSIS_METHOD,
    evidenceSourcesRevision: evidenceIndex.sourcesRevision,
    evidenceExtractionRevision: evidenceIndex.extractionRevision,
    groundedAnalysisBuiltAt: groundedAnalysis.builtAt,
    contentRevision,
    contentFingerprint: getUnsupportedContentFingerprint(contentItems),
    builtAt: Date.now(),
    status: claims.length ? 'complete' : 'no-analyzable-content',
    analyzedClaimCount: claims.length,
    supportedClaimCount,
    findings: findings.sort((left, right) =>
      left.context.location.localeCompare(right.context.location)
      || left.claimText.localeCompare(right.claimText)),
  }
}

export function isUnsupportedAnalysisFresh(
  analysis: UnsupportedAnalysis | null,
  evidenceIndex: EvidenceIndex | null,
  groundedAnalysis: ConceptAnalysis | null,
  contentRevision: number,
  contentItems: AnalyzableContentItem[],
): boolean {
  return !!analysis
    && !!evidenceIndex
    && !!groundedAnalysis
    && analysis.evidenceSourcesRevision === evidenceIndex.sourcesRevision
    && analysis.evidenceExtractionRevision === evidenceIndex.extractionRevision
    && analysis.groundedAnalysisBuiltAt === groundedAnalysis.builtAt
    && analysis.contentRevision === contentRevision
    && analysis.contentFingerprint === getUnsupportedContentFingerprint(contentItems)
}

export function remapUnsupportedAnalysis(
  analysis: UnsupportedAnalysis | null,
  fileIdMap: Record<string, string>,
  remappedEvidenceIndex: EvidenceIndex | null,
  wasEvidenceFresh: boolean,
): UnsupportedAnalysis | null {
  if (!analysis) return null
  const evidenceById = new Map((remappedEvidenceIndex?.items ?? []).map(item => [item.id, item]))
  const findings = analysis.findings.map(finding => ({
    ...finding,
    context: { ...finding.context },
    nearMatches: finding.nearMatches.flatMap(candidate => {
      const copiedEvidence = evidenceById.get(candidate.evidenceId)
      if (copiedEvidence) {
        return [{
          ...candidate,
          sourceId: copiedEvidence.sourceId,
          fileId: copiedEvidence.fileId,
          sourceFileName: copiedEvidence.sourceFileName,
          location: copiedEvidence.location,
          text: copiedEvidence.text,
        }]
      }
      const copiedFileId = fileIdMap[candidate.fileId] ?? fileIdMap[candidate.sourceId]
      return copiedFileId ? [{ ...candidate, sourceId: copiedFileId, fileId: copiedFileId }] : []
    }),
  }))
  return {
    ...analysis,
    findings,
    evidenceSourcesRevision: wasEvidenceFresh && remappedEvidenceIndex
      ? remappedEvidenceIndex.sourcesRevision
      : analysis.evidenceSourcesRevision,
    evidenceExtractionRevision: wasEvidenceFresh && remappedEvidenceIndex
      ? remappedEvidenceIndex.extractionRevision
      : analysis.evidenceExtractionRevision,
  }
}