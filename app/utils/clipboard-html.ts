export interface ClipboardContent {
  html: string
  text: string
}

export interface ClipboardCleanOptions {
  baseUrl?: string
  useCodeSource?: boolean
}

interface CleanContext {
  inertDocument: Document
  baseUrl: string
  useCodeSource: boolean
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const DOCUMENT_PREAMBLE = '<meta charset="utf-8">'
const WRAPPER_STYLE = 'font-size: 12px'
const LIST_STYLE = 'margin: 0'
const BLOCKQUOTE_STYLE = 'margin: 0 0 0 1em'
const PRE_STYLE = 'margin: 0'
const CODE_SOURCE_ATTRIBUTE = 'data-code-source'
const SKIP_CLASS = 'js-clipboard-skip'

const REMOVED_TAGS: ReadonlySet<string> = new Set([
  'button',
  'svg',
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'input',
  'select',
  'textarea',
  'canvas',
  'video',
  'audio',
  'form',
  'link',
  'meta',
])

const KEPT_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'hr',
  'del',
  's',
  'sup',
  'sub',
  'img',
])

const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  ol: ['start'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  img: ['src', 'alt', 'width', 'height'],
}

const LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
])

const IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'section',
  'article',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

const INLINE_RENAMES: Readonly<Record<string, string>> = {
  strong: 'b',
  em: 'i',
}

const LAYOUT_BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'table',
  'hr',
])

const LIST_TAGS: ReadonlySet<string> = new Set(['ul', 'ol'])
const HEADING_PATTERN = /^h[1-6]$/

interface LayoutBlock {
  node: Node
  isParagraph: boolean
  isList: boolean
}

const WRAPPED_ANCESTORS: ReadonlySet<string> = new Set([
  'ul',
  'ol',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
])

const OUTER_WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  tr: ['tbody', 'table'],
  tbody: ['table'],
  thead: ['table'],
  tfoot: ['table'],
}

function getDefaultBaseUrl(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.location.href
}

function createInertDocument(): Document {
  return document.implementation.createHTMLDocument('')
}

function resolveUrl(
  value: string,
  protocols: ReadonlySet<string>,
  baseUrl: string,
): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  let url: URL

  try {
    url = new URL(trimmed, baseUrl || undefined)
  } catch {
    return null
  }

  if (!protocols.has(url.protocol)) {
    return null
  }

  return ABSOLUTE_URL_PATTERN.test(trimmed) ? trimmed : url.href
}

function buildCodeBlock(
  inertDocument: Document,
  source: string,
): HTMLElement {
  const pre = inertDocument.createElement('pre')
  const code = inertDocument.createElement('code')

  code.textContent = source.replace(/\n+$/, '')
  pre.appendChild(code)

  return pre
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode

  if (!parent) {
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  parent.removeChild(element)
}

function replaceNode(node: Node, replacement: Node): void {
  node.parentNode?.replaceChild(replacement, node)
}

function removeNode(node: Node): void {
  node.parentNode?.removeChild(node)
}

function isSkippedElement(element: Element): boolean {
  return element.classList.contains(SKIP_CLASS)
    || element.getAttribute('aria-hidden') === 'true'
    || element.hasAttribute('hidden')
}

function stripAttributes(element: Element, tag: string): void {
  const allowed = KEPT_ATTRIBUTES[tag] ?? []

  for (const name of element.getAttributeNames()) {
    if (!allowed.includes(name)) {
      element.removeAttribute(name)
    }
  }
}

function sanitizeAnchor(anchor: Element, context: CleanContext): void {
  const href = resolveUrl(
    anchor.getAttribute('href') ?? '',
    LINK_PROTOCOLS,
    context.baseUrl,
  )

  if (!href) {
    unwrapElement(anchor)

    return
  }

  anchor.setAttribute('href', href)
}

function sanitizeImage(image: Element, context: CleanContext): void {
  const source = image.getAttribute('src') ?? ''
  const resolved = DATA_IMAGE_PATTERN.test(source.trim())
    ? source.trim()
    : resolveUrl(source, IMAGE_PROTOCOLS, context.baseUrl)

  if (!resolved) {
    removeNode(image)

    return
  }

  image.setAttribute('src', resolved)
}

function decorateTable(table: Element): void {
  table.setAttribute('border', '1')
  table.setAttribute('cellpadding', '6')
  table.setAttribute('cellspacing', '0')
}

function cleanElement(element: Element, context: CleanContext): void {
  const tag = element.tagName.toLowerCase()

  if (REMOVED_TAGS.has(tag) || isSkippedElement(element)) {
    removeNode(element)

    return
  }

  if (context.useCodeSource && element.hasAttribute(CODE_SOURCE_ATTRIBUTE)) {
    replaceNode(
      element,
      buildCodeBlock(
        context.inertDocument,
        element.getAttribute(CODE_SOURCE_ATTRIBUTE) ?? '',
      ),
    )

    return
  }

  if (tag === 'pre') {
    replaceNode(
      element,
      buildCodeBlock(context.inertDocument, element.textContent ?? ''),
    )

    return
  }

  cleanChildren(element, context)

  if (!KEPT_TAGS.has(tag)) {
    unwrapElement(element)

    return
  }

  stripAttributes(element, tag)

  if (tag === 'a') {
    sanitizeAnchor(element, context)
  } else if (tag === 'img') {
    sanitizeImage(element, context)
  } else if (tag === 'table') {
    decorateTable(element)
  }
}

function cleanChildren(parent: Node, context: CleanContext): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === ELEMENT_NODE) {
      cleanElement(child as Element, context)
    } else if (child.nodeType !== TEXT_NODE) {
      removeNode(child)
    }
  }
}

function cleanContainer(
  container: HTMLElement,
  options: ClipboardCleanOptions,
): void {
  cleanChildren(container, {
    inertDocument: container.ownerDocument,
    baseUrl: options.baseUrl ?? getDefaultBaseUrl(),
    useCodeSource: options.useCodeSource ?? true,
  })
}

function getTagName(node: Node): string {
  return node.nodeType === ELEMENT_NODE
    ? (node as Element).tagName.toLowerCase()
    : ''
}

function renameElement(element: Element, tagName: string): Element {
  const renamed = element.ownerDocument.createElement(tagName)

  while (element.firstChild) {
    renamed.appendChild(element.firstChild)
  }

  replaceNode(element, renamed)

  return renamed
}

function createSpacer(inertDocument: Document): HTMLElement {
  const spacer = inertDocument.createElement('div')

  spacer.appendChild(inertDocument.createElement('br'))

  return spacer
}

function renameInlineTags(container: HTMLElement): void {
  const elements = Array.from(container.querySelectorAll('strong, em'))

  for (const element of elements) {
    renameElement(element, INLINE_RENAMES[getTagName(element)]!)
  }
}

function flattenListItemParagraphs(item: Element): void {
  let previousWasParagraph = false

  for (const child of Array.from(item.children)) {
    const tag = getTagName(child)

    if (tag === 'p') {
      if (previousWasParagraph) {
        item.insertBefore(item.ownerDocument.createElement('br'), child)
      }

      unwrapElement(child)
      previousWasParagraph = true

      continue
    }

    previousWasParagraph = false

    if (LIST_TAGS.has(tag)) {
      layoutList(child)
    }
  }
}

function layoutList(list: Element): void {
  list.setAttribute('style', LIST_STYLE)

  for (const item of Array.from(list.children)) {
    if (getTagName(item) === 'li') {
      flattenListItemParagraphs(item)
    }
  }
}

function layoutHeading(heading: Element): Element {
  const inertDocument = heading.ownerDocument
  const line = inertDocument.createElement('div')
  const bold = inertDocument.createElement('b')

  while (heading.firstChild) {
    bold.appendChild(heading.firstChild)
  }

  line.appendChild(bold)
  replaceNode(heading, line)

  return line
}

function layoutBlock(element: Element): LayoutBlock {
  const tag = getTagName(element)

  if (tag === 'p') {
    return {
      node: renameElement(element, 'div'),
      isParagraph: true,
      isList: false,
    }
  }

  if (HEADING_PATTERN.test(tag)) {
    return {
      node: layoutHeading(element),
      isParagraph: false,
      isList: false,
    }
  }

  if (LIST_TAGS.has(tag)) {
    layoutList(element)

    return { node: element, isParagraph: false, isList: true }
  }

  if (tag === 'blockquote') {
    element.setAttribute('style', BLOCKQUOTE_STYLE)
    layoutBlocks(element)
  } else if (tag === 'pre') {
    element.setAttribute('style', PRE_STYLE)
  }

  return { node: element, isParagraph: false, isList: false }
}

function layoutBlocks(parent: Element): void {
  const inertDocument = parent.ownerDocument
  const blocks: LayoutBlock[] = []
  let inlineRun: Node[] = []

  function flushInlineRun(): void {
    const hasContent = inlineRun.some((node) => {
      return node.nodeType !== TEXT_NODE || !!node.textContent?.trim()
    })

    if (hasContent) {
      const line = inertDocument.createElement('div')

      for (const node of inlineRun) {
        line.appendChild(node)
      }

      blocks.push({ node: line, isParagraph: true, isList: false })
    }

    inlineRun = []
  }

  for (const child of Array.from(parent.childNodes)) {
    if (LAYOUT_BLOCK_TAGS.has(getTagName(child))) {
      flushInlineRun()
      blocks.push(layoutBlock(child as Element))

      continue
    }

    inlineRun.push(child)
  }

  flushInlineRun()

  while (parent.firstChild) {
    parent.removeChild(parent.firstChild)
  }

  blocks.forEach((block, index) => {
    const previous = blocks[index - 1]

    if (previous && !(previous.isParagraph && block.isList)) {
      parent.appendChild(createSpacer(inertDocument))
    }

    parent.appendChild(block.node)
  })
}

function applyMailLayout(container: HTMLElement): void {
  renameInlineTags(container)

  const hasBlock = Array.from(container.children).some((child) => {
    return LAYOUT_BLOCK_TAGS.has(getTagName(child))
  })

  if (!hasBlock) {
    return
  }

  const wrapper = container.ownerDocument.createElement('div')

  wrapper.setAttribute('style', WRAPPER_STYLE)

  while (container.firstChild) {
    wrapper.appendChild(container.firstChild)
  }

  layoutBlocks(wrapper)
  container.appendChild(wrapper)
}

function serializeContainer(container: HTMLElement): string {
  const layout = container.cloneNode(true) as HTMLElement

  applyMailLayout(layout)

  const html = layout.innerHTML

  return html.trim() ? `${DOCUMENT_PREAMBLE}${html}` : ''
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, ' ')
}

function normalizeInlineText(text: string): string {
  return text
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function normalizeLinkFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

function renderLink(anchor: Element): string {
  const text = renderInlineChildren(anchor)
  const href = anchor.getAttribute('href') ?? ''

  if (!href) {
    return text
  }

  if (!text.trim()) {
    return href
  }

  if (normalizeLinkFragment(href) === normalizeLinkFragment(text)) {
    return href
  }

  return `${text} (${href})`
}

function renderInline(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    return collapseWhitespace(node.textContent ?? '')
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return ''
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (tag === 'br') {
    return '\n'
  }

  if (tag === 'a') {
    return renderLink(element)
  }

  if (tag === 'img') {
    return element.getAttribute('alt') ?? ''
  }

  return renderInlineChildren(element)
}

function renderInlineChildren(parent: Node): string {
  return Array.from(parent.childNodes).map(renderInline).join('')
}

function parseListStart(list: Element): number {
  const start = Number.parseInt(list.getAttribute('start') ?? '', 10)

  return Number.isNaN(start) ? 1 : start
}

function renderListItem(item: Element, marker: string): string {
  const body = renderBlocks(item).join('\n')

  if (!body) {
    return marker.trimEnd()
  }

  const indent = ' '.repeat(marker.length)
  const [firstLine, ...otherLines] = body.split('\n')

  return [
    `${marker}${firstLine}`,
    ...otherLines.map((line) => {
      return line ? `${indent}${line}` : line
    }),
  ].join('\n')
}

function renderList(list: Element, isOrdered: boolean): string {
  let number = isOrdered ? parseListStart(list) : 0
  const items: string[] = []

  for (const child of Array.from(list.children)) {
    if (child.tagName.toLowerCase() !== 'li') {
      continue
    }

    items.push(renderListItem(child, isOrdered ? `${number}. ` : '- '))
    number += 1
  }

  return items.join('\n')
}

function renderTableCell(cell: Element): string {
  return renderBlocks(cell).join(' ').replace(/\s*\n\s*/g, ' ')
}

function renderTableRow(row: Element): string {
  return Array.from(row.children)
    .filter((cell) => {
      const tag = cell.tagName.toLowerCase()

      return tag === 'td' || tag === 'th'
    })
    .map(renderTableCell)
    .join(' | ')
}

function renderTableRows(table: Element): string {
  return Array.from(table.querySelectorAll('tr'))
    .map(renderTableRow)
    .join('\n')
}

function renderBlockquote(element: Element): string {
  return renderBlocks(element)
    .join('\n\n')
    .split('\n')
    .map((line) => {
      return line ? `> ${line}` : '>'
    })
    .join('\n')
}

function renderBlock(element: Element): string {
  const tag = element.tagName.toLowerCase()

  switch (tag) {
    case 'ul':
      return renderList(element, false)
    case 'ol':
      return renderList(element, true)
    case 'li':
      return renderListItem(element, '- ')
    case 'blockquote':
      return renderBlockquote(element)
    case 'pre':
      return (element.textContent ?? '').replace(/\n+$/, '')
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return renderTableRows(element)
    case 'tr':
      return renderTableRow(element)
    case 'hr':
      return '---'
    default:
      return renderBlocks(element).join('\n\n')
  }
}

function renderBlocks(parent: Node): string[] {
  const blocks: string[] = []
  let inlineBuffer = ''

  function flushInline(): void {
    const text = normalizeInlineText(inlineBuffer)

    inlineBuffer = ''

    if (text) {
      blocks.push(text)
    }
  }

  for (const child of Array.from(parent.childNodes)) {
    const isBlockElement = child.nodeType === ELEMENT_NODE
      && BLOCK_TAGS.has((child as Element).tagName.toLowerCase())

    if (!isBlockElement) {
      inlineBuffer += renderInline(child)

      continue
    }

    flushInline()

    const rendered = renderBlock(child as Element)

    if (rendered) {
      blocks.push(rendered)
    }
  }

  flushInline()

  return blocks
}

export function domToPlainText(root: Node): string {
  return renderBlocks(root).join('\n\n')
}

export function cleanClipboardHtml(
  html: string,
  options: ClipboardCleanOptions = {},
): string {
  if (!html.trim()) {
    return ''
  }

  const container = createInertDocument().createElement('div')

  container.innerHTML = html
  cleanContainer(container, options)

  return serializeContainer(container)
}

export function htmlToClipboardContent(
  html: string,
  options: ClipboardCleanOptions = {},
): ClipboardContent {
  if (!html.trim()) {
    return { html: '', text: '' }
  }

  const container = createInertDocument().createElement('div')

  container.innerHTML = html
  cleanContainer(container, options)

  return {
    html: serializeContainer(container),
    text: domToPlainText(container),
  }
}

function resolveAncestorElement(node: Node): Element | null {
  if (node.nodeType === ELEMENT_NODE) {
    return node as Element
  }

  return node.parentElement
}

function countPrecedingListItems(list: Element, range: Range): number {
  if (typeof range.intersectsNode !== 'function') {
    return 0
  }

  const items = Array.from(list.children).filter((child) => {
    return child.tagName.toLowerCase() === 'li'
  })
  const firstIndex = items.findIndex((item) => {
    return range.intersectsNode(item)
  })

  return Math.max(firstIndex, 0)
}

function wrapPartialContent(
  content: Node,
  ancestor: Element,
  range: Range,
  inertDocument: Document,
): Node {
  const tag = ancestor.tagName.toLowerCase()
  const innerWrapper = inertDocument.importNode(ancestor, false) as Element

  if (tag === 'ol') {
    const start = parseListStart(ancestor)
      + countPrecedingListItems(ancestor, range)

    innerWrapper.setAttribute('start', String(start))
  }

  innerWrapper.appendChild(content)

  let wrapped: Node = innerWrapper

  for (const outerTag of OUTER_WRAPPERS[tag] ?? []) {
    const outerWrapper = inertDocument.createElement(outerTag)

    outerWrapper.appendChild(wrapped)
    wrapped = outerWrapper
  }

  return wrapped
}

function buildRangeNode(
  range: Range,
  fragment: DocumentFragment,
  inertDocument: Document,
): Node {
  const ancestor = resolveAncestorElement(range.commonAncestorContainer)

  if (ancestor?.closest('pre')) {
    const source = fragment.textContent ?? ''

    if (!source.includes('\n')) {
      const code = inertDocument.createElement('code')

      code.textContent = source

      return code
    }

    return buildCodeBlock(inertDocument, source)
  }

  const content = inertDocument.importNode(fragment, true)

  if (!ancestor) {
    return content
  }

  if (!WRAPPED_ANCESTORS.has(ancestor.tagName.toLowerCase())) {
    return content
  }

  return wrapPartialContent(content, ancestor, range, inertDocument)
}

export function isRangeInsideSelector(
  range: Range,
  selector: string,
): boolean {
  const ancestor = resolveAncestorElement(range.commonAncestorContainer)

  return !!ancestor?.closest(selector)
}

export function selectionRangesToClipboardContent(
  ranges: readonly Range[],
  options: ClipboardCleanOptions = {},
): ClipboardContent {
  const inertDocument = createInertDocument()
  const container = inertDocument.createElement('div')
  const rawTexts: string[] = []

  for (const range of ranges) {
    const fragment = range.cloneContents()

    container.appendChild(buildRangeNode(range, fragment, inertDocument))
    rawTexts.push(fragment.textContent ?? '')
  }

  cleanContainer(container, { ...options, useCodeSource: false })

  const hasElements = container.children.length > 0

  return {
    html: serializeContainer(container),
    text: hasElements ? domToPlainText(container) : rawTexts.join('\n'),
  }
}
