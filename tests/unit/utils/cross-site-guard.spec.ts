import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'

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

function makeEvent(headers: Record<string, string> = {}) {
  return { headers } as never
}

describe('assertNotCrossSiteRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('getRequestHeader', (
      event: { headers: Record<string, string> },
      key: string,
    ) => event.headers[key.toLowerCase()])
  })

  it('throws a 403 for sec-fetch-site cross-site', () => {
    expect(() => {
      assertNotCrossSiteRequest(makeEvent({ 'sec-fetch-site': 'cross-site' }))
    }).toThrow(expect.objectContaining({
      status: 403,
      message: 'Forbidden',
      why: 'sec-fetch-site "cross-site" is cross-site',
    }))
  })

  it.each(['same-origin', 'same-site', 'none'])(
    'allows sec-fetch-site %s',
    (value) => {
      expect(() => {
        assertNotCrossSiteRequest(makeEvent({ 'sec-fetch-site': value }))
      }).not.toThrow()
    },
  )

  it('allows a missing sec-fetch-site header', () => {
    expect(() => {
      assertNotCrossSiteRequest(makeEvent())
    }).not.toThrow()
  })
})
