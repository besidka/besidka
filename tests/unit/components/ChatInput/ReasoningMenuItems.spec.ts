import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import type { ReasoningEnabledLevel, ReasoningLevel } from '#shared/types/reasoning.d'
import ReasoningMenuItems from '../../../../app/components/ChatInput/ReasoningMenuItems.vue'

const mocks = vi.hoisted(() => ({
  useUserSetting: vi.fn(),
}))

mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

function setReasoningUserSetting(
  reasoningExpanded: boolean,
  reasoningAutoHide: boolean,
) {
  mocks.useUserSetting.mockReturnValue({
    reasoningExpanded: shallowRef<boolean>(reasoningExpanded),
    reasoningAutoHide: shallowRef<boolean>(reasoningAutoHide),
    setReasoningExpanded: vi.fn().mockResolvedValue(undefined),
    setReasoningAutoHide: vi.fn().mockResolvedValue(undefined),
  })
}

async function mountMenuItems(props: {
  reasoning: ReasoningLevel
  levels: ReasoningEnabledLevel[]
}): Promise<{ wrapper: VueWrapper, selectedLevels: ReasoningLevel[] }> {
  const selectedLevels: ReasoningLevel[] = []

  const host = defineComponent({
    setup() {
      return () => h('ul', [
        h(ReasoningMenuItems, {
          reasoning: props.reasoning,
          levels: props.levels,
          onSelectLevel: (level: ReasoningLevel) => {
            selectedLevels.push(level)
          },
        }),
      ])
    },
  })

  const wrapper = await mountSuspended(host)

  return { wrapper, selectedLevels }
}

function levelButtons(wrapper: VueWrapper) {
  return wrapper.findAll('li > button')
}

describe('ChatInput/ReasoningMenuItems', () => {
  beforeEach(() => {
    setReasoningUserSetting(false, false)
  })

  it('renders an Off/On two-item level list for a toggle-mode '
    + 'model, with the Expanded/Auto-hide section absent while off', async () => {
    const { wrapper } = await mountMenuItems({
      reasoning: 'off',
      levels: ['medium'],
    })

    const buttons = levelButtons(wrapper)

    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.text()).toContain('off')
    expect(buttons[1]?.text()).toContain('On')
    expect(
      wrapper.find('[data-testid="reasoning-expanded-toggle"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="reasoning-auto-hide-toggle"]').exists(),
    ).toBe(false)
  })

  it('reaches the Expanded toggle once a toggle-mode model is on, '
    + 'and the Auto-hide toggle once Expanded is also on', async () => {
    setReasoningUserSetting(true, false)

    const { wrapper } = await mountMenuItems({
      reasoning: 'medium',
      levels: ['medium'],
    })

    expect(
      wrapper.find('[data-testid="reasoning-expanded-toggle"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="reasoning-auto-hide-toggle"]').exists(),
    ).toBe(true)
  })

  it('emits the underlying level value, not the display label, '
    + 'when a toggle-mode level button is clicked', async () => {
    const { wrapper, selectedLevels } = await mountMenuItems({
      reasoning: 'off',
      levels: ['medium'],
    })

    const buttons = levelButtons(wrapper)

    await buttons[1]?.trigger('click')

    expect(selectedLevels).toEqual(['medium'])
  })

  it('renders every level with the effort section title for a '
    + 'multi-level model, proving the toggle-mode cosmetic change does '
    + 'not leak into it', async () => {
    const { wrapper } = await mountMenuItems({
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
    })

    const buttons = levelButtons(wrapper)

    expect(buttons).toHaveLength(4)
    expect(wrapper.text()).toContain('Reasoning effort')
    expect(wrapper.text()).not.toMatch(/\bOn\b/)
  })
})
