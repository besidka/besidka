import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import ToolApprovalBubble from '../../../../app/components/Chat/ToolApprovalBubble.vue'

const cachedConnectors = ref<unknown>({
  connectors: [{ id: 'connector-1', slug: 'linear', title: 'Linear' }],
})

mockNuxtImport('useNuxtData', () => {
  return () => ({ data: cachedConnectors })
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
    focusApproval: vi.fn(),
    ...overrides,
  }
}

async function mountBubble(
  parts: unknown[],
  controller: ToolApprovalController | null = createController(),
  options: { attach?: boolean } = {},
) {
  return await mountSuspended(ToolApprovalBubble, {
    ...(options.attach ? { attachTo: document.body } : {}),
    props: {
      message: { id: MESSAGE_ID, role: 'assistant', parts } as UIMessage,
    },
    global: controller
      ? { provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller } }
      : {},
  })
}

const BUBBLE = '[data-testid="tool-approval-bubble"]'
const STEP = '[data-testid="reasoning-approval-step"]'

describe('Chat/ToolApprovalBubble', () => {
  it('marks its message root and nests the bubble section in it for the '
    + 'scroll spacer', async () => {
    const wrapper = await mountBubble([approvalCall('1'), approvalData('1')])
    const messageRoot = wrapper.element.closest('.js-tool-approval-message')
      ?? wrapper.element

    expect(messageRoot.classList.contains('js-tool-approval-message'))
      .toBe(true)
    expect(messageRoot.querySelector('.js-tool-approval-bubble')).not.toBeNull()
  })

  it('shows the waiting call with its title, reason and answer buttons',
    async () => {
      const wrapper = await mountBubble([approvalCall('1'), approvalData('1')])
      const step = wrapper.get(STEP)

      expect(wrapper.get('[data-testid="tool-approval-bubble-heading"]')
        .text()).toBe('Waiting for your approval')
      expect(step.classes()).toContain('js-tool-approval-step')
      expect(step.attributes('tabindex')).toBe('0')
      expect(step.get('[data-testid="reasoning-approval-step-title"]').text())
        .toBe('Linear wants to run create_issue')
      expect(step.get('[data-testid="reasoning-approval-step-reason"]').text())
        .toBe('Changes or deletes data')
      expect(step.find('[data-testid="reasoning-approval-step-allow-once"]')
        .exists()).toBe(true)
      expect(step.find('[data-testid="reasoning-approval-step-deny"]')
        .exists()).toBe(true)
    })

  it('offers exactly the remember options the server allows', async () => {
    const wrapper = await mountBubble([
      approvalCall('1'),
      approvalData('1', {
        reason: 'untrusted-output',
        rememberOptions: ['once', 'chat', 'always'],
      }),
    ])

    expect(wrapper.findAll('[data-testid^="reasoning-approval-step-allow-"]')
      .map(button => button.text()))
      .toEqual(['Allow once', 'Allow in this chat', 'Always allow'])
  })

  it('shows the skill scripts consent with its summary and two options',
    async () => {
      const wrapper = await mountBubble([
        approvalCall('1', {
          type: 'tool-run_skill_scripts',
          toolName: undefined,
          input: {},
        }),
        approvalData('1', {
          toolName: 'run_skill_scripts',
          reason: 'consent',
          summary: 'Run scripts from data-report in Anthropic\'s container '
            + 'on your key?',
          rememberOptions: ['once', 'chat'],
        }),
      ])
      const step = wrapper.get(STEP)

      expect(step.get('[data-testid="reasoning-approval-step-title"]').text())
        .toBe('Run skill scripts')
      expect(step.get('[data-testid="reasoning-approval-step-summary"]').text())
        .toContain('Anthropic\'s container on your key?')
      expect(step.get('[data-testid="reasoning-approval-step-reason"]').text())
        .toBe('Uploads the skill to your Anthropic workspace')
      expect(step.find('[data-testid="reasoning-approval-step-allow-chat"]')
        .exists()).toBe(true)
      expect(step.find('[data-testid="reasoning-approval-step-allow-always"]')
        .exists()).toBe(false)
    })

  it('answers through the controller', async () => {
    const controller = createController()
    const wrapper = await mountBubble(
      [approvalCall('1'), approvalData('1')],
      controller,
    )

    await wrapper.get('[data-testid="reasoning-approval-step-allow-once"]')
      .trigger('click')

    expect(controller.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      remember: 'once',
    })
  })

  it('answers Always allow with one click', async () => {
    const controller = createController()
    const wrapper = await mountBubble([
      approvalCall('1'),
      approvalData('1', { rememberOptions: ['once', 'always'] }),
    ], controller)

    expect(wrapper.get(STEP).classes()).toContain('rounded-box')

    await wrapper.get('[data-testid="reasoning-approval-step-allow-always"]')
      .trigger('click')

    expect(controller.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      remember: 'always',
    })
    expect(wrapper.find(
      '[data-testid="reasoning-approval-step-always-confirm"]',
    ).exists()).toBe(false)
  })

  it('shows progress across two waiting calls', async () => {
    const wrapper = await mountBubble([
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
    expect(steps[0]!.find('[data-testid="reasoning-approval-step-change"]')
      .exists()).toBe(true)
    expect(steps[1]!.get('[data-testid="reasoning-approval-step-progress"]')
      .text()).toBe('1 of 2 answered')
  })

  it('shows the sending line with a loader in the text color', async () => {
    const wrapper = await mountBubble([
      approvalCall('1', {
        state: 'approval-responded',
        approval: { id: 'approval-1', approved: true },
      }),
      approvalData('1'),
    ], createController({
      answeredApprovalIds: shallowRef(['approval-1']),
      sendingApprovalIds: shallowRef(['approval-1']),
    }))
    const sending = wrapper.get('[data-testid="reasoning-approval-step-sending"]')

    expect(sending.text()).toContain('Sending your answer…')
    expect(sending.get('svg').classes()).not.toContain('text-accent')
    expect(wrapper.get('[data-testid="tool-approval-bubble-heading"]').text())
      .toBe('Sending your answer')
  })

  it('names the source of untrusted content in the reason', async () => {
    const wrapper = await mountBubble([
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

  it('keeps a failed answer with Ask again until the next message',
    async () => {
      const controller = createController({
        failures: shallowRef({ 'approval-1': 'expired' as const }),
      })
      const wrapper = await mountBubble(
        [approvalCall('1'), approvalData('1')],
        controller,
      )

      expect(wrapper.get('[data-testid="tool-approval-bubble-heading"]')
        .text()).toBe('This approval could not finish')

      await wrapper.get('[data-testid="reasoning-approval-step-ask-again"]')
        .trigger('click')

      expect(controller.askAgain).toHaveBeenCalledWith(MESSAGE_ID)
    })

  it('renders nothing once every call is settled', async () => {
    const wrapper = await mountBubble([
      approvalCall('1', {
        state: 'output-available',
        approval: { id: 'approval-1', approved: true },
        output: 'Created',
      }),
      approvalData('1'),
    ])

    expect(wrapper.find(BUBBLE).exists()).toBe(false)
  })

  it('renders nothing for an earlier message or without a controller',
    async () => {
      const earlier = await mountBubble(
        [approvalCall('1'), approvalData('1')],
        createController({
          messages: shallowRef([
            { id: MESSAGE_ID } as UIMessage,
            { id: 'user-2' } as UIMessage,
          ]),
        }),
      )
      const shared = await mountBubble(
        [approvalCall('1'), approvalData('1')],
        null,
      )

      expect(earlier.find(BUBBLE).exists()).toBe(false)
      expect(shared.find(BUBBLE).exists()).toBe(false)
    })

  it('scrolls to and focuses the waiting call on a focus request',
    async () => {
      const focusRequest = shallowRef<{
        approvalId: string
        nonce: number
      } | null>(null)
      const wrapper = await mountBubble(
        [approvalCall('1'), approvalData('1')],
        createController({ focusRequest }),
        { attach: true },
      )
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
