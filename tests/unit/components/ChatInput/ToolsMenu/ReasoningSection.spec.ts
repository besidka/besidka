import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import type {
  ReasoningEnabledLevel,
  ReasoningLevel,
} from '#shared/types/reasoning.d'
import ReasoningSection from '../../../../../app/components/ChatInput/ToolsMenu/ReasoningSection.vue'

const mocks = vi.hoisted(() => ({
  useUserSetting: vi.fn(),
  setReasoningExpanded: vi.fn(),
  setReasoningAutoHide: vi.fn(),
}))

mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

function setReasoningUserSetting(
  reasoningExpanded: boolean,
  reasoningAutoHide: boolean,
) {
  mocks.useUserSetting.mockReturnValue({
    reasoningExpanded: shallowRef<boolean>(reasoningExpanded),
    reasoningAutoHide: shallowRef<boolean>(reasoningAutoHide),
    setReasoningExpanded: mocks.setReasoningExpanded,
    setReasoningAutoHide: mocks.setReasoningAutoHide,
  })
}

interface SectionProps {
  mode?: 'configurable' | 'always-on'
  reasoning: ReasoningLevel
  levels: ReasoningEnabledLevel[]
  defaultLevel?: ReasoningLevel
  canDisable?: boolean
}

async function mountSection(
  props: SectionProps,
  options: { attachTo?: HTMLElement } = {},
) {
  const selectedLevels: ReasoningLevel[] = []
  const savedLevels: ReasoningLevel[] = []
  const state = shallowRef<SectionProps>(props)

  const Host = defineComponent({
    setup() {
      return () => h('div', { class: 'js-tools-content' }, h(ReasoningSection, {
        'mode': 'configurable',
        'defaultLevel': 'off',
        ...state.value,
        'onSelect-level': (level: ReasoningLevel) => {
          selectedLevels.push(level)
        },
        'onSave-default': (level: ReasoningLevel) => {
          savedLevels.push(level)
        },
      }))
    },
  })

  const wrapper = await mountSuspended(Host, options)

  return { wrapper, selectedLevels, savedLevels, state }
}

type SectionWrapper = Awaited<ReturnType<typeof mountSection>>['wrapper']

function levelLabels(wrapper: SectionWrapper): string[] {
  return wrapper.findAll('[data-testid^="reasoning-level-"]').map((item) => {
    return item.attributes('aria-label') ?? ''
  })
}

function input(wrapper: SectionWrapper, testId: string) {
  return wrapper.get(`[data-testid="${testId}"]`)
    .element as HTMLInputElement
}

function hasRow(wrapper: SectionWrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

describe('ChatInput/ToolsMenu/ReasoningSection', () => {
  beforeEach(() => {
    setReasoningUserSetting(false, true)
  })

  it('offers Off plus every effort level by default', async () => {
    const { wrapper } = await mountSection({
      reasoning: 'medium',
      levels: ['low', 'medium', 'high'],
    })

    expect(levelLabels(wrapper)).toEqual(['Off', 'Low', 'Medium', 'High'])
    expect(input(wrapper, 'reasoning-level-medium').checked).toBe(true)
  })

  it('shows a think icon on every level segment, Off included', async () => {
    const { wrapper } = await mountSection({
      reasoning: 'medium',
      levels: ['low', 'medium', 'high'],
    })

    for (const level of ['off', 'low', 'medium', 'high']) {
      const icon = wrapper.get(
        `[data-testid="icon-reasoning-level-${level}"]`,
      )

      expect(icon.attributes('aria-hidden')).toBe('true')
      expect(icon.classes()).toContain('pointer-events-none')
    }
  })

  it('shows the single think icon of a toggle-mode model on On', async () => {
    const { wrapper } = await mountSection({
      reasoning: 'off',
      levels: ['medium'],
    })

    expect(wrapper.find('[data-testid="icon-reasoning-level-off"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="icon-reasoning-level-medium"]')
      .exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="icon-reasoning-level-"]'))
      .toHaveLength(2)
  })

  it('omits Off for a model that cannot disable reasoning', async () => {
    const { wrapper } = await mountSection({
      reasoning: 'high',
      levels: ['low', 'high'],
      canDisable: false,
    })

    expect(levelLabels(wrapper)).toEqual(['Low', 'High'])
  })

  it('renders Off and On for a toggle-mode model and emits the level',
    async () => {
      const { wrapper, selectedLevels } = await mountSection({
        reasoning: 'off',
        levels: ['medium'],
      })

      expect(levelLabels(wrapper)).toEqual(['Off', 'On'])

      await wrapper.get('[data-testid="reasoning-level-medium"]')
        .setValue(true)

      expect(selectedLevels).toEqual(['medium'])
    })

  it('hides both steps rows while reasoning is off', async () => {
    setReasoningUserSetting(true, true)

    const { wrapper } = await mountSection({
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
    })

    expect(hasRow(wrapper, 'reasoning-expanded-toggle')).toBe(false)
    expect(hasRow(wrapper, 'reasoning-auto-hide-toggle')).toBe(false)
  })

  it('shows Show steps expanded as soon as reasoning is on, reflecting the '
    + 'saved setting', async () => {
    setReasoningUserSetting(false, true)

    const { wrapper, state } = await mountSection({
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
    })

    expect(hasRow(wrapper, 'reasoning-expanded-toggle')).toBe(false)

    state.value = { ...state.value, reasoning: 'low' }
    await nextTick()

    expect(input(wrapper, 'reasoning-expanded-toggle').checked).toBe(false)
    expect(input(wrapper, 'reasoning-expanded-toggle').disabled).toBe(false)
  })

  it('hides Auto-hide while steps are collapsed', async () => {
    setReasoningUserSetting(false, true)

    const { wrapper } = await mountSection({
      reasoning: 'low',
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'low',
    })

    expect(hasRow(wrapper, 'reasoning-expanded-toggle')).toBe(true)
    expect(hasRow(wrapper, 'reasoning-auto-hide-toggle')).toBe(false)
  })

  it('shows Auto-hide only while reasoning is on and steps are expanded',
    async () => {
      setReasoningUserSetting(true, false)

      const { wrapper, state } = await mountSection({
        reasoning: 'low',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      })

      expect(input(wrapper, 'reasoning-expanded-toggle').checked).toBe(true)
      expect(input(wrapper, 'reasoning-auto-hide-toggle').disabled)
        .toBe(false)

      await wrapper.get('[data-testid="reasoning-auto-hide-toggle"]')
        .setValue(true)

      expect(mocks.setReasoningAutoHide).toHaveBeenCalledWith(true)

      state.value = { ...state.value, reasoning: 'off' }
      await nextTick()

      expect(hasRow(wrapper, 'reasoning-auto-hide-toggle')).toBe(false)
    })

  describe('Save as default', () => {
    it('is not rendered while the level is the default', async () => {
      const { wrapper } = await mountSection({
        reasoning: 'medium',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'medium',
      })

      expect(hasRow(wrapper, 'reasoning-save-default-toggle')).toBe(false)
      expect(wrapper.text()).not.toContain('is your default')
    })

    it('appears off with the current default when the level differs, and '
      + 'emits the level once turned on', async () => {
      const { wrapper, savedLevels, state } = await mountSection({
        reasoning: 'high',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      })

      expect(input(wrapper, 'reasoning-save-default-toggle').checked)
        .toBe(false)
      expect(wrapper.text()).toContain('Your default is Low')

      await wrapper.get('[data-testid="reasoning-save-default-toggle"]')
        .setValue(true)

      expect(savedLevels).toEqual(['high'])
      expect(input(wrapper, 'reasoning-save-default-toggle').checked)
        .toBe(true)

      state.value = { ...state.value, defaultLevel: 'high' }
      await wrapper.vm.$nextTick()

      expect(hasRow(wrapper, 'reasoning-save-default-toggle')).toBe(false)

      state.value = { ...state.value, reasoning: 'medium' }
      await wrapper.vm.$nextTick()

      expect(input(wrapper, 'reasoning-save-default-toggle').checked)
        .toBe(false)
      expect(wrapper.text()).toContain('Your default is High')
    })
  })

  describe('focus when a row unmounts', () => {
    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('moves focus from the Save as default row to the checked level '
      + 'radio once the default catches up', async () => {
      const { wrapper, state } = await mountSection({
        reasoning: 'high',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      }, { attachTo: document.body })

      input(wrapper, 'reasoning-save-default-toggle').focus()

      expect(document.activeElement)
        .toBe(input(wrapper, 'reasoning-save-default-toggle'))

      state.value = { ...state.value, defaultLevel: 'high' }
      await nextTick()
      await nextTick()

      expect(hasRow(wrapper, 'reasoning-save-default-toggle')).toBe(false)
      expect(document.activeElement)
        .toBe(input(wrapper, 'reasoning-level-high'))
    })

    it('moves focus to the checked level radio when the focused steps row '
      + 'is hidden', async () => {
      setReasoningUserSetting(true, false)

      const { wrapper, state } = await mountSection({
        reasoning: 'low',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      }, { attachTo: document.body })

      input(wrapper, 'reasoning-expanded-toggle').focus()
      state.value = { ...state.value, reasoning: 'off' }
      await nextTick()
      await nextTick()

      expect(hasRow(wrapper, 'reasoning-expanded-toggle')).toBe(false)
      expect(document.activeElement)
        .toBe(input(wrapper, 'reasoning-level-off'))
    })

    it('leaves focus alone when an unfocused row unmounts', async () => {
      const { wrapper, state } = await mountSection({
        reasoning: 'high',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      }, { attachTo: document.body })

      input(wrapper, 'reasoning-level-low').focus()
      state.value = { ...state.value, defaultLevel: 'high' }
      await nextTick()
      await nextTick()

      expect(document.activeElement)
        .toBe(input(wrapper, 'reasoning-level-low'))
    })
  })

  it('renders a checked, disabled row and no levels for an always-on model',
    async () => {
      const { wrapper } = await mountSection({
        mode: 'always-on',
        reasoning: 'off',
        levels: [],
      })
      const toggle = input(wrapper, 'reasoning-always-on-menu-item')

      expect(toggle.checked).toBe(true)
      expect(toggle.disabled).toBe(true)
      expect(levelLabels(wrapper)).toEqual([])
      expect(hasRow(wrapper, 'reasoning-expanded-toggle')).toBe(false)
    })
})
