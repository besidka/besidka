import { describe, expect, it, vi } from 'vitest'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

vi.mock('evlog', () => ({
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

function makeEvent(params: Record<string, string>) {
  return { context: { params } } as never
}

describe('getDecodedRouterParams', () => {
  it('decodes percent-encoded route parameters', () => {
    const params = getDecodedRouterParams(makeEvent({
      key: 'hello%20world%C3%A9',
    }))

    expect(params).toEqual({ key: 'hello worldé' })
  })

  it('returns parameters without encoding unchanged', () => {
    const params = getDecodedRouterParams(makeEvent({ id: 'abc123' }))

    expect(params).toEqual({ id: 'abc123' })
  })

  it.each([
    '%zz',
    '%E0%A4%A',
    '%',
  ])('throws a 400 for malformed encoding %s', (value) => {
    expect(() => {
      getDecodedRouterParams(makeEvent({ key: value }))
    }).toThrow(expect.objectContaining({
      message: 'Invalid route parameter',
      status: 400,
    }))
  })
})
