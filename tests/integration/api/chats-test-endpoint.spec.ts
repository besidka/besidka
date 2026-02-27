import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capturedChunks: [] as { chunks: any[], ready?: Promise<void> }[],
}))

vi.mock('ai', () => ({
  createUIMessageStream: ({ execute }: any) => {
    const chunks: any[] = []
    let startPromise: Promise<void> | undefined

    const writer = {
      merge: vi.fn(),
    }

    const OriginalReadableStream = globalThis.ReadableStream
    const originalSetTimeout = globalThis.setTimeout

    globalThis.ReadableStream = class {
      constructor(source: any) {
        if (source?.start) {
          const controller = {
            enqueue: (chunk: any) => chunks.push(chunk),
            close: () => {},
          }

          globalThis.setTimeout = ((fn: any) => {
            Promise.resolve().then(fn)

            return 0
          }) as any
          startPromise = source.start(controller)
        }
      }

      getReader() {
        return {
          read: async () => ({ done: true, value: undefined }),
        }
      }
    } as any

    execute({ writer })

    globalThis.ReadableStream = OriginalReadableStream
    const ready = startPromise?.then(() => {
      globalThis.setTimeout = originalSetTimeout
    })

    mocks.capturedChunks.push({ chunks, ready })

    return { writer }
  },
  createUIMessageStreamResponse: ({ stream }: any) => stream,
}))

async function getPostHandler() {
  const module = await import('../../../server/api/v1/chats/test/index.post')

  return module.default
}

async function getGetHandler() {
  const module = await import('../../../server/api/v1/chats/test/index.get')

  return module.default
}

function createEvent(query: Record<string, unknown>) {
  return {
    query,
  }
}

describe('test chat endpoints', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.capturedChunks.length = 0

    process.env.CI = 'true'

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal(
      'getValidatedQuery',
      async (event: any, parser: (query: unknown) => unknown) => {
        return parser(event.query)
      },
    )
  })

  it('returns effort-based reasoning steps for post endpoint', async () => {
    const handler = await getPostHandler()

    await handler(createEvent({
      scenario: 'reasoning',
      messages: '1',
      effort: 'low',
    }) as any)

    await mocks.capturedChunks[0].ready
    const lowChunks = mocks.capturedChunks[0].chunks
    const lowReasoningText = lowChunks
      .filter((chunk: any) => chunk.type === 'reasoning-delta')
      .map((chunk: any) => chunk.delta)
      .join('')
    const lowStepsCount = (
      lowReasoningText.match(/\*\*Step \d+\*\*/g) || []
    ).length

    await handler(createEvent({
      scenario: 'reasoning',
      messages: '1',
      effort: 'high',
    }) as any)

    await mocks.capturedChunks[1].ready
    const highChunks = mocks.capturedChunks[1].chunks
    const highReasoningText = highChunks
      .filter((chunk: any) => chunk.type === 'reasoning-delta')
      .map((chunk: any) => chunk.delta)
      .join('')
    const highStepsCount = (
      highReasoningText.match(/\*\*Step \d+\*\*/g) || []
    ).length

    expect(lowStepsCount).toBe(2)
    expect(highStepsCount).toBe(6)
  })

  it('returns effort-based reasoning steps for get endpoint', async () => {
    const handler = await getGetHandler()
    const response = await handler(createEvent({
      scenario: 'reasoning',
      messages: '2',
      effort: 'medium',
    }) as any)

    const assistantMessage = response.messages.find((message: any) => {
      return message.role === 'assistant'
    })
    const reasoningParts = assistantMessage.parts.filter((part: any) => {
      return part.type === 'reasoning'
    })

    expect(reasoningParts).toHaveLength(4)
    expect(assistantMessage.reasoning).toBe('medium')
  })

  it('supports off effort and returns no reasoning parts', async () => {
    const getHandler = await getGetHandler()
    const getResponse = await getHandler(createEvent({
      scenario: 'reasoning',
      messages: '2',
      effort: 'off',
    }) as any)

    const getAssistantMessage = getResponse.messages.find((message: any) => {
      return message.role === 'assistant'
    })
    const getReasoningParts = getAssistantMessage.parts.filter((part: any) => {
      return part.type === 'reasoning'
    })

    expect(getReasoningParts).toHaveLength(0)
    expect(getAssistantMessage.reasoning).toBe('off')

    const postHandler = await getPostHandler()
    await postHandler(createEvent({
      scenario: 'reasoning',
      messages: '1',
      effort: 'off',
    }) as any)

    const lastCapture = mocks.capturedChunks.at(-1)!

    await lastCapture.ready
    const postChunks = lastCapture.chunks
    const postReasoningChunks = postChunks.filter((chunk: any) => {
      return chunk.type.startsWith('reasoning')
    })

    expect(postReasoningChunks).toHaveLength(0)
  })

  it('returns 400 for invalid effort value', async () => {
    const handler = await getPostHandler()

    await expect(handler(createEvent({
      scenario: 'reasoning',
      messages: '1',
      effort: 'invalid',
    }) as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid request query',
    })
  })
})
