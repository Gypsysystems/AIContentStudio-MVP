export type AuthorSearchTopic = {
  id: number
  topicId?: string
  title: string
}

export type AuthorSearchResult = {
  topicId: string
  topicTitle: string
  blockId: string
  blockIndex: number
  field: string
  excerpt: string
  matchContext: string
  matchCount: number
}

type SearchableBlock = {
  id?: unknown
  type?: unknown
  [key: string]: unknown
}

const IGNORED_KEYS = new Set([
  'id',
  'type',
  'mediaType',
  'conditions',
  'startFresh',
  'level',
  'hasHeader',
])

function labelForField(path: string[]): string {
  const last = path[path.length - 1] ?? 'text'
  if (last === 'content') return 'block text'
  if (last === 'caption') return 'caption'
  if (last === 'text') return path.includes('listItems') ? 'list item' : 'text'
  if (last === 'procedureSteps') return 'procedure step'
  if (last === 'rows') return 'table cell'
  if (/^\d+$/.test(last)) {
    if (path.includes('procedureSteps')) return 'procedure step'
    if (path.includes('rows')) return 'table cell'
    if (path.includes('listItems')) return 'list item'
  }
  return path.slice(-2).join(' · ')
}

function collectTextFields(value: unknown, path: string[] = [], output: Array<{ field: string; text: string }> = []) {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text) output.push({ field: labelForField(path), text })
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextFields(item, [...path, String(index)], output))
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (IGNORED_KEYS.has(key)) continue
    // Data URLs and other media payloads are persisted but are not meaningful text.
    if (key === 'mediaType' || (typeof child === 'string' && child.startsWith('data:'))) continue
    collectTextFields(child, [...path, key], output)
  }
  return output
}

function excerptAround(text: string, query: string): string {
  const lowerText = text.toLocaleLowerCase()
  const index = lowerText.indexOf(query.toLocaleLowerCase())
  if (index < 0) return text.slice(0, 160)
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + query.length + 100)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function countMatches(text: string, query: string): number {
  const lowerText = text.toLocaleLowerCase()
  const lowerQuery = query.toLocaleLowerCase()
  let count = 0
  let index = 0
  while ((index = lowerText.indexOf(lowerQuery, index)) >= 0) {
    count++
    index += Math.max(lowerQuery.length, 1)
  }
  return count
}

function stableTopicId(topic: AuthorSearchTopic): string {
  return topic.topicId?.trim() || `legacy-${topic.id}`
}

/**
 * Search only the persisted topicContent associated with the central TOC.
 * The returned results contain no synthetic/demo content and do not mutate inputs.
 */
export function searchAuthorTopicContent(
  toc: AuthorSearchTopic[],
  topicContent: Record<string, unknown[]>,
  query: string,
): AuthorSearchResult[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  return toc.flatMap(topic => {
    const topicId = stableTopicId(topic)
    // Stable topic IDs are authoritative. The numeric key is retained only for
    // legacy records that predate stable topic IDs.
    const blocks = topicContent[topicId] ?? topicContent[String(topic.id)] ?? []
    return blocks.flatMap((rawBlock, blockIndex) => {
      if (!rawBlock || typeof rawBlock !== 'object') return []
      const block = rawBlock as SearchableBlock
      const blockId = typeof block.id === 'string' && block.id ? block.id : `${topicId}-block-${blockIndex}`
      return collectTextFields(block).flatMap(({ field, text }) => {
        const matchCount = countMatches(text, normalizedQuery)
        if (matchCount === 0) return []
        return [{
          topicId,
          topicTitle: topic.title,
          blockId,
          blockIndex,
          field,
          excerpt: excerptAround(text, normalizedQuery),
          matchContext: `${field} · ${String(block.type ?? 'block')} · block ${blockIndex + 1}`,
          matchCount,
        }]
      })
    })
  })
}