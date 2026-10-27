import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
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

async function mountSection(props: SectionProps) {
  const selectedLevels: ReasoningLevel[] = []
  const savedLevels: ReasoningLevel[] = []
  const state = shallowRef<SectionProps>(props)

  const Host = defineComponent({
    setup() {
      return () => h('div', h(ReasoningSection, {
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

  const wrapper = await mountSuspended(Host)

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

  it('keeps the steps toggles rendered but disabled while reasoning is off',
    async () => {
      const { wrapper } = await mountSection({
        reasoning: 'off',
        levels: ['low', 'medium', 'high'],
      })

      expect(input(wrapper, 'reasoning-expanded-toggle').disabled).toBe(true)
      expect(input(wrapper, 'reasoning-auto-hide-toggle').disabled)
        .toBe(true)
      expect(input(wrapper, 'reasoning-auto-hide-toggle').checked)
        .toBe(false)
    })

  it('shows saved step settings as off while reasoning is off', async () => {
    setReasoningUserSetting(true, true)

    const { wrapper } = await mountSection({
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
    })

    expect(input(wrapper, 'reasoning-expanded-toggle').checked).toBe(false)
    expect(input(wrapper, 'reasoning-auto-hide-toggle').checked).toBe(false)
  })

  it('keeps Auto-hide off and disabled while steps are collapsed',
    async () => {
      setReasoningUserSetting(false, true)

      const { wrapper } = await mountSection({
        reasoning: 'low',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      })

      expect(input(wrapper, 'reasoning-auto-hide-toggle').checked)
        .toBe(false)
      expect(input(wrapper, 'reasoning-auto-hide-toggle').disabled)
        .toBe(true)
    })

  it('enables Auto-hide only while steps are expanded', async () => {
    setReasoningUserSetting(true, false)

    const { wrapper } = await mountSection({
      reasoning: 'low',
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'low',
    })

    expect(input(wrapper, 'reasoning-expanded-toggle').checked).toBe(true)
    expect(input(wrapper, 'reasoning-auto-hide-toggle').disabled).toBe(false)

    await wrapper.get('[data-testid="reasoning-auto-hide-toggle"]')
      .setValue(true)

    expect(mocks.setReasoningAutoHide).toHaveBeenCalledWith(true)
  })

  describe('Save as default', () => {
    it('stays rendered, unchecked and locked while the level is the default',
      async () => {
        const { wrapper } = await mountSection({
          reasoning: 'medium',
          levels: ['low', 'medium', 'high'],
          defaultLevel: 'medium',
        })

        expect(input(wrapper, 'reasoning-save-default-toggle').checked)
          .toBe(false)
        expect(input(wrapper, 'reasoning-save-default-toggle').disabled)
          .toBe(true)
        expect(wrapper.text()).toContain('Medium is your default')
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

      expect(input(wrapper, 'reasoning-save-default-toggle').checked)
        .toBe(false)
      expect(input(wrapper, 'reasoning-save-default-toggle').disabled)
        .toBe(true)
      expect(wrapper.text()).toContain('High is your default')

      state.value = { ...state.value, reasoning: 'medium' }
      await wrapper.vm.$nextTick()

      expect(input(wrapper, 'reasoning-save-default-toggle').checked)
        .toBe(false)
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
      expect(
        wrapper.find('[data-testid="reasoning-expanded-toggle"]').exists(),
      ).toBe(false)
    })
})
