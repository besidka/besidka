import type { UIMessage } from 'ai'
import { defineComponent, h, inject, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFeatures } from '../../../app/composables/features'
import {
  shouldRecoverGeneration,
  shouldRecoverInterruptedGeneration,
  useChat,
} from '../../../app/composables/chat'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import type { ToolRoundController } from '~/composables/tool-rounds'
import { TOOL_ROUND_CONTROLLER_KEY } from '~/composables/tool-rounds'

interface SdkOptions {
  transport: {
    prepareSendMessagesRequest: (context: {
      messages: UIMessage[]
    }) => { body: Record<string, unknown> }
  }
  sendAutomaticallyWhen: (context: { messages: UIMessage[] }) => boolean
  onFinish: (context: {
    isAbort: boolean
    isDisconnect: boolean
    isError: boolean
    messages: UIMessage[]
  }) => void
  onError: (error: unknown) => void
  onData: (part: { type: string, data?: unknown }) => void
}

const sdk = vi.hoisted(() => ({
  options: null as SdkOptions | null,
  messages: null as { value: UIMessage[] } | null,
  status: null as { value: string } | null,
  sendMessage: vi.fn(),
  clearError: vi.fn(),
  errorMessage: vi.fn(),
  fetch: vi.fn(async (url: string) => {
    if (url.endsWith('/stop')) {
      return { stopped: true, runId: 'run-stopped' }
    }

    throw new Error('Not mocked')
  }),
}))

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()

  const DefaultChatTransport = vi.fn(function (
    this: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    Object.assign(this, options)
  })

  return { ...original, DefaultChatTransport }
})

vi.mock('@ai-sdk/vue', () => {
  return {
    useChat: (options: SdkOptions & { messages: UIMessage[] }) => {
      const messages = shallowRef<UIMessage[]>(options.messages)
      const status = shallowRef<string>('ready')

      sdk.options = options
      sdk.messages = messages
      sdk.status = status

      return {
        messages,
        status,
        error: shallowRef(undefined),
        regenerate: vi.fn(),
        stop: vi.fn(),
        clearError: sdk.clearError,
        sendMessage: sdk.sendMessage,
        addToolApprovalResponse: vi.fn(async ({ id, approved }: {
          id: string
          approved: boolean
        }) => {
          messages.value = messages.value.map((message) => {
            return {
              ...message,
              parts: message.parts.map((part) => {
                const tool = part as { approval?: { id: string } }

                return tool.approval?.id === id
                  ? {
                    ...part,
                    state: 'approval-responded',
                    approval: { id, approved },
                  }
                  : part
              }),
            } as UIMessage
          })
        }),
      }
    },
  }
})

mockNuxtImport('useSetChatTitle', () => {
  return () => undefined
})

mockNuxtImport('useErrorMessage', () => {
  return sdk.errorMessage
})

mockNuxtImport('$fetch', () => sdk.fetch)

function call(id: string) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__create_issue',
    toolCallId: `call-${id}`,
    state: 'approval-requested',
    input: { title: id },
    approval: { id: `approval-${id}` },
  }
}

function pausedChat(ids: string[]): UIMessage[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'File the bugs' }],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'step-start' }, ...ids.map(call)],
    },
  ] as UIMessage[]
}

async function mountChat(messages: UIMessage[]) {
  let controller: ToolApprovalController | null = null

  const child = defineComponent({
    setup() {
      controller = inject(TOOL_APPROVAL_CONTROLLER_KEY, null)

      return () => null
    },
  })

  const host = defineComponent({
    setup() {
      useChat({ id: 'chat-1', slug: 'slug-1', messages } as never)

      return () => h(child)
    },
  })

  await mountSuspended(host)

  return controller!
}

function errorBody(body: Record<string, unknown>): Error {
  return new Error(JSON.stringify(body))
}

function partStates(): string[] {
  return sdk.messages!.value.at(-1)!.parts.flatMap((part) => {
    const tool = part as { state?: string }

    return tool.state ? [tool.state] : []
  })
}

async function answerAndSend(controller: ToolApprovalController) {
  for (const approvalId of controller.pendingApprovalIds.value) {
    await controller.answer({ approvalId, approved: true })
  }

  const body = sdk.options!.transport.prepareSendMessagesRequest({
    messages: sdk.messages!.value,
  }).body

  sdk.status!.value = 'submitted'

  return body
}

function finish(flags: Partial<{
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
}> = {}) {
  sdk.status!.value = flags.isError ? 'error' : 'ready'
  sdk.options!.onFinish({
    isAbort: false,
    isDisconnect: false,
    isError: false,
    messages: sdk.messages!.value,
    ...flags,
  })
}

describe('useChat tool approval controller', () => {
  beforeEach(() => {
    useFeatures().features.value = {
      isAdmin: false,
      features: {
        'tool-approvals': { enabled: true, active: true, variant: null },
      },
    } as never
    sdk.sendMessage.mockReset()
    sdk.clearError.mockReset()
    sdk.errorMessage.mockReset()
  })

  afterEach(() => {
    useFeatures().features.value = null
    vi.useRealTimers()
  })

  it('lists the waiting calls and requests focus on the first', async () => {
    const controller = await mountChat(pausedChat(['1', '2']))

    expect(controller.isActive.value).toBe(true)
    expect(controller.pendingApprovalIds.value)
      .toEqual(['approval-1', 'approval-2'])

    controller.focusFirstPending()

    expect(controller.focusRequest.value?.approvalId).toBe('approval-1')

    controller.focusApproval('approval-2')

    expect(controller.focusRequest.value?.approvalId).toBe('approval-2')
  })

  it('lists nothing while the flag is off', async () => {
    useFeatures().features.value = null

    const controller = await mountChat(pausedChat(['1']))

    expect(controller.isActive.value).toBe(false)
    expect(controller.pendingApprovalIds.value).toEqual([])
  })

  it('records the answer and builds the approval body once all are answered',
    async () => {
      const controller = await mountChat(pausedChat(['1', '2']))

      await controller.answer({ approvalId: 'approval-1', approved: true })

      expect(controller.answeredApprovalIds.value).toEqual(['approval-1'])
      expect(controller.answeredAt.value['approval-1']).toEqual(
        expect.any(Number),
      )
      expect(sdk.options!.sendAutomaticallyWhen({
        messages: sdk.messages!.value,
      })).toBe(false)

      const body = await answerAndSend(controller)

      expect(body).toEqual({
        approval: {
          messageId: 'assistant-1',
          responses: [
            { approvalId: 'approval-1', approved: true, remember: 'once' },
            { approvalId: 'approval-2', approved: true, remember: 'once' },
          ],
        },
      })
      expect(controller.sendingApprovalIds.value)
        .toEqual(['approval-1', 'approval-2'])
    })

  it('places a request that continues the last reply like a new send',
    async () => {
      const controller = await mountChat(pausedChat(['1']))
      const onContinue = vi.fn()
      const removeHook = useNuxtApp().hook('chat:continue', onContinue)

      await answerAndSend(controller)

      expect(onContinue).toHaveBeenCalledOnce()

      sdk.options!.transport.prepareSendMessagesRequest({
        messages: [sdk.messages!.value[0]!],
      })

      expect(onContinue).toHaveBeenCalledOnce()

      removeHook()
    })

  it('marks the calls expired on a 409 without an error card', async () => {
    const controller = await mountChat(pausedChat(['1']))

    await answerAndSend(controller)
    sdk.options!.onError(errorBody({
      statusCode: 409,
      message: 'This approval expired',
      data: { code: 'TOOL_APPROVAL_EXPIRED', fix: 'Ask again' },
    }))

    const before = sdk.messages!.value

    finish({ isError: true })

    expect(controller.failures.value).toEqual({ 'approval-1': 'expired' })
    expect(controller.sendingApprovalIds.value).toEqual([])
    expect(sdk.messages!.value).toBe(before)
    expect(sdk.clearError).toHaveBeenCalled()
    expect(sdk.errorMessage).not.toHaveBeenCalled()
    expect(sdk.options!.sendAutomaticallyWhen({
      messages: sdk.messages!.value,
    })).toBe(false)
  })

  it('marks the calls interrupted on an interrupted 409', async () => {
    const controller = await mountChat(pausedChat(['1']))

    await answerAndSend(controller)
    sdk.options!.onError(errorBody({
      statusCode: 409,
      message: 'Interrupted. Ask again',
      data: { code: 'TOOL_APPROVAL_INTERRUPTED' },
    }))
    finish({ isError: true })

    expect(controller.failures.value).toEqual({
      'approval-1': 'interrupted',
    })
  })

  it('brings the buttons back with a toast after a rate limit', async () => {
    const controller = await mountChat(pausedChat(['1']))

    await answerAndSend(controller)
    sdk.options!.onError(errorBody({
      statusCode: 429,
      message: 'Too many approval answers',
      data: { why: 'An account can answer at most 30 approvals a minute' },
    }))
    finish({ isError: true })

    expect(partStates()).toEqual(['approval-requested'])
    expect(controller.pendingApprovalIds.value).toEqual(['approval-1'])
    expect(controller.answeredApprovalIds.value).toEqual([])
    expect(sdk.errorMessage).toHaveBeenCalledWith(
      'Too many approval answers',
      'An account can answer at most 30 approvals a minute',
    )

    await controller.answer({ approvalId: 'approval-1', approved: true })

    expect(sdk.options!.sendAutomaticallyWhen({
      messages: sdk.messages!.value,
    })).toBe(true)
  })

  it('resends the same answers after a pending signal, once, later',
    async () => {
      vi.useFakeTimers()

      const controller = await mountChat(pausedChat(['1']))

      await answerAndSend(controller)
      sdk.options!.onData({ type: 'data-generation-pending' })
      finish()

      expect(sdk.options!.sendAutomaticallyWhen({
        messages: sdk.messages!.value,
      })).toBe(false)
      expect(sdk.sendMessage).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(4_000)

      expect(sdk.sendMessage).toHaveBeenCalledTimes(1)
      expect(sdk.sendMessage).toHaveBeenCalledWith()
    })

  it('does not resend once the answers went through', async () => {
    const controller = await mountChat(pausedChat(['1']))

    await answerAndSend(controller)
    finish()

    expect(sdk.options!.sendAutomaticallyWhen({
      messages: sdk.messages!.value,
    })).toBe(false)
  })

  it('takes back a local answer while another call still waits', async () => {
    const controller = await mountChat(pausedChat(['1', '2']))

    await controller.answer({ approvalId: 'approval-1', approved: false })
    controller.change('approval-1')

    expect(partStates()).toEqual(['approval-requested', 'approval-requested'])
    expect(controller.answeredApprovalIds.value).toEqual([])
  })

  it('puts the original prompt back into the composer on Ask again',
    async () => {
      const controller = await mountChat(pausedChat(['1']))
      const prefill = vi.fn()

      useNuxtApp().hook('chat-input:prefill', prefill)
      await controller.askAgain('assistant-1')

      expect(prefill).toHaveBeenCalledWith('File the bugs')
    })
})

function budgetChat(round: number): UIMessage[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Go through every issue' }],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Listed some, more to go.' },
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
    },
  ] as UIMessage[]
}

async function mountRoundChat(messages: UIMessage[]) {
  let controller: ToolRoundController | null = null

  const child = defineComponent({
    setup() {
      controller = inject(TOOL_ROUND_CONTROLLER_KEY, null)

      return () => null
    },
  })
  const host = defineComponent({
    setup() {
      useChat({ id: 'chat-1', slug: 'slug-1', messages } as never)

      return () => h(child)
    },
  })

  await mountSuspended(host)

  return controller!
}

describe('useChat long tool tasks', () => {
  beforeEach(() => {
    useFeatures().features.value = {
      isAdmin: false,
      features: {
        'tool-approvals': { enabled: true, active: true, variant: null },
      },
    } as never
    sdk.sendMessage.mockReset()
  })

  afterEach(() => {
    useFeatures().features.value = null
  })

  it('continues the same reply by itself once, with the next round',
    async () => {
      const controller = await mountRoundChat(budgetChat(1))
      const messages = sdk.messages!.value

      expect(sdk.options!.sendAutomaticallyWhen({ messages })).toBe(true)
      expect(sdk.options!.sendAutomaticallyWhen({ messages })).toBe(false)
      expect(sdk.options!.transport.prepareSendMessagesRequest({ messages })
        .body).toEqual({ continue: { messageId: 'assistant-1', round: 2 } })
      expect(controller.activeRound.value).toBe(2)
    })

  it('never continues by itself after Stop, and continues on Continue',
    async () => {
      const controller = await mountRoundChat(budgetChat(1))

      finish({ isAbort: true })

      expect(controller.isWaitingForUser.value).toBe(true)
      expect(sdk.options!.sendAutomaticallyWhen({
        messages: sdk.messages!.value,
      })).toBe(false)

      await controller.continueRound()

      expect(sdk.sendMessage).toHaveBeenCalled()
      expect(sdk.options!.transport.prepareSendMessagesRequest({
        messages: sdk.messages!.value,
      }).body).toEqual({ continue: { messageId: 'assistant-1', round: 2 } })
    })

  it('stops at the round limit', async () => {
    await mountRoundChat(budgetChat(10))

    expect(sdk.options!.sendAutomaticallyWhen({
      messages: sdk.messages!.value,
    })).toBe(false)
  })

  it('waits while the tab is hidden', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden')

    try {
      const controller = await mountRoundChat(budgetChat(1))

      expect(sdk.options!.sendAutomaticallyWhen({
        messages: sdk.messages!.value,
      })).toBe(false)
      expect(controller.isWaitingForUser.value).toBe(true)
    } finally {
      visibility.mockRestore()
    }
  })

  it('sends a normal message when the last message is a user message',
    async () => {
      await mountRoundChat(budgetChat(1))

      const body = sdk.options!.transport.prepareSendMessagesRequest({
        messages: [
          ...sdk.messages!.value,
          {
            id: 'user-2',
            role: 'user',
            parts: [{ type: 'text', text: 'Next' }],
          } as UIMessage,
        ],
      }).body

      expect(body).not.toHaveProperty('continue')
      expect(body.messages).toHaveLength(1)
    })
})

describe('useChat stop and retry', () => {
  const fetchMock = sdk.fetch

  beforeEach(() => {
    fetchMock.mockClear()
  })

  async function mountStopChat(messages: UIMessage[]) {
    let chat: ReturnType<typeof useChat> | null = null

    const host = defineComponent({
      setup() {
        chat = useChat({ id: 'chat-1', slug: 'slug-1', messages } as never)

        return () => null
      },
    })

    await mountSuspended(host)

    return chat!
  }

  function streamingChat(): UIMessage[] {
    return [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial' }],
      },
    ] as UIMessage[]
  }

  it('tells the server which message to stop when the user stops',
    async () => {
      const chat = await mountStopChat(streamingChat())

      sdk.status!.value = 'streaming'
      chat.stop()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/slug-1/stop', {
        method: 'POST',
        body: { messageId: 'user-1' },
        keepalive: true,
      })
    })

  it('sends no stop when nothing generates', async () => {
    const chat = await mountStopChat(streamingChat())

    chat.stop()

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/stop$/),
      expect.anything(),
    )
  })

  it('keeps one steady stop state while it waits for the previous reply',
    async () => {
      const chat = await mountStopChat(streamingChat())

      sdk.options!.onData({ type: 'data-generation-pending', data: {} })

      expect(chat.waitingForPreviousReplySince.value).toBeGreaterThan(0)
      expect(chat.displayStop.value).toBe(true)

      sdk.status!.value = 'ready'

      expect(chat.displayStop.value).toBe(true)

      chat.stop()

      expect(chat.waitingForPreviousReplySince.value).toBe(0)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/chats/slug-1/stop',
        expect.anything(),
      )
    })

  it('sends the stopped run back once, with the first retry of the same '
    + 'message',
  async () => {
    const chat = await mountStopChat(streamingChat())

    sdk.status!.value = 'streaming'
    chat.stop()
    sdk.status!.value = 'ready'
    await chat.regenerate()

    const userMessage = streamingChat()[0]!
    const otherBody = sdk.options!.transport.prepareSendMessagesRequest({
      messages: [{ ...userMessage, id: 'user-2' }],
    }).body
    const retryBody = sdk.options!.transport.prepareSendMessagesRequest({
      messages: [userMessage],
    }).body
    const laterBody = sdk.options!.transport.prepareSendMessagesRequest({
      messages: [userMessage],
    }).body

    expect(otherBody).not.toHaveProperty('stoppedRunId')
    expect(retryBody.stoppedRunId).toBe('run-stopped')
    expect(laterBody).not.toHaveProperty('stoppedRunId')
  })

  it('Cancel ends the wait without stopping the other reply', async () => {
    const chat = await mountStopChat(streamingChat())

    sdk.options!.onData({ type: 'data-generation-pending', data: {} })
    chat.cancelWaiting()

    expect(chat.waitingForPreviousReplySince.value).toBe(0)
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/stop$/),
      expect.anything(),
    )
  })

  it('never resends a stored stopped reply on load or wake', () => {
    const messages = [
      streamingChat()[0]!,
      {
        id: 'assistant-stopped',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Half an answ', state: 'done' },
          { type: 'data-reply-stopped', data: { stoppedAt: 'x' } },
        ],
      },
    ] as UIMessage[]

    expect(shouldRecoverGeneration(messages)).toBe(false)
    expect(shouldRecoverInterruptedGeneration('ready', messages)).toBe(false)
  })
})
