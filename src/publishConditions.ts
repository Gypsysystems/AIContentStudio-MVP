type ConditionalBlock = { conditions?: readonly string[] }
type ConditionalTopic = { blocks: readonly ConditionalBlock[] }

export function availableConditions(topics: readonly ConditionalTopic[]): string[] {
  return [...new Set(topics.flatMap(topic => topic.blocks.flatMap(block =>
    Array.isArray(block.conditions) ? block.conditions.filter(tag => typeof tag === 'string' && tag.trim().length > 0) : [])))]
}

export function hasConditionalBlocks(topics: readonly ConditionalTopic[]): boolean {
  return topics.some(topic => topic.blocks.some(block =>
    block.conditions !== undefined && (!Array.isArray(block.conditions) || block.conditions.length > 0)))
}

export function htmlConditionError(topics: readonly ConditionalTopic[], selectedCondition?: string): string | null {
  if (topics.some(topic => topic.blocks.some(block =>
    block.conditions !== undefined && (!Array.isArray(block.conditions)
      || block.conditions.some(tag => typeof tag !== 'string' || !tag.trim())))))
    return 'HTML export cannot safely apply malformed block conditions.'
  if (!hasConditionalBlocks(topics)) return null
  if (selectedCondition && availableConditions(topics).includes(selectedCondition)) return null
  return 'HTML export condition context is required: select a valid audience condition matching an authored condition tag before publishing conditional content.'
}

export function matchesCondition(block: ConditionalBlock, selectedCondition?: string): boolean {
  return block.conditions === undefined || Array.isArray(block.conditions)
    && (block.conditions.length === 0 || !!selectedCondition && block.conditions.includes(selectedCondition))
}