import { stableAuthorTopicId } from './authorMetadata'

export type PublishBlock = {
  id: string
  type: string
  content: string
  conditions?: string[]
  caption?: string
  mediaType?: string
  listItems?: Array<{ text: string }>
  procedureSteps?: string[]
  tableData?: { rows: string[][] }
}

type NamedEntity = { id: string; name: string }
type LayoutEntity = NamedEntity & { layoutType: string }
type MasterEntity = NamedEntity & { masterType: string }

export type PublishVariableWarning = {
  name: string
  topicId: string
  blockId?: string
  field: string
}

export type PublishProjection<
  Block extends PublishBlock,
  Style extends NamedEntity,
  Brand extends NamedEntity,
  Layout extends LayoutEntity,
  Master extends MasterEntity,
  Pack extends NamedEntity,
> = {
  projectName: string
  theme: NamedEntity | null
  styleProfile: Style
  legacyBrandProfile: Brand | null
  templatePack: Pack | null
  variables: Array<{ name: string; value: string }>
  pageLayouts: Layout[]
  coverLayout: Layout | null
  contentLayout: Layout | null
  htmlMasters: Master[]
  homeMaster: Master | null
  defaultTopicMaster: Master | null
  topics: Array<{
    topicId: string
    legacyId: number
    title: string
    level: number
    blocks: Block[]
    assignedMasterId: string | null
    assignedMaster: Master | null
  }>
  unresolvedVariables: PublishVariableWarning[]
}

export function buildPublishProjection<
  Block extends PublishBlock,
  Style extends NamedEntity,
  Brand extends NamedEntity,
  Layout extends LayoutEntity,
  Master extends MasterEntity,
  Pack extends NamedEntity,
>({
  projectName,
  topics,
  topicContent,
  masterAssignments,
  variables,
  theme,
  styleProfile,
  legacyBrandProfile,
  templatePack,
  pageLayouts,
  htmlMasters,
}: {
  projectName: string
  topics: Array<{ id: number; topicId?: string; title: string; level: number }>
  topicContent: Record<string, Block[]>
  masterAssignments: Record<number, string>
  variables: Array<{ name: string; value: string }>
  theme: NamedEntity | null
  styleProfile: Style
  legacyBrandProfile: Brand | null
  templatePack: Pack | null
  pageLayouts: Layout[]
  htmlMasters: Master[]
}): PublishProjection<Block, Style, Brand, Layout, Master, Pack> {
  const variableValues = new Map(variables.map(variable => [variable.name, variable.value]))
  const unresolvedVariables: PublishVariableWarning[] = []
  const seenWarnings = new Set<string>()
  const token = /\{\{\s*([^{}]+?)\s*\}\}/g

  const resolveText = (text: string, topicId: string, field: string, blockId?: string, visiting: ReadonlySet<string> = new Set()): string =>
    text.replace(token, (placeholder, rawName: string) => {
      const name = rawName.trim()
      if (!variableValues.has(name) || visiting.has(name)) {
        const key = JSON.stringify([topicId, blockId, field, name])
        if (!seenWarnings.has(key)) {
          seenWarnings.add(key)
          unresolvedVariables.push({ name, topicId, ...(blockId ? { blockId } : {}), field })
        }
        return placeholder
      }
      return resolveText(variableValues.get(name)!, topicId, field, blockId, new Set([...visiting, name]))
    })

  const resolvedLayouts = structuredClone(pageLayouts)
  const resolvedMasters = structuredClone(htmlMasters)
  const resolvedTopics = topics.map(topic => {
    const topicId = stableAuthorTopicId(topic)
    // The stable key always wins. Only older projects use numeric keys.
    const authoredBlocks = topicContent[topicId] ?? topicContent[String(topic.id)] ?? []
    const assignedMasterId = masterAssignments[topic.id] ?? null
    return {
      topicId,
      legacyId: topic.id,
      title: resolveText(topic.title, topicId, 'title'),
      level: topic.level,
      blocks: authoredBlocks.map(block => ({
        ...structuredClone(block),
        content: resolveText(block.content ?? '', topicId, 'content', block.id),
        ...(block.caption !== undefined ? { caption: resolveText(block.caption, topicId, 'caption', block.id) } : {}),
        ...(block.listItems ? { listItems: block.listItems.map((item, index) => ({
          ...structuredClone(item),
          text: resolveText(item.text, topicId, `listItems[${index}].text`, block.id),
        })) } : {}),
        ...(block.procedureSteps ? { procedureSteps: block.procedureSteps.map((step, index) =>
          resolveText(step, topicId, `procedureSteps[${index}]`, block.id)) } : {}),
        ...(block.tableData ? { tableData: {
          ...structuredClone(block.tableData),
          rows: block.tableData.rows.map((row, rowIndex) => row.map((cell, columnIndex) =>
            resolveText(cell, topicId, `tableData.rows[${rowIndex}][${columnIndex}]`, block.id))),
        } } : {}),
      }) as Block),
      assignedMasterId,
      assignedMaster: assignedMasterId
        ? resolvedMasters.find(master => master.id === assignedMasterId) ?? null
        : null,
    }
  })

  return {
    projectName,
    theme: theme ? { id: theme.id, name: theme.name } : null,
    styleProfile: structuredClone(styleProfile),
    legacyBrandProfile: legacyBrandProfile ? structuredClone(legacyBrandProfile) : null,
    templatePack: templatePack ? structuredClone(templatePack) : null,
    variables: variables.map(({ name, value }) => ({ name, value })),
    pageLayouts: resolvedLayouts,
    coverLayout: resolvedLayouts.find(layout => layout.layoutType === 'cover') ?? resolvedLayouts[0] ?? null,
    contentLayout: resolvedLayouts.find(layout => layout.layoutType === 'content') ?? resolvedLayouts[1] ?? null,
    htmlMasters: resolvedMasters,
    homeMaster: resolvedMasters.find(master => master.masterType === 'home') ?? resolvedMasters[0] ?? null,
    defaultTopicMaster: resolvedMasters.find(master => master.masterType === 'topic') ?? resolvedMasters[1] ?? null,
    topics: resolvedTopics,
    unresolvedVariables,
  }
}

// Adapter for the existing flat-block renderers. A synthetic heading ensures an
// empty topic remains in the export; the projection itself never invents blocks.
export function flattenPublishBlocks<Block extends PublishBlock>(
  projection: Pick<PublishProjection<Block, NamedEntity, NamedEntity, LayoutEntity, MasterEntity, NamedEntity>, 'topics'>,
): Block[] {
  return projection.topics.flatMap(topic => {
    const [first, ...rest] = topic.blocks
    if (first?.type === 'h1') return [{ ...first, content: topic.title }, ...rest]
    return [
      { id: `publish-heading-${topic.topicId}`, type: 'h1', content: topic.title } as Block,
      ...topic.blocks,
    ]
  })
}