import type { jsPDF } from 'jspdf'
import type { StyleProfile } from './App'
import type { PublishBlock, PublishProjection } from './publishProjection'

type Zone = { id: string; label: string; alignment: 'left' | 'center' | 'right'; visible: boolean }
type Layout = {
  id: string; name: string; layoutType: string; pageSize?: 'A4' | 'Letter'
  orientation?: 'portrait' | 'landscape'; marginTop?: number; marginBottom?: number
  marginLeft?: number; marginRight?: number; bgColor?: string; brandOverrides?: { bgColor?: string }
  topZone?: Zone[]; centerZone?: Zone[]; bottomZone?: Zone[]; headerZone?: Zone[]; footerZone?: Zone[]
}
type Pack = {
  id: string; name: string; pdfPageSize?: 'A4' | 'Letter'; pdfOrientation?: 'portrait' | 'landscape'
  pdfMarginTop?: number; pdfMarginBottom?: number; pdfMarginLeft?: number; pdfMarginRight?: number
  coverShowTitle?: boolean; headerShowLogo?: boolean; headerShowTitle?: boolean; headerShowVersion?: boolean
  footerShowPageNum?: boolean; footerShowCopyright?: boolean; footerShowConfidentiality?: boolean
}
type PdfProjection = PublishProjection<PublishBlock, StyleProfile, { id: string; name: string },
  Layout, { id: string; name: string; masterType: string }, Pack>
type PdfBlock = PublishBlock & {
  calloutVariant?: string; conditions?: string[]; tableData?: { rows: string[][]; hasHeader?: boolean }
  listItems?: Array<{ text: string; type?: 'bullet' | 'ordered'; level?: number; startFresh?: boolean }>
}
type Geometry = { width: number; height: number; left: number; right: number; top: number; bottom: number; contentWidth: number }
type Role = StyleProfile['body']
type PendingLink = { page: number; x: number; y: number; width: number; height: number; destination: string }

const limit = (value: number | undefined, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const mm = (points: number): number => points * 25.4 / 72
const rgb = (hex: string | undefined, fallback = '#111218'): [number, number, number] => {
  const raw = /^#([a-f\d]{6}|[a-f\d]{3})$/i.test(hex ?? '') ? hex!.slice(1) : fallback.slice(1)
  const full = raw.length === 3 ? Array.from(raw, c => c + c).join('') : raw
  return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number]
}
const zoneName = (zone: Zone): string => zone.label.toLowerCase().replace(/[^a-z]/g, '') ||
  zone.id.toLowerCase().replace(/[^a-z]/g, '')
const urlOrTopic = /https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#topic-[\w-]+/g

function geometry(layout: Layout | null, pack: Pack | null): Geometry {
  const [short, long] = (layout?.pageSize ?? pack?.pdfPageSize) === 'Letter' ? [215.9, 279.4] : [210, 297]
  const landscape = (layout?.orientation ?? pack?.pdfOrientation) === 'landscape'
  const width = landscape ? long : short
  const height = landscape ? short : long
  const left = limit(layout?.marginLeft ?? pack?.pdfMarginLeft, 20, 0, width / 3)
  const right = limit(layout?.marginRight ?? pack?.pdfMarginRight, 20, 0, width / 3)
  const top = limit(layout?.marginTop ?? pack?.pdfMarginTop, 20, 0, height / 3)
  const bottom = limit(layout?.marginBottom ?? pack?.pdfMarginBottom, 20, 0, height / 3)
  return { width, height, left, right, top, bottom, contentWidth: width - left - right }
}

function fontFor(role: Role, key: string, profile: StyleProfile): string {
  const requested = profile.fontInherit?.[key as keyof NonNullable<StyleProfile['fontInherit']>] === false
    ? role.fontFamily : key === 'code' ? profile.codeFont ?? role.fontFamily
      : key.startsWith('h') ? profile.headingFont ?? profile.primaryFont ?? role.fontFamily
        : profile.bodyFont ?? profile.primaryFont ?? role.fontFamily
  // jsPDF has no file bytes for user-defined fonts. Only use its bundled PDF fonts.
  const bundled = (name: string): string | null => {
    if (/courier|consolas|mono/i.test(name)) return 'courier'
    if (/times|georgia|serif/i.test(name) && !/sans/i.test(name)) return 'times'
    if (/helvetica|arial|sans/i.test(name)) return 'helvetica'
    return null
  }
  return bundled(requested) ?? bundled(profile.fallbackFont ?? '') ?? 'helvetica'
}

export async function generatePdfDocument(projection: PdfProjection): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const profile = projection.styleProfile
  const pack = projection.templatePack
  const coverLayout = projection.coverLayout?.layoutType === 'cover' ? projection.coverLayout : null
  const contentLayout = projection.pageLayouts.find(layout => layout.layoutType === 'content') ?? projection.contentLayout
  const cover = geometry(coverLayout, pack)
  const content = geometry(contentLayout, pack)
  const format = (g: Geometry): [number, number] => [Math.min(g.width, g.height), Math.max(g.width, g.height)]
  const orientation = (g: Geometry): 'p' | 'l' => g.width > g.height ? 'l' : 'p'
  const doc = new jsPDF({ unit: 'mm', format: format(coverLayout ? cover : content),
    orientation: orientation(coverLayout ? cover : content), compress: true })
  const pendingLinks: PendingLink[] = []
  const topicPositions = new Map<string, { page: number; top: number }>()
  const outlineParents = new Map<number, ReturnType<jsPDF['outline']['add']>>()
  const pages = new Map<number, string>()
  let page = 1
  let y = 0
  const version = projection.variables.find(variable => variable.name.toLowerCase() === 'version')?.value
  const safeVersion = version && !version.includes('{{') ? version : ''
  const pageNumber = (): number => doc.getNumberOfPages()
  const setRole = (role: Role, key: string, overrideColor?: string) => {
    doc.setFont(fontFor(role, key, profile), Number.parseInt(role.fontWeight, 10) >= 600 ? 'bold' : 'normal')
    doc.setFontSize(limit(role.fontSize, 11, 6, 72))
    doc.setTextColor(...rgb(overrideColor ?? (key === 'h1'
      ? profile.headingTextColor ?? role.color : key === 'body' ? profile.bodyTextColor ?? role.color : role.color)))
  }
  const lineHeight = (role: Role): number =>
    mm(limit(role.fontSize, 11, 6, 72) * limit(role.lineHeight, 1.4, 1, 3))
  const defaultZones = (where: 'header' | 'footer'): Zone[] => {
    const names = where === 'header'
      ? [pack?.headerShowLogo && 'Logo', pack?.headerShowTitle && 'Document Title', pack?.headerShowVersion && 'Version']
      : [pack?.footerShowCopyright && 'Copyright', pack?.footerShowConfidentiality && 'Confidentiality',
        pack?.footerShowPageNum && 'Page Number']
    return names.filter((name): name is string => !!name).map((label, index) => ({
      label, id: label.toLowerCase().replace(/\s/g, ''), visible: true,
      alignment: index === names.length - 1 ? 'right' : 'left',
    }))
  }
  const headers = (contentLayout?.headerZone ?? defaultZones('header')).filter(z => z.visible)
  const footers = (contentLayout?.footerZone ?? defaultZones('footer')).filter(z => z.visible)
  // Keep an additional band inside the content region: even unusually small page
  // margins cannot let authored content collide with a configured header/footer.
  const bodyTop = content.top + (headers.length ? 9 : 0)
  const bodyBottom = content.height - content.bottom - (footers.length ? 9 : 0)
  if (bodyBottom - bodyTop < 20 || content.contentWidth < 35)
    throw new Error('PDF page layout leaves too little room for document content.')
  const addContentPage = (title: string) => {
    doc.addPage(format(content), orientation(content))
    page = pageNumber()
    pages.set(page, title)
    y = bodyTop
  }
  const ensure = (height: number, title: string) => {
    if (y + height > bodyBottom && y > bodyTop + 0.01) addContentPage(title)
  }
  const textPosition = (role: Role, align: Role['alignment'], inset = 0): number =>
    align === 'center' ? content.left + content.contentWidth / 2
      : align === 'right' ? content.width - content.right - inset : content.left + inset
  const annotations = (line: string, x: number, baseline: number, role: Role, align: Role['alignment']) => {
    for (const match of line.matchAll(urlOrTopic)) {
      const token = match[0].replace(/[.,;!?)]*$/, '')
      const before = line.slice(0, match.index)
      const lineWidth = doc.getTextWidth(line)
      const start = align === 'right' ? x - lineWidth
        : align === 'center' ? x - lineWidth / 2 : x
      const linkX = start + doc.getTextWidth(before)
      const width = doc.getTextWidth(token)
      const baselineTop = baseline - mm(role.fontSize)
      if (token.startsWith('#topic-')) {
        pendingLinks.push({ page, x: linkX, y: baselineTop, width, height: lineHeight(role), destination: token.slice(7) })
      } else {
        doc.link(linkX, baselineTop, width, lineHeight(role), { url: token })
      }
    }
  }
  const writeLines = (text: string, role: Role, key: string, title: string, options: {
    inset?: number; width?: number; background?: string; border?: string; color?: string
    align?: Role['alignment']; before?: number; after?: number
  } = {}) => {
    if (!text) return
    const inset = options.inset ?? 0
    const width = options.width ?? content.contentWidth - inset
    if (width < 15) throw new Error('PDF content width is too narrow for text.')
    const align = options.align ?? role.alignment
    setRole(role, key, options.color)
    const before = mm(limit(options.before ?? role.spaceBefore, 0, 0, 96))
    const after = mm(limit(options.after ?? role.spaceAfter, 0, 0, 96))
    ensure(Math.min(before + lineHeight(role), bodyBottom - bodyTop), title)
    y += before
    const lines = text.split('\n').flatMap(segment => doc.splitTextToSize(segment || ' ', width) as string[])
    for (const line of lines) {
      const height = lineHeight(role)
      ensure(height, title)
      const baseline = y + mm(role.fontSize)
      if (options.background) {
        doc.setFillColor(...rgb(options.background, '#F9F8F6'))
        doc.rect(content.left + inset - 2, y, width + 4, height, 'F')
      }
      if (options.border) {
        doc.setDrawColor(...rgb(options.border))
        doc.setLineWidth(0.7)
        doc.line(content.left + inset - 2, y, content.left + inset - 2, y + height)
      }
      setRole(role, key, options.color)
      const x = textPosition(role, align, inset)
      doc.text(line, x, baseline, { align })
      annotations(line, x, baseline, role, align)
      y += height
    }
    y = Math.min(bodyBottom, y + after)
  }
  const drawImage = (asset: string, title: string, caption = '') => {
    if (!/^data:image\/(png|jpe?g|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(asset))
      throw new Error('PDF export supports only PNG, JPEG and GIF image data URLs.')
    let properties: ReturnType<jsPDF['getImageProperties']>
    try { properties = doc.getImageProperties(asset) }
    catch { throw new Error('PDF export could not decode an image asset.') }
    if (!(properties.width > 0 && properties.height > 0))
      throw new Error('PDF export could not read image dimensions.')
    // Fit the image, its trailing gap, and (when present) its caption in a fresh
    // page's usable body. ensure() cannot move an item larger than that body.
    let captionReserve = 0
    if (caption) {
      setRole(profile.caption, 'caption')
      const lines = doc.splitTextToSize(caption, content.contentWidth) as string[]
      captionReserve = Math.min((bodyBottom - bodyTop) / 2, lines.length * lineHeight(profile.caption)
        + mm(profile.caption.spaceBefore + profile.caption.spaceAfter))
    }
    const available = bodyBottom - bodyTop - captionReserve - 2
    if (available <= 0) throw new Error('PDF page layout leaves too little room for an image and caption.')
    const scale = Math.min(1, content.contentWidth / properties.width, available / properties.height)
    const width = properties.width * scale, height = properties.height * scale
    ensure(height + 2 + captionReserve, title)
    doc.addImage(asset, properties.fileType, content.left + (content.contentWidth - width) / 2, y, width, height)
    y += height + 2
  }
  const zoneText = (zone: Zone, currentTopic: string, number: number, total: number): string | null => {
    const name = zoneName(zone)
    if (name.includes('chaptertitle') || name.includes('topictitle')) return currentTopic
    if (name.includes('documenttitle') || name === 'title') return projection.projectName
    if (name.includes('version')) return safeVersion || null
    if (name.includes('copyright')) return `© ${projection.projectName}`
    if (name.includes('confidentiality') || name === 'conf') return 'Confidential'
    if (name.includes('pagenum')) return `${number} / ${total}`
    if (name.includes('logo')) return profile.logoDataUrl?.startsWith('data:') ? null : profile.logoLabel || null
    return null
  }
  const drawZone = (zone: Zone, currentTopic: string, number: number, total: number, baseline: number,
    region: Geometry, colorOverride?: string) => {
    const name = zoneName(zone)
    const text = zoneText(zone, currentTopic, number, total)
    if (name.includes('logo') && profile.logoDataUrl?.startsWith('data:')) {
      const asset = profile.logoDataUrl
      if (!/^data:image\/(png|jpe?g|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(asset))
        throw new Error('PDF export supports only PNG, JPEG and GIF image data URLs.')
      let image: ReturnType<jsPDF['getImageProperties']>
      try { image = doc.getImageProperties(asset) }
      catch { throw new Error('PDF export could not decode a logo image.') }
      const scale = Math.min(1, 28 / image.width, 7 / image.height)
      const width = image.width * scale, height = image.height * scale
      const x = zone.alignment === 'right' ? region.width - region.right - width
        : zone.alignment === 'center' ? (region.width - width) / 2 : region.left
      doc.addImage(asset, image.fileType, x, baseline - height, width, height)
    } else if (text) {
      doc.setFont(fontFor(profile.caption, 'caption', profile), 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...rgb(colorOverride ?? profile.caption.color))
      const maxWidth = region.contentWidth / 3 - 3
      const clipped = doc.getTextWidth(text) > maxWidth
        ? doc.splitTextToSize(text, maxWidth)[0] as string : text
      const x = zone.alignment === 'right' ? region.width - region.right
        : zone.alignment === 'center' ? region.width / 2 : region.left
      doc.text(clipped, x, baseline, { align: zone.alignment })
    }
  }

  if (coverLayout) {
    const bg = coverLayout.brandOverrides
      ? coverLayout.brandOverrides.bgColor ?? profile.primaryColor ?? coverLayout.bgColor
      : coverLayout.bgColor ?? profile.primaryColor
    doc.setFillColor(...rgb(bg, '#FFFFFF'))
    doc.rect(0, 0, cover.width, cover.height, 'F')
    const coverZones = [coverLayout.topZone ?? [], coverLayout.centerZone ?? [], coverLayout.bottomZone ?? []]
    const all = coverZones.flat().filter(zone => zone.visible)
    const hasTitle = all.some(zone => /^(title|documenttitle)$/.test(zoneName(zone)))
    const coverColor = rgb(bg).reduce((sum, channel, i) => sum + channel * [0.299, 0.587, 0.114][i], 0) < 155
      ? '#FFFFFF' : profile.headingTextColor ?? profile.h1.color
    // Subtitle, product, date and client have no reliable value in the snapshot;
    // do not print zone labels or manufacture a publish date.
    for (const [position, zones] of coverZones.entries()) {
      const visible = zones.filter(zone => zone.visible)
      visible.forEach((zone, index) => {
        const baseline = position === 0 ? cover.top + 8 + index * 10
          : position === 1 ? cover.height / 2 + index * 12
            : cover.height - cover.bottom - (visible.length - index - 1) * 10
        if (/^(title|documenttitle)$/.test(zoneName(zone))) {
          setRole(profile.h1, 'h1', coverColor)
          const lines = doc.splitTextToSize(projection.projectName, cover.contentWidth) as string[]
          lines.forEach((line, lineIndex) => doc.text(line,
            zone.alignment === 'center' ? cover.width / 2 : zone.alignment === 'right' ? cover.width - cover.right : cover.left,
            baseline + lineIndex * lineHeight(profile.h1), { align: zone.alignment }))
        } else drawZone(zone, '', 0, 0, baseline, cover, coverColor)
      })
    }
    if (!hasTitle && pack?.coverShowTitle !== false) {
      setRole(profile.h1, 'h1', coverColor)
      doc.text(projection.projectName, cover.left, cover.height / 2, { maxWidth: cover.contentWidth })
    }
    addContentPage(projection.topics[0]?.title ?? '')
  } else {
    page = 1
    pages.set(page, projection.topics[0]?.title ?? '')
    y = bodyTop
    writeLines(projection.projectName, profile.h1, 'h1', projection.topics[0]?.title ?? '')
  }

  const drawTable = (block: PdfBlock, title: string) => {
    const rows = block.tableData?.rows ?? []
    if (!rows.length) return
    const cols = Math.max(...rows.map(row => row.length))
    if (cols === 0) return
    const cellWidth = content.contentWidth / cols
    const padding = limit(profile.tables.cellPadding, 6, 1, 24) * 0.35
    if (cellWidth - padding * 2 < 8) throw new Error('PDF table has too many columns for the selected page width.')
    const size = Math.max(7, Math.min(profile.body.fontSize, 10))
    const rowLine = mm(size * 1.3)
    const showHeader = !!block.tableData?.hasHeader
    const drawRow = (cells: string[][], rowIndex: number, offset: number): number => {
      const count = Math.max(1, ...cells.map(cell => cell.length - offset))
      const capacity = Math.max(1, Math.floor((bodyBottom - y - padding * 2) / rowLine))
      const linesToDraw = Math.min(count, capacity)
      const height = linesToDraw * rowLine + padding * 2
      const isHeader = showHeader && rowIndex === 0
      const fill = isHeader ? profile.tableHeaderBgToken ?? profile.tables.headerBgColor
        : profile.tables.alternateRows && rowIndex % 2 ? profile.tables.alternateRowColor : '#FFFFFF'
      for (let column = 0; column < cols; column++) {
        const x = content.left + column * cellWidth
        doc.setFillColor(...rgb(fill))
        doc.setDrawColor(...rgb(profile.tables.borderColor, profile.borderColorToken ?? '#D1D5DB'))
        doc.setLineWidth(limit(profile.tables.borderWidth, 0.5, 0.2, 3) * 0.25)
        doc.rect(x, y, cellWidth, height, 'FD')
        doc.setFont(fontFor(profile.body, 'body', profile), isHeader || column === 0 && profile.tables.firstColEmphasis ? 'bold' : 'normal')
        doc.setFontSize(size)
        doc.setTextColor(...rgb(isHeader ? profile.tables.headerTextColor : profile.tables.bodyTextColor))
        for (let i = 0; i < linesToDraw; i++) {
          const line = cells[column]?.[offset + i]
          if (!line) continue
          const baseline = y + padding + i * rowLine + mm(size)
          doc.text(line, x + padding, baseline)
          annotations(line, x + padding, baseline, profile.body, 'left')
        }
      }
      y += height
      return linesToDraw
    }
    rows.forEach((row, rowIndex) => {
      doc.setFont(fontFor(profile.body, 'body', profile), 'normal')
      doc.setFontSize(size)
      const cells = Array.from({ length: cols }, (_, i) => doc.splitTextToSize(row[i] ?? '', cellWidth - padding * 2) as string[])
      const totalLines = Math.max(1, ...cells.map(cell => cell.length))
      const fullHeight = totalLines * rowLine + padding * 2
      if (y + Math.min(fullHeight, bodyBottom - bodyTop) > bodyBottom && y > bodyTop + 0.01)
        addContentPage(title)
      let offset = 0
      do {
        if (y + padding * 2 + rowLine > bodyBottom) addContentPage(title)
        offset += drawRow(cells, rowIndex, offset)
        if (offset < totalLines) addContentPage(title)
      } while (offset < totalLines)
    })
    y = Math.min(bodyBottom, y + 3)
  }
  for (const topic of projection.topics) {
    const roleKey = `h${Math.min(4, Math.max(1, Math.round(topic.level)))}` as 'h1' | 'h2' | 'h3' | 'h4'
    const topicRole = profile[roleKey]
    ensure(mm(topicRole.fontSize * topicRole.lineHeight + topicRole.spaceBefore + 2), topic.title)
    topicPositions.set(topic.topicId, { page, top: y })
    topicPositions.set(String(topic.legacyId), { page, top: y })
    const level = Math.max(1, Math.round(topic.level))
    const parent = [...outlineParents.entries()].filter(([candidate]) => candidate < level)
      .sort(([a], [b]) => b - a)[0]?.[1] ?? null
    outlineParents.set(level, doc.outline.add(parent, topic.title, { pageNumber: page }))
    for (const key of outlineParents.keys()) if (key > level) outlineParents.delete(key)
    writeLines(topic.title, topicRole, roleKey, topic.title)
    topic.blocks.forEach((original, index) => {
      const block = original as PdfBlock
      const text = block.content ?? ''
      if (block.conditions?.length)
        throw new Error(`PDF export cannot safely apply conditions on block "${block.id}" in topic "${topic.title}".`)
      if (index === 0 && block.type === 'h1') return
      if (['h1', 'h2', 'h3', 'h4'].includes(block.type)) {
        const headingKey = (block.type === 'h1' ? 'h2' : block.type) as 'h2' | 'h3' | 'h4'
        writeLines(text, profile[headingKey], headingKey, topic.title)
        doc.setDrawColor(...rgb(profile.borderColorToken, '#D1D5DB'))
        doc.setLineWidth(0.3)
        if (headingKey === 'h2' && y + 1 < bodyBottom) { doc.line(content.left, y, content.width - content.right, y); y += 2 }
      } else if (block.type === 'para' || block.type === 'variable' || block.type === 'bookmark') {
        writeLines(text, profile.body, 'body', topic.title)
      } else if (block.type === 'caption') {
        writeLines(text, profile.caption, 'caption', topic.title)
      } else if (block.type === 'quote') {
        writeLines(text, profile.body, 'body', topic.title, {
          inset: 7, width: content.contentWidth - 7, border: profile.accentColor ?? profile.primaryColor,
        })
      } else if (block.type === 'code') {
        writeLines(text, profile.code, 'code', topic.title, { inset: 4, width: content.contentWidth - 6,
          background: profile.surfaceColor ?? '#F4F2EE' })
      } else if (block.type === 'callout') {
        const kind = (['note', 'tip', 'important', 'warning', 'example'].includes(block.calloutVariant ?? '')
          ? block.calloutVariant : 'note') as keyof StyleProfile['callouts']
        const tokens = profile.callouts[kind]
        writeLines(`${tokens.label}: ${text}`, profile.body, 'body', topic.title, {
          inset: 4, width: content.contentWidth - 6, background: tokens.bgColor,
          border: tokens.accentColor, color: tokens.textColor,
        })
      } else if (block.type === 'list') {
        const counters = [0, 0, 0]
        for (const item of block.listItems ?? []) {
          const level = Math.min(2, Math.max(0, (item.level ?? 1) - 1))
          if (item.type === 'ordered') {
            counters[level] = item.startFresh ? 1 : counters[level] + 1
          }
          const label = item.type === 'ordered'
            ? level === 0 ? `${counters[level]}.`
              : level === 1 ? `${String.fromCharCode(96 + (counters[level] - 1) % 26 + 1)}.`
                : `${counters[level]}.`
            : [profile.lists.bulletL1, profile.lists.bulletL2, profile.lists.bulletL3][level]
          writeLines(`${label}  ${item.text}`, profile.body, 'body', topic.title, {
            inset: 4 + level * 6, width: content.contentWidth - 8 - level * 6,
            after: profile.lists.itemSpacing,
          })
        }
      } else if (block.type === 'procedure') {
        if (text) writeLines(text, profile.body, 'body', topic.title)
        block.procedureSteps?.forEach((step, i) => writeLines(`${i + 1}.  ${step}`,
          profile.body, 'body', topic.title, { inset: 4, width: content.contentWidth - 6 }))
      } else if (block.type === 'table') {
        drawTable(block, topic.title)
      } else if (block.type === 'media') {
        if (block.mediaType?.startsWith('data:')) {
          drawImage(block.mediaType, topic.title, block.caption)
          if (block.caption) writeLines(block.caption, profile.caption, 'caption', topic.title)
        } else if (block.mediaType && !['image', 'video', 'diagram', 'chart'].includes(block.mediaType)) {
          throw new Error(`PDF export cannot package media for topic "${topic.title}" without image bytes.`)
        } else {
          if (text && !['Figure caption', 'Video placeholder', 'Diagram placeholder', 'Chart placeholder'].includes(text))
            writeLines(text, profile.body, 'body', topic.title)
          if (block.caption) writeLines(block.caption, profile.caption, 'caption', topic.title)
        }
      } else if (block.type === 'divider') {
        ensure(4, topic.title)
        doc.setDrawColor(...rgb(profile.borderColorToken, '#D1D5DB'))
        doc.setLineWidth(0.3)
        doc.line(content.left, y + 1, content.width - content.right, y + 1)
        y += 4
      } else if (text) {
        writeLines(text, profile.body, 'body', topic.title)
      }
    })
  }
  const contentCount = pages.size
  for (const [pageIndex, topicTitle] of pages) {
    doc.setPage(pageIndex)
    const localNumber = pageIndex - (coverLayout ? 1 : 0)
    headers.forEach(zone => drawZone(zone, topicTitle, localNumber, contentCount,
      Math.max(5, content.top / 2), content))
    footers.forEach(zone => drawZone(zone, topicTitle, localNumber, contentCount,
      content.height - Math.max(5, content.bottom / 2), content))
  }
  for (const link of pendingLinks) {
    const target = topicPositions.get(link.destination)
    if (!target) continue
    doc.setPage(link.page)
    doc.link(link.x, link.y, link.width, link.height, { pageNumber: target.page, top: target.top })
  }
  return doc.output('blob')
}