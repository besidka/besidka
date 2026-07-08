import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getResearchStepsCount } from '../../../server/utils/chats/test/research-steps-count'

const mocks = vi.hoisted(() => ({
  capturedChunks: [] as { chunks: any[], ready?: Promise<void> }[],
}))

function getExpectedResearchSourcesCount(stepsCount: number): number {
  const phaseRepeatsCount = Math.floor((stepsCount - 3) / 2)

  return Math.min(6, phaseRepeatsCount * 2)
}

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

  it('returns a structured pre-stream error response when error=provider-auth', async () => {
    const handler = await getPostHandler()
    const response = await handler({
      query: {
        scenario: 'short',
        messages: '1',
        effort: 'off',
        error: 'provider-auth',
      },
      node: {
        req: {
          headers: {
            'cf-ray': 'cf-ray-test-123',
          },
        },
      },
    } as any)

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: 'provider-auth',
      requestId: 'cf-ray-test-123',
    }))
  })

  it('streams a structured error chunk when error=provider-unavailable', async () => {
    const handler = await getPostHandler()

    await handler({
      query: {
        scenario: 'short',
        messages: '1',
        effort: 'off',
        error: 'provider-unavailable',
      },
      node: {
        req: {
          headers: {
            'cf-ray': 'cf-ray-test-456',
          },
        },
      },
    } as any)

    await mocks.capturedChunks.at(-1)?.ready

    const lastCapture = mocks.capturedChunks.at(-1)!
    const sourceChunk = lastCapture.chunks.find((chunk: any) => {
      return chunk.type === 'source-url'
    })
    const errorChunk = lastCapture.chunks.find((chunk: any) => {
      return chunk.type === 'error'
    })

    expect(sourceChunk).toEqual(expect.objectContaining({
      sourceId: 'test-source-1',
    }))
    expect(JSON.parse(errorChunk.errorText)).toEqual(expect.objectContaining({
      code: 'provider-unavailable',
      requestId: 'cf-ray-test-456',
    }))
  })

  it('returns a structured pre-stream error response when error=clarification-failed', async () => {
    const handler = await getPostHandler()
    const response = await handler({
      query: {
        scenario: 'deep-research',
        messages: '1',
        effort: 'off',
        error: 'clarification-failed',
      },
      node: {
        req: {
          headers: {
            'cf-ray': 'cf-ray-test-789',
          },
        },
      },
    } as any)

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: 'clarification-failed',
      requestId: 'cf-ray-test-789',
    }))
  })

  it('streams a structured error chunk when error=research-step-failed', async () => {
    const handler = await getPostHandler()

    await handler({
      query: {
        scenario: 'deep-research',
        messages: '1',
        effort: 'off',
        error: 'research-step-failed',
      },
      node: {
        req: {
          headers: {
            'cf-ray': 'cf-ray-test-101',
          },
        },
      },
    } as any)

    await mocks.capturedChunks.at(-1)?.ready

    const lastCapture = mocks.capturedChunks.at(-1)!
    const errorChunk = lastCapture.chunks.find((chunk: any) => {
      return chunk.type === 'error'
    })

    expect(JSON.parse(errorChunk.errorText)).toEqual(expect.objectContaining({
      code: 'research-step-failed',
      requestId: 'cf-ray-test-101',
    }))
  })

  describe('deep-research scenario', () => {
    it('emits a start chunk before any research data chunks', async () => {
      const handler = await getPostHandler()

      await handler(createEvent({
        scenario: 'deep-research',
        messages: '1',
        depth: 'standard',
      }) as any)

      const capture = mocks.capturedChunks[0]!

      await capture.ready

      expect(capture.chunks[0]).toEqual(expect.objectContaining({
        type: 'start',
      }))
      expect(capture.chunks.findIndex((chunk: any) => {
        return chunk.type === 'data-research-step'
          || chunk.type === 'data-research-brief'
      })).toBeGreaterThan(0)
    })

    it('streams bounded research step, source and brief chunks per depth', async () => {
      const handler = await getPostHandler()

      await handler(createEvent({
        scenario: 'deep-research',
        messages: '1',
        depth: 'standard',
      }) as any)

      const capture = mocks.capturedChunks[0]!

      await capture.ready

      const stepsCount = getResearchStepsCount('standard')
      const stepChunks = capture.chunks.filter((chunk: any) => {
        return chunk.type === 'data-research-step'
      })
      const sourceChunks = capture.chunks.filter((chunk: any) => {
        return chunk.type === 'source-url'
      })
      const briefChunks = capture.chunks.filter((chunk: any) => {
        return chunk.type === 'data-research-brief'
      })
      const reportText = capture.chunks
        .filter((chunk: any) => chunk.type === 'text-delta')
        .map((chunk: any) => chunk.delta)
        .join('')

      expect(stepChunks).toHaveLength(stepsCount)
      expect(stepChunks.every((chunk: any) => {
        return chunk.id === `research-step-${chunk.data.phase}`
      })).toBe(true)
      expect(sourceChunks).toHaveLength(
        getExpectedResearchSourcesCount(stepsCount),
      )
      expect(briefChunks).toHaveLength(1)
      expect(briefChunks[0].data.depth).toBe('standard')
      expect(typeof briefChunks[0].data.topic).toBe('string')
      expect(briefChunks[0].data.topic.length).toBeGreaterThan(0)
      expect(reportText).toContain('Deep research report')
    })

    it('scales milestone and source counts with a thorough depth', async () => {
      const handler = await getPostHandler()

      await handler(createEvent({
        scenario: 'deep-research',
        messages: '1',
        depth: 'thorough',
      }) as any)

      const capture = mocks.capturedChunks[0]!

      await capture.ready

      const stepsCount = getResearchStepsCount('thorough')
      const stepChunks = capture.chunks.filter((chunk: any) => {
        return chunk.type === 'data-research-step'
      })
      const sourceChunks = capture.chunks.filter((chunk: any) => {
        return chunk.type === 'source-url'
      })

      expect(stepChunks).toHaveLength(stepsCount)
      expect(sourceChunks).toHaveLength(
        getExpectedResearchSourcesCount(stepsCount),
      )
    })

    it('fabricates a matching history message for the get endpoint', async () => {
      const handler = await getGetHandler()
      const response = await handler(createEvent({
        scenario: 'deep-research',
        messages: '2',
        depth: 'quick',
      }) as any)

      const assistantMessage = response.messages.find((message: any) => {
        return message.role === 'assistant'
      })
      const userMessage = response.messages.find((message: any) => {
        return message.role === 'user'
      })
      const sourceParts = assistantMessage.parts.filter((part: any) => {
        return part.type === 'source-url'
      })
      const briefPart = assistantMessage.parts.find((part: any) => {
        return part.type === 'data-research-brief'
      })
      const textPart = assistantMessage.parts.find((part: any) => {
        return part.type === 'text'
      })
      const userTextPart = userMessage.parts.find((part: any) => {
        return part.type === 'text'
      })

      const stepsCount = getResearchStepsCount('quick')

      expect(sourceParts).toHaveLength(
        getExpectedResearchSourcesCount(stepsCount),
      )
      expect(briefPart.data).toEqual(expect.objectContaining({
        depth: 'quick',
        answers: [],
      }))
      expect(textPart.text).toContain('Deep research report')
      expect(userTextPart.text.length).toBeGreaterThan(0)
      expect(assistantMessage.parts.some((part: any) => {
        return part.type === 'data-research-step'
      })).toBe(false)
    })
  })
})
