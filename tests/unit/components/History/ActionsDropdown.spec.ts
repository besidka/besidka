import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HistoryActionsDropdown
  from '../../../../app/components/History/ActionsDropdown.vue'
import { createHistoryChat } from '../../../setup/helpers/history-fixtures'

const mocks = vi.hoisted(() => ({
  setChatMemoryExcluded: vi.fn(),
}))

mockNuxtImport('useChatMemoryExclusion', () => {
  return () => ({
    savingSlug: { value: null },
    isChatMemoryExcluded: (_slug: string, loadedValue?: boolean | null) => {
      return !!loadedValue
    },
    rememberChatMemoryExcluded: vi.fn(),
    setChatMemoryExcluded: mocks.setChatMemoryExcluded,
  })
})

describe('HistoryActionsDropdown', () => {
  it('opens on trigger click and closes after selecting an action', async () => {
    const wrapper = await mountSuspended(HistoryActionsDropdown, {
      props: {
        chat: createHistoryChat(),
        isSelectionMode: false,
      },
      global: {
        stubs: {
          Icon: true,
        },
      },
    })

    const dropdown = wrapper.get('details')

    expect((dropdown.element as HTMLDetailsElement).open).toBe(false)

    ;(dropdown.element as HTMLDetailsElement).open = true
    await wrapper.vm.$nextTick()

    const renameButton = wrapper.findAll('button').find((button) => {
      return button.text().includes('Rename')
    })

    expect(renameButton).toBeDefined()

    await renameButton!.trigger('click')

    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect((dropdown.element as HTMLDetailsElement).open).toBe(false)
  })

  describe('menu placement', () => {
    const MENU_HEIGHT = 320
    const TRIGGER_HEIGHT = 32

    afterEach(() => {
      vi.restoreAllMocks()
      Object.defineProperty(window, 'visualViewport', {
        value: null,
        configurable: true,
      })
    })

    async function openAtTriggerTop(
      triggerTop: number,
      viewportHeight: number,
    ) {
      Object.defineProperty(window, 'visualViewport', {
        value: { offsetTop: 0, height: viewportHeight },
        configurable: true,
      })

      const wrapper = await mountSuspended(HistoryActionsDropdown, {
        props: {
          chat: createHistoryChat(),
          isSelectionMode: false,
        },
        global: {
          stubs: {
            Icon: true,
          },
        },
      })

      vi.spyOn(
        wrapper.get('[data-testid="history-chat-actions-trigger"]').element,
        'getBoundingClientRect',
      ).mockReturnValue({
        top: triggerTop,
        bottom: triggerTop + TRIGGER_HEIGHT,
        height: TRIGGER_HEIGHT,
      } as DOMRect)
      vi.spyOn(
        wrapper.get('[data-testid="history-chat-actions-menu"]').element,
        'getBoundingClientRect',
      ).mockReturnValue({ height: MENU_HEIGHT } as DOMRect)

      const dropdown = wrapper.get('details')

      ;(dropdown.element as HTMLDetailsElement).open = true
      await dropdown.trigger('toggle')

      return wrapper
    }

    it('opens downward while there is room below the trigger', async () => {
      const wrapper = await openAtTriggerTop(100, 800)

      expect(wrapper.get('details').classes()).toContain('dropdown-bottom')
      expect(wrapper.get('details').classes()).not.toContain('dropdown-top')
    })

    it('flips upward when the menu would run past the viewport bottom',
      async () => {
        const wrapper = await openAtTriggerTop(700, 800)

        expect(wrapper.get('details').classes()).toContain('dropdown-top')
        expect(wrapper.get('details').classes())
          .not.toContain('dropdown-bottom')
        expect(wrapper.get('[data-testid="history-chat-actions-menu"]')
          .classes()).toContain('pb-2')
      })

    it('stays downward when neither side has room and below has more',
      async () => {
        const wrapper = await openAtTriggerTop(100, 300)

        expect(wrapper.get('details').classes()).toContain('dropdown-bottom')
      })

    it('flips upward in a short visual viewport',
      async () => {
        const wrapper = await openAtTriggerTop(400, 500)

        expect(wrapper.get('details').classes()).toContain('dropdown-top')
      })
  })

  describe('memory exclusion toggle', () => {
    beforeEach(() => {
      mocks.setChatMemoryExcluded.mockReset()
      mocks.setChatMemoryExcluded.mockResolvedValue(true)
    })

    function mountDropdown(
      chat: ReturnType<typeof createHistoryChat>,
      variant: 'default' | 'shared' = 'default',
    ) {
      return mountSuspended(HistoryActionsDropdown, {
        props: { chat, isSelectionMode: false, variant },
        global: { stubs: { Icon: true } },
      })
    }

    it('shows the exclusion state of the chat', async () => {
      const excluded = await mountDropdown(createHistoryChat({
        memoryExcluded: true,
      }))
      const included = await mountDropdown(createHistoryChat())
      const excludedToggle = excluded
        .get('[data-testid="chat-action-memory-exclusion"]')
      const includedToggle = included
        .get('[data-testid="chat-action-memory-exclusion"]')

      expect((excludedToggle.element as HTMLInputElement).checked).toBe(true)
      expect((includedToggle.element as HTMLInputElement).checked).toBe(false)
      expect(excluded.text()).toContain('Don\'t use this chat for memory')
    })

    it('requests the opposite state and closes the menu', async () => {
      const wrapper = await mountDropdown(createHistoryChat({
        slug: 'chat-to-exclude',
      }))
      const dropdown = wrapper.get('details').element as HTMLDetailsElement
      const toggle = wrapper.get('[data-testid="chat-action-memory-exclusion"]')

      dropdown.open = true
      await toggle.setValue(true)

      expect(mocks.setChatMemoryExcluded)
        .toHaveBeenCalledWith('chat-to-exclude', true)
      expect(dropdown.open).toBe(false)
    })

    it('is not offered for a shared chat row', async () => {
      const wrapper = await mountDropdown(createHistoryChat(), 'shared')

      expect(wrapper.find('[data-testid="chat-action-memory-exclusion"]')
        .exists()).toBe(false)
    })
  })
})
