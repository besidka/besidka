import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import {
  LONG_PASTE_MIN_CHARACTERS,
  LONG_PASTE_MIN_LINES,
  isImeEvent,
  isInsideOpenCodeFence,
  isLongPaste,
  normalizeBulletLines,
  shouldConvertHtml,
  useMarkdownTextarea,
  type TextSnapshot,
} from '../../../app/composables/markdown-textarea'

const APPLE_MAIL_HTML = [
  '<meta charset="utf-8">',
  '<style>p { margin: 0 }</style>',
  '<div>Dobry wieczór,</div>',
  '<div><br></div>',
  '<div>Przesyłam stan liczników za wrzesień:</div>',
  '<ul><li>Prąd: 3442 kWh (+134)</li>',
  '<li>Woda zimna: 45.5 m³ (+2.5)</li></ul>',
  '<div><br></div>',
  '<div>Razem: <b>5458 zł</b></div>',
].join('')

const APPLE_MAIL_MARKDOWN = [
  'Dobry wieczór,',
  '',
  'Przesyłam stan liczników za wrzesień:',
  '',
  '- Prąd: 3442 kWh (+134)',
  '- Woda zimna: 45.5 m³ (+2.5)',
  '',
  'Razem: **5458 zł**',
].join('\n')

const GMAIL_HTML = [
  '<div dir="ltr">Hi team,<br><br>Please review:<br>',
  '<div><b>Budget</b> is <i>final</i>.</div>',
  '<p>See <a href="https://example.com/plan">the plan</a>.</p></div>',
].join('')

const VS_CODE_HTML = [
  '<meta charset="utf-8">',
  '<div style="color:#ccc;font-family:Menlo;white-space:pre;">',
  '<div><span style="color:#569cd6">const</span><span> a = 1</span></div>',
  '<div><span>  return a</span></div></div>',
].join('')

interface FakeClipboardItem {
  kind: string
  type: string
}

interface PasteOptions {
  html?: string
  plain?: string
  items?: FakeClipboardItem[]
}

interface KeyOptions {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

function createTextarea(value: string, caret: number = value.length) {
  const element = document.createElement('textarea')

  document.body.appendChild(element)
  element.value = value
  element.setSelectionRange(caret, caret)

  return element
}

function createPasteEvent(options: PasteOptions) {
  const preventDefault = vi.fn()
  const data: Record<string, string> = {
    'text/html': options.html ?? '',
    'text/plain': options.plain ?? '',
  }
  const event = {
    preventDefault,
    clipboardData: {
      items: options.items ?? [],
      getData: (type: string) => data[type] ?? '',
    },
  } as unknown as ClipboardEvent

  return { event, preventDefault }
}

function createInputEvent(inputType: string, isComposing: boolean = false) {
  const preventDefault = vi.fn()
  const event = {
    inputType,
    isComposing,
    preventDefault,
  } as unknown as InputEvent

  return { event, preventDefault }
}

function createKeyEvent(key: string, options: KeyOptions = {}) {
  const preventDefault = vi.fn()
  const event = {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...options,
    preventDefault,
  } as unknown as KeyboardEvent

  return { event, preventDefault }
}

function setup(
  value: string,
  caret: number = value.length,
  onLongPaste?: (text: string, snapshot: TextSnapshot) => void,
  continueListsOnEnter?: () => boolean,
) {
  const element = createTextarea(value, caret)
  const markdown = useMarkdownTextarea(
    shallowRef<HTMLTextAreaElement | null>(element),
    { onLongPaste, continueListsOnEnter },
  )

  return { element, ...markdown }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useMarkdownTextarea paste', () => {
  it('converts an Apple Mail list email to Markdown', async () => {
    const { element, onPaste } = setup('')
    const { event, preventDefault } = createPasteEvent({
      html: APPLE_MAIL_HTML,
      plain: 'Dobry wieczór,',
    })

    onPaste(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(element.value).toBe(APPLE_MAIL_MARKDOWN)
    })
  })

  it('converts Gmail style markup with line breaks and paragraphs', async () => {
    const { element, onPaste } = setup('')
    const { event } = createPasteEvent({ html: GMAIL_HTML, plain: 'x' })

    onPaste(event)

    await vi.waitFor(() => {
      expect(element.value).toBe([
        'Hi team,',
        '',
        'Please review:',
        '',
        '**Budget** is *final*.',
        '',
        'See [the plan](https://example.com/plan).',
      ].join('\n'))
    })
  })

  it('inserts the converted text at the caret and keeps the rest', async () => {
    const { element, onPaste } = setup('before  after', 7)
    const { event } = createPasteEvent({
      html: '<ul><li>one</li><li>two</li></ul>',
    })

    onPaste(event)

    await vi.waitFor(() => {
      expect(element.value).toBe('before - one\n- two after')
    })
  })

  it('falls back to the plain text when conversion yields nothing', async () => {
    const { element, onPaste } = setup('')
    const { event } = createPasteEvent({
      html: '<ul></ul><ul></ul>',
      plain: '•\tKept',
    })

    onPaste(event)

    await vi.waitFor(() => {
      expect(element.value).toBe('- Kept')
    })
  })

  it('normalises Mail bullet glyphs in text/plain pastes', () => {
    const { element, onPaste } = setup('')
    const { event, preventDefault } = createPasteEvent({
      plain: 'Intro\n\t•\tPrąd: 3442 kWh\n\t•\tWoda\nKoniec',
    })

    onPaste(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe(
      'Intro\n- Prąd: 3442 kWh\n- Woda\nKoniec',
    )
  })

  it('keeps nesting from glyph levels and indentation', () => {
    expect(normalizeBulletLines('\t•\tOne\n\t\t◦\tTwo\n\t\t\t▪\tDeep\n\t•\tThree'))
      .toBe('- One\n  - Two\n    - Deep\n- Three')
    expect(normalizeBulletLines('  • a\n    • b\n      • c\n  • d'))
      .toBe('- a\n  - b\n    - c\n- d')
    expect(normalizeBulletLines('• a\n◦ b'))
      .toBe('- a\n  - b')
  })

  it('does not treat a middle dot as a bullet', () => {
    expect(normalizeBulletLines('· not a bullet')).toBe('· not a bullet')
  })

  it('keeps the native paste for plain text that needs no change', () => {
    const { element, onPaste } = setup('')
    const { event, preventDefault } = createPasteEvent({
      plain: 'just a line\nand another',
    })

    onPaste(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('')
  })

  it('falls through to plain for span soup from code editors', () => {
    const { element, onPaste } = setup('')
    const { event, preventDefault } = createPasteEvent({
      html: VS_CODE_HTML,
      plain: 'const a = 1\n  return a',
    })

    onPaste(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('')
  })

  it('does nothing when the clipboard carries an image file', () => {
    const { element, onPaste } = setup('')
    const { event, preventDefault } = createPasteEvent({
      html: '<ul><li>one</li></ul>',
      plain: '•\tone',
      items: [
        { kind: 'string', type: 'text/html' },
        { kind: 'file', type: 'image/png' },
      ],
    })

    onPaste(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('')
  })

  it('does nothing without clipboard data', () => {
    const { onPaste } = setup('')
    const preventDefault = vi.fn()

    onPaste({ preventDefault } as unknown as ClipboardEvent)

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('pastes verbatim inside an open code fence', () => {
    const { element, onPaste } = setup('```\n')
    const { event, preventDefault } = createPasteEvent({
      html: '<ul><li>one</li></ul>',
      plain: '•\tone',
    })

    onPaste(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('```\n')
  })

  it('hands a text longer than the character limit to onLongPaste', () => {
    const onLongPaste = vi.fn()
    const { element, onPaste } = setup('', 0, onLongPaste)
    const longText = 'a'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)
    const { event, preventDefault } = createPasteEvent({ plain: longText })

    onPaste(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onLongPaste).toHaveBeenCalledWith(longText, {
      start: 0,
      end: 0,
      value: '',
    })
    expect(element.value).toBe('')
  })

  it('does not attach a long paste inside an open code fence', () => {
    const onLongPaste = vi.fn()
    const { element, onPaste } = setup('```\n', 4, onLongPaste)
    const longText = 'a'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)
    const { event, preventDefault } = createPasteEvent({ plain: longText })

    onPaste(event)

    expect(onLongPaste).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('```\n')
  })

  it('hands a text with too many lines to onLongPaste', () => {
    const onLongPaste = vi.fn()
    const { onPaste } = setup('', 0, onLongPaste)
    const manyLines = Array.from(
      { length: LONG_PASTE_MIN_LINES + 1 },
      () => 'x',
    ).join('\n')
    const { event } = createPasteEvent({ plain: manyLines })

    onPaste(event)

    expect(onLongPaste).toHaveBeenCalledWith(manyLines, {
      start: 0,
      end: 0,
      value: '',
    })
  })

  it('does not treat a text at the limits as long', () => {
    const onLongPaste = vi.fn()
    const { onPaste } = setup('', 0, onLongPaste)
    const { event, preventDefault } = createPasteEvent({
      plain: 'a'.repeat(LONG_PASTE_MIN_CHARACTERS),
    })

    onPaste(event)

    expect(onLongPaste).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('uses the 1200 character and 40 line thresholds', () => {
    expect(LONG_PASTE_MIN_CHARACTERS).toBe(1200)
    expect(LONG_PASTE_MIN_LINES).toBe(40)
  })

  it('keeps one short email as text and attaches three of them', () => {
    const emailLine = 'See you on Monday, Jo'
    const email = Array.from({ length: 15 }, () => emailLine).join('\n')
    const threeEmails = [email, email, email].join('\n\n')

    expect(email.length).toBeLessThanOrEqual(330)
    expect(isLongPaste(email)).toBe(false)
    expect(isLongPaste(threeEmails)).toBe(true)
  })

  it('measures converted HTML for the long paste decision', async () => {
    const onLongPaste = vi.fn()
    const { element, onPaste } = setup('', 0, onLongPaste)
    const items = Array.from({ length: LONG_PASTE_MIN_LINES + 1 }, () => {
      return '<li>row</li>'
    }).join('')
    const { event } = createPasteEvent({ html: `<ul>${items}</ul>` })

    onPaste(event)

    await vi.waitFor(() => {
      expect(onLongPaste).toHaveBeenCalledTimes(1)
    })
    expect(onLongPaste.mock.calls[0]![0]).toMatch(/^- row\n- row/)
    expect(element.value).toBe('')
  })

  it('inserts a long text normally when no onLongPaste is given', () => {
    const { element, onPaste } = setup('')
    const longText = `•\t${'a'.repeat(LONG_PASTE_MIN_CHARACTERS)}`
    const { event, preventDefault } = createPasteEvent({ plain: longText })

    onPaste(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe(`- ${'a'.repeat(LONG_PASTE_MIN_CHARACTERS)}`)
  })

  it('fires an input event so v-model updates', () => {
    const { element, onPaste } = setup('')
    const onInput = vi.fn()

    element.addEventListener('input', onInput)
    onPaste(createPasteEvent({ plain: '•\tone' }).event)

    expect(onInput).toHaveBeenCalled()
  })
})

describe('useMarkdownTextarea async paste range', () => {
  const listHtml = '<ul><li>one</li><li>two</li></ul>'

  it('inserts converted html at the caret captured at paste time', async () => {
    const { element, onPaste } = setup('abXY', 2)
    const { event } = createPasteEvent({ html: listHtml })

    onPaste(event)
    element.setSelectionRange(4, 4)

    await vi.waitFor(() => {
      expect(element.value).toBe('ab- one\n- twoXY')
    })
  })

  it('replaces the selection captured at paste time', async () => {
    const { element, onPaste } = setup('abcdef', 0)

    element.setSelectionRange(2, 4)
    onPaste(createPasteEvent({ html: listHtml }).event)
    element.setSelectionRange(6, 6)

    await vi.waitFor(() => {
      expect(element.value).toBe('ab- one\n- twoef')
    })
  })

  it('appends at the end when the text changed meanwhile', async () => {
    const { element, onPaste } = setup('abcd', 2)

    onPaste(createPasteEvent({ html: listHtml }).event)
    element.value = 'abcdXYZ'
    element.setSelectionRange(0, 0)

    await vi.waitFor(() => {
      expect(element.value).toBe('abcdXYZ- one\n- two')
    })
  })

  it('inserts without focus when the textarea is no longer active', async () => {
    const { element, onPaste } = setup('abcd', 2)
    const outside = document.createElement('input')

    document.body.appendChild(outside)
    element.focus()
    onPaste(createPasteEvent({ html: listHtml }).event)
    outside.focus()

    await vi.waitFor(() => {
      expect(element.value).toBe('ab- one\n- twocd')
    })
    expect(document.activeElement).toBe(outside)
  })

  it('hands the snapshot to onLongPaste for converted html', async () => {
    const onLongPaste = vi.fn()
    const { onPaste } = setup('abcd', 2, onLongPaste)
    const items = Array.from({ length: LONG_PASTE_MIN_LINES + 1 }, () => {
      return '<li>row</li>'
    }).join('')

    onPaste(createPasteEvent({ html: `<ul>${items}</ul>` }).event)

    await vi.waitFor(() => {
      expect(onLongPaste).toHaveBeenCalledTimes(1)
    })
    expect(onLongPaste.mock.calls[0]![1]).toEqual({
      start: 2,
      end: 2,
      value: 'abcd',
    })
  })

  it('inserts at the snapshot range through insertText', () => {
    const { element, insertText } = setup('abcdef', 0)

    insertText('XY', { start: 2, end: 4, value: 'abcdef' })

    expect(element.value).toBe('abXYef')
  })

  it('appends through insertText when the snapshot is stale', () => {
    const { element, insertText } = setup('abcdef', 0)

    insertText('XY', { start: 2, end: 4, value: 'old' })

    expect(element.value).toBe('abcdefXY')
  })

  it('does not steal focus when inserting at a snapshot', () => {
    const { element, insertText } = setup('abcdef', 0)
    const outside = document.createElement('input')

    document.body.appendChild(outside)
    outside.focus()
    insertText('XY', { start: 1, end: 1, value: 'abcdef' })

    expect(element.value).toBe('aXYbcdef')
    expect(document.activeElement).toBe(outside)
  })
})

describe('useMarkdownTextarea keydown', () => {
  it('ignores events without a key', () => {
    const { onKeydown } = setup('- one')
    const { event } = createKeyEvent('Enter', { shiftKey: true })

    Reflect.deleteProperty(event, 'key')

    expect(onKeydown(event)).toBe(false)
  })

  it('treats keyCode 229 like an active composition', () => {
    const { element, onKeydown } = setup('- one')
    const { event, preventDefault } = createKeyEvent('Enter', {
      shiftKey: true,
      keyCode: 229,
    })

    expect(onKeydown(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('- one')
  })

  it('inserts a newline for Enter inside an open fence', () => {
    const { element, onKeydown } = setup('```ts\nconst a = 1')
    const { event, preventDefault } = createKeyEvent('Enter')

    expect(onKeydown(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe('```ts\nconst a = 1\n')
  })

  it('treats a just typed opening fence as open', () => {
    const { element, onKeydown } = setup('```')

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(true)
    expect(element.value).toBe('```\n')
  })

  it('leaves Enter alone after the fence is closed', () => {
    const { onKeydown } = setup('```\ncode\n```')
    const { event, preventDefault } = createKeyEvent('Enter')

    expect(onKeydown(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('leaves Enter alone outside fences', () => {
    const { onKeydown } = setup('hello')

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(false)
  })

  it('ignores every key while composing', () => {
    const { element, onKeydown } = setup('```\n')

    expect(
      onKeydown(createKeyEvent('Enter', { isComposing: true }).event),
    ).toBe(false)
    expect(element.value).toBe('```\n')
  })

  it('ignores keys with Ctrl, Meta or Alt', () => {
    const { onKeydown } = setup('```\n')

    expect(onKeydown(createKeyEvent('Enter', { ctrlKey: true }).event))
      .toBe(false)
    expect(onKeydown(createKeyEvent('Enter', { metaKey: true }).event))
      .toBe(false)
    expect(onKeydown(createKeyEvent('Enter', { altKey: true }).event))
      .toBe(false)
  })

  it('continues a bullet list on Shift+Enter', () => {
    const { element, onKeydown } = setup('- one')
    const { event, preventDefault } = createKeyEvent('Enter', {
      shiftKey: true,
    })

    expect(onKeydown(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe('- one\n- ')
  })

  it.each([
    ['* one', '* one\n* '],
    ['+ one', '+ one\n+ '],
    ['1. one', '1. one\n2. '],
    ['9) one', '9) one\n10) '],
    ['  - nested', '  - nested\n  - '],
    ['- [x] done', '- [x] done\n- [ ] '],
    ['- [ ] todo', '- [ ] todo\n- [ ] '],
    ['> quote', '> quote\n> '],
    ['> > deep', '> > deep\n> > '],
  ])('continues %j as %j', (value, expected) => {
    const { element, onKeydown } = setup(value)

    expect(onKeydown(createKeyEvent('Enter', { shiftKey: true }).event))
      .toBe(true)
    expect(element.value).toBe(expected)
  })

  it('ends the list when the current item is empty', () => {
    const { element, onKeydown } = setup('- one\n- ')

    expect(onKeydown(createKeyEvent('Enter', { shiftKey: true }).event))
      .toBe(true)
    expect(element.value).toBe('- one\n')
  })

  it('ends an empty top level task item and a bare quote line', () => {
    const task = setup('- a\n- [ ] ')

    task.onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(task.element.value).toBe('- a\n')

    const quote = setup('> a\n> ')

    quote.onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(quote.element.value).toBe('> a\n')
  })

  it('outdents an empty nested item one level instead of clearing it', () => {
    const nested = setup('- a\n  - b\n    - ')

    nested.onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(nested.element.value).toBe('- a\n  - b\n  - ')
    expect(nested.element.selectionStart).toBe(nested.element.value.length)

    nested.onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(nested.element.value).toBe('- a\n  - b\n- ')

    nested.onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(nested.element.value).toBe('- a\n  - b\n')
  })

  it('outdents an empty nested item on plain Enter when enabled', () => {
    const { element, onKeydown } = setup('- a\n  - ', undefined, undefined, () => true)

    onKeydown(createKeyEvent('Enter').event)

    expect(element.value).toBe('- a\n- ')
  })

  it('does not continue a numbered line with a year-like number', () => {
    const { element, onKeydown } = setup('2024. was a year')

    expect(onKeydown(createKeyEvent('Enter', { shiftKey: true }).event))
      .toBe(false)
    expect(element.value).toBe('2024. was a year')
  })

  it('does not continue quote-like text without a space after >', () => {
    const comparison = setup('>=5 items')
    const emoticon = setup('>_<')

    expect(comparison.onKeydown(
      createKeyEvent('Enter', { shiftKey: true }).event,
    )).toBe(false)
    expect(emoticon.onKeydown(
      createKeyEvent('Enter', { shiftKey: true }).event,
    )).toBe(false)
  })

  it('continues three digit ordered markers', () => {
    const { element, onKeydown } = setup('99. last')

    onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(element.value).toBe('99. last\n100. ')
  })

  it('splits the item when the caret is mid-line', () => {
    const { element, onKeydown } = setup('- onetwo', 5)

    onKeydown(createKeyEvent('Enter', { shiftKey: true }).event)

    expect(element.value).toBe('- one\n- two')
  })

  it('keeps the native newline for Shift+Enter on a plain line', () => {
    const { onKeydown } = setup('plain text')
    const { event, preventDefault } = createKeyEvent('Enter', {
      shiftKey: true,
    })

    expect(onKeydown(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('keeps the native newline when the caret is before the marker', () => {
    const { onKeydown } = setup('- one', 1)

    expect(onKeydown(createKeyEvent('Enter', { shiftKey: true }).event))
      .toBe(false)
  })

  it('keeps the native newline for list-like lines inside a fence', () => {
    const { onKeydown } = setup('```\n- one')

    expect(onKeydown(createKeyEvent('Enter', { shiftKey: true }).event))
      .toBe(false)
  })

  it('indents a list line with Tab and keeps the caret in place', () => {
    const { element, onKeydown } = setup('- one\n- two', 9)
    const { event, preventDefault } = createKeyEvent('Tab')

    expect(onKeydown(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe('- one\n  - two')
    expect(element.selectionStart).toBe(11)
  })

  it('indents by the content width of the parent marker', () => {
    const ordered = setup('1. one\n2. two')
    const wide = setup('10. one\n- two')

    ordered.onKeydown(createKeyEvent('Tab').event)
    wide.onKeydown(createKeyEvent('Tab').event)

    expect(ordered.element.value).toBe('1. one\n   2. two')
    expect(wide.element.value).toBe('10. one\n    - two')
  })

  it('nests under an already nested previous item', () => {
    const { element, onKeydown } = setup('- a\n  - b\n  - c')

    onKeydown(createKeyEvent('Tab').event)

    expect(element.value).toBe('- a\n  - b\n    - c')
  })

  it('leaves Tab alone on the first list line', () => {
    const { element, onKeydown } = setup('- one')
    const { event, preventDefault } = createKeyEvent('Tab')

    expect(onKeydown(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('- one')
  })

  it('leaves Tab alone when the previous line is not a list item', () => {
    const { onKeydown } = setup('text\n- one')

    expect(onKeydown(createKeyEvent('Tab').event)).toBe(false)
  })

  it('leaves Tab alone once the item is nested as deep as it can be', () => {
    const { element, onKeydown } = setup('- one\n  - two')

    expect(onKeydown(createKeyEvent('Tab').event)).toBe(false)
    expect(element.value).toBe('- one\n  - two')
  })

  it('outdents a list line with Shift+Tab', () => {
    const { element, onKeydown } = setup('- one\n  - two', 11)

    expect(onKeydown(createKeyEvent('Tab', { shiftKey: true }).event))
      .toBe(true)
    expect(element.value).toBe('- one\n- two')
    expect(element.selectionStart).toBe(9)
  })

  it('outdents to the nearest shallower item', () => {
    const { element, onKeydown } = setup('1. a\n   1. b\n      1. c')

    onKeydown(createKeyEvent('Tab', { shiftKey: true }).event)

    expect(element.value).toBe('1. a\n   1. b\n   1. c')
  })

  it('outdents a tab-indented list line', () => {
    const { element, onKeydown } = setup('\t- one')

    onKeydown(createKeyEvent('Tab', { shiftKey: true }).event)

    expect(element.value).toBe('- one')
  })

  it('leaves Shift+Tab alone on a list line without indent', () => {
    const { onKeydown } = setup('- one')

    expect(onKeydown(createKeyEvent('Tab', { shiftKey: true }).event))
      .toBe(false)
  })

  it('leaves Tab alone outside list lines', () => {
    const { element, onKeydown } = setup('plain')
    const { event, preventDefault } = createKeyEvent('Tab')

    expect(onKeydown(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('plain')
  })

  it('leaves plain Enter alone on a list line by default', () => {
    const { element, onKeydown } = setup('- one')

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(false)
    expect(element.value).toBe('- one')
  })

  it('continues lists and quotes on plain Enter when enabled', () => {
    const list = setup('1. one', undefined, undefined, () => true)
    const { event, preventDefault } = createKeyEvent('Enter')

    expect(list.onKeydown(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(list.element.value).toBe('1. one\n2. ')

    const quote = setup('> a', undefined, undefined, () => true)

    quote.onKeydown(createKeyEvent('Enter').event)

    expect(quote.element.value).toBe('> a\n> ')
  })

  it('ends the list on plain Enter over an empty item when enabled', () => {
    const { element, onKeydown } = setup(
      '- one\n- ',
      undefined,
      undefined,
      () => true,
    )

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(true)
    expect(element.value).toBe('- one\n')
  })

  it('does not continue on plain Enter when the option returns false', () => {
    const { onKeydown } = setup('- one', undefined, undefined, () => false)

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(false)
  })

  it('leaves plain Enter on a non-list line alone when enabled', () => {
    const { onKeydown } = setup('plain', undefined, undefined, () => true)

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(false)
  })

  it('still inserts a bare newline inside a fence when enabled', () => {
    const { element, onKeydown } = setup(
      '```\n- item',
      undefined,
      undefined,
      () => true,
    )

    expect(onKeydown(createKeyEvent('Enter').event)).toBe(true)
    expect(element.value).toBe('```\n- item\n')
  })

  it('inserts text at the current selection and focuses the textarea', () => {
    const { element, insertText } = setup('abcdef', 2)

    element.setSelectionRange(2, 4)
    insertText('XY')

    expect(element.value).toBe('abXYef')
    expect(document.activeElement).toBe(element)
  })

  it('exposes the fence state for callers', () => {
    const { isCaretInOpenCodeFence } = setup('~~~\ncode')

    expect(isCaretInOpenCodeFence()).toBe(true)
  })
})

describe('useMarkdownTextarea beforeinput', () => {
  it('continues a list on insertLineBreak when enabled', () => {
    const { element, onBeforeInput } = setup('- one', undefined, undefined, () => true)
    const { event, preventDefault } = createInputEvent('insertLineBreak')

    expect(onBeforeInput(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(element.value).toBe('- one\n- ')
  })

  it('continues a list on insertParagraph and ends it when empty', () => {
    const { element, onBeforeInput } = setup('- one', undefined, undefined, () => true)

    onBeforeInput(createInputEvent('insertParagraph').event)
    onBeforeInput(createInputEvent('insertParagraph').event)

    expect(element.value).toBe('- one\n')
  })

  it('does nothing unless list continuation is enabled', () => {
    const { element, onBeforeInput } = setup('- one')
    const { event, preventDefault } = createInputEvent('insertLineBreak')

    expect(onBeforeInput(event)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(element.value).toBe('- one')
  })

  it('ignores other input types and composition', () => {
    const { element, onBeforeInput } = setup('- one', undefined, undefined, () => true)

    expect(onBeforeInput(createInputEvent('insertText').event)).toBe(false)
    expect(onBeforeInput(createInputEvent('insertLineBreak', true).event))
      .toBe(false)
    expect(element.value).toBe('- one')
  })

  it('leaves non list lines and open fences to the browser', () => {
    const plain = setup('plain', undefined, undefined, () => true)
    const fenced = setup('```\n- item', undefined, undefined, () => true)

    expect(plain.onBeforeInput(createInputEvent('insertLineBreak').event))
      .toBe(false)
    expect(fenced.onBeforeInput(createInputEvent('insertLineBreak').event))
      .toBe(false)
  })

  it('ignores the line break its own edit triggers', () => {
    const { element, onBeforeInput, onKeydown } = setup(
      '- one',
      undefined,
      undefined,
      () => true,
    )
    const nestedResults: boolean[] = []

    const originalExecCommand = document.execCommand

    element.focus()
    document.execCommand = vi.fn((
      _command: string,
      _flag: boolean,
      text: string,
    ) => {
      nestedResults.push(
        onBeforeInput(createInputEvent('insertLineBreak').event),
      )
      element.setRangeText(
        text,
        element.selectionStart,
        element.selectionEnd,
        'end',
      )

      return true
    })

    try {
      onKeydown(createKeyEvent('Enter').event)
    } finally {
      document.execCommand = originalExecCommand
    }

    expect(nestedResults).toEqual([false])
    expect(element.value).toBe('- one\n- ')
  })
})

describe('markdown textarea helpers', () => {
  it('detects ime events by flag and key code', () => {
    expect(isImeEvent(createKeyEvent('Enter', { isComposing: true }).event))
      .toBe(true)
    expect(isImeEvent(createKeyEvent('Enter', { keyCode: 229 }).event))
      .toBe(true)
    expect(isImeEvent(createKeyEvent('Enter').event)).toBe(false)
  })

  it('detects open fences by character and length', () => {
    expect(isInsideOpenCodeFence('```\ncode', 8)).toBe(true)
    expect(isInsideOpenCodeFence('```\ncode\n```', 12)).toBe(false)
    expect(isInsideOpenCodeFence('````\n```\nx', 10)).toBe(true)
    expect(isInsideOpenCodeFence('~~~\n```\nx', 9)).toBe(true)
    expect(isInsideOpenCodeFence('```\ncode\n```\nnext\n~~~', 21)).toBe(true)
    expect(isInsideOpenCodeFence('```\ncode', 2)).toBe(false)
  })

  it('does not rewrite bullet glyph lines inside fences', () => {
    expect(normalizeBulletLines('```\n• keep\n```\n• change'))
      .toBe('```\n• keep\n```\n- change')
  })

  it('gates HTML conversion on structure', () => {
    expect(shouldConvertHtml('')).toBe(false)
    expect(shouldConvertHtml('<span>one</span>')).toBe(false)
    expect(shouldConvertHtml('<div>one</div>')).toBe(false)
    expect(shouldConvertHtml('<div>one</div><div>two</div>')).toBe(true)
    expect(shouldConvertHtml('<p>a</p><p>b</p>')).toBe(true)
    expect(shouldConvertHtml('<b>bold</b>')).toBe(true)
    expect(shouldConvertHtml('<pre>code</pre>')).toBe(true)
    expect(shouldConvertHtml(VS_CODE_HTML)).toBe(false)
  })
})
