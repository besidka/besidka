import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillPicker from '../../../../app/components/ChatInput/SkillPicker.client.vue'
import type { ComposerSkillItem } from '../../../../app/composables/composer-skills'

enableAutoUnmount(afterEach)

const items: ComposerSkillItem[] = [
  {
    id: 'skl1',
    name: 'writing-style',
    description: 'Write in my voice',
    version: 1,
    mode: 'auto',
  },
  {
    id: 'skl2',
    name: 'meeting-notes',
    description: 'Turn a transcript into notes',
    version: 2,
    mode: 'ask',
  },
]

function find(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function get(id: string): HTMLElement {
  const element = find(id)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element
}

async function mountPicker(selectedId: string | null = null) {
  const wrapper = await mountSuspended(SkillPicker, {
    props: { items, selectedId, open: true },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })

  await flushPromises()

  return wrapper
}

describe('ChatInput/SkillPicker', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a dialog and lists every skill with its mode', async () => {
    await mountPicker()

    expect(get('skill-picker-dialog').hasAttribute('open')).toBe(true)
    expect(get('skill-picker-item-writing-style').textContent)
      .toContain('Write in my voice')
    expect(get('skill-picker-item-writing-style').textContent)
      .toContain('Auto')
    expect(get('skill-picker-item-meeting-notes').textContent)
      .toContain('Only when I ask')
  })

  it('filters by name or description and offers Clear when nothing matches', async () => {
    const wrapper = await mountPicker()
    const input = document.body.querySelector('input[type="text"]')!

    ;(input as HTMLInputElement).value = 'transcript'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(find('skill-picker-item-meeting-notes')).not.toBeNull()
    expect(find('skill-picker-item-writing-style')).toBeNull()

    ;(input as HTMLInputElement).value = 'zzz'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(get('skill-picker-empty').textContent).toContain('Nothing matches "zzz"')

    get('skill-picker-clear').click()
    await flushPromises()

    expect(find('skill-picker-item-writing-style')).not.toBeNull()
    expect(wrapper.exists()).toBe(true)
  })

  it('emits the chosen skill and closes', async () => {
    const wrapper = await mountPicker()

    get('skill-picker-item-meeting-notes').click()
    await flushPromises()

    expect(wrapper.emitted('pick')).toEqual([[items[1]]])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('marks the attached skill', async () => {
    await mountPicker('skl2')

    expect(get('skill-picker-item-meeting-notes').getAttribute('aria-pressed'))
      .toBe('true')
    expect(get('skill-picker-item-writing-style').getAttribute('aria-pressed'))
      .toBe('false')
  })
})
