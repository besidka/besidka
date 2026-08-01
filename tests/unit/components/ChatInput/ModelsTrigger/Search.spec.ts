import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import Search
  from '../../../../../app/components/ChatInput/ModelsTrigger/Search.vue'

enableAutoUnmount(afterEach)

function mountSearch(
  props: Partial<{
    modelValue: string
    autofocus: boolean
    controls: string
    activeDescendant: string
  }> = {},
) {
  return mountSuspended(Search, {
    attachTo: document.body,
    props: {
      modelValue: '',
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/Search', () => {
  it('exposes the input as a combobox wired to the model listbox', async () => {
    const wrapper = await mountSearch({
      controls: 'models-listbox',
      activeDescendant: 'model-option-gpt-5.4',
    })
    const input = wrapper.get('[data-testid="models-picker-search"]')

    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-label')).toBe('Search models')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe('models-listbox')
    expect(input.attributes('aria-activedescendant'))
      .toBe('model-option-gpt-5.4')
  })

  it('omits aria-activedescendant when nothing is highlighted', async () => {
    const wrapper = await mountSearch({ controls: 'models-listbox' })

    expect(
      wrapper.get('[data-testid="models-picker-search"]')
        .attributes('aria-activedescendant'),
    ).toBeUndefined()
  })

  it('emits the query as the user types', async () => {
    const wrapper = await mountSearch()

    await wrapper.get('[data-testid="models-picker-search"]').setValue('gpt')

    expect(wrapper.emitted('update:modelValue')).toEqual([['gpt']])
  })

  it('hides the clear button while the query is empty', async () => {
    const wrapper = await mountSearch()

    expect(wrapper.find('button[aria-label="Clear search"]').exists())
      .toBe(false)
  })

  it('clears the query and returns focus to the input', async () => {
    const wrapper = await mountSearch({ modelValue: 'gpt' })
    const input = wrapper.get('[data-testid="models-picker-search"]')

    await wrapper.get('button[aria-label="Clear search"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    expect(document.activeElement).toBe(input.element)
  })

  it('forwards keydown events to the parent picker', async () => {
    const wrapper = await mountSearch()

    await wrapper.get('[data-testid="models-picker-search"]')
      .trigger('keydown', { key: 'ArrowDown' })

    const events = wrapper.emitted('keydown')

    expect(events).toHaveLength(1)
    expect((events?.[0]?.[0] as KeyboardEvent).key).toBe('ArrowDown')
  })

  it('focuses the input on mount when autofocus is requested', async () => {
    const wrapper = await mountSearch({ autofocus: true })

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="models-picker-search"]').element,
    )
  })

  it('leaves focus alone on mount without autofocus', async () => {
    const wrapper = await mountSearch()

    expect(document.activeElement).not.toBe(
      wrapper.get('[data-testid="models-picker-search"]').element,
    )
  })
})
