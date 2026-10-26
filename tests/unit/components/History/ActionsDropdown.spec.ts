import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
