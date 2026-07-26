import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      statusCode: input.status,
      why: input.why,
    })

    return exception
  },
}))

async function getClientErrorsHandler() {
  const module = await import(
    '../../../server/api/v1/chats/client-errors.post'
  )

  return module.default
}

describe('POST /api/v1/chats/client-errors', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))
  })

  it('rejects a message over the maximum length', async () => {
    const handler = await getClientErrorsHandler()

    await expect(handler({
      body: { message: 'x'.repeat(501) },
    } as any)).rejects.toMatchObject({ statusCode: 400 })

    expect(mocks.loggerSet).not.toHaveBeenCalled()
  })

  it('accepts a message at the maximum length', async () => {
    const handler = await getClientErrorsHandler()

    await handler({
      body: { message: 'x'.repeat(500) },
    } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'x'.repeat(500) }),
    )
  })

  it('rejects a status code outside the valid HTTP range', async () => {
    const handler = await getClientErrorsHandler()

    await expect(handler({
      body: { status: 600 },
    } as any)).rejects.toMatchObject({ statusCode: 400 })

    expect(mocks.loggerSet).not.toHaveBeenCalled()
  })

  it('rejects an overlong provider or model identifier', async () => {
    const handler = await getClientErrorsHandler()

    await expect(handler({
      body: { modelId: 'x'.repeat(201) },
    } as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('falls back to a default message when none is provided', async () => {
    const handler = await getClientErrorsHandler()

    await handler({ body: {} } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client chat transport error',
      }),
    )
  })

  it('includes the userId when a session is present', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '42' },
    }))

    const handler = await getClientErrorsHandler()

    await handler({ body: { message: 'boom' } } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 }),
    )
  })

  it('responds with no body on success', async () => {
    const handler = await getClientErrorsHandler()
    const response = await handler({ body: {} } as any)

    expect(response).toBeNull()
  })
})
