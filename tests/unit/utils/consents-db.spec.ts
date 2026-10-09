import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertFailure: null as Error | null,
  loggerSet: vi.fn(),
  env: { CONSENT_DB: {} } as Record<string, unknown>,
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('cloudflare:workers', () => ({
  env: mocks.env,
}))

vi.mock('drizzle-orm/d1', () => ({
  drizzle: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          if (mocks.insertFailure) {
            throw mocks.insertFailure
          }
        },
      }),
    }),
  }),
}))

const receipt = {
  id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
  createdAt: '2026-10-09T12:00:00.000Z',
  revision: 1,
  granted: ['necessary'],
  denied: ['preferences'],
  changed: ['preferences'],
  decision: 'none' as const,
  consistent: true,
  country: 'DE',
}

describe('insertConsentReceipt', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.insertFailure = null
    vi.stubGlobal('useRuntimeConfig', () => ({ drizzleDebug: false }))
  })

  it('returns a generic why and logs the D1 message under attributes', async () => {
    mocks.insertFailure = new Error('D1_ERROR: no such table: consent_receipts')

    const { insertConsentReceipt } = await import(
      '../../../server/utils/consents-db'
    )

    await expect(
      insertConsentReceipt(receipt, { set: mocks.loggerSet } as never),
    ).rejects.toMatchObject({
      status: 500,
      why: 'The consent database rejected the insert.',
    })

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      attributes: {
        consentDb: {
          error: 'D1_ERROR: no such table: consent_receipts',
        },
      },
    })
  })

  it('never leaks the D1 message through the error', async () => {
    mocks.insertFailure = new Error('SQLITE_CONSTRAINT: internal detail')

    const { insertConsentReceipt } = await import(
      '../../../server/utils/consents-db'
    )

    const failure = await insertConsentReceipt(
      receipt,
      { set: mocks.loggerSet } as never,
    ).catch(exception => exception)

    expect(JSON.stringify(failure)).not.toContain('internal detail')
    expect(failure.message).not.toContain('internal detail')
  })

  it('logs stored=true on success', async () => {
    const { insertConsentReceipt } = await import(
      '../../../server/utils/consents-db'
    )

    await insertConsentReceipt(receipt, { set: mocks.loggerSet } as never)

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentDb: { stored: true },
    })
  })
})
