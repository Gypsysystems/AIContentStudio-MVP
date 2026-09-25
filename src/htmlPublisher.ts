import type { PublishBlock, PublishProjection } from './publishProjection'
import { htmlConditionError, matchesCondition } from './publishConditions'
import { htmlPublisherStyles, type HtmlPalette } from './htmlPublisherStyles'

type Profile = {
  id: string; name: string
  primaryColor?: string; secondaryColor?: string; bgColor?: string; surfaceColor?: string
  headingTextColor?: string; bodyTextColor?: string; linkColor?: string; borderColorToken?: string
  tableHeaderBgToken?: string
  headingFont?: string; bodyFont?: string; logoDataUrl?: string; logoLabel?: string
  h1?: { color?: string; fontFamily?: string; fontSize?: number }
  h2?: { fontSize?: number }; h3?: { fontSize?: number }
  body?: { color?: string; fontFamily?: string; fontSize?: number }
  tables?: { headerBgColor?: string; headerTextColor?: string; borderColor?: string }
  links?: { color?: string; underline?: boolean }
  callouts?: Record<string, { accentColor?: string; bgColor?: string; textColor?: string }>
}
type MasterBlock = { id: string; type: string; props?: Record<string, unknown> }
type Master = {
  id: string; name: string; masterType: string; blocks?: MasterBlock[]
  showHeader?: boolean; showLogo?: boolean; showSearch?: boolean; stickyNav?: boolean
  showHero?: boolean; showNavCards?: boolean; showBreadcrumb?: boolean; showLeftNav?: boolean
  showOnThisPage?: boolean; showPrevNext?: boolean; showFooter?: boolean
  contentWidth?: number; navWidth?: number; otpWidth?: number
}
type HtmlProjection = PublishProjection<
  PublishBlock, Profile, { id: string; name: string },
  { id: string; name: string; layoutType: string }, Master, { id: string; name: string }
>
type Topic = HtmlProjection['topics'][number]
type HtmlConditionOptions = { selectedCondition?: string }

function selectHtmlContent(projection: HtmlProjection, options?: HtmlConditionOptions): HtmlProjection {
  const error = htmlConditionError(projection.topics, options?.selectedCondition)
  if (error) throw new Error(error)
  return {
    ...projection,
    topics: projection.topics.map(topic => ({
      ...topic,
      blocks: topic.blocks.filter(block => matchesCondition(block, options?.selectedCondition)),
    })),
  }
}
type Card = {
  id?: string; title?: string; desc?: string; icon?: string
  destinationType?: string; topicId?: number; url?: string; fileName?: string
}
export type HtmlPublishDiagnostics = {
  topicPages: number
  validCards: number
  unavailableCards: number
  missingAssignedMasters: number
  hiddenTopicBodies: number
  assetError: string | null
}

const escapeHtml = (text: unknown): string =>
  String(text ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const hexId = (id: string): string =>
  Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, '0')).join('')
export const htmlTopicFile = (topicId: string): string => `topics/topic-${hexId(topicId)}.html`
const cleanColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? value : fallback
const cleanFont = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[\w ,.-]{1,80}$/.test(value) ? value.replace(/"/g, '') : fallback
const bounded = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const propText = (props: Record<string, unknown>, key: string): string =>
  typeof props[key] === 'string' ? props[key] as string : ''
const isShown = (value: boolean | undefined): boolean => value !== false

function palette(profile: Profile): HtmlPalette {
  const primary = cleanColor(profile.primaryColor, '#5B5BD6')
  const body = cleanColor(profile.bodyTextColor ?? profile.body?.color, '#2A2A3A')
  return {
    primary,
    page: cleanColor(profile.bgColor, '#FFFFFF'),
    surface: cleanColor(profile.surfaceColor, '#F9F8F6'),
    heading: cleanColor(profile.headingTextColor ?? profile.h1?.color, '#111218'),
    body,
    link: cleanColor(profile.linkColor ?? profile.links?.color, primary),
    border: cleanColor(profile.borderColorToken ?? profile.tables?.borderColor, '#E2DED7'),
    headerText: cleanColor(profile.surfaceColor, '#FFFFFF'),
    footer: cleanColor(profile.secondaryColor, primary),
    headingFont: cleanFont(profile.headingFont ?? profile.h1?.fontFamily, 'Arial'),
    bodyFont: cleanFont(profile.bodyFont ?? profile.body?.fontFamily, 'Arial'),
    h1Size: bounded(profile.h1?.fontSize, 32, 18, 64),
    h2Size: bounded(profile.h2?.fontSize, 24, 16, 48),
    h3Size: bounded(profile.h3?.fontSize, 20, 14, 40),
    bodySize: bounded(profile.body?.fontSize, 16, 10, 26),
    tableHeader: cleanColor(profile.tableHeaderBgToken ?? profile.tables?.headerBgColor, primary),
    tableHeaderText: cleanColor(profile.tables?.headerTextColor, '#FFFFFF'),
    underlineLinks: profile.links?.underline !== false,
    callouts: Object.fromEntries(['note', 'tip', 'important', 'warning', 'example'].map(kind => [kind, {
      accent: cleanColor(profile.callouts?.[kind]?.accentColor, primary),
      background: cleanColor(profile.callouts?.[kind]?.bgColor, cleanColor(profile.surfaceColor, '#F9F8F6')),
      text: cleanColor(profile.callouts?.[kind]?.textColor, body),
    }])),
  }
}

function blocksFor(master: Master | null, home: boolean): MasterBlock[] {
  if (master?.blocks) return master.blocks
  return home
    ? [{ id: 'header', type: 'header' }, { id: 'hero', type: 'hero' },
       { id: 'cards', type: 'navigation-cards' }, { id: 'footer', type: 'footer' }]
    : [{ id: 'header', type: 'header' }, { id: 'breadcrumb', type: 'breadcrumb' },
       { id: 'body', type: 'body' }, { id: 'prevnext', type: 'prevnext' }, { id: 'footer', type: 'footer' }]
}

function assetExtension(data: string): { extension: string; base64: string } {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(data)
  if (!match) throw new Error('HTML export requires a supported raster image data URL (PNG, JPEG, WebP, GIF, or AVIF).')
  return {
    extension: match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase(),
    base64: match[2].replace(/\s/g, ''),
  }
}

function assetInfo(data: string): { extension: string; bytes: Uint8Array } {
  const { extension, base64 } = assetExtension(data)
  try {
    const raw = atob(base64)
    if (!raw.length) throw new Error('Empty image')
    const start = (prefix: number[]): boolean =>
      prefix.every((value, index) => raw.charCodeAt(index) === value)
    const actualImage =
      (extension === 'png' && start([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (extension === 'jpg' && start([255, 216, 255])) ||
      (extension === 'gif' && /^GIF8[79]a/.test(raw)) ||
      (extension === 'webp' && raw.startsWith('RIFF') && raw.slice(8, 12) === 'WEBP') ||
      (extension === 'avif' && raw.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(raw.slice(8, 12)))
    if (!actualImage) throw new Error('Image bytes do not match type')
    return {
      extension,
      bytes: Uint8Array.from(raw, character => character.charCodeAt(0)),
    }
  } catch {
    throw new Error('HTML export could not decode an image asset.')
  }
}

function assetPaths(projection: HtmlProjection): string[] {
  const paths: string[] = []
  if (projection.styleProfile.logoDataUrl && !projection.styleProfile.logoDataUrl.startsWith('data:')) {
    throw new Error('HTML export cannot package a logo that is not a data URL.')
  }
  if (projection.styleProfile.logoDataUrl?.startsWith('data:')) {
    paths.push(`assets/logo.${assetInfo(projection.styleProfile.logoDataUrl).extension}`)
  }
  for (const topic of projection.topics) {
    topic.blocks.forEach((block, index) => {
      if (block.type === 'media' && block.mediaType && !block.mediaType.startsWith('data:')
        && !['image', 'video', 'diagram', 'chart'].includes(block.mediaType)) {
        throw new Error('HTML export cannot package an external media URL without its file bytes.')
      }
      if (block.type === 'media' && block.mediaType?.startsWith('data:')) {
        paths.push(`assets/media-${hexId(topic.topicId)}-${index}.${assetInfo(block.mediaType).extension}`)
      }
    })
  }
  return paths
}

function cardsFor(block: MasterBlock, topics: Topic[]): Card[] {
  if (Array.isArray(block.props?.cards)) return block.props.cards as Card[]
  // Legacy masters had only a cards block; use real committed topics, never demo cards.
  return topics.map(topic => ({
    id: topic.topicId, title: topic.title, desc: '', icon: '',
    destinationType: 'topic', topicId: topic.legacyId,
  }))
}

function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function cardDestination(card: Card, topics: Topic[], assets: string[], prefix: string):
  { href: string | null; label: string; external: boolean } {
  if (card.destinationType === 'topic') {
    const topic = topics.find(entry => entry.legacyId === card.topicId)
    return topic
      ? { href: prefix + htmlTopicFile(topic.topicId), label: topic.title, external: false }
      : { href: null, label: 'Referenced topic is unavailable', external: false }
  }
  if (card.destinationType === 'external-url') {
    const href = safeExternalUrl(card.url)
    return { href, label: href ?? 'External URL is unavailable', external: !!href }
  }
  if (card.destinationType === 'file') {
    // A filename alone does not provide file bytes. Link only to a unique asset
    // already packaged in this ZIP; otherwise show an unavailable card.
    const matches = assets.filter(path =>
      path === card.fileName || path.split('/').pop() === card.fileName)
    return matches.length === 1
      ? { href: prefix + matches[0], label: card.fileName!, external: false }
      : { href: null, label: 'File is not included in this package', external: false }
  }
  return { href: null, label: 'No destination selected', external: false }
}

export function getHtmlPublishDiagnostics(source: HtmlProjection, options?: HtmlConditionOptions): HtmlPublishDiagnostics {
  const projection = htmlConditionError(source.topics, options?.selectedCondition)
    ? source : selectHtmlContent(source, options)
  let assets: string[] = []
  let assetError: string | null = null
  try { assets = assetPaths(projection) } catch (error) { assetError = (error as Error).message }
  let validCards = 0
  let unavailableCards = 0
  for (const master of [projection.homeMaster, ...projection.topics.map(topic =>
    topic.assignedMaster ?? projection.defaultTopicMaster)]) {
    if (!master || !isShown(master.showNavCards)) continue
    for (const block of blocksFor(master, master === projection.homeMaster)) {
      if ((block.type !== 'navigation-cards' && block.type !== 'cards') || block.props?.hidden) continue
      for (const card of cardsFor(block, projection.topics)) {
        if (cardDestination(card, projection.topics, assets, '').href) validCards++
        else unavailableCards++
      }
    }
  }
  return {
    topicPages: projection.topics.length,
    validCards,
    unavailableCards,
    missingAssignedMasters: projection.topics.filter(topic =>
      topic.assignedMasterId && !topic.assignedMaster).length,
    hiddenTopicBodies: projection.topics.filter(topic =>
      blocksFor(topic.assignedMaster ?? projection.defaultTopicMaster, false).some(block =>
        block.type === 'body' && !!block.props?.hidden)).length,
    assetError,
  }
}

function contentText(block: PublishBlock): string {
  return [block.content, block.caption, ...(block.listItems?.map(item => item.text) ?? []),
    ...(block.procedureSteps ?? []), ...(block.tableData?.rows.flat() ?? [])].filter(Boolean).join(' ')
}

function renderAuthoredBlock(block: PublishBlock, index: number, mediaPath?: string): string {
  const text = escapeHtml(block.content)
  if (/^h[1-4]$/.test(block.type)) {
    const level = block.type === 'h1' ? 'h2' : block.type
    return `<${level} id="section-${index}">${text}</${level}>`
  }
  if (block.type === 'para' || block.type === 'caption') return text ? `<p>${text}</p>` : ''
  if (block.type === 'quote') return `<blockquote>${text}</blockquote>`
  if (block.type === 'code') return `<pre><code>${text}</code></pre>`
  if (block.type === 'divider') return '<hr>'
  if (block.type === 'callout') {
    const variant = (block as PublishBlock & { calloutVariant?: string }).calloutVariant ?? 'note'
    const safeVariant = ['note', 'tip', 'important', 'warning', 'example'].includes(variant) ? variant : 'note'
    return `<aside class="callout ${safeVariant}"><strong>${escapeHtml(variant)}</strong> ${text}</aside>`
  }
  if (block.type === 'list' && block.listItems) {
    const ordered = (block.listItems[0] as { type?: string } | undefined)?.type === 'ordered'
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag}>${block.listItems.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</${tag}>`
  }
  if (block.type === 'procedure') return `<section><p><strong>${text}</strong></p><ol>${
    (block.procedureSteps ?? []).map(step => `<li class="procedure-step">${escapeHtml(step)}</li>`).join('')}</ol></section>`
  if (block.type === 'table' && block.tableData) {
    const hasHeader = (block.tableData as { hasHeader?: boolean }).hasHeader
    return `<table>${block.tableData.rows.map((row, rowIndex) =>
      `<tr>${row.map(cell => `<${hasHeader && rowIndex === 0 ? 'th' : 'td'}>${escapeHtml(cell)}</${
        hasHeader && rowIndex === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`
  }
  if (block.type === 'media') return mediaPath
    ? `<figure><img src="../${escapeHtml(mediaPath)}" alt="${escapeHtml(block.caption || '')}" loading="lazy">${
        block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`
    : ''
  return text ? `<p>${text}</p>` : ''
}

function searchScript(topics: Topic[]): string {
  const entries = topics.map(topic => ({
    title: topic.title, href: htmlTopicFile(topic.topicId),
    text: topic.blocks.map(contentText).join(' ').toLowerCase(),
  }))
  return `(()=>{const entries=${JSON.stringify(entries)};document.querySelectorAll('[data-search]').forEach(input=>{
const output=input.parentElement.querySelector('.search-results');
input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();output.replaceChildren();
if(!query)return;for(const entry of entries.filter(item=>(item.title+' '+item.text).toLowerCase().includes(query)).slice(0,20)){
const link=document.createElement('a');link.href=(location.pathname.includes('/topics/')?'../':'')+entry.href;
link.textContent=entry.title;output.append(link)}})})})();`
}

export async function generateHtmlPackage(source: HtmlProjection, options?: HtmlConditionOptions): Promise<Blob> {
  // Validate before adding content, search entries, or assets to the package.
  const projection = selectHtmlContent(source, options)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const colors = palette(projection.styleProfile)
  const assets = new Map<string, Uint8Array>()
  const mediaByTopic = new Map<string, Map<number, string>>()
  // Use the same media validation as pre-publish QA before writing any files.
  assetPaths(projection)
  if (projection.styleProfile.logoDataUrl?.startsWith('data:')) {
    const logo = assetInfo(projection.styleProfile.logoDataUrl)
    assets.set(`assets/logo.${logo.extension}`, logo.bytes)
  }
  for (const topic of projection.topics) {
    const media = new Map<number, string>()
    topic.blocks.forEach((block, index) => {
      if (block.type !== 'media' || !block.mediaType?.startsWith('data:')) return
      const image = assetInfo(block.mediaType)
      const path = `assets/media-${hexId(topic.topicId)}-${index}.${image.extension}`
      assets.set(path, image.bytes)
      media.set(index, path)
    })
    mediaByTopic.set(topic.topicId, media)
  }
  const bundledAssets = [...assets.keys()]
  const logoPath = bundledAssets.find(path => path.startsWith('assets/logo.'))

  const nav = (prefix: string, activeId?: string): string =>
    `<nav aria-label="Topics"><a href="${prefix}index.html">Home</a>${projection.topics.map(topic =>
      `<a href="${prefix}${htmlTopicFile(topic.topicId)}"${
        activeId === topic.topicId ? ' aria-current="page"' : ''}>${escapeHtml(topic.title)}</a>`).join('')}</nav>`
  const search = () =>
    '<div class="search"><input type="search" data-search aria-label="Search published topics" placeholder="Search topics"><div class="search-results" aria-live="polite"></div></div>'

  const page = (topic?: Topic): string => {
    const home = !topic
    const master = home ? projection.homeMaster : topic.assignedMaster ?? projection.defaultTopicMaster
    const masterBlocks = blocksFor(master, home)
    if (topic && masterBlocks.some(block => block.type === 'body' && block.props?.hidden)) {
      throw new Error(`HTML export cannot publish "${topic.title}": its master hides the topic Body block.`)
    }
    const prefix = home ? '' : '../'
    const showSeparateSearch = masterBlocks.some(block => block.type === 'search' && !block.props?.hidden)
    const sectionLinks = topic?.blocks.flatMap((block, index) =>
      /^h[2-4]$/.test(block.type) ? [{ title: block.content, index }] : []) ?? []
    const mainContent = topic
      ? `<article><h1>${escapeHtml(topic.title)}</h1>${topic.blocks.map((block, index) =>
          index === 0 && block.type === 'h1' ? '' :
            renderAuthoredBlock(block, index, mediaByTopic.get(topic.topicId)?.get(index))).join('\n')}</article>`
      : `<section><h1>${escapeHtml(projection.projectName)}</h1><ul class="topic-list">${projection.topics.map(item =>
          `<li><a href="${htmlTopicFile(item.topicId)}">${escapeHtml(item.title)}</a></li>`).join('')}</ul></section>`
    const body = () =>
      `<div class="container body-layout">${master?.showLeftNav ? `<aside class="sidebar">${nav(prefix, topic?.topicId)}</aside>` : ''}<main class="content">${mainContent}</main>${
        topic && master?.showOnThisPage && sectionLinks.length
          ? `<aside class="on-this-page"><strong>On this page</strong>${sectionLinks.map(section =>
              `<a href="#section-${section.index}">${escapeHtml(section.title)}</a>`).join('')}</aside>` : ''}</div>`

    const renderMasterBlock = (block: MasterBlock): string => {
      const props = block.props ?? {}
      if (props.hidden) return ''
      if (block.type === 'header') {
        if (!isShown(master?.showHeader)) return ''
        const bg = cleanColor(props.bgColor, colors.primary)
        const text = cleanColor(props.textColor, colors.headerText)
        return `<header class="site-header${master?.stickyNav ? ' sticky' : ''}" style="background-color:${bg};color:${text}">${
          isShown(master?.showLogo) ? logoPath
            ? `<img class="logo" src="${prefix}${logoPath}" alt="${escapeHtml(
                projection.styleProfile.logoLabel ?? projection.styleProfile.name)}">`
            : `<span class="logo-label">${escapeHtml(projection.styleProfile.logoLabel ?? projection.styleProfile.name)}</span>` : ''
        }<a class="site-title" href="${prefix}index.html">${escapeHtml(propText(props, 'siteTitle') || projection.projectName)}</a>${
          master?.showSearch && !showSeparateSearch ? search() : ''}</header>`
      }
      if (block.type === 'hero') return master?.showHero === false ? '' :
        `<section class="hero" style="background-color:${cleanColor(props.bgColor, colors.primary)};text-align:${
          ['left', 'center', 'right'].includes(String(props.alignment)) ? props.alignment : 'center'}"><h1>${
          escapeHtml(propText(props, 'heading') || projection.projectName)}</h1>${
          props.description ? `<p>${escapeHtml(props.description)}</p>` : ''}</section>`
      if (block.type === 'navigation-cards' || block.type === 'cards') {
        if (master?.showNavCards === false) return ''
        const cards = cardsFor(block, projection.topics)
        return `<section class="container"><h2>${escapeHtml(propText(props, 'title') || 'Topics')}</h2><div class="cards" style="--columns:${
          bounded(props.columns, 3, 1, 4)}">${cards.map(card => {
            const destination = cardDestination(card, projection.topics, bundledAssets, prefix)
            const label = `<span class="icon">${escapeHtml(card.icon)}</span><h3>${escapeHtml(card.title)}</h3>${
              card.desc ? `<p>${escapeHtml(card.desc)}</p>` : ''}<small>${escapeHtml(destination.label)}</small>`
            return destination.href
              ? `<div class="card" data-link-state="valid"><a href="${escapeHtml(destination.href)}"${
                  destination.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a></div>`
              : `<div class="card unavailable" data-link-state="unavailable" aria-disabled="true">${label}</div>`
          }).join('')}</div></section>`
      }
      if (block.type === 'breadcrumb') return topic && isShown(master?.showBreadcrumb)
        ? `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a> › ${escapeHtml(topic.title)}</nav>` : ''
      if (block.type === 'body') return body()
      if (block.type === 'prevnext' || block.type === 'previous-/-next') {
        if (!topic || master?.showPrevNext === false) return ''
        const index = projection.topics.indexOf(topic)
        const previous = projection.topics[index - 1], next = projection.topics[index + 1]
        return `<nav class="container prev-next" aria-label="Adjacent topics"><span>${
          previous ? `<a href="${prefix}${htmlTopicFile(previous.topicId)}">← ${escapeHtml(previous.title)}</a>` : ''}</span><span>${
          next ? `<a href="${prefix}${htmlTopicFile(next.topicId)}">${escapeHtml(next.title)} →</a>` : ''}</span></nav>`
      }
      if (block.type === 'footer') return isShown(master?.showFooter)
        ? `<footer class="site-footer" style="background-color:${cleanColor(props.bgColor, colors.footer)};color:${
          cleanColor(props.textColor, colors.headerText)}">${escapeHtml(propText(props, 'copyrightText') || projection.projectName)}</footer>` : ''
      if (block.type === 'search') return master?.showSearch ? `<div class="container">${search()}</div>` : ''
      if (block.type === 'heading') {
        const level = bounded(props.level, 2, 1, 3)
        return `<section class="container"><h${level}>${escapeHtml(propText(props, 'text'))}</h${level}></section>`
      }
      if (block.type === 'welcome-text' || block.type === 'image-+-text')
        return `<section class="container" style="background-color:${cleanColor(props.bgColor, colors.page)}">${
          props.heading ? `<h2>${escapeHtml(props.heading)}</h2>` : ''}<p>${escapeHtml(propText(props, 'body'))}</p></section>`
      if (block.type === 'rich-text')
        return `<section class="container"><p>${escapeHtml(propText(props, 'content'))}</p></section>`
      if (block.type === 'announcement-banner')
        return `<aside class="container note">${escapeHtml(propText(props, 'text'))}</aside>`
      if (block.type === 'featured-links') {
        const links = Array.isArray(props.links) ? props.links as Array<{ label?: string }> : []
        return `<section class="container"><h2>${escapeHtml(propText(props, 'title'))}</h2>${
          links.map(link => `<span class="card unavailable" aria-disabled="true">${escapeHtml(link.label)}</span>`).join('')}</section>`
      }
      if (block.type === 'recent-content') {
        const count = bounded(props.count, 5, 1, 20)
        return `<section class="container"><h2>Topics</h2><ul class="topic-list">${projection.topics.slice(0, count).map(item =>
          `<li><a href="${prefix}${htmlTopicFile(item.topicId)}">${escapeHtml(item.title)}</a></li>`).join('')}</ul></section>`
      }
      if (block.type === 'accordion-/-faq') {
        const items = Array.isArray(props.items) ? props.items as Array<{ q?: string; a?: string }> : []
        return `<section class="container"><h2>${escapeHtml(propText(props, 'title'))}</h2>${
          items.map(item => `<details><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`).join('')}</section>`
      }
      if (block.type === 'checklist') {
        const items = Array.isArray(props.items) ? props.items as Array<{ text?: string }> : []
        return `<section class="container"><ul>${items.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul></section>`
      }
      if (block.type === 'tabs') {
        const tabs = Array.isArray(props.tabs) ? props.tabs as Array<{ label?: string; content?: string }> : []
        return `<section class="container">${tabs.map(tab =>
          `<details><summary>${escapeHtml(tab.label)}</summary><p>${escapeHtml(tab.content)}</p></details>`).join('')}</section>`
      }
      if (block.type === 'progress-bar') {
        const value = bounded(props.value, 0, 0, 100)
        return `<section class="container"><label>${escapeHtml(propText(props, 'label'))}<progress max="100" value="${value}"></progress></label></section>`
      }
      if (block.type === 'button-/-cta') {
        const href = safeExternalUrl(propText(props, 'href'))
        return `<div class="container">${href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(propText(props, 'label'))}</a>`
          : `<span aria-disabled="true">${escapeHtml(propText(props, 'label'))}</span>`}</div>`
      }
      if (block.type === 'divider') return '<hr>'
      if (block.type === 'spacer') return '<div class="container" aria-hidden="true"></div>'
      throw new Error(`HTML export does not support master block "${block.type}".`)
    }

    const rendered = masterBlocks.filter(block => !block.props?.hidden).map(renderMasterBlock)
    const cardTopicIds = new Set(masterBlocks.flatMap(block =>
      !home || block.props?.hidden || master?.showNavCards === false
        || !['navigation-cards', 'cards'].includes(block.type) ? [] :
        cardsFor(block, projection.topics).filter(card => card.destinationType === 'topic' &&
          projection.topics.some(item => item.legacyId === card.topicId)).map(card => card.topicId)))
    if (!masterBlocks.some(block => block.type === 'body' && !block.props?.hidden)
      && (topic || cardTopicIds.size < projection.topics.length)) {
      rendered.push(body())
    }
    const maxWidth = bounded(master?.contentWidth, 1200, 600, 1600)
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
      escapeHtml(topic ? `${topic.title} — ${projection.projectName}` : projection.projectName)}</title><link rel="stylesheet" href="${prefix}css/theme.css">${
      master?.showSearch ? `<script defer src="${prefix}js/search.js"></script>` : ''}</head><body data-master-id="${
      escapeHtml(master?.id ?? '')}" style="--content-width:${maxWidth}px;--nav-width:${
      bounded(master?.navWidth, 280, 120, 420)}px;--otp-width:${bounded(master?.otpWidth, 220, 120, 320)}px">${
      rendered.join('\n')}</body></html>`
  }

  zip.file('index.html', page())
  projection.topics.forEach(topic => zip.file(htmlTopicFile(topic.topicId), page(topic)))
  zip.file('css/theme.css', htmlPublisherStyles(colors))
  if ([projection.homeMaster, projection.defaultTopicMaster, ...projection.topics.map(topic =>
    topic.assignedMaster)].some(master => master?.showSearch)) {
    zip.file('js/search.js', searchScript(projection.topics))
  }
  for (const [path, bytes] of assets) zip.file(path, bytes)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}