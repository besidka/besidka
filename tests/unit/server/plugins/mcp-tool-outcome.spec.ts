import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn() },
    useRequestLogger: vi.fn(),
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: mocks.useRequestLogger }
})

type ToolCalledHandler = (call: {
  name: string
  result: { isError?: boolean } | null
  durationMs: number
  event: { context: Record<string, unknown> }
}) => void

let buildMcpToolOutcomeFields: (call: {
  result?: { isError?: boolean } | null
  durationMs: number
}) => Record<string, string | number>
let registerPlugin: (nitroApp: unknown) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const module = await import('~~/server/plugins/mcp-tool-outcome')

  buildMcpToolOutcomeFields = module.buildMcpToolOutcomeFields
  registerPlugin = module.default as unknown as typeof registerPlugin
})

function captureToolCalledHandler(): ToolCalledHandler {
  let handler: ToolCalledHandler | undefined
  const hook = vi.fn((name: string, callback: ToolCalledHandler) => {
    if (name === 'mcp:tool:called') {
      handler = callback
    }
  })

  registerPlugin({ hooks: { hook } })

  if (!handler) {
    throw new Error('mcp:tool:called was not hooked')
  }

  return handler
}

describe('buildMcpToolOutcomeFields', () => {
  it('reports success with the rounded duration', () => {
    expect(buildMcpToolOutcomeFields({
      result: { isError: false },
      durationMs: 12.6,
    })).toEqual({ outcome: 'success', duration_ms: 13 })
  })

  it('reports an isError result as error', () => {
    expect(buildMcpToolOutcomeFields({
      result: { isError: true },
      durationMs: 3.2,
    })).toEqual({ outcome: 'error', duration_ms: 3 })
  })

  it('treats a missing result as success', () => {
    expect(buildMcpToolOutcomeFields({ durationMs: 1 }).outcome)
      .toBe('success')
  })
})

describe('mcp:tool:called hook', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.useRequestLogger.mockReset()
    mocks.useRequestLogger.mockReturnValue(mocks.logger)
  })

  it('writes the outcome onto the logger of the passed event', () => {
    const handler = captureToolCalledHandler()
    const event = { context: {} }

    handler({
      name: 'list_chats',
      result: { isError: true },
      durationMs: 41.4,
      event,
    })

    expect(mocks.useRequestLogger).toHaveBeenCalledWith(event)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { outcome: 'error', duration_ms: 41 },
    })
  })

  it('never throws when the request logger is unavailable', () => {
    mocks.useRequestLogger.mockImplementation(() => {
      throw new Error('no logger')
    })

    const handler = captureToolCalledHandler()

    expect(() => handler({
      name: 'list_chats',
      result: { isError: false },
      durationMs: 5,
      event: { context: {} },
    })).not.toThrow()
  })
})
