import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import type { ModelCategory } from '~/types/models-picker'
import FilterDropdown
  from '../../../../../app/components/ChatInput/ModelsTrigger/FilterDropdown.vue'

const mocks = vi.hoisted(() => ({
  onClickOutside: vi.fn(),
}))

mockNuxtImport('onClickOutside', () => mocks.onClickOutside)

async function mountFilterDropdown(selected: ModelCategory[] = []) {
  const wrapper = await mountSuspended(FilterDropdown, {
    props: {
      'modelValue': selected,
      'onUpdate:modelValue': (value: ModelCategory[]) => {
        wrapper.setProps({ modelValue: value })
      },
    },
  })

  return wrapper
}

function getClickOutsideHandler() {
  const handler = mocks.onClickOutside.mock.calls.at(-1)?.[1]

  expect(handler).toBeTypeOf('function')

  return handler as () => void
}

describe('ChatInput/ModelsTrigger/FilterDropdown', () => {
  it('renders a checkbox for every model category', async () => {
    const wrapper = await mountFilterDropdown()
    const menu = wrapper.get('[data-testid="models-picker-filter-menu"]')

    expect(menu.text()).toContain('Chat')
    expect(menu.text()).toContain('Deep research')
    expect(menu.text()).toContain('Image generation')
    expect(wrapper.find('[data-testid="models-picker-filter-chat"]').exists())
      .toBe(true)
    expect(
      wrapper.find('[data-testid="models-picker-filter-research"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find(
        '[data-testid="models-picker-filter-image-generation"]',
      ).exists(),
    ).toBe(true)
  })

  it('checks only the selected categories', async () => {
    const wrapper = await mountFilterDropdown(['research'])
    const research = wrapper.get<HTMLInputElement>(
      '[data-testid="models-picker-filter-research"]',
    )
    const chat = wrapper.get<HTMLInputElement>(
      '[data-testid="models-picker-filter-chat"]',
    )

    expect(research.element.checked).toBe(true)
    expect(chat.element.checked).toBe(false)
  })

  it('adds a category on the first change and removes it on the second', async () => {
    const wrapper = await mountFilterDropdown()
    const chat = wrapper.get('[data-testid="models-picker-filter-chat"]')

    await chat.setValue(true)

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['chat']])

    await chat.setValue(false)

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]])
  })

  it('keeps existing categories when another one is added', async () => {
    const wrapper = await mountFilterDropdown(['chat'])

    await wrapper.get('[data-testid="models-picker-filter-image-generation"]')
      .setValue(true)

    expect(wrapper.emitted('update:modelValue')?.at(-1))
      .toEqual([['chat', 'image-generation']])
  })

  it('leaves the trigger unbadged while no filter is applied', async () => {
    const wrapper = await mountFilterDropdown()
    const trigger = wrapper.get(
      '[data-testid="models-picker-filter-trigger"]',
    )

    expect(trigger.attributes('aria-label')).toBe('Filter models by category')
    expect(trigger.classes()).not.toContain('text-accent')
    expect(trigger.find('.badge').exists()).toBe(false)
  })

  it('badges the trigger with the number of applied filters', async () => {
    const wrapper = await mountFilterDropdown(['chat', 'research'])
    const trigger = wrapper.get(
      '[data-testid="models-picker-filter-trigger"]',
    )

    expect(trigger.classes()).toContain('text-accent')
    expect(trigger.get('.badge').text()).toBe('2')
  })

  it('closes the open dropdown on escape', async () => {
    const wrapper = await mountFilterDropdown()
    const dropdown = wrapper.get('details')

    dropdown.element.open = true

    await dropdown.trigger('keydown', { key: 'Escape' })

    expect(dropdown.element.open).toBe(false)
  })

  it('closes the open dropdown on an outside click', async () => {
    const wrapper = await mountFilterDropdown()
    const dropdown = wrapper.get('details')

    dropdown.element.open = true
    getClickOutsideHandler()()

    expect(dropdown.element.open).toBe(false)
  })

  it('leaves an already closed dropdown alone on an outside click', async () => {
    const wrapper = await mountFilterDropdown()
    const dropdown = wrapper.get('details')

    getClickOutsideHandler()()

    expect(dropdown.element.open).toBe(false)
  })
})
