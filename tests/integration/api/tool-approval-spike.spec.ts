import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import {
  asSchema,
  convertToModelMessages,
  isStepCount,
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  tool,
} from 'ai'
import type { ModelMessage, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'

vi.mock('nitropack/runtime', () => {
  return {
    defineCachedFunction: vi.fn(),
    useNitroApp: vi.fn(),
    useStorage: vi.fn(),
  }
})

const SECRET = 'spike-secret'

const TAMPERED_INPUT = { ids: ['a', 'b', 'victim'] }

const PLANNED_CHAT_TOOL_NAMES = [
  'list_shared_chats',
  'list_projects',
  'get_project',
  'read_project_knowledge_item',
  'list_files',
  'read_file',
  'get_settings',
  'list_my_features',
  'list_artifacts',
  'get_artifact',
  'list_artifact_shares',
  'update_chat',
  'move_chats_to_project',
  'branch_chat',
  'create_project',
  'update_project',
  'update_project_knowledge_item',
  'create_file',
  'rename_file',
  'delete_chats',
  'delete_chat_message',
  'delete_project',
  'delete_project_knowledge_items',
  'delete_files',
  'delete_artifacts',
  'revoke_chat_shares',
  'revoke_artifact_shares',
  'share_artifact',
  'update_project_instructions',
  'add_project_note',
  'add_project_text',
  'update_settings',
]

const USER_MESSAGE: Omit<UIMessage, 'id'> = {
  role: 'user',
  parts: [{ type: 'text', text: 'Delete chats a and b' }],
}

function createUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  }
}

function toolCallsStep(
  calls: Array<{ id: string, name: string, input: Record<string, unknown> }>,
) {
  return [
    ...calls.map((call) => {
      return {
        type: 'tool-call' as const,
        toolCallId: call.id,
        toolName: call.name,
        input: JSON.stringify(call.input),
      }
    }),
    {
      type: 'finish' as const,
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function textStep(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function createScriptedModel(steps: Array<Array<Record<string, unknown>>>) {
  let callCount = 0

  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

      callCount += 1

      return { stream: simulateReadableStream({ chunks: chunks as any }) }
    },
  })
}

function replay(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

async function lastMessageOf(chunks: UIMessageChunk[]) {
  let last: UIMessage | undefined

  for await (const snapshot of readUIMessageStream({
    stream: replay(chunks),
  })) {
    last = snapshot
  }

  return last!
}

async function lastMessageOfContinuation(
  chunks: UIMessageChunk[],
  message: UIMessage,
) {
  let last: UIMessage | undefined

  for await (const snapshot of readUIMessageStream({
    stream: replay(chunks),
    message,
  })) {
    last = snapshot
  }

  return last!
}

function types(chunks: UIMessageChunk[]) {
  return chunks.map(chunk => chunk.type)
}

function approvalToolSet(counter: { runs: string[] }) {
  return {
    delete_things: tool({
      description: 'Delete things',
      inputSchema: z.object({ ids: z.array(z.string()) }),
      execute: async (input) => {
        counter.runs.push(JSON.stringify(input))

        return { deleted: input.ids }
      },
    }),
    lookup: tool({
      description: 'Look something up',
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => {
        counter.runs.push(`lookup:${input.query}`)

        return { found: input.query }
      },
    }),
  }
}

interface SendOptions {
  model: MockLanguageModelV4
  tools: ToolSet
  uiMessages: Array<Omit<UIMessage, 'id'>>
  toolApproval?: any
  secret?: string
  originalMessages?: UIMessage[]
  modelMessages?: ModelMessage[]
  cancelAfterChunkType?: string
}

async function send(options: SendOptions) {
  const events = {
    onEnd: undefined as any,
    errors: [] as any[],
    aborted: false,
  }
  const messages = options.modelMessages
    ?? await convertToModelMessages(options.uiMessages, {
      tools: options.tools,
    })
  const result = streamText({
    model: options.model,
    messages,
    tools: options.tools,
    stopWhen: isStepCount(5),
    toolApproval: options.toolApproval,
    experimental_toolApprovalSecret: options.secret,
    onEnd: (event) => {
      events.onEnd = event
    },
    onError: ({ error }) => {
      events.errors.push(error)
    },
    onAbort: () => {
      events.aborted = true
    },
  })
  const reader = result.toUIMessageStream({
    originalMessages: options.originalMessages,
    onError: (error) => {
      events.errors.push(error)

      return error instanceof Error ? error.message : String(error)
    },
  }).getReader()
  const chunks: UIMessageChunk[] = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)

    if (value.type === options.cancelAfterChunkType) {
      await reader.cancel()
      break
    }
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 20)
  })

  return { chunks, events, messages }
}

function respond(
  assistant: UIMessage,
  decisions: Record<string, { approved: boolean, reason?: string }>,
  mutate?: (part: any) => void,
): UIMessage {
  return {
    ...assistant,
    id: 'assistant-1',
    parts: assistant.parts.map((part: any) => {
      const decision = part.approval?.id ? decisions[part.approval.id] : null

      if (!decision) {
        return part
      }

      const responded = {
        ...part,
        state: 'approval-responded',
        approval: { ...part.approval, ...decision },
      }

      mutate?.(responded)

      return responded
    }),
  }
}

function findPendingPart(assistant: UIMessage) {
  return assistant.parts.find((part: any) => {
    return part.state === 'approval-requested'
  }) as any
}

async function firstRequest(secret?: string) {
  const model = createScriptedModel([
    toolCallsStep([
      { id: 'call-1', name: 'delete_things', input: { ids: ['a', 'b'] } },
    ]),
  ])
  const result = await send({
    model,
    tools: approvalToolSet({ runs: [] }),
    uiMessages: [USER_MESSAGE],
    toolApproval: { delete_things: 'user-approval' },
    secret,
  })
  const assistant = await lastMessageOf(result.chunks)

  return { assistant, approvalId: findPendingPart(assistant).approval.id }
}

interface ContinuationOptions {
  tools?: (counter: { runs: string[] }) => ToolSet
  toolApproval?: any
  secret?: string
  firstSecret?: string
  approved?: boolean
  mutate?: (part: any) => void
  cancelAfterChunkType?: string
  appendUserMessage?: boolean
  mutateModelMessages?: (messages: ModelMessage[]) => ModelMessage[]
}

async function continuation(options: ContinuationOptions = {}) {
  const { assistant, approvalId } = await firstRequest(options.firstSecret)
  const respondedAssistant = respond(
    assistant,
    { [approvalId]: { approved: options.approved ?? true } },
    options.mutate,
  )
  const counter = { runs: [] as string[] }
  const model = createScriptedModel([textStep('after')])
  const tools = options.tools?.(counter) ?? approvalToolSet(counter)
  const uiMessages: Array<Omit<UIMessage, 'id'>> = [
    USER_MESSAGE,
    respondedAssistant,
  ]

  if (options.appendUserMessage) {
    uiMessages.push({
      role: 'user',
      parts: [{ type: 'text', text: 'Also, thanks' }],
    })
  }

  const modelMessages = options.mutateModelMessages
    ? options.mutateModelMessages(
      await convertToModelMessages(uiMessages, { tools }),
    )
    : undefined
  const result = await send({
    model,
    tools,
    uiMessages,
    modelMessages,
    toolApproval: options.toolApproval ?? { delete_things: 'user-approval' },
    secret: options.secret,
    cancelAfterChunkType: options.cancelAfterChunkType,
    originalMessages: [
      { id: 'user-1', ...USER_MESSAGE } as UIMessage,
      respondedAssistant,
    ],
  })

  return {
    ...result,
    counter,
    model,
    approvalId,
    assistant,
    respondedAssistant,
  }
}

type Continuation = Awaited<ReturnType<typeof continuation>>

function errorNames(result: Continuation) {
  return result.events.errors.map(error => error?.name)
}

function toolMessageContent(result: Continuation) {
  const prompt = result.model.doStreamCalls[0]!.prompt
  const toolMessage = prompt.find(message => message.role === 'tool')!

  return toolMessage.content as any[]
}

describe('tool approval spike (ai 7.0.173)', () => {
  it('1. a user-approval call ends the send with a request chunk', async () => {
    const counter = { runs: [] as string[] }
    const model = createScriptedModel([
      toolCallsStep([
        { id: 'call-1', name: 'delete_things', input: { ids: ['a', 'b'] } },
      ]),
      textStep('never reached'),
    ])
    const { chunks, events } = await send({
      model,
      tools: approvalToolSet(counter),
      uiMessages: [USER_MESSAGE],
      toolApproval: { delete_things: 'user-approval' },
      secret: SECRET,
    })
    const requestChunk = chunks.find((chunk) => {
      return chunk.type === 'tool-approval-request'
    }) as any
    const lastStep = events.onEnd.steps.at(-1)

    expect(types(chunks)).toEqual([
      'start',
      'start-step',
      'tool-input-available',
      'tool-approval-request',
      'finish-step',
      'finish',
    ])
    expect(chunks[0]).toEqual({ type: 'start' })
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      finishReason: 'tool-calls',
    })
    expect(requestChunk.toolCallId).toBe('call-1')
    expect(requestChunk.approvalId).toMatch(/^aitxt-/)
    expect(typeof requestChunk.signature).toBe('string')
    expect(model.doStreamCalls).toHaveLength(1)
    expect(counter.runs).toEqual([])
    expect(events.onEnd.finishReason).toBe('tool-calls')
    expect(events.onEnd.steps).toHaveLength(1)
    expect(lastStep.finishReason).toBe('tool-calls')
    expect(lastStep.content.map((part: any) => part.type)).toEqual([
      'tool-call',
      'tool-approval-request',
    ])
    expect(lastStep.content[1].approvalId).toBe(requestChunk.approvalId)
    expect(lastStep.content[1].signature).toBe(requestChunk.signature)
    expect(events.onEnd.totalUsage).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    })
  })

  it('2. approved executes before any model call, denied does not', async () => {
    const { assistant, approvalId } = await firstRequest()
    const approvedAssistant = respond(assistant, {
      [approvalId]: { approved: true },
    })
    const counter = { runs: [] as string[] }
    const model = createScriptedModel([textStep('All done')])
    const tools = approvalToolSet(counter)
    const modelCallsAtExecute: number[] = []
    const originalExecute = (tools.delete_things as any).execute

    ;(tools.delete_things as any).execute = async (...args: any[]) => {
      modelCallsAtExecute.push(model.doStreamCalls.length)

      return originalExecute(...args)
    }

    const approved = await send({
      model,
      tools,
      uiMessages: [USER_MESSAGE, approvedAssistant],
      toolApproval: { delete_things: 'user-approval' },
      originalMessages: [
        { id: 'user-1', ...USER_MESSAGE } as UIMessage,
        approvedAssistant,
      ],
    })
    const deniedAssistant = respond(assistant, {
      [approvalId]: { approved: false, reason: 'Nope' },
    })
    const deniedCounter = { runs: [] as string[] }
    const deniedModel = createScriptedModel([textStep('Understood')])
    const denied = await send({
      model: deniedModel,
      tools: approvalToolSet(deniedCounter),
      uiMessages: [USER_MESSAGE, deniedAssistant],
      toolApproval: { delete_things: 'user-approval' },
      originalMessages: [
        { id: 'user-1', ...USER_MESSAGE } as UIMessage,
        deniedAssistant,
      ],
    })
    const mergedAssistant = await lastMessageOfContinuation(
      approved.chunks,
      approvedAssistant,
    )
    const approvedPrompt = model.doStreamCalls[0]!.prompt
    const deniedPrompt = deniedModel.doStreamCalls[0]!.prompt

    expect(types(approved.chunks)).toEqual([
      'start',
      'tool-output-available',
      'start-step',
      'text-start',
      'text-delta',
      'text-end',
      'finish-step',
      'finish',
    ])
    expect(approved.chunks[0]).toEqual({
      type: 'start',
      messageId: 'assistant-1',
    })
    expect(approved.chunks[1]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { deleted: ['a', 'b'] },
    })
    expect(modelCallsAtExecute).toEqual([0])
    expect(counter.runs).toEqual(['{"ids":["a","b"]}'])
    expect(model.doStreamCalls).toHaveLength(1)
    expect(approvedPrompt.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
    expect((approvedPrompt[2]!.content as any[])[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-1',
      output: { type: 'json', value: { deleted: ['a', 'b'] } },
    })
    expect(
      mergedAssistant.parts.map((part: any) => [part.type, part.state]),
    ).toEqual([
      ['step-start', undefined],
      ['tool-delete_things', 'output-available'],
      ['step-start', undefined],
      ['text', 'done'],
    ])
    expect(approved.events.onEnd.finishReason).toBe('stop')
    expect(approved.events.onEnd.steps).toHaveLength(1)
    expect(approved.events.onEnd.totalUsage.inputTokens).toBe(10)
    expect(
      approved.events.onEnd.responseMessages.map((message: any) => {
        return message.role
      }),
    ).toEqual(['tool', 'assistant'])

    expect(types(denied.chunks)).toEqual([
      'start',
      'tool-output-denied',
      'start-step',
      'text-start',
      'text-delta',
      'text-end',
      'finish-step',
      'finish',
    ])
    expect(deniedCounter.runs).toEqual([])
    expect(deniedModel.doStreamCalls).toHaveLength(1)
    expect((deniedPrompt.at(-1)!.content as any[])).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'delete_things',
        output: { type: 'execution-denied', reason: 'Nope' },
      },
    ])
  })

  it('3. a parallel auto-run tool executes in the first request only', async () => {
    const counter = { runs: [] as string[] }
    const model = createScriptedModel([
      toolCallsStep([
        { id: 'call-a', name: 'lookup', input: { query: 'q' } },
        { id: 'call-b', name: 'delete_things', input: { ids: ['x'] } },
      ]),
      textStep('wrapped up'),
    ])
    const first = await send({
      model,
      tools: approvalToolSet(counter),
      uiMessages: [USER_MESSAGE],
      toolApproval: { delete_things: 'user-approval' },
      secret: SECRET,
    })
    const assistant = await lastMessageOf(first.chunks)
    const pending = findPendingPart(assistant)
    const respondedAssistant = respond(assistant, {
      [pending.approval.id]: { approved: true },
    })
    const secondCounter = { runs: [] as string[] }
    const secondModel = createScriptedModel([textStep('after')])
    const second = await send({
      model: secondModel,
      tools: approvalToolSet(secondCounter),
      uiMessages: [USER_MESSAGE, respondedAssistant],
      toolApproval: { delete_things: 'user-approval' },
      secret: SECRET,
      originalMessages: [
        { id: 'user-1', ...USER_MESSAGE } as UIMessage,
        respondedAssistant,
      ],
    })
    const toolResults = secondModel.doStreamCalls[0]!.prompt.at(-1)!
      .content as any[]

    expect(types(first.chunks)).toEqual([
      'start',
      'start-step',
      'tool-input-available',
      'tool-input-available',
      'tool-approval-request',
      'tool-output-available',
      'finish-step',
      'finish',
    ])
    expect(counter.runs).toEqual(['lookup:q'])
    expect(model.doStreamCalls).toHaveLength(1)
    expect(first.events.onEnd.finishReason).toBe('tool-calls')
    expect(
      first.events.onEnd.steps.at(-1).content.map((part: any) => part.type),
    ).toEqual(['tool-call', 'tool-call', 'tool-approval-request', 'tool-result'])
    expect(
      assistant.parts.filter((part: any) => part.type.startsWith('tool-'))
        .map((part: any) => [part.toolCallId, part.state]),
    ).toEqual([
      ['call-a', 'output-available'],
      ['call-b', 'approval-requested'],
    ])

    expect(types(second.chunks)).toEqual([
      'start',
      'tool-output-available',
      'start-step',
      'text-start',
      'text-delta',
      'text-end',
      'finish-step',
      'finish',
    ])
    expect(second.chunks[1]).toMatchObject({ toolCallId: 'call-b' })
    expect(secondCounter.runs).toEqual(['{"ids":["x"]}'])
    expect(secondModel.doStreamCalls).toHaveLength(1)
    expect(toolResults.map(part => part.toolCallId)).toEqual([
      'call-a',
      'call-b',
    ])
  })

  it('3b. every call in a step is decided before any call runs', async () => {
    const timeline: string[] = []
    const tools = approvalToolSet({ runs: [] })
    const originalExecute = (tools.lookup as any).execute

    ;(tools.lookup as any).execute = async (...args: any[]) => {
      timeline.push(`execute:${args[0].query}`)

      return originalExecute(...args)
    }

    const model = createScriptedModel([
      toolCallsStep([
        { id: 'call-a', name: 'lookup', input: { query: 'q' } },
        { id: 'call-b', name: 'delete_things', input: { ids: ['x'] } },
        { id: 'call-c', name: 'lookup', input: { query: 'later' } },
      ]),
    ])

    await send({
      model,
      tools,
      uiMessages: [USER_MESSAGE],
      toolApproval: ({ toolCall }: any) => {
        timeline.push(`decide:${toolCall.toolCallId}`)

        return toolCall.toolName === 'delete_things'
          ? 'user-approval'
          : undefined
      },
    })

    expect(timeline).toEqual([
      'decide:call-a',
      'decide:call-b',
      'decide:call-c',
      'execute:q',
      'execute:later',
    ])
  })

  it('3c. one answered approval of two gated calls', async () => {
    const model = createScriptedModel([
      toolCallsStep([
        { id: 'call-1', name: 'delete_things', input: { ids: ['a'] } },
        { id: 'call-2', name: 'delete_things', input: { ids: ['b'] } },
      ]),
    ])
    const first = await send({
      model,
      tools: approvalToolSet({ runs: [] }),
      uiMessages: [USER_MESSAGE],
      toolApproval: { delete_things: 'user-approval' },
      secret: SECRET,
    })
    const assistant = await lastMessageOf(first.chunks)
    const [firstPart, secondPart] = assistant.parts.filter((part: any) => {
      return part.state === 'approval-requested'
    }) as any[]
    const partial = respond(assistant, {
      [firstPart.approval.id]: { approved: true },
    })
    const counter = { runs: [] as string[] }
    const secondModel = createScriptedModel([textStep('after')])
    const second = await send({
      model: secondModel,
      tools: approvalToolSet(counter),
      uiMessages: [USER_MESSAGE, partial],
      toolApproval: { delete_things: 'user-approval' },
      secret: SECRET,
    })

    expect(secondPart.state).toBe('approval-requested')
    expect(types(first.chunks).filter((type) => {
      return type === 'tool-approval-request'
    })).toHaveLength(2)
    expect(counter.runs).toEqual(['{"ids":["a"]}'])
    expect(types(second.chunks)).toEqual(['start', 'tool-output-available', 'error'])
    expect(second.events.errors.map(error => error?.name)).toContain(
      'AI_MissingToolResultsError',
    )
    expect(secondModel.doStreamCalls).toHaveLength(0)
  })

  it('3d. a pending approval followed by a new user message is dropped', async () => {
    const { assistant } = await firstRequest()
    const model = createScriptedModel([textStep('fresh start')])
    const counter = { runs: [] as string[] }
    const result = await send({
      model,
      tools: approvalToolSet(counter),
      uiMessages: [
        USER_MESSAGE,
        { ...assistant, id: 'assistant-1' },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Never mind, something else' }],
        },
      ],
      toolApproval: { delete_things: 'user-approval' },
    })
    const roles = result.messages.map(message => message.role)
    const assistantMessage = result.messages.find((message) => {
      return message.role === 'assistant'
    })

    expect(roles).toEqual(['user', 'user'])
    expect(assistantMessage).toBeUndefined()
    expect(types(result.chunks)).toContain('finish')
    expect(counter.runs).toEqual([])
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('4. a killed stream re-executes the approved tool on resend', async () => {
    const killed = await continuation({
      cancelAfterChunkType: 'tool-output-available',
    })
    const resentCounter = { runs: [] as string[] }
    const resentModel = createScriptedModel([textStep('after')])
    const resent = await send({
      model: resentModel,
      tools: approvalToolSet(resentCounter),
      uiMessages: [USER_MESSAGE, killed.respondedAssistant],
      toolApproval: { delete_things: 'user-approval' },
    })

    expect(types(killed.chunks)).toEqual(['start', 'tool-output-available'])
    expect(killed.counter.runs).toEqual(['{"ids":["a","b"]}'])
    expect(killed.events.onEnd).toBeUndefined()
    expect(killed.events.aborted).toBe(false)
    expect(resentCounter.runs).toEqual(['{"ids":["a","b"]}'])
    expect(types(resent.chunks)).toContain('tool-output-available')
    expect(resentModel.doStreamCalls).toHaveLength(1)
  })

  it('5. a missing or renamed tool errors, a replay denial denies', async () => {
    const removed = await continuation({
      tools: (counter) => {
        const { lookup } = approvalToolSet(counter)

        return { lookup }
      },
    })
    const renamed = await continuation({
      tools: (counter) => {
        const { delete_things, lookup } = approvalToolSet(counter)

        return { delete_items: delete_things, lookup }
      },
      toolApproval: { delete_items: 'user-approval' },
    })
    const denied = await continuation({
      toolApproval: {
        delete_things: { type: 'denied', reason: 'Blocked since' },
      },
    })
    const askedAgain = await continuation({
      toolApproval: { delete_things: 'user-approval' },
    })
    const noPolicy = await continuation({ toolApproval: {} })

    for (const missing of [removed, renamed]) {
      expect(types(missing.chunks)).toEqual(['start', 'error'])
      expect(errorNames(missing)).toContain('AI_MissingToolResultsError')
      expect(missing.counter.runs).toEqual([])
      expect(missing.model.doStreamCalls).toHaveLength(0)
    }

    expect(types(denied.chunks)).toContain('tool-output-denied')
    expect(denied.counter.runs).toEqual([])
    expect(denied.model.doStreamCalls).toHaveLength(1)
    expect(toolMessageContent(denied)).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'delete_things',
        output: { type: 'execution-denied', reason: 'Blocked since' },
      },
    ])

    for (const executed of [askedAgain, noPolicy]) {
      expect(types(executed.chunks)).toContain('tool-output-available')
      expect(executed.counter.runs).toEqual(['{"ids":["a","b"]}'])
      expect(executed.model.doStreamCalls).toHaveLength(1)
    }
  })

  it('6. a message after the trailing tool message errors loudly', async () => {
    const appendedInUi = await continuation({ appendUserMessage: true })
    const appendedInModelMessages = await continuation({
      mutateModelMessages: (messages) => {
        return [
          ...messages,
          { role: 'user', content: [{ type: 'text', text: 'extra' }] },
        ]
      },
    })
    const editedEarlierTurn = await continuation({
      mutateModelMessages: (messages) => {
        const [firstMessage, ...rest] = messages

        return [
          {
            ...firstMessage,
            content: [
              ...(firstMessage!.content as any[]),
              { type: 'text', text: 'appended to the earlier user turn' },
            ],
          },
          ...rest,
        ] as ModelMessage[]
      },
    })

    expect(appendedInUi.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])

    for (const trailing of [appendedInUi, appendedInModelMessages]) {
      expect(types(trailing.chunks)).toEqual(['start', 'error'])
      expect(errorNames(trailing)).toContain('AI_MissingToolResultsError')
      expect(trailing.counter.runs).toEqual([])
      expect(trailing.model.doStreamCalls).toHaveLength(0)
    }

    expect(editedEarlierTurn.counter.runs).toEqual(['{"ids":["a","b"]}'])
    expect(editedEarlierTurn.model.doStreamCalls).toHaveLength(1)
  })

  it('7. a signing secret rejects tampering and forged ids', async () => {
    const signed = { secret: SECRET, firstSecret: SECRET }
    const untampered = await continuation(signed)
    const tamperedInput = await continuation({
      ...signed,
      mutate: (part) => {
        part.input = TAMPERED_INPUT
      },
    })
    const forgedApprovalId = await continuation({
      ...signed,
      mutate: (part) => {
        part.approval = { ...part.approval, id: 'forged-approval-id' }
      },
    })
    const strippedSignature = await continuation({
      ...signed,
      mutate: (part) => {
        part.approval = { id: part.approval.id, approved: true }
      },
    })
    const wrongSecret = await continuation({
      secret: 'other-secret',
      firstSecret: SECRET,
    })
    const mismatchedResponseId = await continuation({
      ...signed,
      mutateModelMessages: (messages) => {
        return messages.map((message) => {
          if (message.role !== 'tool') {
            return message
          }

          return {
            ...message,
            content: (message.content as any[]).map((part) => {
              return part.type === 'tool-approval-response'
                ? { ...part, approvalId: 'some-other-id' }
                : part
            }),
          }
        }) as ModelMessage[]
      },
    })
    const unsignedTampered = await continuation({
      mutate: (part) => {
        part.input = TAMPERED_INPUT
      },
    })
    const deniedTampered = await continuation({
      ...signed,
      approved: false,
      mutate: (part) => {
        part.input = TAMPERED_INPUT
      },
    })
    const firstErrorMessage = (result: Continuation) => {
      return result.events.errors[0].message as string
    }
    const pendingPart = findPendingPart(untampered.assistant)
    const requestPart = (untampered.messages[1]!.content as any[]).find(
      part => part.type === 'tool-approval-request',
    )

    expect(typeof pendingPart.approval.signature).toBe('string')
    expect(requestPart.signature).toBe(pendingPart.approval.signature)
    expect(untampered.counter.runs).toEqual(['{"ids":["a","b"]}'])
    expect(types(untampered.chunks)).toContain('tool-output-available')

    for (const rejected of [
      tamperedInput,
      forgedApprovalId,
      strippedSignature,
      wrongSecret,
    ]) {
      expect(types(rejected.chunks)).toEqual(['start', 'error'])
      expect(errorNames(rejected)).toContain(
        'AI_InvalidToolApprovalSignatureError',
      )
      expect(rejected.counter.runs).toEqual([])
      expect(rejected.model.doStreamCalls).toHaveLength(0)
    }

    expect(firstErrorMessage(tamperedInput)).toContain('invalid signature')
    expect(firstErrorMessage(forgedApprovalId)).toContain('invalid signature')
    expect(firstErrorMessage(wrongSecret)).toContain('invalid signature')
    expect(firstErrorMessage(strippedSignature)).toContain('missing signature')
    expect(types(mismatchedResponseId.chunks)).toEqual(['start', 'error'])
    expect(errorNames(mismatchedResponseId)).toContain(
      'AI_InvalidToolApprovalError',
    )
    expect(mismatchedResponseId.counter.runs).toEqual([])
    expect(unsignedTampered.counter.runs).toEqual([
      JSON.stringify(TAMPERED_INPUT),
    ])
    expect(deniedTampered.counter.runs).toEqual([])
    expect(types(deniedTampered.chunks)).toContain('tool-output-denied')
  })

  it('8. the planned Besidka chat tools weigh in at about 29 KB', async () => {
    vi.stubGlobal('defineMcpTool', (definition: unknown) => definition)
    vi.stubGlobal('useEvent', () => {
      return { context: {} }
    })
    vi.stubGlobal('useDb', () => {
      return {}
    })

    const toolModules = import.meta.glob('../../../server/mcp/tools/*.ts')
    const weights = new Map<string, {
      fullBytes: number
      cappedBytes: number
      schemaBytes: number
    }>()

    for (const load of Object.values(toolModules)) {
      try {
        const loaded = await load() as { default: any }
        const definition = loaded.default
        const jsonSchema = asSchema(
          z.object(definition.inputSchema ?? {}),
        ).jsonSchema
        const byteLength = (value: unknown) => {
          return new TextEncoder().encode(JSON.stringify(value)).length
        }
        const serialize = (description: string) => {
          return byteLength({
            name: definition.name,
            description,
            parameters: jsonSchema,
          })
        }

        weights.set(definition.name, {
          fullBytes: serialize(definition.description),
          cappedBytes: serialize(definition.description.slice(0, 300)),
          schemaBytes: byteLength(jsonSchema),
        })
      } catch {
        continue
      }
    }

    const planned = PLANNED_CHAT_TOOL_NAMES.map(name => weights.get(name)!)
    const sum = (key: 'fullBytes' | 'cappedBytes' | 'schemaBytes') => {
      return planned.reduce((total, weight) => total + weight[key], 0)
    }

    expect(PLANNED_CHAT_TOOL_NAMES).toHaveLength(32)
    expect(planned.every(weight => weight !== undefined)).toBe(true)
    expect(weights.size).toBeGreaterThanOrEqual(32)
    expect(sum('fullBytes')).toBeGreaterThan(25_000)
    expect(sum('fullBytes')).toBeLessThan(33_000)
    expect(sum('cappedBytes')).toBeLessThan(sum('fullBytes'))
    expect(sum('cappedBytes')).toBeGreaterThan(22_000)
    expect(sum('schemaBytes')).toBeGreaterThan(13_000)
    expect(sum('schemaBytes')).toBeLessThan(20_000)
  })
})
