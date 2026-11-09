import { afterEach, describe, expect, it, vi } from 'vitest'

const { assertRequestBodyLength } = await import(
  '~~/server/utils/artifacts/viewer-storage-request'
)

function stubContentLength(value: string | null | undefined) {
  vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => {
    return name === 'content-length' ? value : undefined
  })
}

function check(maxBytes: number) {
  assertRequestBodyLength({} as never, maxBytes)
}

describe('assertRequestBodyLength', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a body below the limit', () => {
    stubContentLength('100')

    expect(() => check(1000)).not.toThrow()
  })

  it('accepts a body of exactly the limit', () => {
    stubContentLength('1000')

    expect(() => check(1000)).not.toThrow()
  })

  it('answers 413 for a body one byte over the limit', () => {
    stubContentLength('1001')

    expect(() => check(1000)).toThrowError(expect.objectContaining({
      status: 413,
      message: 'Request too large',
    }))
  })

  it('states the sizes in the reason', () => {
    stubContentLength('5000')

    expect(() => check(1000)).toThrowError(expect.objectContaining({
      why: 'The request body is 5000 bytes; at most 1000 are accepted.',
    }))
  })

  it.each([undefined, null, '', 'abc', 'Infinity', 'NaN'])(
    'lets a missing or unreadable Content-Length (%j) through',
    (value) => {
      stubContentLength(value)

      expect(() => check(1000)).not.toThrow()
    },
  )

  it('reads the content-length header of the event', () => {
    const readHeader = vi.fn(() => '1')
    const event = {} as never

    vi.stubGlobal('getRequestHeader', readHeader)
    assertRequestBodyLength(event, 10)

    expect(readHeader).toHaveBeenCalledWith(event, 'content-length')
  })
})
