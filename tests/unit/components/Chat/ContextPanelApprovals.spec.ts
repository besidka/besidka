import { computed, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ToolApprovalGrantItem,
} from '../../../../shared/types/tool-approval-grants.d'
import ContextPanelApprovals from '../../../../app/components/Chat/ContextPanelApprovals.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  grants: [] as ToolApprovalGrantItem[],
  refresh: vi.fn(async () => {}),
  resetChatGrants: vi.fn(async () => {}),
  revokeAlwaysGrant: vi.fn(async () => {}),
}))

mockNuxtImport('useChatToolApprovalGrants', () => {
  return () => {
    const grants = computed(() => mocks.grants)

    return {
      grants,
      hasChatGrants: computed(() => {
        return mocks.grants.some(grant => grant.scope === 'chat')
      }),
      isEnabled: computed(() => true),
      busyKey: shallowRef(''),
      error: shallowRef(null),
      refresh: mocks.refresh,
      resetChatGrants: mocks.resetChatGrants,
      revokeAlwaysGrant: mocks.revokeAlwaysGrant,
    }
  }
})

const CHAT_GRANT: ToolApprovalGrantItem = {
  scope: 'chat',
  connectorId: 'c1',
  connectorTitle: 'Linear',
  toolName: 'update_issue',
}

const ALWAYS_GRANT: ToolApprovalGrantItem = {
  scope: 'always',
  connectorId: 'c1',
  connectorTitle: 'Linear',
  toolName: 'create_issue',
}

describe('Chat/ContextPanelApprovals', () => {
  beforeEach(() => {
    mocks.grants = []
    mocks.refresh.mockClear()
    mocks.resetChatGrants.mockClear()
    mocks.revokeAlwaysGrant.mockClear()
  })

  it('renders nothing without grants and refreshes on mount', async () => {
    const wrapper = await mountSuspended(ContextPanelApprovals)

    expect(wrapper.find('[data-testid="chat-context-approvals"]').exists())
      .toBe(false)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('lists the chat and always grants with their scope', async () => {
    mocks.grants = [CHAT_GRANT, ALWAYS_GRANT]

    const wrapper = await mountSuspended(ContextPanelApprovals)
    const chatRow = wrapper.get('[data-testid="chat-context-approval-chat"]')
    const alwaysRow = wrapper.get(
      '[data-testid="chat-context-approval-always"]',
    )

    expect(chatRow.text()).toContain('update_issue')
    expect(chatRow.text()).toContain('Linear · Allowed in this chat')
    expect(chatRow.find('[data-testid="chat-context-approval-remove"]')
      .exists()).toBe(false)
    expect(alwaysRow.text()).toContain('Linear · Always allowed, in every chat')
  })

  it('resets the chat grants and removes one always grant', async () => {
    mocks.grants = [CHAT_GRANT, ALWAYS_GRANT]

    const wrapper = await mountSuspended(ContextPanelApprovals)

    await wrapper.get('[data-testid="chat-context-approvals-reset"]')
      .trigger('click')
    await wrapper.get('[data-testid="chat-context-approval-remove"]')
      .trigger('click')

    expect(mocks.resetChatGrants).toHaveBeenCalledTimes(1)
    expect(mocks.revokeAlwaysGrant).toHaveBeenCalledWith(ALWAYS_GRANT)
  })

  it('links a Besidka Always allow grant to the Labs permissions',
    async () => {
      mocks.grants = [{
        scope: 'always',
        connectorId: '',
        connectorTitle: 'Besidka',
        toolName: 'list_projects',
        source: 'besidka',
      }]

      const wrapper = await mountSuspended(ContextPanelApprovals)
      const row = wrapper.get('[data-testid="chat-context-approval-always"]')
      const manage = row.get(
        '[data-testid="chat-context-approval-manage-besidka"]',
      )

      expect(row.text()).toContain('Besidka · Always allowed, in every chat')
      expect(manage.attributes('to'))
        .toBe('/profile/labs?panel=besidka-tool-permissions')
      expect(row.find('[data-testid="chat-context-approval-remove"]')
        .exists()).toBe(false)
    })

  it('hides Reset when only always grants apply', async () => {
    mocks.grants = [ALWAYS_GRANT]

    const wrapper = await mountSuspended(ContextPanelApprovals)

    expect(wrapper.find('[data-testid="chat-context-approvals-reset"]')
      .exists()).toBe(false)
  })
})
