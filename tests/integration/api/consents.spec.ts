import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  loggerAudit: vi.fn(),
  getCookie: vi.fn<() => string | undefined>(() => undefined),
  getRequestHeader: vi.fn<() => string | undefined>(() => undefined),
  deriveConsentDecision: vi.fn<
    (grantedIds: string[], categories: unknown[]) => string
  >(),
  parseConsentCookieValue: vi.fn<
    (raw: string | null | undefined) => {
      v: number
      granted: string[]
      id?: string
      date?: string
    } | null
  >(),
  insertConsentReceipt: vi.fn<() => Promise<void>>(
    async () => undefined,
  ),
  enforceConsentsRateLimit: vi.fn<() => Promise<void>>(
    async () => undefined,
  ),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
    audit: mocks.loggerAudit,
  }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      statusCode: input.status,
      why: input.why,
      fix: input.fix,
    })

    return exception
  },
}))

vi.mock('~~/server/utils/consents-db', () => ({
  insertConsentReceipt: mocks.insertConsentReceipt,
}))

vi.mock('~~/server/utils/consents-rate-limit', () => ({
  enforceConsentsRateLimit: mocks.enforceConsentsRateLimit,
}))

vi.mock('~~/server/utils/consents', () => ({
  deriveConsentDecision: mocks.deriveConsentDecision,
  parseConsentCookieValue: mocks.parseConsentCookieValue,
}))

vi.mock('nitropack/runtime/internal/config', () => ({
  useRuntimeConfig: () => ({
    public: {
      cookieConsent: {
        cookieName: 'cookies_consent',
        revision: 1,
        categories: [
          { id: 'necessary', required: true },
          { id: 'preferences' },
          { id: 'analytics' },
          { id: 'marketing' },
        ],
      },
    },
  }),
}))

async function getConsentHandler() {
  const module = await import(
    '../../../server/api/v1/consents/index.post'
  )

  return module.default
}

const SERVER_NOW = '2026-06-10T12:00:30.000Z'

const validBody = {
  id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
  date: '2026-06-10T12:00:00.000Z',
  revision: 1,
  granted: ['necessary', 'preferences'],
  denied: ['analytics', 'marketing'],
  changed: ['preferences'],
}

describe('POST /api/v1/consents', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(SERVER_NOW))
    mocks.enforceConsentsRateLimit.mockResolvedValue(undefined)
    mocks.getCookie.mockReturnValue(undefined)
    mocks.getRequestHeader.mockReturnValue(undefined)
    mocks.parseConsentCookieValue.mockReturnValue(null)
    mocks.deriveConsentDecision.mockReturnValue('partial')
    mocks.insertConsentReceipt.mockResolvedValue(undefined)

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getCookie', mocks.getCookie)
    vi.stubGlobal('getRequestHeader', mocks.getRequestHeader)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
  })

  it('returns 400 for invalid body (missing required fields)', async () => {
    const handler = await getConsentHandler()

    await expect(handler({ body: { id: 'only-id' } } as any))
      .rejects
      .toMatchObject({ statusCode: 400 })
  })

  it('returns 400 for invalid body (id too long)', async () => {
    const handler = await getConsentHandler()

    await expect(handler({
      body: {
        ...validBody,
        id: 'x'.repeat(65),
      },
    } as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['the legacy base36 fallback format', 'k3j9x0q2lq8f5n1a'],
    ['a UUID with a bad version nibble', 'a1b2c3d4-e5f6-0890-abcd-ef1234567890'],
    ['an empty string', ''],
  ])('returns 400 with why and fix for an id that is %s', async (_label, id) => {
    const handler = await getConsentHandler()

    await expect(handler({ body: { ...validBody, id } } as any))
      .rejects
      .toMatchObject({
        statusCode: 400,
        why: expect.any(String),
        fix: expect.any(String),
      })

    expect(mocks.insertConsentReceipt).not.toHaveBeenCalled()
  })

  it.each([
    ['more than a day in the past', '2026-06-09T11:59:00.000Z'],
    ['more than a day in the future', '2026-06-11T12:01:00.000Z'],
    ['years away', '2020-01-01T00:00:00.000Z'],
  ])('returns 400 with why and fix for a date %s', async (_label, date) => {
    const handler = await getConsentHandler()

    await expect(handler({ body: { ...validBody, date } } as any))
      .rejects
      .toMatchObject({
        statusCode: 400,
        why: expect.stringContaining('24 hours'),
        fix: expect.any(String),
      })

    expect(mocks.insertConsentReceipt).not.toHaveBeenCalled()
  })

  it.each([
    ['23 hours in the past', '2026-06-09T13:00:30.000Z'],
    ['23 hours in the future', '2026-06-11T11:00:30.000Z'],
    ['a few seconds in the future (clock skew)', '2026-06-10T12:00:35.000Z'],
  ])('accepts a date %s', async (_label, date) => {
    const handler = await getConsentHandler()

    await handler({ body: { ...validBody, date } } as any)

    expect(mocks.insertConsentReceipt).toHaveBeenCalledOnce()
  })

  it('accepts an uppercase UUID id', async () => {
    const handler = await getConsentHandler()

    await handler({
      body: { ...validBody, id: validBody.id.toUpperCase() },
    } as any)

    expect(mocks.insertConsentReceipt).toHaveBeenCalledOnce()
  })

  it('returns 429 and stores nothing when the rate limit is exceeded', async () => {
    mocks.enforceConsentsRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many consent receipts'), {
        statusCode: 429,
      }),
    )

    const handler = await getConsentHandler()

    await expect(handler({ body: validBody } as any))
      .rejects
      .toMatchObject({ statusCode: 429 })

    expect(mocks.insertConsentReceipt).not.toHaveBeenCalled()
  })

  it('checks the rate limit before reading the body', async () => {
    mocks.enforceConsentsRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many consent receipts'), {
        statusCode: 429,
      }),
    )

    const handler = await getConsentHandler()

    await expect(handler({ body: { id: 'only-id' } } as any))
      .rejects
      .toMatchObject({ statusCode: 429 })
  })

  it('accepts valid body, sets consent context with decision partial', async () => {
    mocks.deriveConsentDecision.mockReturnValue('partial')

    const handler = await getConsentHandler()

    await handler({ body: validBody } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consent: expect.objectContaining({
        id: validBody.id,
        date: validBody.date,
        revision: 1,
        granted: ['necessary', 'preferences'],
        denied: ['analytics', 'marketing'],
        changed: ['preferences'],
        decision: 'partial',
        cookiePresent: false,
        consistent: false,
      }),
    })
  })

  it('derives decision=all when all optional categories granted', async () => {
    mocks.deriveConsentDecision.mockReturnValue('all')

    const handler = await getConsentHandler()

    await handler({
      body: {
        ...validBody,
        granted: ['necessary', 'preferences', 'analytics', 'marketing'],
        denied: [],
      },
    } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consent: expect.objectContaining({ decision: 'all' }),
    })
  })

  it('derives decision=none when no optional categories granted', async () => {
    mocks.deriveConsentDecision.mockReturnValue('none')

    const handler = await getConsentHandler()

    await handler({
      body: {
        ...validBody,
        granted: ['necessary'],
        denied: ['preferences', 'analytics', 'marketing'],
      },
    } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consent: expect.objectContaining({ decision: 'none' }),
    })
  })

  it('marks consistent=true when cookie matches body id and granted set', async () => {
    mocks.parseConsentCookieValue.mockReturnValue({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: validBody.id,
      date: validBody.date,
    })
    mocks.getCookie.mockReturnValue(
      JSON.stringify({
        v: 1,
        granted: ['necessary', 'preferences'],
        id: validBody.id,
        date: validBody.date,
      }),
    )

    const handler = await getConsentHandler()

    await handler({ body: validBody } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consent: expect.objectContaining({
        cookiePresent: true,
        consistent: true,
      }),
    })
  })

  it('marks consistent=false when cookie id differs from body', async () => {
    mocks.parseConsentCookieValue.mockReturnValue({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: 'different-id',
      date: validBody.date,
    })
    mocks.getCookie.mockReturnValue(
      JSON.stringify({
        v: 1,
        granted: ['necessary', 'preferences'],
        id: 'different-id',
        date: validBody.date,
      }),
    )

    const handler = await getConsentHandler()

    await handler({ body: validBody } as any)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consent: expect.objectContaining({
        cookiePresent: true,
        consistent: false,
      }),
    })
  })

  it('calls logger.audit for the consent receipt', async () => {
    const handler = await getConsentHandler()

    await handler({ body: validBody } as any)

    expect(mocks.loggerAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.receipt',
        actor: expect.objectContaining({ id: validBody.id, type: 'user' }),
      }),
    )
  })

  it('calls insertConsentReceipt with parsed receipt on happy path', async () => {
    mocks.deriveConsentDecision.mockReturnValue('partial')
    mocks.getRequestHeader.mockReturnValue('DE')

    const handler = await getConsentHandler()

    await handler({ body: validBody } as any)

    expect(mocks.insertConsentReceipt).toHaveBeenCalledOnce()
    expect(mocks.insertConsentReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: validBody.id,
        createdAt: validBody.date,
        revision: validBody.revision,
        granted: validBody.granted,
        denied: validBody.denied,
        changed: validBody.changed,
        decision: 'partial',
        country: 'DE',
      }),
      expect.objectContaining({ set: mocks.loggerSet }),
    )
  })

  it('does not call insertConsentReceipt on validation failure', async () => {
    const handler = await getConsentHandler()

    await expect(handler({ body: { id: 'only-id' } } as any))
      .rejects
      .toMatchObject({ statusCode: 400 })

    expect(mocks.insertConsentReceipt).not.toHaveBeenCalled()
  })
})
