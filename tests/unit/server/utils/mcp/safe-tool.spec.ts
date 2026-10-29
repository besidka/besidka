import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createError as createH3Error } from 'h3'
import { createError } from 'evlog'
import { normalizeErrorToResult } from '../../../../../node_modules/@nuxtjs/mcp-toolkit/dist/runtime/server/mcp/definitions/tools.js'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    log: { error: vi.fn() },
    useEvent: vi.fn(),
  }
})

vi.mock('nitropack/runtime', () => {
  return {
    defineCachedFunction: vi.fn(),
    useNitroApp: vi.fn(),
    useStorage: vi.fn(),
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: () => mocks.logger }
})

vi.mock('evlog', async (importOriginal) => {
  const original = await importOriginal<typeof import('evlog')>()

  return { ...original, log: mocks.log }
})

const SECRET_MESSAGE = 'SQLITE_ERROR: no such table: _content_keyGuides'

async function loadModule() {
  vi.resetModules()
  vi.stubGlobal('useEvent', mocks.useEvent)

  return await import('~~/server/utils/mcp/safe-tool')
}

async function callToolResult(error: unknown) {
  const { withSafeToolErrors } = await loadModule()
  const handler = withSafeToolErrors(async () => {
    throw error
  })

  try {
    await handler()
  } catch (exception) {
    return normalizeErrorToResult(exception)
  }

  throw new Error('handler did not throw')
}

describe('withSafeToolErrors', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.logger.error.mockReset()
    mocks.log.error.mockReset()
    mocks.useEvent.mockReset()
    mocks.useEvent.mockReturnValue({ context: {} })
  })

  it('returns the handler result untouched', async () => {
    const { withSafeToolErrors } = await loadModule()
    const handler = withSafeToolErrors(async (value: number) => {
      return value * 2
    })

    await expect(handler(21)).resolves.toBe(42)
  })

  it('keeps the message of a deliberate evlog 404', async () => {
    const result = await callToolResult(createError({
      status: 404,
      message: 'No key guide for "x". Call list_providers.',
    }))

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'No key guide for "x". Call list_providers.',
    )
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('keeps the message of a deliberate h3 404',
    async () => {
      const result = await callToolResult(createH3Error({
        statusCode: 404,
        message: 'Page "byok" is not published.',
      }))

      expect(result.content[0].text).toContain(
        'Page "byok" is not published.',
      )
    })

  it('replaces a raw database error with the fixed message', async () => {
    const { MCP_TOOL_FAILURE_MESSAGE } = await loadModule()
    const result = await callToolResult(new Error(SECRET_MESSAGE))

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(MCP_TOOL_FAILURE_MESSAGE)
    expect(result.content[0].text).not.toContain('SQLITE')
  })

  it('replaces a thrown non-error value', async () => {
    const { MCP_TOOL_FAILURE_MESSAGE } = await loadModule()
    const result = await callToolResult(SECRET_MESSAGE)

    expect(result.content[0].text).toBe(MCP_TOOL_FAILURE_MESSAGE)
  })

  it('replaces a 5xx error even when it carries a message', async () => {
    const { MCP_TOOL_FAILURE_MESSAGE } = await loadModule()
    const result = await callToolResult(createError({
      status: 503,
      message: SECRET_MESSAGE,
      why: SECRET_MESSAGE,
    }))

    expect(result.content[0].text).toBe(MCP_TOOL_FAILURE_MESSAGE)
  })

  it('logs the original error on the request logger', async () => {
    const original = new Error(SECRET_MESSAGE)

    await callToolResult(original)

    expect(mocks.logger.set).toHaveBeenCalledWith({
      action: 'mcp-tool-failure',
    })
    expect(mocks.logger.error).toHaveBeenCalledWith(original)
  })

  it('falls back to the standalone logger outside a request', async () => {
    mocks.useEvent.mockImplementation(() => {
      throw new Error('no event')
    })

    const result = await callToolResult(new Error(SECRET_MESSAGE))

    expect(result.content[0].text).not.toContain('SQLITE')
    expect(mocks.log.error).toHaveBeenCalledWith({
      action: 'mcp-tool-failure',
      message: SECRET_MESSAGE,
    })
  })
})

describe('isClientError', () => {
  it('accepts only 4xx statuses from status or statusCode', async () => {
    const { isClientError } = await loadModule()

    expect(isClientError({ status: 404 })).toBe(true)
    expect(isClientError({ statusCode: 400 })).toBe(true)
    expect(isClientError({ status: 500 })).toBe(false)
    expect(isClientError({ status: 399 })).toBe(false)
    expect(isClientError(new Error('x'))).toBe(false)
    expect(isClientError(null)).toBe(false)
    expect(isClientError('404')).toBe(false)
  })
})
