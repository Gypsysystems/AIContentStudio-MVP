import { Fragment, type CSSProperties, type ReactNode } from 'react'
import type { StyleProfile } from './App'
import type { PublishBlock, PublishProjection } from './publishProjection'

type Block = Omit<PublishBlock, 'listItems' | 'tableData'> & {
  conditions?: string[]
  calloutVariant?: string
  tableData?: { rows: string[][]; hasHeader?: boolean }
  listItems?: Array<{ text: string; level?: number; type?: 'bullet' | 'ordered'; startFresh?: boolean }>
}
type Layout = {
  id: string; name: string; layoutType: string; pageSize?: 'A4' | 'Letter'
  orientation?: 'portrait' | 'landscape'; marginTop?: number; marginBottom?: number
  marginLeft?: number; marginRight?: number; bgColor?: string
  brandOverrides?: { bgColor?: string }
}
type Master = {
  id: string; name: string; masterType: string
  showHeader?: boolean; showLogo?: boolean; showBreadcrumb?: boolean; showLeftNav?: boolean
  showOnThisPage?: boolean; showPrevNext?: boolean; showFooter?: boolean; showHero?: boolean; navWidth?: number
  contentWidth?: number; blocks?: Array<{ id: string; type: string; props?: Record<string, unknown> }>
}
type Projection = PublishProjection<Block, StyleProfile, { id: string; name: string },
  Layout, Master, { id: string; name: string }>
type Topic = Projection['topics'][number]
type Role = StyleProfile['body']

const rasterData = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/i
const reference = /(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#topic-[\w-]+)/g
const roleStyle = (role: Role, font: string, color: string): CSSProperties => ({
  fontFamily: `${font}, sans-serif`, fontSize: `${role.fontSize}pt`,
  fontWeight: role.fontWeight, color, lineHeight: role.lineHeight,
  marginTop: `${role.spaceBefore}pt`, marginBottom: `${role.spaceAfter}pt`,
  textAlign: role.alignment, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
})
const family = (profile: StyleProfile, role: Role, key: string) =>
  profile.fontInherit?.[key as keyof NonNullable<StyleProfile['fontInherit']>] === false
    ? role.fontFamily : key === 'code' ? profile.codeFont ?? role.fontFamily
      : key.startsWith('h') ? profile.headingFont ?? profile.primaryFont ?? role.fontFamily
        : profile.bodyFont ?? profile.primaryFont ?? role.fontFamily

function linkedText(text: string, topics: Topic[], linkColor: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(reference)) {
    const index = match.index
    parts.push(text.slice(last, index))
    const value = match[0].replace(/[.,;!?)]*$/, '')
    const trailing = match[0].slice(value.length)
    const destination = value.startsWith('#topic-')
      ? topics.find(topic => topic.topicId === value.slice(7) || String(topic.legacyId) === value.slice(7))
      : null
    if (value.startsWith('#topic-') && !destination) parts.push(value)
    else parts.push(<a key={`${index}-${value}`} href={destination ? `#preview-topic-${destination.topicId}` : value}
      style={{ color: linkColor, textDecoration: 'underline' }}
      {...(destination ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{value}</a>)
    parts.push(trailing)
    last = index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

function PreviewBlock({ block, profile, topics }: { block: Block; profile: StyleProfile; topics: Topic[] }) {
  const text = block.content ?? ''
  const body = (extra?: CSSProperties): CSSProperties => ({
    ...roleStyle(profile.body, family(profile, profile.body, 'body'), profile.bodyTextColor ?? profile.body.color),
    ...extra,
  })
  const linked = (value: string) => linkedText(value, topics, profile.linkColor ?? profile.links.color)
  if (block.conditions?.length) return <p className="text-amber-800 text-sm" data-testid="preview-condition-warning">
    Conditional block not shown: the full-project snapshot has no selected audience.
  </p>
  if (['h1', 'h2', 'h3', 'h4'].includes(block.type)) {
    const key = block.type as 'h1' | 'h2' | 'h3' | 'h4'
    const role = profile[key]
    return <h3 style={roleStyle(role, family(profile, role, key), profile.headingTextColor ?? role.color)}>{linked(text)}</h3>
  }
  if (block.type === 'para' || block.type === 'variable' || block.type === 'bookmark')
    return text ? <p style={body()}>{linked(text)}</p> : null
  if (block.type === 'caption') return <p style={roleStyle(profile.caption, family(profile, profile.caption, 'caption'), profile.caption.color)}>{linked(text)}</p>
  if (block.type === 'quote') return <blockquote style={body({ paddingLeft: 16, borderLeft: `3px solid ${profile.accentColor ?? profile.primaryColor}` })}>{linked(text)}</blockquote>
  if (block.type === 'code') return <pre style={{
    ...roleStyle(profile.code, family(profile, profile.code, 'code'), profile.code.color),
    padding: 12, backgroundColor: profile.surfaceColor ?? '#F4F2EE', whiteSpace: 'pre-wrap',
  }}><code>{text}</code></pre>
  if (block.type === 'divider') return <hr style={{ borderColor: profile.borderColorToken ?? profile.tables.borderColor, margin: '16px 0' }} />
  if (block.type === 'callout') {
    const kind = block.calloutVariant as keyof StyleProfile['callouts']
    const tokens = profile.callouts[kind] ?? profile.callouts.note
    return <aside style={body({ borderLeft: `4px solid ${tokens.accentColor}`, backgroundColor: tokens.bgColor,
      color: tokens.textColor, padding: 12 })}><strong>{tokens.label}: </strong>{linked(text)}</aside>
  }
  if (block.type === 'list') {
    const counters = [0, 0, 0]
    return <div role="list" style={body()}>{(block.listItems ?? []).map((item, index) => {
      const level = Math.min(2, Math.max(0, (item.level ?? 1) - 1))
      if (item.type === 'ordered') counters[level] = item.startFresh ? 1 : counters[level] + 1
      const marker = item.type === 'ordered' ? `${counters[level]}.`
        : [profile.lists.bulletL1, profile.lists.bulletL2, profile.lists.bulletL3][level]
      return <div role="listitem" key={index} style={{ paddingLeft: 8 + level * profile.lists.indentation,
        marginBottom: profile.lists.itemSpacing }}><span aria-hidden="true">{marker} </span>{linked(item.text)}</div>
    })}</div>
  }
  if (block.type === 'procedure') return <section style={body()}>
    {text && <p style={{ fontWeight: 600 }}>{linked(text)}</p>}
    <ol style={{ listStyle: 'decimal', paddingLeft: 28 }}>{(block.procedureSteps ?? []).map((step, index) =>
      <li key={index}>{linked(step)}</li>)}</ol>
  </section>
  if (block.type === 'table') return <div style={{ overflowX: 'auto', margin: '14px 0' }}>
    <table style={{ borderCollapse: 'collapse', width: '100%', ...body() }}>
      <tbody>{(block.tableData?.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}
        style={{ backgroundColor: block.tableData?.hasHeader && rowIndex === 0
          ? profile.tableHeaderBgToken ?? profile.tables.headerBgColor
          : profile.tables.alternateRows && rowIndex % 2 ? profile.tables.alternateRowColor : undefined }}>
        {row.map((cell, index) => {
          const Cell = block.tableData?.hasHeader && rowIndex === 0 ? 'th' : 'td'
          return <Cell key={index} style={{ border: `${profile.tables.borderWidth}px solid ${profile.tables.borderColor}`,
            padding: profile.tables.cellPadding,
            color: block.tableData?.hasHeader && rowIndex === 0
              ? profile.tables.headerTextColor : profile.tables.bodyTextColor,
            textAlign: 'left' }}>{linked(cell)}</Cell>
        })}
      </tr>)}</tbody>
    </table>
  </div>
  if (block.type === 'media') return <figure style={{ margin: '16px 0' }}>
    {block.mediaType && rasterData.test(block.mediaType)
      ? <img src={block.mediaType} alt={block.caption || text || 'Authored image'}
        style={{ display: 'block', maxWidth: '100%', maxHeight: 600, objectFit: 'contain' }} />
      : <p className="text-amber-800 text-sm" data-testid="preview-media-warning">
        Media asset unavailable in the project snapshot; no image is shown.
      </p>}
    {block.caption && <figcaption style={roleStyle(profile.caption, family(profile, profile.caption, 'caption'), profile.caption.color)}>{linked(block.caption)}</figcaption>}
  </figure>
  return text ? <p style={body()}>{linked(text)}</p> : null
}

export function ProjectPreview({ projection }: { projection: Projection }) {
  const { styleProfile: profile, topics } = projection
  const layout = projection.contentLayout
  const cover = projection.coverLayout?.layoutType === 'cover' ? projection.coverLayout : null
  const primary = profile.primaryColor ?? '#5B5BD6'
  const paper = layout?.brandOverrides
    ? layout.brandOverrides.bgColor ?? profile.bgColor ?? layout.bgColor ?? '#FFFFFF'
    : layout?.bgColor ?? profile.bgColor ?? '#FFFFFF'
  const coverColor = cover?.brandOverrides
    ? cover.brandOverrides.bgColor ?? profile.primaryColor ?? cover.bgColor ?? primary
    : cover?.bgColor ?? primary
  const width = layout?.pageSize === 'Letter' ? 216 : 210
  const height = layout?.pageSize === 'Letter' ? 279 : 297
  const landscape = layout?.orientation === 'landscape'
  const warnings = projection.unresolvedVariables
  const imageLogo = profile.logoDataUrl && rasterData.test(profile.logoDataUrl) ? profile.logoDataUrl : null
  const conditionalTopics = topics.map(topic => ({
    topic,
    count: topic.blocks.filter(block => block.conditions?.length).length,
  })).filter(entry => entry.count > 0)
  return <div data-testid="project-preview" className="flex-1 min-w-0 overflow-auto bg-[#F4F2EE] p-5 md:p-8">
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="bg-white border border-[#E2DED7] rounded-xl p-4 text-sm text-[#3D3D4E]">
        <strong>Full-project document preview</strong> · {topics.length} committed {topics.length === 1 ? 'topic' : 'topics'}
        <p className="text-xs text-[#6B6B7E] mt-1">Uses the publish snapshot. Screen layout is indicative:
          PDF uses fixed pages and bundled fonts; Word can reflow; HTML uses responsive master pages.
          Assigned HTML topic-master components follow their saved order; without saved blocks the order is Header, Breadcrumb, Body,
          Previous/Next, Footer. Unsupported master components are identified rather than simulated. This view does not calculate
          exported page numbers or simulate search, home cards, or missing assets.</p>
        <p className="text-xs text-[#6B6B7E] mt-1">Style: {profile.name} · Content layout: {layout?.name ?? 'None'}
          {layout && ` · ${layout.pageSize ?? 'A4'} ${layout.orientation ?? 'portrait'} · ${layout.marginLeft ?? 20}/${layout.marginRight ?? 20}mm side margins`}</p>
      </div>
      {conditionalTopics.length > 0 && <div role="alert" data-testid="preview-conditional-export-warning"
        className="bg-red-50 border border-red-300 text-red-950 rounded-xl p-4 text-sm">
        <strong>Conditional content is not audience-filtered for publishing.</strong>
        <p className="mt-1">The preview masks these blocks because no audience is selected. HTML export would include them unfiltered;
          Word and PDF reject conditional blocks. Review the listed topics before publishing—this preview does not make the HTML output safe.</p>
        <ul className="list-disc pl-5 mt-2">{conditionalTopics.map(({ topic, count }) =>
          <li key={topic.topicId}>{topic.title} ({count} conditional {count === 1 ? 'block' : 'blocks'})</li>)}</ul>
      </div>}
      {warnings.length > 0 && <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
        <strong>Unresolved variables</strong>
        <ul className="list-disc pl-5 mt-1">{warnings.map((warning, index) =>
          <li key={`${warning.topicId}-${warning.blockId}-${warning.field}-${warning.name}-${index}`}>
            {`{{${warning.name}}}`} · {topics.find(topic => topic.topicId === warning.topicId)?.title ?? warning.topicId} · {warning.field}
          </li>)}</ul>
      </div>}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <nav aria-label="Committed table of contents" className="bg-white rounded-xl border border-[#E2DED7] p-4 w-full lg:w-56 shrink-0 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold mb-2">Table of Contents</h2>
          {!topics.length && <p className="text-sm text-[#6B6B7E]">No committed topics yet.</p>}
          {topics.map(topic => <a key={topic.topicId} data-topic-id={topic.topicId}
            href={`#preview-topic-${topic.topicId}`}
            className="block py-1 text-sm hover:underline" style={{ paddingLeft: Math.max(0, topic.level - 1) * 12,
              color: profile.linkColor ?? profile.links.color }}>{topic.title}</a>)}
        </nav>
        <main className="min-w-0 flex-1 space-y-5">
          {cover && <section aria-label="Cover layout" data-layout-id={cover.id}
            className="rounded-xl shadow-sm border border-[#E2DED7] flex flex-col justify-center"
            style={{ backgroundColor: coverColor, minHeight: 180, padding: `${cover.marginTop ?? 20}mm ${cover.marginLeft ?? 20}mm` }}>
            {imageLogo && <img src={imageLogo} alt={profile.logoLabel || 'Brand logo'} style={{ maxWidth: 100, maxHeight: 40, objectFit: 'contain' }} />}
            <h1 style={roleStyle(profile.h1, family(profile, profile.h1, 'h1'), '#FFFFFF')}>{projection.projectName}</h1>
          </section>}
          {!topics.length && <div className="bg-white rounded-xl p-8 text-sm text-[#6B6B7E]">There is no committed content to preview.</div>}
          {topics.map((topic, index) => {
            const master = topic.assignedMasterId ? topic.assignedMaster : projection.defaultTopicMaster
            const defaultMasterBlocks: NonNullable<Master['blocks']> = [
              { id: 'header', type: 'header' }, { id: 'breadcrumb', type: 'breadcrumb' },
              { id: 'body', type: 'body' }, { id: 'prevnext', type: 'prevnext' }, { id: 'footer', type: 'footer' },
            ]
            const masterBlocks = master?.blocks ?? defaultMasterBlocks
            const bodyBlock = masterBlocks.find(block => block.type === 'body')
            const bodyHidden = bodyBlock?.props?.hidden === true
            const bodyMissing = !bodyBlock
            const role = profile[`h${Math.min(4, Math.max(1, Math.round(topic.level)))}` as 'h1' | 'h2' | 'h3' | 'h4']
            const blocks = topic.blocks[0]?.type === 'h1' ? topic.blocks.slice(1) : topic.blocks
            const headings = blocks.filter(block => /^h[1-4]$/.test(block.type) && !block.conditions?.length)
            const next = topics[index + 1]
            const prev = topics[index - 1]
            const bodyContent = <div className="flex gap-4">
              {master?.showLeftNav && <aside className="hidden md:block shrink-0 text-xs border-r pr-3"
                style={{ width: Math.min(master.navWidth ?? 180, 220), borderColor: profile.borderColorToken ?? '#E2DED7' }}>
                {topics.map(item => <a key={item.topicId} className="block py-1"
                  href={`#preview-topic-${item.topicId}`} style={{ color: profile.linkColor ?? primary }}>{item.title}</a>)}
              </aside>}
              <div className="min-w-0 flex-1" style={{ maxWidth: master?.contentWidth || undefined }}>
                <h2 style={roleStyle(role, family(profile, role, `h${Math.min(4, Math.max(1, Math.round(topic.level)))}`),
                  profile.headingTextColor ?? role.color)}>{topic.title}</h2>
                {blocks.length ? blocks.map(block => <div key={block.id} id={`preview-block-${topic.topicId}-${block.id}`}>
                  <PreviewBlock block={block} profile={profile} topics={topics} />
                </div>)
                  : <p className="text-sm italic text-[#6B6B7E]">Needs Grounding — no content authored for this topic.</p>}
              </div>
              {master?.showOnThisPage && headings.length > 0 && <aside className="hidden xl:block shrink-0 w-32 text-xs">
                <strong>On this topic</strong>
                {headings.map(heading => <a key={heading.id} className="block py-1"
                  href={`#preview-block-${topic.topicId}-${heading.id}`}
                  style={{ color: profile.linkColor ?? primary }}>{heading.content}</a>)}
              </aside>}
            </div>
            const masterColor = (value: unknown, fallback: string) =>
              typeof value === 'string' && /^#[\da-f]{3,8}$/i.test(value) ? value : fallback
            const masterText = (props: Record<string, unknown>, key: string, fallback = '') =>
              typeof props[key] === 'string' ? props[key] as string : fallback
            const supportedMasterTypes = new Set([
              'header', 'breadcrumb', 'body', 'prevnext', 'previous-/-next', 'footer',
              'heading', 'rich-text', 'announcement-banner', 'welcome-text', 'hero',
            ])
            const unsupportedMasterTypes = [...new Set(masterBlocks
              .filter(block => block.props?.hidden !== true && !supportedMasterTypes.has(block.type))
              .map(block => block.type))]
            const renderMasterBlock = (block: NonNullable<Master['blocks']>[number]): ReactNode => {
              const props = block.props ?? {}
              if (props.hidden === true) return null
              if (block.type === 'header') return master?.showHeader === false ? null :
                <header className="flex gap-2 items-center border-b px-4 py-2"
                  style={{ borderColor: profile.borderColorToken ?? '#E2DED7',
                    backgroundColor: masterColor(props.bgColor, primary),
                    color: masterColor(props.textColor, '#FFFFFF') }}>
                  {master?.showLogo !== false && (imageLogo
                    ? <img src={imageLogo} alt={profile.logoLabel || 'Brand logo'} className="max-w-8 max-h-8 object-contain" />
                    : profile.logoLabel && <span>{profile.logoLabel}</span>)}
                  <span>{masterText(props, 'siteTitle', projection.projectName)}</span>
                </header>
              if (block.type === 'breadcrumb') return master?.showBreadcrumb === false ? null :
                <p className="text-xs mb-4" style={{ color: profile.linkColor ?? primary }}>
                  {projection.projectName} / {topic.title}
                </p>
              if (block.type === 'body') return bodyHidden ? null : bodyContent
              if (block.type === 'prevnext' || block.type === 'previous-/-next') {
                if (master?.showPrevNext === false || (!prev && !next)) return null
                return <nav aria-label={`Adjacent topics for ${topic.title}`} className="flex justify-between px-4 py-3 text-xs"
                  style={{ color: profile.linkColor ?? primary }}>
                  {prev ? <a href={`#preview-topic-${prev.topicId}`}>← {prev.title}</a> : <span />}
                  {next ? <a href={`#preview-topic-${next.topicId}`}>{next.title} →</a> : <span />}
                </nav>
              }
              if (block.type === 'footer') return master?.showFooter === false ? null :
                <footer className="border-t px-4 py-2 text-xs" style={{
                  borderColor: profile.borderColorToken ?? '#E2DED7', color: profile.bodyTextColor ?? profile.body.color,
                }}>{masterText(props, 'copyrightText', projection.projectName)}</footer>
              if (block.type === 'heading') {
                const level = Math.min(3, Math.max(1, Number(props.level) || 2))
                const headingStyle = roleStyle(profile[`h${level}` as 'h1' | 'h2' | 'h3'],
                  family(profile, profile[`h${level}` as 'h1' | 'h2' | 'h3'], `h${level}`),
                  profile.headingTextColor ?? profile[`h${level}` as 'h1' | 'h2' | 'h3'].color)
                const Heading = `h${level}` as 'h1' | 'h2' | 'h3'
                return <Heading style={headingStyle}>{masterText(props, 'text')}</Heading>
              }
              if (block.type === 'rich-text') return <p style={{ ...roleStyle(profile.body,
                family(profile, profile.body, 'body'), profile.bodyTextColor ?? profile.body.color), padding: '0 20px' }}>
                {masterText(props, 'content')}</p>
              if (block.type === 'announcement-banner') return <aside className="px-4 py-2 text-sm"
                style={{ backgroundColor: profile.callouts.note.bgColor, color: profile.callouts.note.textColor }}>
                {masterText(props, 'text')}</aside>
              if (block.type === 'welcome-text') return <section className="px-4 py-3"
                style={{ backgroundColor: masterColor(props.bgColor, 'transparent') }}>
                {typeof props.heading === 'string' && props.heading && <h3 style={roleStyle(profile.h3, family(profile, profile.h3, 'h3'),
                  profile.headingTextColor ?? profile.h3.color)}>{masterText(props, 'heading')}</h3>}
                <p style={roleStyle(profile.body, family(profile, profile.body, 'body'),
                  profile.bodyTextColor ?? profile.body.color)}>{masterText(props, 'body')}</p>
              </section>
              if (block.type === 'hero') return master?.showHero === false ? null :
                <section className="px-4 py-4" style={{ backgroundColor: masterColor(props.bgColor, primary),
                  textAlign: ['left', 'center', 'right'].includes(String(props.alignment))
                    ? props.alignment as CSSProperties['textAlign'] : 'center' }}>
                  <h2 style={roleStyle(profile.h1, family(profile, profile.h1, 'h1'), '#FFFFFF')}>
                    {masterText(props, 'heading', projection.projectName)}</h2>
                  {typeof props.description === 'string' && props.description && <p style={roleStyle(profile.body, family(profile, profile.body, 'body'), '#FFFFFF')}>
                    {masterText(props, 'description')}</p>}
                </section>
              return null
            }
            return <article key={topic.topicId} id={`preview-topic-${topic.topicId}`} data-topic-id={topic.topicId}
              data-master-id={master?.id ?? ''} data-layout-id={layout?.id ?? ''}
              className="bg-white rounded-xl border border-[#E2DED7] shadow-sm overflow-hidden"
              style={{ backgroundColor: paper, width: `${landscape ? height : width}mm`, maxWidth: '100%',
                minHeight: `${landscape ? width : height}mm`,
                fontFamily: family(profile, profile.body, 'body') }}>
              <p className="text-xs text-[#6B6B7E] px-4 pt-3" data-testid="preview-master-label">
                HTML topic master: {master?.name ?? 'No topic master configured'}
                {topic.assignedMasterId && !topic.assignedMaster && ' (assigned master missing)'}
              </p>
              {bodyHidden && <p role="alert" className="mx-4 mt-2 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-950">
                This HTML master hides its Body block. HTML export rejects this topic; generation fails instead of hiding its content.
                Authored content remains visible here for full-project review.
              </p>}
              {bodyMissing && <p role="alert" className="mx-4 mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                This HTML master has no Body block. Authored content remains visible here for full-project review, but HTML export omits it.
              </p>}
              {unsupportedMasterTypes.length > 0 && <p className="mx-4 mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
                data-testid="preview-master-limitations">
                Master components not rendered in this on-screen document preview: {unsupportedMasterTypes.join(', ')}.
              </p>}
              {masterBlocks.map((block, blockIndex) =>
                <Fragment key={`${block.id}-${blockIndex}`}>
                  {block.type === 'body'
                    ? <div style={{ padding: `${layout?.marginTop ?? 20}mm ${layout?.marginRight ?? 20}mm ${layout?.marginBottom ?? 20}mm ${layout?.marginLeft ?? 20}mm` }}>
                      {renderMasterBlock(block)}
                    </div>
                    : renderMasterBlock(block)}
                </Fragment>)}
              {(bodyMissing || bodyHidden) && <div data-testid="preview-authored-content"
                style={{ padding: `${layout?.marginTop ?? 20}mm ${layout?.marginRight ?? 20}mm ${layout?.marginBottom ?? 20}mm ${layout?.marginLeft ?? 20}mm` }}>
                {bodyHidden && <h3 className="text-amber-900 text-sm font-semibold">Authored content for review (HTML export is blocked)</h3>}
                {bodyMissing && <h3 className="text-amber-900 text-sm font-semibold">Authored content for review (not included by this HTML master)</h3>}
                {bodyContent}
              </div>}
            </article>
          })}
        </main>
      </div>
    </div>
  </div>
}