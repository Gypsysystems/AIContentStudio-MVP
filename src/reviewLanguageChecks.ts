import type { ReviewInputSnapshot, ReviewInputStandard } from './reviewInput'
import type { ReviewFinding, ReviewStyleReference, ReviewSuggestionDiff } from './reviewModel'

export type LanguageCheck = {
  key: string
  category: 'Grammar' | 'Spelling' | 'Writing Style' | 'Formatting / Standards'
  topicId: string
  blockId: string
  originalText: string
  rationale: string
  severity: ReviewFinding['severity']
  styleReferences: ReviewStyleReference[]
  suggestion?: ReviewSuggestionDiff
}

type WritingRules = {
  activeVoice?: boolean
  directAddress?: boolean
  maxSentenceWords?: number
  avoidRepetition?: boolean
}
type FormattingRules = { requireTableHeader?: boolean; maxHeadingLevelJump?: number }

function rules<T>(standard: ReviewInputStandard | undefined): T | null {
  if (!standard) return null
  try {
    const value: unknown = JSON.parse(standard.value)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null
  } catch {
    return null
  }
}

function reference(snapshot: ReviewInputSnapshot, standard: ReviewInputStandard): ReviewStyleReference {
  return {
    styleProfileId: snapshot.style?.styleProfileId,
    standardId: standard.standardId,
    label: standard.label,
    value: standard.value,
    fingerprint: standard.fingerprint,
  }
}

// Only check prose. In particular, code, URLs and identifiers are not dictionary words.
function prose(type: string, content: string): boolean {
  return /^(?:para|paragraph|text)$/.test(type) && !/[`]|https?:\/\/|[_{}<>]/.test(content)
}

const SPELLINGS: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  definately: 'definitely',
  seperate: 'separate',
  occured: 'occurred',
}
export function deterministicSpellingCorrection(word: string): string | null {
  return Object.prototype.hasOwnProperty.call(SPELLINGS, word) ? SPELLINGS[word] : null
}
const DUPLICATED_FUNCTION_WORD = /\b(the|a|an|to|of|in|is|are|and|for|with)\s+\1\b/gi
const PASSIVE_WITH_AGENT = /\b(?:is|are|was|were)\s+(?:not\s+)?(?:created|generated|updated|deleted|displayed|sent|saved|selected|completed)\s+by\b/i
const THIRD_PERSON_USER = /^(?:the\s+)?users?\s+(?:can|should|must|need(?:s)? to|will)\b/i

export function languageAndStandardsChecks(snapshot: ReviewInputSnapshot): LanguageCheck[] {
  const byId = new Map(snapshot.standards.map(standard => [standard.standardId, standard]))
  const language = byId.get('language')
  const english = !!language && /^en(?:-[a-z]{2})?$/i.test(language.value) && /^en(?:-[a-z]{2})?$/i.test(snapshot.language)
  const writingStandard = byId.get('writing-rules')
  const writing = rules<WritingRules>(writingStandard)
  const formattingStandard = byId.get('formatting-rules')
  const formatting = rules<FormattingRules>(formattingStandard)
  const checks: LanguageCheck[] = []
  for (const topic of snapshot.topics) {
    let previousHeadingLevel: number | null = null
    for (const block of topic.blocks) {
      const text = block.content.trim()
      const add = (
        category: LanguageCheck['category'], rule: string, excerpt: string,
        rationale: string, standard: ReviewInputStandard, severity: LanguageCheck['severity'],
        occurrence = 0,
      ) => checks.push({
        key: `${category}:${rule}:${topic.topicId}:${block.blockId}:${occurrence}`,
        category, topicId: topic.topicId, blockId: block.blockId,
        originalText: excerpt, rationale, severity,
        styleReferences: [reference(snapshot, standard)],
      })
      if (english && prose(block.type, text) && text) {
        // Deliberately small, unambiguous patterns; not a general grammar engine or dictionary.
        const duplicate = DUPLICATED_FUNCTION_WORD.exec(text)
        DUPLICATED_FUNCTION_WORD.lastIndex = 0
        if (duplicate) add('Grammar', 'repeated-function-word', duplicate[0],
          `The function word “${duplicate[1]}” appears twice in succession.`, language!, 'warning', duplicate.index)
        for (const match of block.content.matchAll(/\b[a-z]+\b/g)) {
          const correction = deterministicSpellingCorrection(match[0])
          if (correction) {
            add('Spelling', `known-misspelling-${match[0]}`, match[0],
              `“${match[0]}” is a common misspelling of “${correction}”.`, language!, 'warning', match.index)
            checks[checks.length - 1].suggestion = {
              kind: 'replace',
              blockId: block.blockId,
              originalText: block.content,
              proposedText: block.content.slice(0, match.index) + correction + block.content.slice(match.index + match[0].length),
              range: { start: match.index, end: match.index + match[0].length },
              expectedBlockFingerprint: block.fingerprint,
              method: 'deterministic-spelling-v1',
              confidence: 'high',
              rationale: `Replace “${match[0]}” with “${correction}”.`,
            }
          }
        }
        if (writingStandard && writing) {
          const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []
          let offset = 0
          for (const sentence of sentences) {
            const trimmed = sentence.trim()
            if (trimmed && writing.activeVoice === true && PASSIVE_WITH_AGENT.test(trimmed)) {
              add('Writing Style', 'active-voice', trimmed,
                'This sentence uses a passive construction with an explicit agent; the current writing rule requests active voice.',
                writingStandard, 'suggestion', offset)
            }
            if (trimmed && writing.directAddress === true && THIRD_PERSON_USER.test(trimmed)) {
              add('Writing Style', 'direct-address', trimmed,
                'This sentence addresses users in the third person; the current writing rule requests direct address.',
                writingStandard, 'suggestion', offset)
            }
            if (trimmed && Number.isInteger(writing.maxSentenceWords)
              && writing.maxSentenceWords! >= 10 && writing.maxSentenceWords! <= 100
              && (trimmed.match(/\b[\p{L}]+\b/gu) ?? []).length > writing.maxSentenceWords!) {
              add('Writing Style', 'sentence-length', trimmed,
                `This sentence exceeds the configured ${writing.maxSentenceWords}-word limit.`,
                writingStandard, 'suggestion', offset)
            }
            offset += sentence.length
          }
          if (writing.avoidRepetition === true && sentences.length > 1) {
            for (let i = 1; i < sentences.length; i++) {
              const previous = sentences[i - 1].trim().toLowerCase()
              const current = sentences[i].trim().toLowerCase()
              if (current.length >= 25 && previous === current) add(
                'Writing Style', 'repeated-sentence', sentences[i].trim(),
                'The same sentence appears twice in succession; the current writing rule asks to avoid repetition.',
                writingStandard, 'suggestion', i)
            }
          }
        }
      }
      if (formattingStandard && formatting) {
        if (formatting.requireTableHeader === true && block.type === 'table' && block.tableHasHeader === false) {
          const excerpt = text || block.tableExcerpt
          if (excerpt) add('Formatting / Standards', 'table-header', excerpt,
            'This table has no header row, but the current formatting rule requires one.',
            formattingStandard, 'warning')
        }
        const headingLevel = /^h([1-4])$/.exec(block.type)?.[1]
        if (headingLevel) {
          const level = Number(headingLevel)
          if (Number.isInteger(formatting.maxHeadingLevelJump) && formatting.maxHeadingLevelJump! >= 1
            && formatting.maxHeadingLevelJump! <= 3 && previousHeadingLevel !== null
            && level - previousHeadingLevel > formatting.maxHeadingLevelJump!) {
            add('Formatting / Standards', 'heading-level-jump', text || block.type,
              `This heading skips ${level - previousHeadingLevel - 1} level(s); the current formatting rule allows a jump of at most ${formatting.maxHeadingLevelJump}.`,
              formattingStandard, 'warning')
          }
          previousHeadingLevel = level
        }
      }
    }
  }
  return checks
}