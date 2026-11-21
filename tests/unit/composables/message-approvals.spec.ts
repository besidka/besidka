import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import { useMessageApprovals } from '~/composables/message-approvals'

mockNuxtImport('useNuxtData', () => {
  return () => ({
    data: ref({
      connectors: [{ id: 'connector-1', slug: 'linear', title: 'Linear' }],
    }),
  })
})

const MESSAGE_ID = 'assistant-1'

function approvalCall(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__create_issue',
    toolCallId: `call-${id}`,
    state: 'approval-requested',
    input: { title: `Issue ${id}` },
    approval: { id: `approval-${id}` },
    ...overrides,
  }
}

function approvalData(id: string) {
  return {
    type: 'data-tool-approval',
    id: `call-${id}`,
    data: {
      approvalId: `approval-${id}`,
      toolCallId: `call-${id}`,
      toolName: 'mcp__linear__create_issue',
      reason: 'always-ask',
      summary: 'Linear wants to run mcp__linear__create_issue',
      rememberOptions: ['once', 'chat', 'always'],
    },
  }
}

function createController(
  overrides: Partial<ToolApprovalController> = {},
): ToolApprovalController {
  return {
    isActive: computed(() => true),
    messages: shallowRef([{ id: MESSAGE_ID } as UIMessage]),
    isRequestActive: computed(() => false),
    pendingApprovalIds: computed(() => []),
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
    ...overrides,
  }
}

async function useApprovals(
  parts: unknown[],
  controller: ToolApprovalController | null = createController(),
) {
  let result: ReturnType<typeof useMessageApprovals> | null = null
  const host = defineComponent({
    setup() {
      result = useMessageApprovals(() => {
        return { id: MESSAGE_ID, role: 'assistant', parts } as UIMessage
      })

      return () => h('div')
    },
  })

  await mountSuspended(host, {
    global: controller
      ? { provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller } }
      : {},
  })

  return result!
}

describe('useMessageApprovals', () => {
  it('puts the waiting calls of the last message in the bubble', async () => {
    const approvals = await useApprovals([
      approvalCall('1'),
      approvalData('1'),
      approvalCall('2', {
        state: 'output-denied',
        approval: { id: 'approval-2', approved: false },
      }),
      approvalData('2'),
    ])

    expect(approvals.isLastMessage.value).toBe(true)
    expect(approvals.pendingApprovalIds.value).toEqual(['approval-1'])
    expect(approvals.bubbleViews.value).toHaveLength(1)
    expect(approvals.bubbleViews.value[0]).toMatchObject({
      id: 'tool-call-1',
      title: 'Linear wants to run create_issue',
      approval: {
        state: 'pending',
        isInBubble: true,
        connectorName: 'Linear',
        reasonText: 'Changes or deletes data',
      },
    })
    expect(approvals.bubbleViews.value[0]!.approval.model.rememberOptions)
      .toEqual(['once', 'chat', 'always'])

    const denied = approvals.entries.value.get(2)!

    expect(denied.state).toBe('denied')
    expect(approvals.buildApprovalStep(denied).isInBubble).toBe(false)
  })

  it('keeps a failed answer in the bubble only on the last message',
    async () => {
      const failures = shallowRef({ 'approval-1': 'interrupted' as const })
      const last = await useApprovals(
        [approvalCall('1'), approvalData('1')],
        createController({ failures }),
      )
      const earlier = await useApprovals(
        [approvalCall('1'), approvalData('1')],
        createController({
          failures,
          messages: shallowRef([
            { id: MESSAGE_ID } as UIMessage,
            { id: 'user-2' } as UIMessage,
          ]),
        }),
      )

      expect(last.bubbleViews.value.map(view => view.approval.state))
        .toEqual(['interrupted'])
      expect(earlier.isLastMessage.value).toBe(false)
      expect(earlier.bubbleViews.value).toEqual([])
      expect(earlier.entries.value.get(0)?.state).toBe('interrupted')
    })

  it('expires the waiting calls of an earlier message', async () => {
    const approvals = await useApprovals(
      [approvalCall('1'), approvalData('1')],
      createController({
        messages: shallowRef([
          { id: MESSAGE_ID } as UIMessage,
          { id: 'user-2' } as UIMessage,
        ]),
      }),
    )

    expect(approvals.entries.value.get(0)?.state).toBe('expired')
    expect(approvals.pendingApprovalIds.value).toEqual([])
    expect(approvals.bubbleViews.value).toEqual([])
  })

  it('reads nothing without an active controller', async () => {
    const inactive = await useApprovals(
      [approvalCall('1'), approvalData('1')],
      createController({ isActive: computed(() => false) }),
    )
    const missing = await useApprovals(
      [approvalCall('1'), approvalData('1')],
      null,
    )

    expect(inactive.entries.value.size).toBe(0)
    expect(missing.entries.value.size).toBe(0)
    expect(missing.bubbleViews.value).toEqual([])
  })
})
