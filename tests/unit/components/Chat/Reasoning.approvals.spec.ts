import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'

const cachedConnectors = ref<unknown>({
  connectors: [{ slug: 'linear', title: 'Linear' }],
})

mockNuxtImport('useNuxtData', () => {
  return () => ({ data: cachedConnectors })
})
mockNuxtImport('useConnectorLibrary', () => {
  return () => ({})
})
mockNuxtImport('useUserSetting', () => {
  return () => ({
    reasoningExpanded: shallowRef<boolean>(false),
    reasoningAutoHide: shallowRef<boolean>(true),
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

function approvalData(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'data-tool-approval',
    id: `call-${id}`,
    data: {
      approvalId: `approval-${id}`,
      toolCallId: `call-${id}`,
      toolName: 'mcp__linear__create_issue',
      reason: 'always-ask',
      summary: 'Linear wants to run mcp__linear__create_issue',
      rememberOptions: ['once'],
      ...overrides,
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
    ...overrides,
  }
}

async function mountMessage(
  parts: unknown[],
  controller: ToolApprovalController | null = createController(),
) {
  return await mountSuspended(Reasoning, {
    props: {
      message: { id: MESSAGE_ID, role: 'assistant', parts } as UIMessage,
      status: 'ready',
      reasoningLevel: 'off',
      turnStartedAt: 0,
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    },
    global: {
      stubs: { MDCCached: true },
      ...(controller
        ? {
          provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller },
        }
        : {}),
    },
  })
}

const STEP = '[data-testid="reasoning-approval-step"]'

describe('Chat/Reasoning approval steps', () => {
  it('keeps the old title when the flag is off', async () => {
    const wrapper = await mountMessage(
      [approvalCall('1'), approvalData('1')],
      createController({ isActive: computed(() => false) }),
    )

    expect(wrapper.find(STEP).exists()).toBe(false)
    expect(wrapper.get('[data-testid="reasoning-connector-step-title"]')
      .text()).toBe('Waiting for approval: Linear · create_issue')
  })

  it('keeps the old title on pages without a controller', async () => {
    const wrapper = await mountMessage(
      [approvalCall('1'), approvalData('1')],
      null,
    )

    expect(wrapper.find(STEP).exists()).toBe(false)
  })

  it('renders a pending approval and opens the block despite auto-hide',
    async () => {
      const wrapper = await mountMessage([
        { type: 'text', text: 'I will file it.' },
        approvalCall('1'),
        approvalData('1'),
      ])

      await nextTick()

      expect(wrapper.get('details').attributes('open')).toBeDefined()
      expect(wrapper.get(STEP).attributes('data-state')).toBe('pending')
      expect(wrapper.get('[data-testid="reasoning-approval-step-title"]')
        .text()).toBe('Linear wants to run create_issue')
      expect(wrapper.find('[data-testid="reasoning-approval-step-summary"]')
        .exists()).toBe(false)
      expect(wrapper.find('.reasoning-step-waiting').exists()).toBe(true)
    })

  it('shows progress across two waiting calls', async () => {
    const wrapper = await mountMessage([
      approvalCall('1', {
        state: 'approval-responded',
        approval: { id: 'approval-1', approved: true },
      }),
      approvalData('1'),
      approvalCall('2'),
      approvalData('2'),
    ], createController({
      answeredApprovalIds: shallowRef(['approval-1']),
    }))
    const steps = wrapper.findAll(STEP)

    expect(steps.map(step => step.attributes('data-state')))
      .toEqual(['answered', 'pending'])
    expect(steps[1]!.get('[data-testid="reasoning-approval-step-progress"]')
      .text()).toBe('1 of 2 answered')
  })

  it('names the source of untrusted content in the reason', async () => {
    const wrapper = await mountMessage([
      {
        type: 'dynamic-tool',
        toolName: 'mcp__linear__search',
        toolCallId: 'call-0',
        state: 'output-available',
        input: {},
        output: 'result',
      },
      approvalCall('1'),
      approvalData('1', { reason: 'untrusted-output' }),
    ])

    expect(wrapper.get('[data-testid="reasoning-approval-step-reason"]')
      .text()).toBe('Because this message read content from Linear')
  })

  it('marks an approval on an earlier message as expired', async () => {
    const wrapper = await mountMessage(
      [approvalCall('1'), approvalData('1')],
      createController({
        messages: shallowRef([
          { id: MESSAGE_ID } as UIMessage,
          { id: 'user-2' } as UIMessage,
        ]),
      }),
    )

    expect(wrapper.get(STEP).attributes('data-state')).toBe('expired')
  })

  it('shows a denial as one line', async () => {
    const wrapper = await mountMessage([
      approvalCall('1', {
        state: 'output-denied',
        approval: { id: 'approval-1', approved: false },
      }),
      approvalData('1'),
    ])

    expect(wrapper.get(STEP).attributes('data-state')).toBe('denied')
    expect(wrapper.get('[data-testid="reasoning-approval-step-outcome"]')
      .text()).toBe('Denied')
  })

  it('keeps the regular step for an approved call and adds the outcome',
    async () => {
      const wrapper = await mountMessage([
        approvalCall('1', {
          state: 'output-available',
          approval: { id: 'approval-1', approved: true },
          output: 'Created',
        }),
        approvalData('1'),
      ])

      expect(wrapper.find(STEP).exists()).toBe(false)
      expect(wrapper.get('[data-testid="reasoning-connector-step-title"]')
        .text()).toBe('Used Linear · create_issue')
      expect(wrapper.get('[data-testid="reasoning-approval-outcome"]').text())
        .toBe('Allowed')
    })

  it('scrolls to and focuses the step on a focus request', async () => {
    const focusRequest = shallowRef<{
      approvalId: string
      nonce: number
    } | null>(null)
    const wrapper = await mountSuspended(Reasoning, {
      attachTo: document.body,
      props: {
        message: {
          id: MESSAGE_ID,
          role: 'assistant',
          parts: [approvalCall('1'), approvalData('1')],
        } as UIMessage,
        status: 'ready',
        reasoningLevel: 'off',
        turnStartedAt: 0,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
      },
      global: {
        stubs: { MDCCached: true },
        provide: {
          [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: createController({
            focusRequest,
          }),
        },
      },
    })
    const step = wrapper.get(STEP).element as HTMLElement
    const scrollIntoView = vi.fn()

    step.scrollIntoView = scrollIntoView
    focusRequest.value = { approvalId: 'approval-1', nonce: 1 }
    await nextTick()
    await nextTick()

    expect(scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(step)

    wrapper.unmount()
  })
})
