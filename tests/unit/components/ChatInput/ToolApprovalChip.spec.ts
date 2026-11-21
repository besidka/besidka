import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, shallowRef } from 'vue'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import {
  TOOL_APPROVAL_CONTROLLER_KEY,
  useToolApprovalBubbleInView,
} from '~/composables/tool-approvals'
import ToolApprovalChip from '../../../../app/components/ChatInput/ToolApprovalChip.vue'

function createController(
  pendingIds: string[],
  isActive = true,
): ToolApprovalController & { pending: { value: string[] } } {
  const pending = shallowRef<string[]>(pendingIds)

  return {
    pending,
    isActive: computed(() => isActive),
    messages: shallowRef([]),
    isRequestActive: computed(() => false),
    pendingApprovalIds: computed(() => pending.value),
    sendingApprovalIds: shallowRef([]),
    answeredApprovalIds: shallowRef([]),
    failures: shallowRef({}),
    answeredAt: shallowRef({}),
    focusRequest: shallowRef(null),
    answer: vi.fn(async () => {}),
    change: vi.fn(),
    askAgain: vi.fn(async () => {}),
    focusFirstPending: vi.fn(),
    focusApproval: vi.fn(),
  }
}

async function mountChip(controller: ToolApprovalController | null) {
  return await mountSuspended(ToolApprovalChip, {
    global: controller
      ? { provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller } }
      : {},
  })
}

const CHIP = '[data-testid="tool-approval-chip"]'
const LIVE = '[data-testid="tool-approval-live-region"]'

describe('ChatInput/ToolApprovalChip', () => {
  it('counts one waiting action', async () => {
    const wrapper = await mountChip(createController(['approval-1']))

    expect(wrapper.get(CHIP).text()).toBe('1 action waiting for approval')
    expect(wrapper.get(LIVE).text()).toBe('Action waiting for approval')
    expect(wrapper.get(LIVE).attributes('aria-live')).toBe('polite')
  })

  it('pluralizes several waiting actions', async () => {
    const wrapper = await mountChip(createController(['a', 'b', 'c']))

    expect(wrapper.get(CHIP).text()).toBe('3 actions waiting for approval')
  })

  it('hides while the approval bubble is on screen, keeping the live region',
    async () => {
      const isBubbleInView = useToolApprovalBubbleInView()
      const wrapper = await mountChip(createController(['approval-1']))

      isBubbleInView.value = true
      await nextTick()

      expect(wrapper.find(CHIP).exists()).toBe(false)
      expect(wrapper.get(LIVE).text()).toBe('Action waiting for approval')

      isBubbleInView.value = false
      await nextTick()

      expect(wrapper.find(CHIP).exists()).toBe(true)
    })

  it('focuses the first waiting step on click', async () => {
    const controller = createController(['approval-1'])
    const wrapper = await mountChip(controller)

    await wrapper.get(CHIP).trigger('click')

    expect(controller.focusFirstPending).toHaveBeenCalled()
  })

  it('keeps the live region mounted and hides the chip with nothing waiting',
    async () => {
      const controller = createController([])
      const wrapper = await mountChip(controller)

      expect(wrapper.find(CHIP).exists()).toBe(false)
      expect(wrapper.find('.pb-2').exists()).toBe(false)
      expect(wrapper.get(LIVE).text()).toBe('')

      controller.pending.value = ['approval-1']
      await nextTick()

      expect(wrapper.get(LIVE).text()).toBe('Action waiting for approval')
      expect(wrapper.find(CHIP).exists()).toBe(true)
    })

  it('renders nothing when the flag is off or there is no controller',
    async () => {
      const off = await mountChip(createController(['approval-1'], false))
      const none = await mountChip(null)

      expect(off.find(CHIP).exists()).toBe(false)
      expect(off.find(LIVE).exists()).toBe(false)
      expect(none.find(CHIP).exists()).toBe(false)
    })
})
