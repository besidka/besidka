export const LONG_PASTE_MIN_CHARACTERS = 1200
export const LONG_PASTE_MIN_LINES = 40

const INDENT = '  '
const TAB_WIDTH = 4
const IME_KEY_CODE = 229
const HTML_STRUCTURE_PATTERN
  = /<(ul|ol|li|strong|b|em|h[1-6]|pre|code|blockquote|table)\b/i
const HTML_BLOCK_PATTERN = /<(p|div)\b/gi
const PRESERVED_WHITESPACE_PATTERN = /white-space:\s*pre/i
const BULLET_LINE_PATTERN = /^([ \t]*)([•◦▪‣])[ \t]+(.*)$/
const BULLET_GLYPH_LEVELS: Record<string, number> = {
  '•': 0,
  '‣': 0,
  '◦': 1,
  '▪': 2,
}
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_LINE_PATTERN
  = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)(\[[ xX]\](?:\s+|$))?/
const QUOTE_LINE_PATTERN = /^(\s*(?:>[ \t])+)/

export interface TextSnapshot {
  start: number
  end: number
  value: string
}

export interface MarkdownTextareaOptions {
  onLongPaste?: (text: string, snapshot: TextSnapshot) => void
  continueListsOnEnter?: () => boolean
}

export interface OpenFence {
  character: string
  length: number
}

interface LineBounds {
  start: number
  end: number
}

interface BulletLine {
  indentWidth: number
  glyphLevel: number
  text: string
}

interface Preventable {
  preventDefault: () => void
}

type TextareaRef = Ref<HTMLTextAreaElement | null | undefined>

export function isImeEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === IME_KEY_CODE
}

function measureIndent(whitespace: string): number {
  let width = 0

  for (const character of whitespace) {
    width += character === '\t' ? TAB_WIDTH : 1
  }

  return width
}

export function normalizeBulletLines(text: string): string {
  let openFence: OpenFence | null = null

  const entries = text.split('\n').map((line): string | BulletLine => {
    openFence = advanceFence(openFence, line)

    if (openFence || FENCE_LINE_PATTERN.test(line)) {
      return line
    }

    const bulletMatch = BULLET_LINE_PATTERN.exec(line)

    if (!bulletMatch) {
      return line
    }

    return {
      indentWidth: measureIndent(bulletMatch[1]!),
      glyphLevel: BULLET_GLYPH_LEVELS[bulletMatch[2]!] ?? 0,
      text: bulletMatch[3]!,
    }
  })
  const indentWidths = entries.flatMap((entry) => {
    return typeof entry === 'string' ? [] : [entry.indentWidth]
  })
  const indentRanks = [...new Set(indentWidths)].sort((first, second) => {
    return first - second
  })

  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry
      }

      const level = Math.max(
        indentRanks.indexOf(entry.indentWidth),
        entry.glyphLevel,
      )

      return `${INDENT.repeat(level)}- ${entry.text}`
    })
    .join('\n')
}

export function isInsideOpenCodeFence(
  text: string,
  caretPosition: number,
): boolean {
  let openFence: OpenFence | null = null

  for (const line of text.slice(0, caretPosition).split('\n')) {
    openFence = advanceFence(openFence, line)
  }

  return openFence !== null
}

export function shouldConvertHtml(html: string): boolean {
  if (!html.trim()) {
    return false
  }

  if (HTML_STRUCTURE_PATTERN.test(html)) {
    return true
  }

  if (PRESERVED_WHITESPACE_PATTERN.test(html)) {
    return false
  }

  return (html.match(HTML_BLOCK_PATTERN)?.length ?? 0) > 1
}

export function isLongPaste(text: string): boolean {
  return text.length > LONG_PASTE_MIN_CHARACTERS
    || text.split('\n').length > LONG_PASTE_MIN_LINES
}

export function advanceFence(
  openFence: OpenFence | null,
  line: string,
): OpenFence | null {
  if (openFence) {
    const closingMatch = CLOSING_FENCE_PATTERN.exec(line)

    if (
      closingMatch
      && closingMatch[1]!.startsWith(openFence.character)
      && closingMatch[1]!.length >= openFence.length
    ) {
      return null
    }

    return openFence
  }

  const openingMatch = FENCE_LINE_PATTERN.exec(line)

  if (!openingMatch) {
    return null
  }

  const marker = openingMatch[1]!

  if (marker.startsWith('`') && openingMatch[2]!.includes('`')) {
    return null
  }

  return { character: marker[0]!, length: marker.length }
}

function getLineBounds(text: string, position: number): LineBounds {
  const start = text.slice(0, position).lastIndexOf('\n') + 1
  const nextBreak = text.indexOf('\n', position)

  return {
    start,
    end: nextBreak === -1 ? text.length : nextBreak,
  }
}

function replaceRange(
  element: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
) {
  const canUseEditingCommand = typeof document.execCommand === 'function'
    && document.activeElement === element

  if (canUseEditingCommand) {
    const command = text === '' ? 'delete' : 'insertText'

    element.setSelectionRange(start, end)

    if (document.execCommand(command, false, text)) {
      return
    }
  }

  element.setRangeText(text, start, end, 'end')
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function resolveInsertRange(
  element: HTMLTextAreaElement,
  snapshot?: TextSnapshot,
): { start: number, end: number } {
  if (!snapshot) {
    return { start: element.selectionStart, end: element.selectionEnd }
  }

  if (element.value !== snapshot.value) {
    const end = element.value.length

    return { start: end, end }
  }

  return { start: snapshot.start, end: snapshot.end }
}

function takeSnapshot(element: HTMLTextAreaElement): TextSnapshot {
  return {
    start: element.selectionStart,
    end: element.selectionEnd,
    value: element.value,
  }
}

function hasImageFile(clipboardData: DataTransfer): boolean {
  const items = Array.from(clipboardData.items ?? [])

  return items.some((item) => {
    return item.kind !== 'string' && item.type.startsWith('image/')
  })
}

function getNextListMarker(
  marker: string,
  taskBox: string | undefined,
): string {
  const orderedMatch = /^(\d{1,3})([.)])$/.exec(marker)
  const nextMarker = orderedMatch
    ? `${Number(orderedMatch[1]) + 1}${orderedMatch[2]}`
    : marker

  return taskBox ? `${nextMarker} [ ] ` : `${nextMarker} `
}

function getPreviousLineMatch(
  text: string,
  lineStart: number,
): RegExpExecArray | null {
  if (lineStart === 0) {
    return null
  }

  const previous = getLineBounds(text, lineStart - 1)

  return LIST_LINE_PATTERN.exec(text.slice(previous.start, previous.end))
}

function getContentWidth(listMatch: RegExpExecArray): number {
  return measureIndent(listMatch[1]!) + listMatch[2]!.length
    + listMatch[3]!.length
}

function findOutdentTarget(
  text: string,
  lineStart: number,
  currentWidth: number,
): number {
  let cursor = lineStart

  while (cursor > 0) {
    const previous = getLineBounds(text, cursor - 1)
    const previousMatch = LIST_LINE_PATTERN.exec(
      text.slice(previous.start, previous.end),
    )

    if (!previousMatch) {
      break
    }

    const previousWidth = measureIndent(previousMatch[1]!)

    if (previousWidth < currentWidth) {
      return previousWidth
    }

    cursor = previous.start
  }

  return Math.max(0, currentWidth - INDENT.length)
}

function countCharactersToRemove(
  whitespace: string,
  width: number,
): number {
  let removedWidth = 0
  let characterCount = 0

  for (const character of whitespace) {
    if (removedWidth >= width) {
      break
    }

    removedWidth += character === '\t' ? TAB_WIDTH : 1
    characterCount += 1
  }

  return characterCount
}

export function useMarkdownTextarea(
  textarea: TextareaRef,
  options: MarkdownTextareaOptions = {},
) {
  let isApplyingEdit = false

  function applyReplacement(
    element: HTMLTextAreaElement,
    start: number,
    end: number,
    text: string,
  ) {
    isApplyingEdit = true

    try {
      replaceRange(element, start, end, text)
    } finally {
      isApplyingEdit = false
    }
  }

  function insertText(
    element: HTMLTextAreaElement,
    text: string,
    snapshot?: TextSnapshot,
  ) {
    const { start, end } = resolveInsertRange(element, snapshot)

    applyReplacement(element, start, end, text)
  }

  function isCaretInOpenCodeFence(): boolean {
    const element = textarea.value

    if (!element) {
      return false
    }

    return isInsideOpenCodeFence(element.value, element.selectionStart)
  }

  async function convertHtmlToMarkdown(html: string): Promise<string> {
    try {
      const { htmlToChatMarkdown } = await import(
        '~/utils/knowledge-html-to-markdown'
      )

      return htmlToChatMarkdown(html)
    } catch {
      return ''
    }
  }

  function insertPastedText(
    element: HTMLTextAreaElement,
    text: string,
    snapshot: TextSnapshot,
    canAttach: boolean,
  ) {
    if (canAttach && isLongPaste(text) && options.onLongPaste) {
      options.onLongPaste(text, snapshot)

      return
    }

    insertText(element, text, snapshot)
  }

  async function pasteConvertedHtml(
    element: HTMLTextAreaElement,
    html: string,
    plainText: string,
    snapshot: TextSnapshot,
  ) {
    const markdown = await convertHtmlToMarkdown(html)
    const text = markdown || normalizeBulletLines(plainText)

    if (!text) {
      return
    }

    insertPastedText(element, text, snapshot, true)
  }

  function onPaste(event: ClipboardEvent) {
    const element = textarea.value
    const clipboardData = event.clipboardData

    if (!element || !clipboardData || hasImageFile(clipboardData)) {
      return
    }

    const html = clipboardData.getData('text/html')
    const plainText = clipboardData.getData('text/plain')
    const snapshot = takeSnapshot(element)
    const isInsideFence = isCaretInOpenCodeFence()

    if (!isInsideFence && shouldConvertHtml(html)) {
      event.preventDefault()
      pasteConvertedHtml(element, html, plainText, snapshot)

      return
    }

    if (!plainText) {
      return
    }

    const text = isInsideFence ? plainText : normalizeBulletLines(plainText)
    const shouldAttach = !isInsideFence
      && isLongPaste(text)
      && !!options.onLongPaste

    if (!shouldAttach && text === plainText) {
      return
    }

    event.preventDefault()
    insertPastedText(element, text, snapshot, !isInsideFence)
  }

  function continueMarkdownLine(
    event: Preventable,
    element: HTMLTextAreaElement,
  ): boolean {
    const { value, selectionStart, selectionEnd } = element

    if (selectionStart !== selectionEnd || isCaretInOpenCodeFence()) {
      return false
    }

    const line = getLineBounds(value, selectionStart)
    const lineText = value.slice(line.start, line.end)
    const listMatch = LIST_LINE_PATTERN.exec(lineText)
    const prefixMatch = listMatch ?? QUOTE_LINE_PATTERN.exec(lineText)

    if (!prefixMatch) {
      return false
    }

    const prefixEnd = line.start + prefixMatch[0].length

    if (selectionStart < prefixEnd) {
      return false
    }

    event.preventDefault()

    if (lineText.slice(prefixMatch[0].length).trim() === '') {
      const indentLength = listMatch ? prefixMatch[1]!.length : 0

      if (indentLength === 0) {
        applyReplacement(element, line.start, line.end, '')

        return true
      }

      const target = findOutdentTarget(
        value,
        line.start,
        measureIndent(prefixMatch[1]!),
      )

      applyReplacement(
        element,
        line.start,
        line.end,
        `${' '.repeat(target)}${lineText.slice(indentLength)}`,
      )

      return true
    }

    const nextPrefix = listMatch
      ? `${prefixMatch[1]}${getNextListMarker(prefixMatch[2]!, prefixMatch[4])}`
      : prefixMatch[1]!

    insertText(element, `\n${nextPrefix}`)

    return true
  }

  function shiftIndent(
    event: KeyboardEvent,
    element: HTMLTextAreaElement,
  ): boolean {
    const { value, selectionStart, selectionEnd } = element
    const line = getLineBounds(value, selectionStart)
    const isSingleLine = selectionEnd <= line.end

    if (!isSingleLine || isCaretInOpenCodeFence()) {
      return false
    }

    const lineText = value.slice(line.start, line.end)
    const listMatch = LIST_LINE_PATTERN.exec(lineText)

    if (!listMatch) {
      return false
    }

    const currentWidth = measureIndent(listMatch[1]!)

    if (!event.shiftKey) {
      const parentMatch = getPreviousLineMatch(value, line.start)

      if (!parentMatch) {
        return false
      }

      const addedWidth = getContentWidth(parentMatch) - currentWidth

      if (addedWidth <= 0) {
        return false
      }

      event.preventDefault()
      applyReplacement(element, line.start, line.start, ' '.repeat(addedWidth))
      element.setSelectionRange(
        selectionStart + addedWidth,
        selectionEnd + addedWidth,
      )

      return true
    }

    if (currentWidth === 0) {
      return false
    }

    const targetWidth = findOutdentTarget(value, line.start, currentWidth)
    const removedLength = countCharactersToRemove(
      listMatch[1]!,
      currentWidth - targetWidth,
    )

    if (removedLength === 0) {
      return false
    }

    event.preventDefault()
    applyReplacement(element, line.start, line.start + removedLength, '')
    element.setSelectionRange(
      Math.max(line.start, selectionStart - removedLength),
      Math.max(line.start, selectionEnd - removedLength),
    )

    return true
  }

  function onKeydown(event: KeyboardEvent): boolean {
    const element = textarea.value
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey
    const key = event.key?.toLowerCase()

    if (!element || !key || isImeEvent(event) || hasModifier) {
      return false
    }

    if (key === 'tab') {
      return shiftIndent(event, element)
    }

    if (key !== 'enter') {
      return false
    }

    if (event.shiftKey) {
      return continueMarkdownLine(event, element)
    }

    if (isCaretInOpenCodeFence()) {
      event.preventDefault()
      insertText(element, '\n')

      return true
    }

    if (options.continueListsOnEnter?.()) {
      return continueMarkdownLine(event, element)
    }

    return false
  }

  function onBeforeInput(event: InputEvent): boolean {
    const element = textarea.value
    const isLineBreak = event.inputType === 'insertLineBreak'
      || event.inputType === 'insertParagraph'

    if (
      isApplyingEdit
      || !element
      || !isLineBreak
      || event.isComposing
      || !options.continueListsOnEnter?.()
    ) {
      return false
    }

    return continueMarkdownLine(event, element)
  }

  function insertTextAtSelection(text: string, snapshot?: TextSnapshot) {
    const element = textarea.value

    if (!element) {
      return
    }

    if (!snapshot) {
      element.focus()
    }

    insertText(element, text, snapshot)
  }

  return {
    onPaste,
    onKeydown,
    onBeforeInput,
    insertText: insertTextAtSelection,
    isCaretInOpenCodeFence,
  }
}
