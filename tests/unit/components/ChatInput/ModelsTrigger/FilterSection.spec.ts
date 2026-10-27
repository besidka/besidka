import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type {
  GatewayCapabilityFilter,
  GatewayCapabilityFilterOption,
  ModelCategory,
} from '~/types/models-picker'
import FilterSection
  from '../../../../../app/components/ChatInput/ModelsTrigger/FilterSection.vue'

const capabilityOptions: GatewayCapabilityFilterOption[] = [
  { value: 'reasoning', label: 'Reasoning', icon: 'lucide:brain' },
  { value: 'tool-calling', label: 'Tool calling', icon: 'lucide:wrench' },
]

function mountSection(props: Partial<{
  modelValue: ModelCategory | null
  visionOnly: boolean
  capabilities: GatewayCapabilityFilter[]
  capabilityOptions: GatewayCapabilityFilterOption[]
}> = {}) {
  return mountSuspended(FilterSection, {
    props: {
      modelValue: null,
      visionOnly: false,
      capabilities: [],
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/FilterSection', () => {
  it('renders every category, vision and Clear as touch-sized chips',
    async () => {
      const wrapper = await mountSection()

      for (const testId of [
        'models-picker-filter-chat',
        'models-picker-filter-research',
        'models-picker-filter-image-generation',
        'models-picker-filter-vision',
        'models-picker-filter-clear',
      ]) {
        const chip = wrapper.get(`[data-testid="${testId}"]`)

        expect(chip.element.tagName).toBe('BUTTON')
        expect(chip.classes()).toEqual(expect.arrayContaining([
          'btn-xs',
          'hitslop',
        ]))
      }

      expect(wrapper.get('[data-testid="models-picker-filter-clear"]')
        .attributes('disabled')).toBeDefined()
    })

  it('toggles a category on and off without other side effects',
    async () => {
      const wrapper = await mountSection()
      const chat = wrapper.get('[data-testid="models-picker-filter-chat"]')

      await chat.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([['chat']])

      await wrapper.setProps({ modelValue: 'chat' })

      expect(chat.attributes('aria-pressed')).toBe('true')
      expect(chat.classes()).toContain('btn-accent')

      await chat.trigger('click')

      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    })

  it('toggles vision and capabilities independently', async () => {
    const wrapper = await mountSection({
      capabilityOptions,
      capabilities: ['reasoning'],
    })

    await wrapper.get('[data-testid="models-picker-filter-vision"]')
      .trigger('click')
    await wrapper.get('[data-testid="models-picker-filter-tool-calling"]')
      .trigger('click')
    await wrapper.get('[data-testid="models-picker-filter-reasoning"]')
      .trigger('click')

    expect(wrapper.emitted('update:visionOnly')).toEqual([[true]])
    expect(wrapper.emitted('update:capabilities')?.[0])
      .toEqual([['reasoning', 'tool-calling']])
    expect(wrapper.emitted('update:capabilities')?.at(-1)).not.toContainEqual(
      expect.arrayContaining(['reasoning']),
    )
  })

  it('clears every filter at once', async () => {
    const wrapper = await mountSection({
      modelValue: 'free',
      visionOnly: true,
      capabilityOptions,
      capabilities: ['reasoning'],
    })
    const clear = wrapper.get('[data-testid="models-picker-filter-clear"]')

    expect(clear.attributes('disabled')).toBeUndefined()

    await clear.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
    expect(wrapper.emitted('update:visionOnly')).toEqual([[false]])
    expect(wrapper.emitted('update:capabilities')).toEqual([[[]]])
  })
})
