import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CommandMirror from '../../../../app/components/ChatInput/CommandMirror.vue'
import type {
  ComposerMirrorKind,
  ComposerMirrorRange,
} from '~/utils/composer-mirror-ranges'

enableAutoUnmount(afterEach)

interface MountOptions {
  text?: string
  start?: number
  end?: number
  ranges?: ComposerMirrorRange[]
  textarea?: HTMLTextAreaElement | null
}

function createTextarea(): HTMLTextAreaElement {
  const element = document.createElement('textarea')

  element.style.fontFamily = 'Menlo, monospace'
  element.style.fontSize = '18px'
  element.style.fontWeight = '600'
  element.style.letterSpacing = '1px'
  element.style.lineHeight = '24px'
  element.style.paddingTop = '10px'
  element.style.paddingRight = '14px'
  element.style.paddingBottom = '12px'
  element.style.paddingLeft = '16px'
  document.body.appendChild(element)

  return element
}

function mountMirror(options: MountOptions = {}) {
  return mountSuspended(CommandMirror, {
    props: {
      textarea: createTextarea(),
      text: 'Please /c this',
      start: 7,
      end: 9,
      ...options,
    },
  })
}

function readPlainText(root: Element): string {
  return Array.from(root.childNodes)
    .filter((node) => {
      return node.nodeType === Node.TEXT_NODE
    })
    .map((node) => {
      return node.textContent
    })
    .join('')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ChatInput/CommandMirror', () => {
  it('drops the badge padding on the side the caret rests on, so the caret stays visible', async () => {
    const textarea = createTextarea()

    textarea.value = 'Please /c this'
    textarea.focus()

    const wrapper = await mountMirror({ textarea, start: 7, end: 9 })
    const token = () => {
      return wrapper.get('[data-testid="command-mirror-token"]')
    }

    textarea.setSelectionRange(9, 9)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-caret')).toBe('end')

    textarea.setSelectionRange(7, 7)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-caret')).toBe('start')

    textarea.setSelectionRange(8, 8)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-caret')).toBeUndefined()

    textarea.setSelectionRange(7, 9)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-caret')).toBeUndefined()
  })

  it('keeps both paddings when the textarea does not have focus', async () => {
    const textarea = createTextarea()

    textarea.value = 'Please /c this'
    textarea.setSelectionRange(9, 9)
    textarea.blur()

    const wrapper = await mountMirror({ textarea, start: 7, end: 9 })

    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(wrapper.get('[data-testid="command-mirror-token"]')
      .attributes('data-caret')).toBeUndefined()
  })

  it('draws the token as a soft badge above the textarea without changing its metrics', async () => {
    const wrapper = await mountMirror()
    const token = wrapper.get('[data-testid="command-mirror-token"]')

    expect(token.classes()).toContain('composer-command-token')
    expect(token.classes()).not.toContain('text-transparent')
    expect(wrapper.classes()).toContain('z-10')
    expect(token.attributes('style')).toBeUndefined()
  })

  it('marks exactly the token and leaves the rest unmarked', async () => {
    const wrapper = await mountMirror()
    const marks = wrapper.findAll('mark')

    expect(marks).toHaveLength(1)
    expect(marks[0]!.attributes('data-testid')).toBe('command-mirror-token')
    expect(marks[0]!.text()).toBe('/c')
    expect(readPlainText(wrapper.element)).toBe('Please  this ')
  })

  it('is hidden from assistive technology and from the pointer', async () => {
    const wrapper = await mountMirror()

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toContain('pointer-events-none')
    expect(wrapper.classes()).toContain('text-transparent')
    expect(wrapper.classes()).toContain('z-10')
  })

  it('mirrors the textarea text plus a trailing space filler', async () => {
    const wrapper = await mountMirror()

    expect(wrapper.element.textContent).toBe('Please /c this ')
  })

  it('adds the filler when the token ends the text', async () => {
    const wrapper = await mountMirror({ text: '/c', start: 0, end: 2 })

    expect(wrapper.element.textContent).toBe('/c ')
    expect(wrapper.get('mark').text()).toBe('/c')
  })

  it('keeps a newline after the token in the mirror text', async () => {
    const wrapper = await mountMirror({
      text: 'a /c\nb',
      start: 2,
      end: 4,
    })

    expect(wrapper.element.textContent).toBe('a /c\nb ')
  })

  it('renders markup in the text as plain text', async () => {
    const markupText = '<b>x</b> /c <img src=x onerror=1>'
    const wrapper = await mountMirror({
      text: markupText,
      start: markupText.indexOf('/c'),
      end: markupText.indexOf('/c') + 2,
    })

    expect(wrapper.element.textContent).toBe(`${markupText} `)
    expect(wrapper.element.children).toHaveLength(1)
    expect(wrapper.element.children[0]!.tagName).toBe('MARK')
    expect(wrapper.element.querySelector('b, img')).toBeNull()
  })

  it('renders a markup-looking token as plain text inside the mark', async () => {
    const wrapper = await mountMirror({
      text: '<i>x</i>',
      start: 0,
      end: 8,
    })

    expect(wrapper.get('mark').text()).toBe('<i>x</i>')
    expect(wrapper.element.querySelector('i')).toBeNull()
  })

  it('moves the mark when text, start and end change', async () => {
    const wrapper = await mountMirror()

    await wrapper.setProps({
      text: '/meeting-notes then',
      start: 0,
      end: 14,
    })

    expect(wrapper.get('mark').text()).toBe('/meeting-notes')
    expect(readPlainText(wrapper.element)).toBe(' then ')
    expect(wrapper.element.textContent).toBe('/meeting-notes then ')
  })

  it('copies the typography and padding of the textarea', async () => {
    const textarea = createTextarea()
    const wrapper = await mountMirror({ textarea })

    await flushPromises()

    const style = (wrapper.element as HTMLElement).style

    expect(style.fontSize).toBe('18px')
    expect(style.fontWeight).toBe('600')
    expect(style.letterSpacing).toBe('1px')
    expect(style.lineHeight).toBe('24px')
    expect(style.paddingTop).toBe('10px')
    expect(style.paddingRight).toBe('14px')
    expect(style.paddingBottom).toBe('12px')
    expect(style.paddingLeft).toBe('16px')
    expect(style.fontFamily).toContain('Menlo')
  })

  it('copies the metrics of a textarea that arrives later', async () => {
    const wrapper = await mountMirror({ textarea: null })
    const style = (wrapper.element as HTMLElement).style

    expect(style.fontSize).toBe('')

    await wrapper.setProps({ textarea: createTextarea() })
    await flushPromises()

    expect(style.fontSize).toBe('18px')
    expect(style.paddingLeft).toBe('16px')
  })

  it('follows the scroll position of the textarea', async () => {
    const textarea = createTextarea()
    const wrapper = await mountMirror({ textarea })

    textarea.scrollTop = 40
    textarea.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect((wrapper.element as HTMLElement).scrollTop).toBe(40)
  })

  it('reveals the textarea under a badge the caret is strictly inside, not '
    + 'at its edges', async () => {
    const textarea = createTextarea()

    textarea.value = 'Please /c this'
    textarea.focus()

    const wrapper = await mountMirror({ textarea, start: 7, end: 9 })
    const token = () => {
      return wrapper.get('[data-testid="command-mirror-token"]')
    }

    textarea.setSelectionRange(8, 8)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-reveal')).toBe('true')

    textarea.setSelectionRange(9, 9)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-reveal')).toBeUndefined()
    expect(token().attributes('data-caret')).toBe('end')
  })

  it('reveals the textarea under a badge a selection overlaps', async () => {
    const textarea = createTextarea()

    textarea.value = 'Please /c this'
    textarea.focus()

    const wrapper = await mountMirror({ textarea, start: 7, end: 9 })
    const token = () => {
      return wrapper.get('[data-testid="command-mirror-token"]')
    }

    textarea.setSelectionRange(0, 8)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-reveal')).toBe('true')

    textarea.setSelectionRange(0, 7)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-reveal')).toBeUndefined()

    textarea.blur()
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()

    expect(token().attributes('data-reveal')).toBeUndefined()
  })

  describe('with a list of ranges', () => {
    const FIRST_LINK = 'https://docs.google.com/document/d/1ExampleExampleExampleExample0123456789/edit'
    const SECOND_LINK = 'https://drive.google.com/file/d/1SecondSecondSecondSecond0123456789/view'

    function rangeOf(text: string, part: string, kind: ComposerMirrorKind) {
      const start = text.indexOf(part)

      return { start, end: start + part.length, kind }
    }

    it('paints one mark per range with the right slices', async () => {
      const text = `a ${FIRST_LINK} b ${SECOND_LINK} c`
      const wrapper = await mountMirror({
        text,
        ranges: [
          rangeOf(text, FIRST_LINK, 'google-link'),
          rangeOf(text, SECOND_LINK, 'google-link'),
        ],
      })
      const marks = wrapper.findAll('mark')

      expect(marks).toHaveLength(2)
      expect(marks.map((mark) => {
        return mark.text()
      })).toEqual([FIRST_LINK, SECOND_LINK])
      expect(marks.every((mark) => {
        return mark.classes().includes('composer-command-token')
          && mark.attributes('data-kind') === 'google-link'
          && mark.attributes('data-testid') === 'command-mirror-link'
      })).toBe(true)
      expect(readPlainText(wrapper.element)).toBe('a  b  c ')
    })

    it('draws a command and a link together', async () => {
      const text = `/meeting see ${FIRST_LINK}`
      const wrapper = await mountMirror({
        text,
        ranges: [
          rangeOf(text, FIRST_LINK, 'google-link'),
          rangeOf(text, '/meeting', 'command'),
        ],
      })

      expect(wrapper.findAll('mark').map((mark) => {
        return [mark.attributes('data-kind'), mark.text()]
      })).toEqual([
        ['command', '/meeting'],
        ['google-link', FIRST_LINK],
      ])
      expect(wrapper.find('[data-testid="command-mirror-token"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="command-mirror-link"]').exists())
        .toBe(true)
    })

    it('clips overlapping ranges and ignores ranges outside the text',
      async () => {
        const wrapper = await mountMirror({
          text: 'abcdefghij',
          ranges: [
            { start: 4, end: 8, kind: 'google-link' },
            { start: 2, end: 6, kind: 'command' },
            { start: 7, end: 40, kind: 'google-link' },
            { start: 30, end: 40, kind: 'google-link' },
            { start: -5, end: 1, kind: 'google-link' },
            { start: 6, end: 3, kind: 'google-link' },
            { start: Number.NaN, end: 5, kind: 'google-link' },
          ],
        })

        expect(wrapper.findAll('mark').map((mark) => {
          return mark.text()
        })).toEqual(['a', 'cdef', 'gh', 'ij'])
        expect(wrapper.element.textContent).toBe('abcdefghij ')
      })

    it('paints nothing for an empty list', async () => {
      const wrapper = await mountMirror({ ranges: [] })

      expect(wrapper.findAll('mark')).toHaveLength(0)
      expect(wrapper.element.textContent).toBe('Please /c this ')
    })

    it('mirrors the text exactly, tabs, blank lines and double spaces '
      + 'included, so widths match the textarea', async () => {
      const text = `a\t${FIRST_LINK}\n\n  b  ${SECOND_LINK}\n`
      const wrapper = await mountMirror({
        text,
        ranges: [
          rangeOf(text, FIRST_LINK, 'google-link'),
          rangeOf(text, SECOND_LINK, 'google-link'),
        ],
      })

      expect(wrapper.element.textContent).toBe(`${text} `)
      expect(wrapper.classes()).toContain('whitespace-pre-wrap')
    })

    it('renders markup around a link as plain text', async () => {
      const text = `<b>x</b> ${FIRST_LINK} <img src=x onerror=1>`
      const wrapper = await mountMirror({
        text,
        ranges: [rangeOf(text, FIRST_LINK, 'google-link')],
      })

      expect(wrapper.element.textContent).toBe(`${text} `)
      expect(wrapper.element.querySelector('b, img')).toBeNull()
      expect(wrapper.element.children).toHaveLength(1)
    })

    it('follows the text while it changes', async () => {
      const text = `see ${FIRST_LINK}`
      const wrapper = await mountMirror({
        text,
        ranges: [rangeOf(text, FIRST_LINK, 'google-link')],
      })
      const longerText = `hello there ${FIRST_LINK} and ${SECOND_LINK}`

      await wrapper.setProps({
        text: longerText,
        ranges: [
          rangeOf(longerText, FIRST_LINK, 'google-link'),
          rangeOf(longerText, SECOND_LINK, 'google-link'),
        ],
      })

      expect(wrapper.findAll('mark')).toHaveLength(2)
      expect(wrapper.element.textContent).toBe(`${longerText} `)

      await wrapper.setProps({ text: 'plain', ranges: [] })

      expect(wrapper.findAll('mark')).toHaveLength(0)
      expect(wrapper.element.textContent).toBe('plain ')
    })

    it('sets the caret edge and reveal per link', async () => {
      const textarea = createTextarea()
      const text = `${FIRST_LINK} ${SECOND_LINK}`

      textarea.value = text
      textarea.focus()

      const wrapper = await mountMirror({
        textarea,
        text,
        ranges: [
          rangeOf(text, FIRST_LINK, 'google-link'),
          rangeOf(text, SECOND_LINK, 'google-link'),
        ],
      })
      const [first, second] = wrapper.findAll('mark')

      textarea.setSelectionRange(FIRST_LINK.length, FIRST_LINK.length)
      document.dispatchEvent(new Event('selectionchange'))
      await flushPromises()

      expect(first!.attributes('data-caret')).toBe('end')
      expect(second!.attributes('data-caret')).toBeUndefined()

      textarea.setSelectionRange(text.length - 5, text.length - 5)
      document.dispatchEvent(new Event('selectionchange'))
      await flushPromises()

      expect(first!.attributes('data-reveal')).toBeUndefined()
      expect(second!.attributes('data-reveal')).toBe('true')
    })

    it('is an out-of-flow overlay that adds no height to the composer',
      async () => {
        const text = `see ${FIRST_LINK}`
        const wrapper = await mountMirror({
          text,
          ranges: [rangeOf(text, FIRST_LINK, 'google-link')],
        })

        expect(wrapper.classes()).toEqual(expect.arrayContaining([
          'absolute',
          'inset-0',
          'overflow-hidden',
          'pointer-events-none',
        ]))
        expect(wrapper.attributes('aria-hidden')).toBe('true')
        expect(wrapper.get('mark').attributes('style')).toBeUndefined()
      })
  })
})
