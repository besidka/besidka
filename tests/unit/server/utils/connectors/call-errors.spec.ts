import { describe, expect, it } from 'vitest'
import { MCPClientError, UnauthorizedError } from '@ai-sdk/mcp'
import { createError } from 'evlog'
import {
  classifyConnectorCallError,
  redactLoggedMessage,
} from '~~/server/utils/connectors/call-errors'

function codedError(code: string, status: number) {
  return createError({ message: 'x', status, code })
}

describe('classifyConnectorCallError', () => {
  it.each([
    ['a 401 from the transport', new MCPClientError({
      message: 'HTTP 401: nope',
      statusCode: 401,
    }), 'auth', 401],
    ['a 403 from the transport', new MCPClientError({
      message: 'HTTP 403',
      statusCode: 403,
    }), 'auth', 403],
    ['an UnauthorizedError', new UnauthorizedError(), 'auth', null],
    ['a refused sign-in', codedError('CONNECTOR_REAUTH_REQUIRED', 401), 'auth', null],
    ['a JSON-RPC unauthorized error', new MCPClientError({
      message: 'Unauthorized: invalid token',
      code: -32000,
    }), 'auth', null],
    ['a 500', new MCPClientError({
      message: 'HTTP 500',
      statusCode: 500,
    }), 'server-error', 500],
    ['a 503', new MCPClientError({
      message: 'HTTP 503',
      statusCode: 503,
    }), 'server-error', 503],
    ['a 429', new MCPClientError({
      message: 'HTTP 429',
      statusCode: 429,
    }), 'rate-limited', 429],
    ['a 404', new MCPClientError({
      message: 'HTTP 404',
      statusCode: 404,
    }), 'protocol', 404],
    ['the safe-fetch timeout', codedError('safe-fetch-timeout', 504), 'timeout', null],
    ['an SDK request timeout', new MCPClientError({
      message: 'Request timed out after 60000ms',
    }), 'timeout', null],
    ['a TimeoutError', Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout', null],
    ['a network failure', codedError('safe-fetch-network', 502), 'unreachable', null],
    ['a blocked address', codedError('safe-fetch-special-name', 400), 'unreachable', null],
    ['a refused redirect', codedError('safe-fetch-redirect-refused', 502), 'unreachable', null],
    ['a moved origin', codedError('CONNECTOR_ORIGIN_CHANGED', 400), 'unreachable', null],
    ['a closed connection', new MCPClientError({
      message: 'Connection closed',
    }), 'unreachable', null],
    ['a refused socket in the cause', new TypeError('fetch failed', {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    }), 'unreachable', null],
    ['an oversized answer', codedError('safe-fetch-too-large', 502), 'protocol', null],
    ['a JSON-RPC error', new MCPClientError({
      message: 'Method not found',
      code: -32601,
    }), 'protocol', null],
    ['a parse failure', new MCPClientError({
      message: 'Failed to parse message',
    }), 'protocol', null],
    ['a validation error', Object.assign(new Error('bad'), {
      name: 'ZodError',
    }), 'protocol', null],
    ['something unknown', new Error('boom'), 'unknown', null],
    ['a thrown string', 'boom', 'unknown', null],
  ])('sorts %s as %s', (_label, exception, category, httpStatus) => {
    const result = classifyConnectorCallError(exception)

    expect(result.category).toBe(category)
    expect(result.httpStatus).toBe(httpStatus)
  })

  it('treats the caller deadline as a timeout over any other signal', () => {
    const result = classifyConnectorCallError(
      new MCPClientError({ message: 'x', statusCode: 500 }),
      { timedOut: true },
    )

    expect(result.category).toBe('timeout')
    expect(result.httpStatus).toBe(500)
  })

  it('prefers the string code over a 5xx status', () => {
    const exception = codedError('safe-fetch-network', 502)

    expect(classifyConnectorCallError(exception).category)
      .toBe('unreachable')
  })

  it('reports the error name and message', () => {
    const result = classifyConnectorCallError(
      new MCPClientError({ message: 'HTTP 500', statusCode: 500 }),
    )

    expect(result.errorName).toBe('MCPClientError')
    expect(result.message).toBe('HTTP 500')
  })
})

describe('redactLoggedMessage', () => {
  it('redacts secrets, flattens whitespace and cuts to 300 characters', () => {
    const message = redactLoggedMessage(
      `key secret-value-1234\n${'x'.repeat(400)}`,
      ['secret-value-1234'],
    )

    expect(message).not.toContain('secret-value-1234')
    expect(message).toContain('[redacted]')
    expect(message).not.toContain('\n')
    expect(message.length).toBeLessThanOrEqual(300)
  })
})
