import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import type { VueWrapper } from '@vue/test-utils'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import { expandReasoningSteps } from './Reasoning/expand-steps'

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
    stepsExpanded: shallowRef<boolean>(false),
    stepsAutoHide: shallowRef<boolean>(true),
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
    focusApproval: vi.fn(),
    ...overrides,
  }
}

async function mountMessage(
  parts: unknown[],
  controller: ToolApprovalController | null = createController(),
  options: { expand?: boolean } = {},
) {
  const wrapper = await mountSuspended(Reasoning, {
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

  if (options.expand ?? true) {
    await expandReasoningSteps(wrapper)
  }

  return wrapper
}

const STEP = '[data-testid="reasoning-approval-step"]'
const ANSWER_BUTTONS = [
  'reasoning-approval-step-allow-once',
  'reasoning-approval-step-allow-chat',
  'reasoning-approval-step-allow-always',
  'reasoning-approval-step-deny',
  'reasoning-approval-step-change',
]

function answerButtonCount(wrapper: VueWrapper): number {
  return ANSWER_BUTTONS.reduce((count, testId) => {
    return count + wrapper.findAll(`[data-testid="${testId}"]`).length
  }, 0)
}

describe('Chat/Reasoning approval steps', () => {
  it('shows a waiting call as a compact step that points to the bubble',
    async () => {
      const controller = createController()
      const wrapper = await mountMessage(
        [approvalCall('1'), approvalData('1')],
        controller,
      )
      const step = wrapper.get(STEP)

      expect(step.attributes('data-state')).toBe('pending')
      expect(step.classes()).not.toContain('js-tool-approval-step')
      expect(step.attributes('tabindex')).toBeUndefined()
      expect(step.get('[data-testid="reasoning-approval-step-title"]').text())
        .toBe('Linear wants to run create_issue')
      expect(step.get('[data-testid="reasoning-approval-step-waiting"]')
        .text()).toContain('Waiting for your approval below the message')
      expect(answerButtonCount(wrapper)).toBe(0)
      expect(wrapper.find('.reasoning-step-waiting').exists()).toBe(true)

      await step.get('[data-testid="reasoning-approval-step-review"]')
        .trigger('click')

      expect(controller.focusApproval).toHaveBeenCalledWith('approval-1')
    })

  it('shows an answered call and a sending call without buttons',
    async () => {
      const wrapper = await mountMessage([
        approvalCall('1', {
          state: 'approval-responded',
          approval: { id: 'approval-1', approved: true },
        }),
        approvalData('1'),
        approvalCall('2', {
          state: 'approval-responded',
          approval: { id: 'approval-2', approved: false },
        }),
        approvalData('2'),
        approvalCall('3'),
        approvalData('3'),
      ], createController({
        answeredApprovalIds: shallowRef(['approval-1', 'approval-2']),
        sendingApprovalIds: shallowRef(['approval-2']),
      }))
      const steps = wrapper.findAll(STEP)

      expect(steps.map(step => step.attributes('data-state')))
        .toEqual(['answered', 'sending', 'pending'])
      expect(steps[0]!.text()).toContain('Waiting for the other answers')
      expect(steps[1]!.text()).toContain('Sending your answer…')
      expect(steps[1]!.get('[data-testid="reasoning-approval-step-waiting"]')
        .find('svg').exists()).toBe(false)
      expect(answerButtonCount(wrapper)).toBe(0)
    })

  it('shows a Besidka call with the Besidka mark and its summary as title',
    async () => {
      const wrapper = await mountMessage([
        {
          type: 'tool-besidka__list_projects',
          toolCallId: 'call-read',
          state: 'output-available',
          input: {},
          output: 'framed',
        },
        {
          type: 'data-tool-grant',
          id: 'grant-call-read',
          data: {
            toolCallId: 'call-read',
            toolName: 'besidka__list_projects',
            scope: 'always',
          },
        },
        approvalCall('1', {
          type: 'tool-besidka__delete_chats',
          toolName: undefined,
          input: { slugs: ['01HZX'] },
        }),
        approvalData('1', {
          toolName: 'besidka__delete_chats',
          summary: 'Delete 1 chat: 01HZX',
        }),
      ])
      const step = wrapper.get(STEP)
      const kinds = wrapper.findAll('[data-testid="reasoning-step-icon"]')
        .map(icon => icon.attributes('data-kind'))

      expect(step.get('[data-testid="reasoning-approval-step-title"]').text())
        .toBe('Delete 1 chat: 01HZX')
      expect(kinds).toEqual(['besidka', 'besidka'])
      expect(wrapper.text()).toContain('Besidka: list projects')
      expect(wrapper.get('[data-testid="reasoning-grant-marker"]').text())
        .toContain('Ran without asking (Always allowed)')
    })

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

  it('leaves the steps collapsed for a new waiting call', async () => {
    const wrapper = await mountMessage([
      { type: 'text', text: 'I will file it.' },
      approvalCall('1'),
      approvalData('1'),
    ], createController(), { expand: false })

    await nextTick()

    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.find(STEP).exists()).toBe(false)
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
    expect(wrapper.find('[data-testid="reasoning-approval-step-failure"]')
      .exists()).toBe(true)
    expect(answerButtonCount(wrapper)).toBe(0)
  })

  it('points a failed answer on the last message to the bubble', async () => {
    const wrapper = await mountMessage(
      [approvalCall('1'), approvalData('1')],
      createController({
        failures: shallowRef({ 'approval-1': 'interrupted' as const }),
      }),
    )
    const step = wrapper.get(STEP)

    expect(step.attributes('data-state')).toBe('interrupted')
    expect(step.find('[data-testid="reasoning-approval-step-ask-again"]')
      .exists()).toBe(false)
    expect(step.get('[data-testid="reasoning-approval-step-waiting"]').text())
      .toBe('Could not finish. See below the message.')
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
})

describe('Chat/Reasoning grant marker', () => {
  function grantedCall(scope: 'always' | 'chat') {
    return [
      {
        type: 'dynamic-tool',
        toolName: 'mcp__linear__create_issue',
        toolCallId: 'call-9',
        state: 'output-available',
        input: { title: 'Bug' },
        output: 'Created WEB-42',
      },
      {
        type: 'data-tool-grant',
        id: 'grant-call-9',
        data: {
          toolCallId: 'call-9',
          toolName: 'mcp__linear__create_issue',
          scope,
        },
      },
    ]
  }

  it.each([
    ['always', 'Ran without asking (Always allowed)'],
    ['chat', 'Ran without asking (Allowed in this chat)'],
  ] as const)('marks a call that ran under a %s grant', async (scope, text) => {
    const wrapper = await mountMessage(grantedCall(scope))
    const marker = wrapper.get('[data-testid="reasoning-grant-marker"]')

    expect(marker.text()).toContain(text)
    expect(marker.find('[data-testid="reasoning-grant-manage"]').exists())
      .toBe(true)
  })

  it('marks nothing for a call without a grant part', async () => {
    const wrapper = await mountMessage([grantedCall('always')[0]])

    expect(wrapper.find('[data-testid="reasoning-grant-marker"]').exists())
      .toBe(false)
  })

  it('offers no Manage link without a chat controller', async () => {
    const wrapper = await mountMessage(grantedCall('chat'), null)

    expect(wrapper.find('[data-testid="reasoning-grant-manage"]').exists())
      .toBe(false)
  })
})
