import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import BuiltinList from '../../../../../app/components/Profile/Skills/BuiltinList.vue'

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
}))

const activeKeys = ref<string[]>(['skills.commands'])

mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = activeKeys.value.includes(key)

    return { enabled: active, active, variant: null }
  })
})
mockNuxtImport('useClipboard', () => {
  return () => ({ copy: mocks.copy })
})
mockNuxtImport('useSuccessMessage', () => mocks.success)

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/BuiltinList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeKeys.value = ['skills.commands']
  })

  it('lists every built-in under a labelled Built-in heading', async () => {
    const wrapper = await mountSuspended(BuiltinList)
    const section = wrapper.get(testId('skills-builtin'))
    const heading = section.get('h2')

    expect(section.element.tagName).toBe('SECTION')
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(heading.text()).toBe('Built-in')
    expect(wrapper.findAll(testId('skill-builtin-row')).map((row) => {
      return row.attributes('data-command')
    })).toEqual(['cost', 'debug', 'stats'])
    expect(wrapper.get(testId('skills-builtin-note')).text())
      .toContain('without a model, so they cost nothing')
  })

  it('shows the command with its argument hint and how to use it', async () => {
    const wrapper = await mountSuspended(BuiltinList)

    expect(wrapper.get(testId('skill-builtin-command-stats')).text())
      .toBe('/stats [7d|30d|all]')
    expect(wrapper.get(testId('skill-builtin-command-cost')).text())
      .toBe('/cost')
    expect(wrapper.get(testId('skill-builtin-howto-cost')).text())
      .toBe('How to use: type /cost in a chat.')
  })

  it('suggests asking in plain words only with Besidka tools in chats', async () => {
    activeKeys.value = ['skills.commands', 'besidka-tools', 'tool-approvals']

    const wrapper = await mountSuspended(BuiltinList)

    expect(wrapper.get(testId('skill-builtin-howto-cost')).text()).toBe(
      'How to use: type /cost in a chat, or ask “How much did this chat '
      + 'cost?” (that one uses the model).',
    )
  })

  it('offers no action that changes a built-in, only Copy', async () => {
    const wrapper = await mountSuspended(BuiltinList)
    const row = wrapper.get('[data-command="debug"]')

    expect(row.findAll('button')).toHaveLength(1)
    expect(row.find('select').exists()).toBe(false)
    expect(row.find('details').exists()).toBe(false)

    const copy = row.get(testId('skill-builtin-copy-debug'))

    expect(copy.attributes('aria-label')).toBe('Copy /debug')

    await copy.trigger('click')
    await flushPromises()

    expect(mocks.copy).toHaveBeenCalledWith('/debug')
    expect(mocks.success).toHaveBeenCalledWith('Copied /debug')
  })

  it('filters by the search text', async () => {
    const wrapper = await mountSuspended(BuiltinList, {
      props: { query: '/usage' },
    })

    expect(wrapper.findAll(testId('skill-builtin-row')).map((row) => {
      return row.attributes('data-command')
    })).toEqual(['stats'])
  })

  it('renders nothing without the commands flag or a match', async () => {
    activeKeys.value = []

    const hidden = await mountSuspended(BuiltinList)

    expect(hidden.find(testId('skills-builtin')).exists()).toBe(false)

    activeKeys.value = ['skills.commands']

    const empty = await mountSuspended(BuiltinList, {
      props: { query: 'nothing-like-this' },
    })

    expect(empty.find(testId('skills-builtin')).exists()).toBe(false)
  })
})
