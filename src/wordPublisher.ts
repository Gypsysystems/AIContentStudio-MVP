import type { FileChild, IParagraphOptions, ISectionOptions, ParagraphChild } from 'docx'
import type { StyleProfile } from './App'
import type { PublishBlock, PublishProjection } from './publishProjection'

type Layout = {
  id: string; name: string; layoutType: string
  pageSize?: 'A4' | 'Letter'; orientation?: 'portrait' | 'landscape'
  marginTop?: number; marginBottom?: number; marginLeft?: number; marginRight?: number
  topZone?: Zone[]; centerZone?: Zone[]; bottomZone?: Zone[]
  headerZone?: Zone[]; footerZone?: Zone[]
}
type Zone = { id: string; label: string; alignment: 'left' | 'center' | 'right'; visible: boolean }
type Pack = {
  id: string; name: string
  pdfPageSize?: 'A4' | 'Letter'; pdfOrientation?: 'portrait' | 'landscape'
  pdfMarginTop?: number; pdfMarginBottom?: number; pdfMarginLeft?: number; pdfMarginRight?: number
  coverShowTitle?: boolean; headerShowLogo?: boolean; headerShowTitle?: boolean; headerShowVersion?: boolean
  footerShowPageNum?: boolean; footerShowCopyright?: boolean; footerShowConfidentiality?: boolean
}
type WordProjection = PublishProjection<PublishBlock, StyleProfile, { id: string; name: string },
  Layout, { id: string; name: string; masterType: string }, Pack>
type Dox = typeof import('docx')
type Role = StyleProfile['body']
type WordBlock = PublishBlock & {
  calloutVariant?: string
  conditions?: string[]
  tableData?: { rows: string[][]; hasHeader?: boolean }
  listItems?: Array<{ text: string; type?: 'bullet' | 'ordered'; level?: number; startFresh?: boolean }>
}

const color = (value: string | undefined, fallback = '111218'): string =>
  value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? (value.length === 4 ? [...value.slice(1)].map(c => c + c).join('') : value.slice(1)).toUpperCase()
    : fallback
const mmTwips = (mm: number): number => Math.round(mm * 1440 / 25.4)
const ptTwips = (pt: number): number => Math.max(0, Math.round(pt * 20))
const bounded = (value: number | undefined, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const hexId = (id: string): string =>
  Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, '0')).join('')

function decodeImage(dataUrl: string): { type: 'png' | 'jpg' | 'gif' | 'bmp'; bytes: Uint8Array; width: number; height: number } {
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Word export supports only PNG, JPEG, GIF and BMP image data URLs.')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), char => char.charCodeAt(0))
  } catch {
    throw new Error('Word export could not decode an image asset.')
  }
  const type = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase() as 'png' | 'jpg' | 'gif' | 'bmp'
  const view = new DataView(bytes.buffer)
  let width = 0, height = 0
  if (type === 'png' && bytes.length >= 24 && bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
    width = view.getUint32(16); height = view.getUint32(20)
  } else if (type === 'gif' && bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) {
    width = view.getUint16(6, true); height = view.getUint16(8, true)
  } else if (type === 'bmp' && bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true))
  } else if (type === 'jpg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) break
      const marker = bytes[offset + 1]
      if (marker === 216 || marker === 1) { offset += 2; continue }
      if (marker === 217 || marker === 218) break
      const length = view.getUint16(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB].includes(marker)) {
        if (length >= 7) { height = view.getUint16(offset + 5); width = view.getUint16(offset + 7) }
        break
      }
      offset += length + 2
    }
  }
  if (!width || !height || width > 30000 || height > 30000) throw new Error('Word export could not read the image dimensions or format.')
  return { type, bytes, width, height }
}

function pageGeometry(layout: Layout | null, pack: Pack | null): {
  width: number; height: number; margins: { top: number; bottom: number; left: number; right: number }
  contentWidthPx: number
} {
  const size = layout?.pageSize ?? pack?.pdfPageSize ?? 'A4'
  const landscape = (layout?.orientation ?? pack?.pdfOrientation) === 'landscape'
  const [widthMm, heightMm] = size === 'Letter' ? [215.9, 279.4] : [210, 297]
  const width = landscape ? heightMm : widthMm
  const height = landscape ? widthMm : heightMm
  const marginsMm = {
    top: bounded(layout?.marginTop ?? pack?.pdfMarginTop, 20, 0, height / 3),
    bottom: bounded(layout?.marginBottom ?? pack?.pdfMarginBottom, 20, 0, height / 3),
    left: bounded(layout?.marginLeft ?? pack?.pdfMarginLeft, 20, 0, width / 3),
    right: bounded(layout?.marginRight ?? pack?.pdfMarginRight, 20, 0, width / 3),
  }
  return {
    width: mmTwips(width), height: mmTwips(height),
    margins: Object.fromEntries(Object.entries(marginsMm).map(([key, mm]) => [key, mmTwips(mm)])) as {
      top: number; bottom: number; left: number; right: number
    },
    contentWidthPx: (width - marginsMm.left - marginsMm.right) * 96 / 25.4,
  }
}

function roleStyle(D: Dox, role: Role, font: string, textColor: string): {
  run: { font: string; size: number; bold: boolean; color: string }
  paragraph: { alignment: (typeof D.AlignmentType)[keyof typeof D.AlignmentType]; spacing: { before: number; after: number; line: number } }
} {
  const size = bounded(role.fontSize, 11, 6, 72)
  return {
    run: { font: font || role.fontFamily, size: size * 2, bold: Number.parseInt(role.fontWeight, 10) >= 600, color: color(textColor, color(role.color)) },
    paragraph: {
      alignment: role.alignment === 'center' ? D.AlignmentType.CENTER : role.alignment === 'right' ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT,
      spacing: {
        before: ptTwips(bounded(role.spaceBefore, 0, 0, 96)),
        after: ptTwips(bounded(role.spaceAfter, 0, 0, 96)),
        line: ptTwips(size * bounded(role.lineHeight, 1.4, 1, 3)),
      },
    },
  }
}

export async function generateWordDocument(projection: WordProjection): Promise<Blob> {
  const D = await import('docx')
  const profile = projection.styleProfile
  const pack = projection.templatePack
  const contentLayout = projection.pageLayouts.find(layout => layout.layoutType === 'content') ?? projection.contentLayout
  const coverLayout = projection.coverLayout?.layoutType === 'cover' ? projection.coverLayout : null
  const headingFont = profile.headingFont ?? profile.primaryFont ?? profile.h1.fontFamily
  const bodyFont = profile.bodyFont ?? profile.primaryFont ?? profile.body.fontFamily
  const headingColor = profile.headingTextColor
  const bodyColor = profile.bodyTextColor
  const roleFont = (key: 'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'caption' | 'code'): string => {
    const semanticFont = key === 'code' ? profile.codeFont ?? profile.code.fontFamily
      : key.startsWith('h') ? headingFont : bodyFont
    return profile.fontInherit?.[key] === false ? profile[key].fontFamily : semanticFont
  }
  const roles = Object.fromEntries((['body', 'h1', 'h2', 'h3', 'h4', 'caption', 'code'] as const)
    .map(key => [key, roleStyle(D, profile[key], roleFont(key),
      key === 'h1' ? headingColor ?? profile.h1.color
        : key === 'body' ? bodyColor ?? profile.body.color : profile[key].color)])) as Record<
      'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'caption' | 'code',
      ReturnType<typeof roleStyle>>
  const headerColor = color(profile.tables.headerTextColor, 'FFFFFF')
  const tableHeaderColor = color(profile.tableHeaderBgToken ?? profile.tables.headerBgColor, color(profile.primaryColor))
  const geometry = pageGeometry(contentLayout, pack)
  const version = projection.variables.find(variable => variable.name.toLowerCase() === 'version')?.value
  const safeVersion = version && !version.includes('{{') ? version : ''
  const availableLogo = profile.logoDataUrl?.startsWith('data:') ? profile.logoDataUrl : null
  const imageRun = (dataUrl: string, availableWidth: number, alt: string): InstanceType<typeof D.ImageRun> => {
    const image = decodeImage(dataUrl)
    const scale = Math.min(1, availableWidth / image.width, 480 / image.height)
    return new D.ImageRun({
      type: image.type, data: image.bytes,
      transformation: { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) },
      altText: { title: alt || 'Image', description: alt || 'Image', name: alt || 'Image' },
    })
  }

  const zoneContent = (zone: Zone, where: 'cover' | 'header' | 'footer'): ParagraphChild[] => {
    const id = zone.label.toLowerCase().replace(/[^a-z]/g, '') || zone.id.toLowerCase().replace(/[^a-z]/g, '')
    if (id.includes('logo')) return availableLogo ? [imageRun(availableLogo, 125, profile.logoLabel ?? 'Logo')]
      : profile.logoLabel ? [new D.TextRun(profile.logoLabel)] : []
    if (id.includes('pagenum')) return [new D.TextRun({ children: [D.PageNumber.CURRENT] })]
    if (id.includes('chaptertitle') || id.includes('topictitle')) return where === 'header'
      ? [new D.SimpleField('STYLEREF "Heading 1"')] : []
    if (id.includes('documenttitle') || id === 'title') return [new D.TextRun({
      text: projection.projectName, ...(where === 'cover' ? {} : roles.h1.run),
    })]
    if (id.includes('version')) return safeVersion ? [new D.TextRun(safeVersion)] : []
    if (id.includes('copyright')) return [new D.TextRun(`© ${projection.projectName}`)]
    if (id.includes('confidentiality') || id === 'conf') return [new D.TextRun('Confidential')]
    // Subtitle, product, client, date and custom-text zones have no corresponding
    // snapshot field. Do not publish their editor labels as document data.
    return []
  }
  const zones = (elements: Zone[], where: 'cover' | 'header' | 'footer'): InstanceType<typeof D.Paragraph>[] =>
    elements.filter(element => element.visible).flatMap(element => {
      const children = zoneContent(element, where)
      return children.length ? [new D.Paragraph({
        children,
        ...(where === 'cover' && /^(title|documenttitle)$/.test(element.label.toLowerCase().replace(/[^a-z]/g, ''))
          ? { style: 'Title' } : {}),
        alignment: element.alignment === 'right' ? D.AlignmentType.RIGHT
          : element.alignment === 'center' ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
      })] : []
    })
  const band = (elements: Zone[], where: 'header' | 'footer'): InstanceType<typeof D.Paragraph>[] => {
    const grouped = (['left', 'center', 'right'] as const).map(alignment =>
      elements.filter(zone => zone.visible && zone.alignment === alignment)
        .map(zone => zoneContent(zone, where)).filter(content => content.length))
    if (grouped.every(group => !group.length)) return []
    const children: ParagraphChild[] = []
    grouped.forEach((group, index) => {
      if (index) children.push(new D.Tab())
      group.forEach((content, itemIndex) => {
        if (itemIndex) children.push(new D.TextRun(' · '))
        children.push(...content)
      })
    })
    return [new D.Paragraph({
      children,
      tabStops: [
        { type: D.TabStopType.CENTER, position: Math.round(geometry.contentWidthPx * 1440 / 96 / 2) },
        { type: D.TabStopType.RIGHT, position: Math.round(geometry.contentWidthPx * 1440 / 96) },
      ],
    })]
  }
  const defaultZones = (where: 'header' | 'footer'): Zone[] => {
    const names = where === 'header'
      ? [pack?.headerShowLogo && 'Logo', pack?.headerShowTitle && 'Document Title', pack?.headerShowVersion && 'Version']
      : [pack?.footerShowCopyright && 'Copyright', pack?.footerShowConfidentiality && 'Confidentiality',
        pack?.footerShowPageNum && 'Page Number']
    return names.filter((name): name is string => !!name).map((label, index) => ({
      id: label.toLowerCase().replace(/\s/g, ''), label, visible: true,
      alignment: (index === names.length - 1 ? 'right' : 'left') as 'left' | 'right',
    }))
  }
  const headers = band(contentLayout?.headerZone ?? defaultZones('header'), 'header')
  const footers = band(contentLayout?.footerZone ?? defaultZones('footer'), 'footer')
  const numberingConfig: Array<{ reference: string; levels: Array<{
    level: number; format: (typeof D.LevelFormat)[keyof typeof D.LevelFormat]; text: string
  }> }> = []
  const numbered = (reference: string, ordered: boolean) => {
    if (numberingConfig.some(config => config.reference === reference)) return
    numberingConfig.push({ reference, levels: [0, 1, 2].map(level => {
      const mark = ordered
        ? [profile.lists.orderedL1, profile.lists.orderedL2, profile.lists.orderedL3][level]
        : [profile.lists.bulletL1, profile.lists.bulletL2, profile.lists.bulletL3][level]
      const format = !ordered ? D.LevelFormat.BULLET
        : /^[ivx]+[.)]$/i.test(mark) ? D.LevelFormat.LOWER_ROMAN
          : /^[a-z][.)]$/i.test(mark) ? D.LevelFormat.LOWER_LETTER : D.LevelFormat.DECIMAL
      return {
        level, format,
        text: ordered ? `%${level + 1}${mark.endsWith(')') ? ')' : '.'}` : mark,
        style: { paragraph: { indent: {
          left: ptTwips(bounded(profile.lists.indentation, 24, 0, 72) * (level + 1)),
          hanging: ptTwips(12),
        } } },
      }
    }) })
  }
  const bodyRun = (text: string, options: Record<string, unknown> = {}): InstanceType<typeof D.TextRun> =>
    new D.TextRun({ text, ...options })
  const linkedText = (text: string): ParagraphChild[] => {
    const children: ParagraphChild[] = []
    let position = 0
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const start = match.index!
      if (start > position) children.push(bodyRun(text.slice(position, start)))
      const url = match[0].replace(/[.,;!?)]*$/, '')
      const suffix = match[0].slice(url.length)
      children.push(new D.ExternalHyperlink({
        link: url,
        children: [bodyRun(url, { color: color(profile.linkColor ?? profile.links.color),
          underline: profile.links.underline ? {} : undefined })],
      }))
      if (suffix) children.push(bodyRun(suffix))
      position = start + match[0].length
    }
    if (position < text.length || children.length === 0) children.push(bodyRun(text.slice(position)))
    return children
  }
  const textParagraph = (text: string, style = 'AuthorBody', options: IParagraphOptions = {}): InstanceType<typeof D.Paragraph> =>
    new D.Paragraph({ style, children: linkedText(text), ...options })
  const heading = (text: string, level: 1 | 2 | 3 | 4, topicId?: string): InstanceType<typeof D.Paragraph> => {
    const run = new D.TextRun({ text })
    return new D.Paragraph({
      heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2,
        D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4][level - 1],
      children: topicId ? [new D.Bookmark({ id: `topic_${hexId(topicId)}`, children: [run] })] : [run],
      keepNext: true,
    })
  }
  const children: FileChild[] = []
  if (!coverLayout) children.push(new D.Paragraph({ style: 'Title', children: [
    new D.TextRun({ text: projection.projectName }),
  ] }))
  for (const topic of projection.topics) {
    children.push(heading(topic.title, Math.max(1, Math.min(4, Math.round(topic.level))) as 1 | 2 | 3 | 4, topic.topicId))
    topic.blocks.forEach((base, index) => {
      const block = base as WordBlock
      const text = block.content ?? ''
      if (block.conditions?.length) {
        throw new Error(`Word export cannot safely apply conditions on block "${block.id}" in topic "${topic.title}".`)
      }
      if (index === 0 && block.type === 'h1') return
      if (/^h[1-4]$/.test(block.type)) {
        children.push(heading(text, block.type === 'h1' ? 2 : Number(block.type[1]) as 1 | 2 | 3 | 4))
      } else if (block.type === 'para' || block.type === 'variable') {
        children.push(textParagraph(text))
      } else if (block.type === 'caption') {
        children.push(new D.Paragraph({ style: 'AuthorCaption', children: [
          new D.TextRun({ text }),
        ] }))
      } else if (block.type === 'quote') {
        children.push(new D.Paragraph({ style: 'AuthorQuote', children: [bodyRun(text, { italics: true })],
          indent: { left: mmTwips(7) },
          border: { left: { style: D.BorderStyle.SINGLE, color: color(profile.accentColor ?? profile.primaryColor), size: 16 } },
        }))
      } else if (block.type === 'code') {
        children.push(new D.Paragraph({ style: 'AuthorCode', children: [new D.TextRun({ text })],
          shading: { type: D.ShadingType.SOLID, fill: color(profile.surfaceColor, 'F9F8F6') },
        }))
      } else if (block.type === 'callout') {
        const kind = (['note', 'tip', 'important', 'warning', 'example'].includes(block.calloutVariant ?? '')
          ? block.calloutVariant : 'note') as keyof StyleProfile['callouts']
        const tokens = profile.callouts[kind]
        children.push(new D.Paragraph({
          style: 'AuthorCallout', children: [
            bodyRun(`${tokens.label}: `, { bold: true, color: color(tokens.accentColor) }),
            bodyRun(text, { color: color(tokens.textColor, color(profile.bodyTextColor)) }),
          ],
          shading: { type: D.ShadingType.SOLID, fill: color(tokens.bgColor, 'F9F8F6') },
          border: { left: { style: D.BorderStyle.SINGLE, color: color(tokens.accentColor), size: 16 } },
        }))
      } else if (block.type === 'list') {
        let orderedSequence = 0
        for (const item of block.listItems ?? []) {
          const ordered = item.type === 'ordered'
          if (ordered && item.startFresh) orderedSequence++
          const reference = `list-${hexId(topic.topicId)}-${index}-${ordered ? `ordered-${orderedSequence}` : 'bullet'}`
          numbered(reference, ordered)
          children.push(textParagraph(item.text, 'AuthorList', {
            numbering: { reference, level: Math.min(2, Math.max(0, (item.level ?? 1) - 1)) },
            spacing: { after: ptTwips(profile.lists.itemSpacing) },
          }))
        }
      } else if (block.type === 'procedure') {
        if (text) children.push(textParagraph(text, 'AuthorBody', { keepNext: true }))
        const reference = `steps-${hexId(topic.topicId)}-${index}`
        numbered(reference, true)
        for (const step of block.procedureSteps ?? []) {
          children.push(textParagraph(step, 'AuthorList', { numbering: { reference, level: 0 } }))
        }
      } else if (block.type === 'table' && block.tableData) {
        const rows = block.tableData.rows
        if (!rows.length || !rows.some(row => row.length)) return
        const width = Math.max(...rows.map(row => row.length))
        const rule = { style: D.BorderStyle.SINGLE, color: color(profile.tables.borderColor,
          color(profile.borderColorToken)), size: bounded(profile.tables.borderWidth, 1, 0, 12) * 6 }
        children.push(new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          borders: { top: rule, bottom: rule, left: rule, right: rule, insideHorizontal: rule, insideVertical: rule },
          rows: rows.map((row, rowIndex) => new D.TableRow({
            children: Array.from({ length: width }, (_, cellIndex) => {
              const isHeader = !!block.tableData?.hasHeader && rowIndex === 0
              return new D.TableCell({
                shading: isHeader ? { type: D.ShadingType.SOLID, fill: tableHeaderColor } :
                  profile.tables.alternateRows && rowIndex % 2 ? { type: D.ShadingType.SOLID, fill: color(profile.tables.alternateRowColor) } : undefined,
                children: [new D.Paragraph({
                  style: 'AuthorBody',
                  children: [bodyRun(row[cellIndex] ?? '', {
                    bold: isHeader || (cellIndex === 0 && profile.tables.firstColEmphasis),
                    color: isHeader ? headerColor : color(profile.tables.bodyTextColor, color(bodyColor)),
                  })],
                })],
              })
            }),
          })),
        }))
      } else if (block.type === 'media') {
        if (block.mediaType?.startsWith('data:')) {
          children.push(new D.Paragraph({
            children: [imageRun(block.mediaType, geometry.contentWidthPx, block.caption ?? text)],
            alignment: D.AlignmentType.CENTER,
          }))
          if (block.caption) children.push(new D.Paragraph({
            style: 'AuthorCaption', children: [new D.TextRun({ text: block.caption })],
          }))
        } else if (block.mediaType && !['image', 'video', 'diagram', 'chart'].includes(block.mediaType)) {
          throw new Error(`Word export cannot package media for topic "${topic.title}" without image bytes.`)
        } else {
          if (text && !['Figure caption', 'Video placeholder', 'Diagram placeholder', 'Chart placeholder'].includes(text))
            children.push(textParagraph(text))
          if (block.caption) children.push(new D.Paragraph({
            style: 'AuthorCaption', children: [new D.TextRun({ text: block.caption })],
          }))
        }
      } else if (block.type === 'divider') {
        children.push(new D.Paragraph({ border: { bottom: {
          style: D.BorderStyle.SINGLE, color: color(profile.borderColorToken), size: 6,
        } } }))
      } else if (block.type === 'bookmark') {
        if (text) children.push(textParagraph(text))
      } else {
        if (text) children.push(textParagraph(text))
      }
    })
  }
  if (children.length === 0) children.push(new D.Paragraph({ text: '' }))
  const sections: ISectionOptions[] = []
  if (coverLayout) {
    const cover = pageGeometry(coverLayout, pack)
    const top = zones(coverLayout.topZone ?? [], 'cover')
    const center = zones(coverLayout.centerZone ?? [], 'cover')
    const bottom = zones(coverLayout.bottomZone ?? [], 'cover')
    const hasTitle = [...(coverLayout.topZone ?? []), ...(coverLayout.centerZone ?? []), ...(coverLayout.bottomZone ?? [])]
      .some(zone => zone.visible && /^(title|documenttitle)$/.test(zone.label.toLowerCase().replace(/[^a-z]/g, '')))
    const coverChildren = [...top, ...center, ...bottom]
    if (!hasTitle && pack?.coverShowTitle !== false) {
      coverChildren.push(new D.Paragraph({
        style: 'Title', children: [new D.TextRun({ text: projection.projectName })],
      }))
    }
    sections.push({
      properties: { page: { size: { width: cover.width, height: cover.height }, margin: cover.margins } },
      children: coverChildren.length ? coverChildren : [new D.Paragraph({ text: '' })],
    })
  }
  sections.push({
    properties: {
      page: { size: { width: geometry.width, height: geometry.height }, margin: geometry.margins,
        ...(coverLayout ? { pageNumbers: { start: 1 } } : {}) },
    },
    ...(headers.length ? { headers: { default: new D.Header({ children: headers }) } } : {}),
    ...(footers.length ? { footers: { default: new D.Footer({ children: footers }) } } : {}),
    children,
  })
  const doc = new D.Document({
    sections,
    styles: {
      default: {
        document: { run: roles.body.run, paragraph: roles.body.paragraph },
        title: { run: roles.h1.run, paragraph: roles.h1.paragraph },
        heading1: { run: roles.h1.run, paragraph: roles.h1.paragraph },
        heading2: { run: roles.h2.run, paragraph: roles.h2.paragraph },
        heading3: { run: roles.h3.run, paragraph: roles.h3.paragraph },
        heading4: { run: roles.h4.run, paragraph: roles.h4.paragraph },
      },
      paragraphStyles: [
        { id: 'AuthorBody', name: 'Author Body', run: roles.body.run, paragraph: roles.body.paragraph },
        { id: 'AuthorCaption', name: 'Author Caption', run: roles.caption.run, paragraph: roles.caption.paragraph },
        { id: 'AuthorCode', name: 'Author Code', run: roles.code.run, paragraph: roles.code.paragraph },
        { id: 'AuthorQuote', name: 'Author Quote', run: roles.body.run, paragraph: roles.body.paragraph },
        { id: 'AuthorCallout', name: 'Author Callout', run: roles.body.run, paragraph: roles.body.paragraph },
        { id: 'AuthorList', name: 'Author List', run: roles.body.run, paragraph: roles.body.paragraph },
      ],
    },
    numbering: { config: numberingConfig },
  })
  return D.Packer.toBlob(doc)
}