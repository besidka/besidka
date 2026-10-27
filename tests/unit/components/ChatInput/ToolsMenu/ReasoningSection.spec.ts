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
  const element = wrapper.find(`[data-testid="${testId}"]`)

  return element.exists() && !element.element.closest('[inert]')
}

function caption(wrapper: SectionWrapper): string {
  return wrapper.get('[data-testid="reasoning-default-caption"]').text()
}

function saveButton(wrapper: SectionWrapper) {
  return wrapper.find('[data-testid="reasoning-save-default-button"]')
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

  describe('default caption', () => {
    it('is always rendered with a one-line minimum height', async () => {
      const { wrapper } = await mountSection({
        reasoning: 'medium',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'medium',
      })

      expect(wrapper.get('[data-testid="reasoning-default-caption"]')
        .classes()).toEqual(expect.arrayContaining(['min-h-4', 'text-xs']))
    })

    it('says the level is the default and offers no button', async () => {
      const { wrapper } = await mountSection({
        reasoning: 'medium',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'medium',
      })

      expect(caption(wrapper)).toBe('Medium is your default')
      expect(saveButton(wrapper).exists()).toBe(false)
    })

    it('names the default and offers to save the level when they differ',
      async () => {
        const { wrapper, savedLevels } = await mountSection({
          reasoning: 'high',
          levels: ['low', 'medium', 'high'],
          defaultLevel: 'low',
        })

        expect(caption(wrapper))
          .toBe('Your default is Low · Save High as default')
        expect(saveButton(wrapper).element.tagName).toBe('BUTTON')
        expect(saveButton(wrapper).attributes('type')).toBe('button')
        expect(saveButton(wrapper).text()).toBe('Save High as default')

        await saveButton(wrapper).trigger('click')

        expect(savedLevels).toEqual(['high'])
      })

    it('shows Saving… and ignores further clicks while the save is pending',
      async () => {
        const { wrapper, savedLevels, state } = await mountSection({
          reasoning: 'high',
          levels: ['low', 'medium', 'high'],
          defaultLevel: 'low',
        })

        await saveButton(wrapper).trigger('click')

        expect(saveButton(wrapper).text()).toBe('Saving…')
        expect(saveButton(wrapper).attributes('aria-disabled'))
          .toBe('true')

        await saveButton(wrapper).trigger('click')

        expect(savedLevels).toEqual(['high'])

        state.value = { ...state.value, defaultLevel: 'high' }
        await nextTick()

        expect(caption(wrapper)).toBe('High is your default')
        expect(saveButton(wrapper).exists()).toBe(false)
      })

    it('goes back to the offer when the level changes again after a save',
      async () => {
        const { wrapper, state } = await mountSection({
          reasoning: 'high',
          levels: ['low', 'medium', 'high'],
          defaultLevel: 'high',
        })

        state.value = { ...state.value, reasoning: 'medium' }
        await nextTick()

        expect(caption(wrapper))
          .toBe('Your default is High · Save Medium as default')
      })

    it('uses On and Off labels for a toggle-mode model', async () => {
      const { wrapper } = await mountSection({
        reasoning: 'medium',
        levels: ['medium'],
        defaultLevel: 'off',
      })

      expect(caption(wrapper))
        .toBe('Your default is Off · Save On as default')
    })

    it('is not rendered for an always-on model', async () => {
      const { wrapper } = await mountSection({
        mode: 'always-on',
        reasoning: 'off',
        levels: [],
      })

      expect(wrapper.find('[data-testid="reasoning-default-caption"]')
        .exists()).toBe(false)
    })
  })

  describe('focus rescue', () => {
    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('moves focus from the inline save button to the checked level '
      + 'radio once the default catches up', async () => {
      const { wrapper, state } = await mountSection({
        reasoning: 'high',
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      }, { attachTo: document.body })

      const button = saveButton(wrapper).element as HTMLButtonElement

      button.focus()

      expect(document.activeElement).toBe(button)

      state.value = { ...state.value, defaultLevel: 'high' }
      await nextTick()
      await nextTick()

      expect(saveButton(wrapper).exists()).toBe(false)
      expect(document.activeElement)
        .toBe(input(wrapper, 'reasoning-level-high'))
    })

    it('moves focus to the checked level radio when the focused steps '
      + 'row collapses', async () => {
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

    it('leaves focus alone when an unfocused control goes away',
      async () => {
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

  describe('collapsing rows', () => {
    it('keeps the steps rows mounted but inert while they are hidden',
      async () => {
        const { wrapper } = await mountSection({
          reasoning: 'off',
          levels: ['low', 'medium', 'high'],
        })
        const reveal = wrapper
          .get('[data-testid="reasoning-expanded-toggle"]')
          .element
          .closest('[data-open]')

        expect(reveal?.getAttribute('data-open')).toBe('false')
        expect(reveal?.hasAttribute('inert')).toBe(true)
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
