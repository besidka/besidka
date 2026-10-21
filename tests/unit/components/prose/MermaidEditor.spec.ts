import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import MermaidEditor from '../../../../app/components/prose/MermaidEditor.vue'

const SOURCE = 'flowchart LR\n  A --> B'
const EDITOR_SELECTOR = '[data-testid="mermaid-editor"]'

const mountedWrappers: VueWrapper[] = []

async function mountEditor(modelValue: string = SOURCE) {
  const wrapper = await mountSuspended(MermaidEditor, {
    props: {
      'modelValue': modelValue,
      'onUpdate:modelValue': (value: string | undefined) => {
        wrapper.setProps({ modelValue: value })
      },
    },
    attachTo: document.body,
  })

  mountedWrappers.push(wrapper)

  return wrapper
}

function getTextarea(wrapper: VueWrapper): HTMLTextAreaElement {
  return wrapper.get(EDITOR_SELECTOR).element as HTMLTextAreaElement
}

function pressKey(
  textarea: HTMLTextAreaElement,
  init: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })

  textarea.dispatchEvent(event)

  return event
}

describe('prose/MermaidEditor.vue', () => {
  afterEach(() => {
    vi.restoreAllMocks()

    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount()
    }
  })

  it('renders a code-styled textarea without autocorrection', async () => {
    const wrapper = await mountEditor()
    const textarea = getTextarea(wrapper)

    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea.value).toBe(SOURCE)
    expect(textarea.classList.contains('font-code')).toBe(true)
    expect(textarea.classList.contains('max-h-72')).toBe(true)
    expect(textarea.getAttribute('spellcheck')).toBe('false')
    expect(textarea.getAttribute('autocapitalize')).toBe('off')
    expect(textarea.getAttribute('aria-label')).toBe('Diagram source')
  })

  it('describes the textarea with a visible Tab and Escape hint', async () => {
    const wrapper = await mountEditor()
    const hint = wrapper.get('[data-testid="mermaid-editor-hint"]')

    expect(hint.text()).toBe('Tab inserts spaces · Esc to finish')
    expect(hint.attributes('id')).toBeTruthy()
    expect(getTextarea(wrapper).getAttribute('aria-describedby'))
      .toBe(hint.attributes('id'))
  })

  it('focuses the textarea when it mounts', async () => {
    const wrapper = await mountEditor()

    expect(document.activeElement).toBe(getTextarea(wrapper))
  })

  it('emits the typed text through the model', async () => {
    const wrapper = await mountEditor()

    await wrapper.get(EDITOR_SELECTOR).setValue('flowchart LR\n  A --> C')

    expect(wrapper.emitted('update:modelValue')?.at(-1))
      .toEqual(['flowchart LR\n  A --> C'])
  })

  it('grows to the content height on input', async () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(180)

    const wrapper = await mountEditor()

    expect(getTextarea(wrapper).style.height).toBe('180px')

    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(260)

    await wrapper.get(EDITOR_SELECTOR).setValue(`${SOURCE}\n  B --> C`)

    expect(getTextarea(wrapper).style.height).toBe('260px')
  })

  it('inserts two spaces at the caret on Tab', async () => {
    const wrapper = await mountEditor('abcd')
    const textarea = getTextarea(wrapper)

    textarea.setSelectionRange(2, 2)

    const event = pressKey(textarea, { key: 'Tab' })

    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe('ab  cd')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['ab  cd'])
  })

  it('replaces the selection with two spaces on Tab', async () => {
    const wrapper = await mountEditor('abcd')
    const textarea = getTextarea(wrapper)

    textarea.setSelectionRange(1, 3)
    pressKey(textarea, { key: 'Tab' })

    expect(textarea.value).toBe('a  d')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['a  d'])
  })

  it('leaves Shift+Tab alone so focus can move away', async () => {
    const wrapper = await mountEditor('abcd')
    const textarea = getTextarea(wrapper)

    const event = pressKey(textarea, { key: 'Tab', shiftKey: true })

    expect(event.defaultPrevented).toBe(false)
    expect(textarea.value).toBe('abcd')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', {}],
  ])('ignores Tab and Escape during IME composition (%s)',
    async (_label, init) => {
      const wrapper = await mountEditor('abcd')
      const textarea = getTextarea(wrapper)

      textarea.setSelectionRange(2, 2)

      for (const key of ['Tab', 'Escape']) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        })

        if (!('isComposing' in init)) {
          Object.defineProperty(event, 'keyCode', { value: 229 })
        }

        textarea.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(false)
      }

      expect(textarea.value).toBe('abcd')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(wrapper.emitted('exit')).toBeUndefined()
    })

  it('emits exit on Escape', async () => {
    const wrapper = await mountEditor()

    await wrapper.get(EDITOR_SELECTOR).trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('exit')).toHaveLength(1)
  })
})
