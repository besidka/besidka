import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CommandMirror from '../../../../app/components/ChatInput/CommandMirror.vue'

enableAutoUnmount(afterEach)

interface MountOptions {
  text?: string
  start?: number
  end?: number
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
})
