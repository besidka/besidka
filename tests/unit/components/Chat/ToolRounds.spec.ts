import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import ToolRounds from '../../../../app/components/Chat/ToolRounds.vue'
import { TOOL_ROUND_CONTROLLER_KEY } from '../../../../app/composables/tool-rounds'
import type { ToolRoundController } from '../../../../app/composables/tool-rounds'

function budgetMessage(round: number): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Working.' },
      {
        type: 'data-tool-budget',
        data: {
          round,
          maxRounds: 10,
          reason: 'steps',
          model: 'm',
          gateway: null,
          reasoning: 'off',
          connectorIds: [],
        },
      },
    ],
  } as UIMessage
}

function createController(
  overrides: Partial<ToolRoundController> = {},
): ToolRoundController {
  return {
    activeRound: shallowRef(0),
    isRequestActive: shallowRef(false),
    isWaitingForUser: shallowRef(false),
    isRequested: () => false,
    continueRound: vi.fn(async () => undefined),
    continueAsNewMessage: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function mountRounds(
  message: UIMessage,
  controller: ToolRoundController | null,
  isLast = true,
) {
  return await mountSuspended(ToolRounds, {
    props: { message, isLast },
    global: controller
      ? { provide: { [TOOL_ROUND_CONTROLLER_KEY as symbol]: controller } }
      : {},
  })
}

describe('Chat/ToolRounds', () => {
  it('renders nothing without a controller or on an older message',
    async () => {
      const withoutController = await mountRounds(budgetMessage(1), null)
      const older = await mountRounds(
        budgetMessage(1),
        createController(),
        false,
      )

      expect(withoutController.find('[data-testid="chat-tool-rounds"]')
        .exists()).toBe(false)
      expect(older.find('[data-testid="chat-tool-rounds"]').exists())
        .toBe(false)
    })

  it('shows the running round while a round request streams', async () => {
    const wrapper = await mountRounds(budgetMessage(2), createController({
      activeRound: shallowRef(3),
      isRequestActive: shallowRef(true),
    }))

    expect(wrapper.get('[data-testid="chat-tool-rounds-running"]').text())
      .toContain('round 3 of 10')
  })

  it('offers Continue when the task waits for the user', async () => {
    const controller = createController({
      isWaitingForUser: shallowRef(true),
      isRequested: () => true,
    })
    const wrapper = await mountRounds(budgetMessage(2), controller)

    expect(wrapper.get('[data-testid="chat-tool-rounds-paused"]').text())
      .toContain('round 2 of 10')

    await wrapper.get('[data-testid="chat-tool-rounds-continue"]')
      .trigger('click')

    expect(controller.continueRound).toHaveBeenCalled()
  })

  it('hides while the next round is about to start by itself', async () => {
    const wrapper = await mountRounds(budgetMessage(2), createController({
      isRequested: () => true,
    }))

    expect(wrapper.find('[data-testid="chat-tool-rounds"]').exists())
      .toBe(false)
  })

  it('goes on in a new message at the round limit', async () => {
    const controller = createController()
    const wrapper = await mountRounds(budgetMessage(10), controller)

    expect(wrapper.get('[data-testid="chat-tool-rounds-limit"]').text())
      .toContain('all 10 rounds')

    await wrapper.get('[data-testid="chat-tool-rounds-continue-new"]')
      .trigger('click')

    expect(controller.continueAsNewMessage).toHaveBeenCalled()
  })
})
